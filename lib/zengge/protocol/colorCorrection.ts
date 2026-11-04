/**
 * Hue correction for LED strings whose green emitter is much brighter than red, so a standard
 * colour wheel looks green-shifted between red and green.
 *
 * Calibrated by eye on the Quntis NS-I-204-M-E (product 0x86) on 2026-11-03 by sweeping device
 * hues and asking which looked like real orange / yellow / green:
 *   device 5-10 = orange, 13 = yellow, 30-90 = (yellowish) green, 120 = pure green;
 *   cyan, blue, magenta matched the standard wheel.
 *
 * The curve is monotonic, so it can be inverted to show the controller's reported hue in Homey.
 */

/** [homeyHueDegrees, deviceHue] pairs, ascending in both columns. */
export type HueCurve = Array<[number, number]>;

export const QUNTIS_HUE_CURVE: HueCurve = [
  [0, 0],
  [30, 7], // orange
  [60, 13], // yellow
  [90, 24], // yellow-green
  [120, 120], // green
  [360, 360],
];

function interpolate(curve: HueCurve, x: number, from: 0 | 1, to: 0 | 1): number {
  const v = ((x % 360) + 360) % 360;
  for (let i = 1; i < curve.length; i++) {
    const a = curve[i - 1];
    const b = curve[i];
    if (v <= b[from]) {
      const span = b[from] - a[from];
      const t = span === 0 ? 0 : (v - a[from]) / span;
      return Math.round(a[to] + t * (b[to] - a[to])) % 360;
    }
  }
  return v;
}

/** Homey hue (degrees) -> hue to send to the controller. */
export function correctHue(hue: number, curve: HueCurve = QUNTIS_HUE_CURVE): number {
  return interpolate(curve, hue, 0, 1);
}

/** Controller-reported hue -> Homey hue (degrees). */
export function uncorrectHue(deviceHue: number, curve: HueCurve = QUNTIS_HUE_CURVE): number {
  return interpolate(curve, deviceHue, 1, 0);
}
