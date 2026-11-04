/**
 * Device state decoding.
 *
 * Sources:
 *  - Surplife app: BleDeviceManagerServer.onArrival() - notification opcode 12 carries JSON
 *    {"code":0,"payload":"<hex>"}, opcode 22 carries raw state bytes.
 *  - Surplife app asset wifi_dp_response.json, state_upload:
 *    "81{devType}{open}{mode}{wiring_sort}{speed}{color}{color}{color}{warm}{ver}{cool}{flag}{cs}" (14 bytes)
 *  - lednetwf_ble (MIT) parse_state_response for the meaning of mode bytes.
 */
import { DecodedMessage } from './transport';
import { NOTIFY_OPCODE_JSON_STATE, NOTIFY_OPCODE_RAW_STATE } from './commands';
import { rgbToHsv, unpackHueSaturation } from './color';

export interface LightState {
  on: boolean | null;
  /** 0x61 static colour/white, 0x25 effect (symphony) ... raw for diagnostics */
  mode: number | null;
  subMode: number | null;
  rgb: [number, number, number] | null;
  /** 0-100 when derivable */
  brightness: number | null;
  speed: number | null;
  effectId: number | null;
  /** 0-359 / 0-100 when the controller reports a static colour */
  hue: number | null;
  saturation: number | null;
  raw: Buffer;
  format: '0x81' | '0xEA81' | 'unknown';
}

/** Unwrap a notification into the raw state/response bytes. */
export function notificationPayload(msg: DecodedMessage): Buffer {
  const p = msg.payload;
  if (msg.opcode === NOTIFY_OPCODE_JSON_STATE || (p.length > 0 && p[0] === 0x7b /* '{' */)) {
    try {
      const json = JSON.parse(p.toString('utf8')) as { code?: number; payload?: string };
      if (json.code === 0 && typeof json.payload === 'string') {
        return Buffer.from(json.payload.replace(/[^0-9a-f]/gi, ''), 'hex');
      }
    } catch {
      // fall through: not JSON
    }
  }
  return p;
}

export function isStateOpcode(opcode: number): boolean {
  return opcode === NOTIFY_OPCODE_JSON_STATE || opcode === NOTIFY_OPCODE_RAW_STATE;
}

export function parseState(data: Buffer): LightState {
  const base: LightState = {
    on: null, mode: null, subMode: null, rgb: null, brightness: null, speed: null, effectId: null, hue: null, saturation: null, raw: data, format: 'unknown',
  };
  if (data.length >= 14 && data[0] === 0x81) {
    const on = data[2] === 0x23 ? true : data[2] === 0x24 ? false : null;
    const mode = data[3];
    const subMode = data[4];
    const rgb: [number, number, number] = [data[6], data[7], data[8]];
    let brightness: number | null = null;
    let effectId: number | null = null;
    if (mode === 0x61 && (subMode === 0xf0 || subMode === 0x01 || subMode === 0x0b)) {
      brightness = rgbToHsv(...rgb).v;
    } else if (mode === 0x61 && subMode === 0x0f) {
      brightness = data[5] <= 100 ? data[5] : null;
    } else if (mode === 0x25) {
      effectId = subMode;
      brightness = data[6] <= 100 ? data[6] : null;
    }
    return { ...base, on, mode, subMode, rgb, brightness, speed: data[5], effectId, format: '0x81' };
  }
  if (data.length >= 7 && data[0] === 0xea && data[1] === 0x81) {
    // DeviceState2. Layout observed on the Quntis controller (product 0x86, fw 44), 2026-11-03,
    // by correlating every command we sent with the state it reported:
    //   [6] power 0x23/0x24   [7] 0x24 static | 0x25 effect   [8] 0x14 static colour | effect id
    //   [9] speed   [11..12] packed hue/saturation   [13] colour level   [15] white level
    const on = data[6] === 0x23 ? true : data[6] === 0x24 ? false : null;
    const mode = data[7] ?? null;
    const subMode = data[8] ?? null;
    const out: LightState = { ...base, on, mode, subMode, format: '0xEA81' };
    if (data.length >= 16) {
      out.speed = data[9];
      if (mode === 0x25) {
        out.effectId = subMode;
      } else if (mode === 0x24 && subMode === 0x14) {
        const { h, s } = unpackHueSaturation(data[11], data[12]);
        const colourLevel = data[13];
        const whiteLevel = data[15];
        if (s === 0 && whiteLevel > 0) {
          out.saturation = 0;
          out.brightness = whiteLevel <= 100 ? whiteLevel : null;
        } else {
          out.hue = h <= 359 ? h : null;
          out.saturation = s <= 100 ? s : null;
          out.brightness = colourLevel <= 100 ? colourLevel : null;
        }
      }
    }
    return out;
  }
  return base;
}
