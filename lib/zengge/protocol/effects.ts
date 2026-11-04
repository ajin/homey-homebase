/**
 * Symphony "E1 21" scene command and named presets.
 *
 * Layout (opcode 0x0A, no checksum):
 *   E1 21 00 <brightness 1-100> <pattern> <subMode> <flags> 64 <speed 1-100> 00 00 00 00 00 00
 *   <colourCount> then per colour: <hue/2> <saturation 0-100> <brightness 0-100> <cool white 0-100> <warm white 0-100>
 *
 * Verified on the Quntis NS-I-204-M-E (product 0x86, BLE v7, fw 44) on 2026-11-03: pattern 0x19
 * with the "Christmas 1" palette started an animation and the controller reported mode 0x25 with
 * effect 0x19. Byte layout and the named palettes below come from HCI captures of the Surplife app
 * driving Surplife-app string lights (magichome2-ble, MIT, docs/protocol_map.md).
 *
 * Palette hues are the raw device hue bytes the app sent; the device hue scale is not standard
 * HSV, so they are kept verbatim rather than converted.
 */
import { clamp } from './color';
import type { LightCommand } from './commands';

export interface PaletteColour {
  h: number;
  s: number;
  b: number;
  /** Cool-white channel 0-100 (palette byte 4). Verified on the Quntis 2026-11-04. */
  cw?: number;
  /** Warm-white channel 0-100 (palette byte 5). Verified on the Quntis 2026-11-04. */
  ww?: number;
}

export interface EffectPreset {
  id: string;
  name: string;
  pattern: number;
  speed: number;
  subMode?: number;
  flags?: number;
  hues: number[];
}

export function symphonyScene(
  pattern: number,
  speed: number,
  brightness: number,
  colours: PaletteColour[],
  subMode = 0x00,
  flags = 0x01,
): LightCommand {
  const list = colours.slice(0, 8);
  const bytes = [
    0xe1, 0x21, 0x00,
    clamp(Math.round(brightness), 1, 100),
    clamp(Math.round(pattern), 1, 255),
    subMode & 0xff,
    flags & 0xff,
    0x64,
    clamp(Math.round(speed), 1, 100),
    0, 0, 0, 0, 0, 0,
    list.length,
  ];
  for (const c of list) bytes.push(c.h & 0xff, clamp(c.s, 0, 100), clamp(c.b, 0, 100), clamp(c.cw ?? 0, 0, 100), clamp(c.ww ?? 0, 0, 100));
  return {
    opcode: 0x0a,
    payload: Buffer.from(bytes),
    label: `scene pattern 0x${pattern.toString(16)} speed ${speed} (e1 21)`,
    provenance: 'third-party',
  };
}

const full = (hues: number[]): PaletteColour[] => hues.map((h) => ({ h, s: 100, b: 100 }));

/**
 * Palettes as captured from the Surplife app (protocol_map.md "Named Effect Lookup"). Kept as
 * verified byte fixtures only: compared with the Surplife cloud scene list (2026-11-04) the
 * magichome2-ble names are attached to the wrong scenes (e.g. their "Champagne" is the app's
 * "Northern lights"). The effect library uses lib/zengge/effects/surplifeScenes.ts instead.
 */
export const EFFECT_PRESETS: EffectPreset[] = [
  { id: 'christmas1', name: 'Christmas 1', pattern: 0x19, speed: 80, hues: [0, 120, 0, 0, 30] },
  { id: 'christmas2', name: 'Christmas 2', pattern: 0x14, speed: 80, hues: [60, 135, 30, 11] },
  { id: 'christmas3', name: 'Christmas 3', pattern: 0x0a, speed: 80, hues: [0, 30, 0, 30, 0, 30, 0, 30] },
  { id: 'candy_cane', name: 'Candy cane', pattern: 0x1c, speed: 80, hues: [8, 14] },
  { id: 'new_year', name: 'New Year', pattern: 0x0a, speed: 80, hues: [0, 60, 120, 30, 150, 90, 0] },
  { id: 'halloween1', name: 'Halloween 1', pattern: 0x0b, speed: 80, hues: [0, 0, 0, 120] },
  { id: 'halloween2', name: 'Halloween 2', pattern: 0x02, speed: 80, hues: [30, 14] },
  { id: 'halloween3', name: 'Halloween 3', pattern: 0x20, speed: 80, hues: [120, 0, 120] },
  { id: 'valentine', name: "Valentine's Day", pattern: 0x0d, speed: 80, hues: [0, 23, 135, 165] },
  { id: 'thanksgiving', name: 'Thanksgiving', pattern: 0x16, speed: 80, hues: [150, 90, 14] },
  { id: 'easter', name: 'Easter', pattern: 0x0e, speed: 80, hues: [14, 0] },
  { id: 'easter_eggs', name: 'Easter eggs', pattern: 0x1a, speed: 80, hues: [4, 16] },
  { id: 'birthday', name: 'Birthday', pattern: 0x14, speed: 100, hues: [0, 0, 60, 30] },
  { id: 'st_patrick', name: "St. Patrick's Day", pattern: 0x13, speed: 80, hues: [1, 135] },
  { id: 'fireworks', name: 'Fireworks festival', pattern: 0x0b, speed: 80, hues: [0, 30, 0] },
  { id: 'fantasy_fireworks', name: 'Fantasy fireworks', pattern: 0x0f, speed: 80, hues: [14, 5] },
  { id: 'meteor_shower', name: 'Meteor shower', pattern: 0x11, speed: 80, hues: [60, 30, 14, 90] },
  { id: 'moonlight', name: 'Moonlight', pattern: 0x0f, speed: 80, hues: [120, 104, 90] },
  { id: 'summer_wind', name: 'Summer wind', pattern: 0x0e, speed: 80, hues: [120, 75, 15, 75, 120] },
  { id: 'forest_day', name: 'Forest day', pattern: 0x1d, speed: 80, hues: [5, 60, 30, 0] },
  { id: 'champagne', name: 'Champagne party', pattern: 0x0d, speed: 99, subMode: 0x02, hues: [14] },
  { id: 'movie_night', name: 'Movie night', pattern: 0x0d, speed: 80, hues: [0, 150, 120, 90, 60, 30] },
  { id: 'rainbow_water', name: 'Rainbow water', pattern: 0x07, speed: 80, hues: [90, 0] },
  { id: 'rainbow_cycle', name: 'Rainbow cycle', pattern: 0x01, speed: 80, hues: [0, 150, 120, 90, 60, 30] },
  { id: 'rainbow_smooth', name: 'Rainbow smooth', pattern: 0x16, speed: 80, hues: [0, 150, 120, 90, 60, 30] },
];

/**
 * Built-in effects on the Quntis controller, as cycled by its handheld remote (captured
 * 2026-11-03 at 1 s state polling, two full cycles): 1-11, 13-22, 25-37, then back to 1.
 * 12, 23, 24 and numbers above 37 are accepted and echoed by the controller but the remote
 * skips them and they did not animate, so they are not offered.
 */
export const BUILTIN_EFFECTS: number[] = [
  ...Array.from({ length: 11 }, (_, i) => i + 1),
  ...Array.from({ length: 10 }, (_, i) => i + 13),
  ...Array.from({ length: 13 }, (_, i) => i + 25),
];
export const BUILTIN_EFFECT_COUNT = 37;

export function isBuiltinEffect(effect: number): boolean {
  return BUILTIN_EFFECTS.includes(effect);
}

/**
 * Palette sent with built-in effects. The controller needs an explicit colour list: with an
 * empty list (tested 2026-11-03) effects ran without colours - partial lights, no animation or
 * going dark. With this palette effect 13 animated (multicolour flashing). Values are palette
 * hue bytes (roughly hue/2 on this controller) for red, orange, yellow, green, cyan, blue,
 * purple, using the warm-colour correction calibrated on the Quntis.
 */
export const RAINBOW_PALETTE: PaletteColour[] = [0, 3, 6, 60, 90, 120, 140].map((h) => ({ h, s: 100, b: 100 }));

/**
 * Built-in effect N: E1 21 with an explicit colour list (opcode 0x0A). The handheld remote runs
 * the same effect numbers with the firmware's own colours, which no BLE command we tried can
 * select (E1 21 with an empty list and the IOTBT E1 01 scene command both fail), so Homey
 * supplies the colours.
 */
export function builtinEffect(
  effect: number, speed: number, brightness: number, palette: PaletteColour[] = RAINBOW_PALETTE,
): LightCommand {
  const n = Math.round(effect);
  if (!isBuiltinEffect(n)) {
    throw new Error(`Effect ${n} is not available. Use 1-11, 13-22 or 25-37.`);
  }
  const cmd = symphonyScene(n, speed, brightness, palette.length > 0 ? palette : RAINBOW_PALETTE);
  return { ...cmd, label: `built-in effect ${effect} speed ${speed} (e1 21)` };
}

export function presetCommand(preset: EffectPreset, brightness: number, speed?: number): LightCommand {
  const cmd = symphonyScene(preset.pattern, speed ?? preset.speed, brightness, full(preset.hues), preset.subMode ?? 0, preset.flags ?? 0x01);
  return { ...cmd, label: `effect "${preset.name}" (e1 21)` };
}
