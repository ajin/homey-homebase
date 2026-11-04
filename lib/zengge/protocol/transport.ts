/**
 * Zengge "ZGHB" BLE transport framing.
 *
 * Ported from the Surplife Android app (decompiled):
 *   com.zengge.hagallbjarkan.protocol.zgble.LowerTransportLayerEncoder
 *   com.zengge.hagallbjarkan.protocol.zgble.LowerTransportLayerDecoder
 *   com.zengge.hagallbjarkan.handler.zghb.ZGHBWriteUtils
 *
 * This layer is independent of Homey and of the light-level command set: it only wraps an
 * (opcode, payload) pair into one or more GATT writes and reassembles notifications.
 *
 * Frame layout, version 0 (bleVersion < 8), unsegmented:
 *   [0] ctrl     bit6 = segmented, bit5 = protect, bit4 = ack, bits0-1 = frame version
 *   [1] seq      per-device sequence number (app starts at 1 and wraps as a signed byte)
 *   [2..3] frag  0x8000 = "last segment, number 0"
 *   [4..5] total payload length (big endian)
 *   [6]  payload length + 1 (length of opcode + payload in this frame)
 *   [7]  opcode  (the app calls it cmdId / opcode)
 *   [8..] payload
 *
 * Version 1 (bleVersion >= 8) widens field [6] to two bytes, so the header is 9 bytes and
 * continuation segments carry a 2-byte chunk length.
 */

export const ZG_SERVICE_UUID = 'ffff';
export const ZG_WRITE_CHAR_UUID = 'ff01';
export const ZG_NOTIFY_CHAR_UUID = 'ff02';

/** App constants: MAX_PACKAGE_LENGTH (v0) and MAX_PACKAGE_LENGTH_V1 (v1). */
export const MAX_PACKET_V0 = 255;
export const MAX_PACKET_V1 = 512;

/** Upper transport "type" value the app treats as a bare ACK (ignored for data). */
export const TYPE_ACK = 2;

export type FrameVersion = 0 | 1;

/** ZGHBWriteUtils.getWriteVersion */
export function frameVersionForBle(bleVersion: number): FrameVersion {
  return bleVersion >= 8 ? 1 : 0;
}

function ctrlByte(segmented: boolean, version: FrameVersion, protect = false, ack = false): number {
  let b = 0;
  if (segmented) b |= 0x40;
  if (protect) b |= 0x20;
  if (ack) b |= 0x10;
  return b | (version & 0x03);
}

export interface EncodeOptions {
  seq: number;
  /** Maximum bytes per GATT write. The app uses min(MTU, 255) for v0, min(MTU, 512) for v1. */
  maxPacket?: number;
  version?: FrameVersion;
}

/** Encode one logical command into the list of GATT writes to perform, in order. */
export function encodeFrames(opcode: number, payload: Buffer, opts: EncodeOptions): Buffer[] {
  const version = opts.version ?? 0;
  const max = Math.min(opts.maxPacket ?? (version === 1 ? MAX_PACKET_V1 : MAX_PACKET_V0),
    version === 1 ? MAX_PACKET_V1 : MAX_PACKET_V0);
  const seq = opts.seq & 0xff;
  const len = payload.length;
  if (len > 0xffff) throw new RangeError('payload too large');
  const headerLen = version === 1 ? 9 : 8;
  const subHeaderLen = version === 1 ? 6 : 5;
  if (max <= headerLen + 1) throw new RangeError(`maxPacket ${max} too small`);

  if (len <= max - headerLen) {
    const out = Buffer.alloc(headerLen + len);
    out[0] = ctrlByte(false, version);
    out[1] = seq;
    out[2] = 0x80;
    out[3] = 0x00;
    out[4] = (len >> 8) & 0xff;
    out[5] = len & 0xff;
    if (version === 1) {
      out[6] = ((len + 1) >> 8) & 0xff;
      out[7] = (len + 1) & 0xff;
      out[8] = opcode & 0xff;
    } else {
      out[6] = (len + 1) & 0xff;
      out[7] = opcode & 0xff;
    }
    payload.copy(out, headerLen);
    return [out];
  }

  const frames: Buffer[] = [];
  const firstChunk = max - headerLen;
  const first = Buffer.alloc(max);
  first[0] = ctrlByte(true, version);
  first[1] = seq;
  first[2] = 0x00;
  first[3] = 0x00;
  first[4] = (len >> 8) & 0xff;
  first[5] = len & 0xff;
  if (version === 1) {
    const l = max - 8; // app: i3 - 8
    first[6] = (l >> 8) & 0xff;
    first[7] = l & 0xff;
    first[8] = opcode & 0xff;
  } else {
    first[6] = (max - 7) & 0xff; // app: i3 - 7
    first[7] = opcode & 0xff;
  }
  payload.copy(first, headerLen, 0, firstChunk);
  frames.push(first);

  let offset = firstChunk;
  let segment = 1;
  const chunkMax = max - subHeaderLen;
  while (offset < len) {
    const chunk = Math.min(len - offset, chunkMax);
    const last = offset + chunk >= len;
    const frag = (last ? 0x8000 : 0) | segment;
    const f = Buffer.alloc(subHeaderLen + chunk);
    f[0] = ctrlByte(true, version);
    f[1] = seq;
    f[2] = (frag >> 8) & 0xff;
    f[3] = frag & 0xff;
    if (version === 1) {
      f[4] = (chunk >> 8) & 0xff;
      f[5] = chunk & 0xff;
    } else {
      f[4] = chunk & 0xff;
    }
    payload.copy(f, subHeaderLen, offset, offset + chunk);
    frames.push(f);
    offset += chunk;
    segment++;
  }
  return frames;
}

export interface DecodedMessage {
  opcode: number;
  payload: Buffer;
  seq: number;
  /** Upper transport type: 0 = JSON, 1 = HEX, 2 = ACK (app constants). */
  type: number;
  ack: boolean;
  protect: boolean;
}

/**
 * Stateful notification reassembler (one per connection).
 * Mirrors LowerTransportLayerDecoder.getTransport / getTransportV1.
 */
export class FrameDecoder {
  private seq = -1;
  private prevSegment = -1;
  private opcode = -1;
  private buffer: Buffer | null = null;
  private index = 0;

  reset(): void {
    this.seq = -1;
    this.prevSegment = -1;
    this.opcode = -1;
    this.buffer = null;
    this.index = 0;
  }

  private finish(ctrl: number, seq: number, opcode: number, payload: Buffer): DecodedMessage {
    this.reset();
    return {
      opcode,
      payload,
      seq,
      type: (ctrl & 0x0c) >> 2,
      ack: (ctrl & 0x10) !== 0,
      protect: (ctrl & 0x20) !== 0,
    };
  }

  /** Feed one notification. Returns a complete message, or null if more segments are needed. */
  push(data: Buffer): DecodedMessage | null {
    if (data.length === 0) return null;
    const ctrl = data[0];
    const v1 = (ctrl & 0x03) === 1;
    const headerLen = v1 ? 9 : 8;
    const segmented = (ctrl & 0x40) === 0x40;

    if (!segmented) {
      if (data.length < (v1 ? 8 : 7)) return null;
      const frag = (data[2] << 8) | data[3];
      if (frag !== 0x8000) return null;
      const total = (data[4] << 8) | data[5];
      if (total > MAX_MESSAGE_BYTES) return null;
      const inner = v1 ? ((data[6] << 8) | data[7]) - 1 : data[6];
      const opcode = inner > 0 ? data[v1 ? 8 : 7] : -1;
      const payload = Buffer.alloc(total);
      if (inner > 0) data.copy(payload, 0, headerLen, headerLen + total);
      return this.finish(ctrl, data[1], opcode, payload);
    }

    if (data.length < 4) {
      this.reset();
      return null;
    }
    const segNum = ((data[2] << 8) & 0x7f00) | data[3];
    const fragFull = (data[2] << 8) | data[3];
    if (fragFull === 0) {
      this.reset();
      if (data.length < headerLen) return null;
      const total = (data[4] << 8) | data[5];
      if (total > MAX_MESSAGE_BYTES) return null;
      const firstLen = (v1 ? ((data[6] << 8) | data[7]) : data[6]) - 1;
      this.seq = data[1];
      this.opcode = data[v1 ? 8 : 7];
      this.buffer = Buffer.alloc(total);
      data.copy(this.buffer, 0, headerLen, headerLen + Math.min(firstLen, total));
      this.index = data.length - headerLen;
      this.prevSegment = segNum;
      return null;
    }
    if (this.buffer && this.seq === data[1] && this.prevSegment === segNum - 1) {
      const sub = v1 ? 6 : 5;
      const chunk = v1 ? ((data[4] << 8) | data[5]) : data[4];
      if (this.index + chunk > this.buffer.length) {
        this.reset();
        return null;
      }
      data.copy(this.buffer, this.index, sub, sub + chunk);
      this.index += chunk;
      this.prevSegment = segNum;
      if ((data[2] & 0x80) === 0x80) {
        return this.finish(ctrl, this.seq, this.opcode, this.buffer);
      }
      return null;
    }
    this.reset();
    return null;
  }
}

/** Largest message accepted from a controller; state replies are well under 200 bytes. */
export const MAX_MESSAGE_BYTES = 2048;

/** Per-device sequence counter (SequenceUtils.nextByteSeq: starts at 1, wraps at 8 bits). */
export class SequenceCounter {
  private value = 0;

  next(): number {
    this.value = (this.value + 1) & 0xff;
    return this.value;
  }
}
