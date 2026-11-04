/** Colour helpers. Kept free of Homey types so they can be unit tested. */

export interface Hsv {
  /** 0-360 */
  h: number;
  /** 0-100 */
  s: number;
  /** 0-100 */
  v: number;
}

export function clamp(n: number, lo: number, hi: number): number {
  return Math.min(hi, Math.max(lo, n));
}

/** Homey light_hue / light_saturation / dim (all 0..1) to device HSV. */
/**
 * Brightness as the eye sees it. LED controllers dim linearly (PWM duty), but perceived brightness
 * is roughly the square of that, so a linear 50 % looks almost as bright as 100 %. The perceptual
 * curve maps Homey's dim slider through gamma 2 so 50 % on the slider looks about half as bright.
 *
 * It starts at MIN_VISIBLE_LEVEL: on the Quntis the white LEDs stay dark at level 1 and light at 2
 * (seen 2026-11-04), so the slider's lowest position still gives light.
 * Returns the controller level 1-100 for a Homey dim 0-1 (above 0).
 */
export type BrightnessCurve = 'perceptual' | 'linear';
export const BRIGHTNESS_GAMMA = 2;
export const MIN_VISIBLE_LEVEL = 2;
export function dimToLevel(dim: number, curve: BrightnessCurve = 'perceptual'): number {
  const d = clamp(dim, 0, 1);
  if (curve === 'linear') return clamp(Math.round(d * 100), 1, 100);
  const level = MIN_VISIBLE_LEVEL + (100 - MIN_VISIBLE_LEVEL) * d ** BRIGHTNESS_GAMMA;
  return clamp(Math.round(level), MIN_VISIBLE_LEVEL, 100);
}
/** The inverse of dimToLevel: Homey dim 0.01-1 for a controller level 1-100. */
export function levelToDim(level: number, curve: BrightnessCurve = 'perceptual'): number {
  const l = clamp(level, 1, 100);
  const dim = curve === 'linear' ? l / 100 : Math.max(0, (l - MIN_VISIBLE_LEVEL) / (100 - MIN_VISIBLE_LEVEL)) ** (1 / BRIGHTNESS_GAMMA);
  return Math.max(0.01, Math.round(dim * 100) / 100);
}

export function homeyToHsv(hue: number, saturation: number, dim: number): Hsv {
  return {
    h: clamp(Math.round(hue * 360), 0, 359),
    s: clamp(Math.round(saturation * 100), 0, 100),
    v: clamp(Math.round(dim * 100), 0, 100),
  };
}

export function hsvToRgb({ h, s, v }: Hsv): [number, number, number] {
  const sf = s / 100;
  const vf = v / 100;
  const c = vf * sf;
  const hp = (h % 360) / 60;
  const x = c * (1 - Math.abs((hp % 2) - 1));
  let rgb: [number, number, number];
  if (hp < 1) rgb = [c, x, 0];
  else if (hp < 2) rgb = [x, c, 0];
  else if (hp < 3) rgb = [0, c, x];
  else if (hp < 4) rgb = [0, x, c];
  else if (hp < 5) rgb = [x, 0, c];
  else rgb = [c, 0, x];
  const m = vf - c;
  return rgb.map((n) => Math.round((n + m) * 255)) as [number, number, number];
}

export function rgbToHsv(r: number, g: number, b: number): Hsv {
  const rf = r / 255;
  const gf = g / 255;
  const bf = b / 255;
  const max = Math.max(rf, gf, bf);
  const min = Math.min(rf, gf, bf);
  const d = max - min;
  let h = 0;
  if (d !== 0) {
    if (max === rf) h = 60 * (((gf - bf) / d) % 6);
    else if (max === gf) h = 60 * ((bf - rf) / d + 2);
    else h = 60 * ((rf - gf) / d + 4);
  }
  if (h < 0) h += 360;
  return {
    h: Math.round(h) % 360,
    s: max === 0 ? 0 : Math.round((d / max) * 100),
    v: Math.round(max * 100),
  };
}

/**
 * Pack hue (0-359) and saturation (0-100) into two bytes: (hue << 7) | sat.
 * Used by the 0x3B 0xA1 colour command (hardware-verified by the lednetwf_ble project on
 * other Zengge BLE controllers; not yet verified on the Quntis controller).
 */
export function packHueSaturation(h: number, s: number): [number, number] {
  const packed = ((clamp(Math.round(h), 0, 359) << 7) | clamp(Math.round(s), 0, 100)) & 0xffff;
  return [(packed >> 8) & 0xff, packed & 0xff];
}

export function unpackHueSaturation(hi: number, lo: number): { h: number; s: number } {
  const packed = (hi << 8) | lo;
  return { h: packed >> 7, s: packed & 0x7f };
}
