/**
 * Hamulight L2046 433 MHz remote protocol (OOK, 200 us symbol).
 *
 * Every frame on air is:
 *   start  H200 L200 H200 L200 H1200 L1200
 *   32 bits, pulse-width coded: 0 = H200 L600, 1 = H600 L200
 *   end    H200 L200 H200
 * and the remote repeats it about ten times per press.
 *
 * Bits 0-15 are the remote id (different for every remote, which is why codes copied from another
 * installation do nothing). The meaning of bits 16-31 differs between remote generations:
 *   - aukedejong/esphome-hamulight (remote 351B): toggle = A045, dim ring = 0 + 15-bit level
 *   - RFFHEM issue 1206 (remote 3605): on/off = 5F47, preset dims 553D/563E/5038/5941
 * so this code does not rely on a command table: the app learns the frames of the user's own
 * remote and replays them. See docs/hamulight/RESEARCH.md.
 *
 * No Homey imports here, so it can be unit tested.
 */

export const FRAME_BITS = 32;

/** A frame as an unsigned 32-bit number. */
export type Frame = number;

export function frameToBits(frame: Frame): number[] {
  const bits: number[] = [];
  for (let i = FRAME_BITS - 1; i >= 0; i--) bits.push((frame >>> i) & 1);
  return bits;
}

export function bitsToFrame(bits: ArrayLike<number>): Frame | null {
  if (bits.length !== FRAME_BITS) return null;
  let v = 0;
  for (let i = 0; i < FRAME_BITS; i++) {
    const b = bits[i];
    if (b !== 0 && b !== 1) return null;
    v = (v * 2) + b;
  }
  return v >>> 0;
}

export function remoteId(frame: Frame): number {
  return (frame >>> 16) & 0xffff;
}

export function commandPart(frame: Frame): number {
  return frame & 0xffff;
}

export function hex(value: number, digits: number): string {
  return value.toString(16).toUpperCase().padStart(digits, '0');
}

export function frameHex(frame: Frame): string {
  return hex(frame >>> 0, 8);
}

export function parseFrameHex(text: string): Frame | null {
  const t = text.trim().replace(/^0x/i, '');
  if (!/^[0-9a-f]{8}$/i.test(t)) return null;
  return parseInt(t, 16) >>> 0;
}

/** Command byte (bits 16-23) and checksum byte (bits 24-31). */
export function commandByte(frame: Frame): number {
  return (frame >>> 8) & 0xff;
}

/** On/off command byte, seen on remotes 351B (L2046, aukedejong) and 4516 (HM3002). */
export const TOGGLE_COMMAND = 0xa0;

/**
 * Checksum byte = (id high byte + id low byte + command + 0x55) & 0xFF.
 * Verified on remote 4516 (HM3002: A050, 3EEE, 3DED, 3CEC) and on the published 351B A045.
 * The RFFHEM captures of remote 3605 do not follow it (another remote generation).
 */
export function checksumFor(remote: number, command: number): number {
  return (((remote >>> 8) & 0xff) + (remote & 0xff) + (command & 0xff) + 0x55) & 0xff;
}

export function checksumOk(frame: Frame): boolean {
  return checksumFor(remoteId(frame), commandByte(frame)) === (frame & 0xff);
}

export function buildFrame(remote: number, command: number): Frame {
  return (((remote & 0xffff) << 16) | ((command & 0xff) << 8) | checksumFor(remote, command)) >>> 0;
}

/**
 * Brightness ring (HM3002): while touched, the remote sends the finger's absolute position on the
 * ring as the command byte, 0x00-0x7F, wrapping around (…7E 7F 00 01…). Command bytes with the
 * top bit set are buttons (A0 = on/off). aukedejong's published L2046 dim range runs from position
 * 4F (darkest) downwards, through 00/7F, to 5F (brightest). RFFHEM maps 0-100 % to 1.17 x pct + 170
 * (minus 127 above 254) with inverted bits, which is 55 (darkest) down to 5F (brightest) here.
 */
export const RING_POSITIONS = 0x80;

export type RingDirection = 'down' | 'up';

export interface RingRange {
  dark: number;
  bright: number;
  direction: RingDirection;
}

export const RING_DEFAULTS: RingRange = { dark: 0x55, bright: 0x5f, direction: 'down' };

/** Number of positions from dark to bright, walking the ring in the given direction. */
export function ringSpan(r: RingRange): number {
  const d = r.direction === 'down' ? r.dark - r.bright : r.bright - r.dark;
  return ((d % RING_POSITIONS) + RING_POSITIONS) % RING_POSITIONS;
}

/** Ring position for a Homey dim value 0..1 (0 = dark end, 1 = bright end). */
export function ringPositionFor(dim: number, r: RingRange): number {
  const d = Math.min(1, Math.max(0, dim));
  const step = Math.round(d * ringSpan(r));
  const p = r.direction === 'down' ? r.dark - step : r.dark + step;
  return ((p % RING_POSITIONS) + RING_POSITIONS) % RING_POSITIONS;
}

/** Dim value for a ring position, or null when it lies outside the range. */
export function dimForRingPosition(position: number, r: RingRange): number | null {
  const span = ringSpan(r);
  if (span === 0) return null;
  const d = r.direction === 'down' ? r.dark - position : position - r.dark;
  const step = ((d % RING_POSITIONS) + RING_POSITIONS) % RING_POSITIONS;
  return step <= span ? step / span : null;
}

export function parseRingPosition(text: string | number | undefined, fallback: number): number {
  if (typeof text === 'number') return text >= 0 && text < RING_POSITIONS ? Math.round(text) : fallback;
  const t = String(text ?? '').trim().replace(/^0x/i, '');
  if (!/^[0-9a-f]{1,2}$/i.test(t)) return fallback;
  const v = parseInt(t, 16);
  return v < RING_POSITIONS ? v : fallback;
}

/** What the app learned from the user's remote, kept in the device store. */
export interface LearnedRemote {
  /** 16-bit remote id. */
  remoteId: number;
  /** Full frame of the on/off button (the light only knows "toggle"). */
  toggle: Frame;
  /** Brightness frames in order from darkest to brightest, as captured from the ring. */
  levels: Frame[];
}

/**
 * Pick the brightness frame for a Homey dim value (0..1). Levels are spread evenly over the
 * learned frames; 0 still sends the darkest one (switching off is a separate toggle).
 */
export function levelIndexFor(dim: number, levelCount: number): number {
  if (levelCount <= 0) return -1;
  const d = Math.min(1, Math.max(0, dim));
  return Math.min(levelCount - 1, Math.round(d * (levelCount - 1)));
}

export function dimForLevelIndex(index: number, levelCount: number): number {
  if (levelCount <= 1) return 1;
  return Math.min(1, Math.max(0, index / (levelCount - 1)));
}

/**
 * Clean a captured ring sweep: drop the toggle frame and frames from other remotes, keep first
 * occurrences in capture order.
 */
export function cleanLevels(frames: Frame[], remote: number, toggle: Frame): Frame[] {
  const out: Frame[] = [];
  for (const f of frames) {
    if (remoteId(f) !== remote || f === toggle || out.includes(f)) continue;
    out.push(f);
  }
  return out;
}

/**
 * Brightness frame using the encoding published for remote 351B (aukedejong/esphome-hamulight):
 * remote id, then a 0 bit and a 15-bit level. Only a fallback for remotes whose ring was not
 * learned; it may not work for other remote generations. percent: 1..100.
 */
export function generatedDimFrame(remote: number, percent: number): Frame {
  const p = Math.min(100, Math.max(1, Math.round(percent)));
  let level = 20479 - 289 * p + 289;
  if (level < 249) level += 32222;
  if (p === 100) level = 24357;
  return (((remote & 0xffff) << 16) | (level & 0x7fff)) >>> 0;
}

/**
 * Pulse timings (us) of one frame, starting with a high pulse, as the remote sends it. Used by
 * tests and the research notes; Homey builds the same timings from the signal definition in
 * .homeycompose/signals/433/hamulight.json.
 */
export const TIMING = {
  start: [200, 200, 200, 200, 1200, 1200],
  zero: [200, 600],
  one: [600, 200],
  end: [200, 200, 200],
} as const;

export function framePulses(frame: Frame): number[] {
  const out: number[] = [...TIMING.start];
  for (const b of frameToBits(frame)) out.push(...(b ? TIMING.one : TIMING.zero));
  out.push(...TIMING.end);
  return out;
}

/** Same frame as the 200 us symbol string used in aukedejong/esphome-hamulight (1 = carrier on). */
export function frameSymbols(frame: Frame): string {
  let s = '';
  let high = true;
  for (const us of framePulses(frame)) {
    s += (high ? '1' : '0').repeat(Math.round(us / 200));
    high = !high;
  }
  return s;
}

/**
 * Sending, as the real remote does it (RFFHEM protocol 22 captures, issue 1206; klockie86/
 * Hamulight2MQTT): a short lead pulse, then frames back to back WITHOUT a gap, each preceded by
 * four H200 L200 pairs and the H1200 L1200 sync; exactly 10 frames per press. The send-only signal
 * `hamulight_tx` does this: agc = lead pulse, sof = 4 pairs + sync, word 2 = the next frame's
 * 4 pairs + sync (follows the last bit's low directly), eof = H200, interval = L200, so Homey's
 * repetitions continue the same pattern with only one extra short pair.
 */
export const FRAME_SEPARATOR_WORD = 2;
export const TX_AGC_INTERVALS = 2;
export const TX_START_INTERVALS = 10;
export const TX_SEPARATOR_INTERVALS = 10;
export const TX_END_INTERVALS = 1;
/** Frames per press, as counted on the real remote ("genau 10 Nachrichten pro Tastenbetätigung"). */
export const FRAMES_PER_PRESS = 10;

/** Homey's radio takes at most 256 pulse intervals per transmission. */
export const MAX_TX_INTERVALS = 256;

/** Pulse intervals of `count` frames joined in one transmission. */
export function packedIntervals(count: number): number {
  return TX_AGC_INTERVALS + TX_START_INTERVALS + count * FRAME_BITS * 2 + (count - 1) * TX_SEPARATOR_INTERVALS + TX_END_INTERVALS;
}

export const FRAMES_PER_TX = (() => {
  let n = 1;
  while (packedIntervals(n + 1) <= MAX_TX_INTERVALS) n++;
  return n;
})();

/** Word indexes for `count` copies of a frame in one `hamulight_tx` transmission. */
export function packedPayload(frame: Frame, count: number): number[] {
  const bits = frameToBits(frame);
  const out: number[] = [];
  for (let i = 0; i < count; i++) {
    if (i > 0) out.push(FRAME_SEPARATOR_WORD);
    out.push(...bits);
  }
  return out;
}

/**
 * How to send a command: one unbroken transmission of up to FRAMES_PER_TX frames, never Homey
 * repetitions. Homey leaves gaps between repetitions, and the light then sometimes counted one
 * command as two presses (switched on and straight off again).
 */
export function txPlan(frames: number): { perTx: number; repetitions: number } {
  const n = Math.max(1, Math.round(frames));
  return { perTx: Math.min(FRAMES_PER_TX, n), repetitions: 1 };
}

/** Preset keys of the HM3002 (klockie86/Hamulight2MQTT, RFFHEM dim_1..dim_4). */
export const PRESET_DIM: Record<number, number> = { 0xaa: 0.25, 0xa9: 0.5, 0xaf: 0.75, 0xa6: 1 };
