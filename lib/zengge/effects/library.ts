/**
 * Effect library: everything the user can pick, in one list.
 *
 *  - Scenes: the Surplife app's own built-in scenes for this controller, from the Surplife cloud
 *    preset file (see surplifeScenes.ts), sent exactly as the app sends them.
 *  - Patterns: the controller's 34 built-in patterns (as cycled by the remote), sent with
 *    Homey's rainbow palette.
 *  - My effects: user-made pattern + colours + speed, stored in the app settings.
 *
 * Pure module (no Homey imports) so it can be unit tested and shared by the device, the app API
 * and the settings page (which receives it as JSON).
 */
import { BUILTIN_EFFECTS, PaletteColour, RAINBOW_PALETTE, symphonyScene } from '../protocol/effects';
import { SCENE_CATEGORY_TITLES, SceneCategory, scenesForProduct, sceneDisplayColour, sceneId, scenePaletteColour } from './surplifeScenes';
import { correctHue, uncorrectHue } from '../protocol/colorCorrection';
import { clamp } from '../protocol/color';
import type { LightCommand } from '../protocol/commands';
import { Motion, patternInfo } from './patterns';

export type EffectCategory = 'mine' | SceneCategory | 'patterns';

/** In display order. */
export const CATEGORY_TITLES: Record<EffectCategory, string> = {
  mine: 'My effects',
  ...SCENE_CATEGORY_TITLES,
  patterns: 'Patterns',
};

/** A colour as the user sees it: hue 0-359 degrees, saturation 0-100 (value 0-100, default 100). */
export interface UserColour {
  h: number;
  s: number;
  v?: number;
}

export interface CustomEffect {
  id: string;
  name: string;
  pattern: number;
  speed: number;
  colours: UserColour[];
}

export interface LibraryEntry {
  /** Stable id used by the picker, Flows and the API: "n:<preset>", "p:<pattern>", "c:<custom>". */
  id: string;
  name: string;
  category: EffectCategory;
  pattern: number;
  speed: number;
  /** Colours for previews (user scale). */
  colours: UserColour[];
  /** Raw palette bytes sent to the controller. */
  palette: PaletteColour[];
  subMode?: number;
  flags?: number;
  /** How the pattern moves, for previews ('unknown' = no reliable description). */
  motion: Motion;
}

/**
 * Palette hue byte <-> user hue. Palette bytes are roughly hue/2 on this controller (0-179),
 * with the same green-shift as solid colours, so the calibrated correction is applied.
 */
export function paletteFromUser(c: UserColour): PaletteColour {
  return { h: correctHue(clamp(Math.round(c.h), 0, 359)) >> 1, s: clamp(Math.round(c.s), 0, 100), b: 100 };
}

export function userFromPalette(p: PaletteColour): UserColour {
  return { h: uncorrectHue(clamp(p.h * 2, 0, 359)), s: p.s };
}

export function patternName(pattern: number): string {
  const info = patternInfo(pattern);
  return info.motion === 'unknown' ? info.name : `${info.name} (${pattern})`;
}

/** What a device can play: its model's scenes, and the raw patterns when it supports E1 21 effects. */
export interface LibraryScope {
  productId: number;
  effects: boolean;
}

/** The Quntis controller (product 0x86); used where no device is involved, e.g. tests. */
export const QUNTIS_SCOPE: LibraryScope = { productId: 0x86, effects: true };

/** Built-in entries per product id: built once, they never change while the app runs. */
const builtinCache = new Map<number, LibraryEntry[]>();

/** The model's scenes and the controller patterns. Shared and cached: do not modify the result. */
export function builtinEntries(scope: LibraryScope = QUNTIS_SCOPE): LibraryEntry[] {
  if (!scope.effects) return [];
  let entries = builtinCache.get(scope.productId);
  if (!entries) {
    entries = buildBuiltinEntries(scope);
    builtinCache.set(scope.productId, entries);
  }
  return entries;
}

function buildBuiltinEntries(scope: LibraryScope): LibraryEntry[] {
  const scenes = scenesForProduct(scope.productId).map((sc): LibraryEntry => ({
    id: `s:${sceneId(sc.key)}`,
    name: sc.name,
    category: sc.category,
    pattern: sc.type,
    speed: sc.speed,
    palette: sc.colours.map(scenePaletteColour),
    colours: sc.colours.map(sceneDisplayColour),
    subMode: sc.other ?? 0,
    motion: patternInfo(sc.type).motion,
  }));
  const patterns = BUILTIN_EFFECTS.map((n): LibraryEntry => ({
    id: `p:${n}`,
    name: patternName(n),
    category: 'patterns',
    pattern: n,
    speed: 100,
    palette: RAINBOW_PALETTE,
    colours: RAINBOW_PALETTE.map(userFromPalette),
    motion: patternInfo(n).motion,
  }));
  return [...scenes, ...patterns];
}

export function customEntry(c: CustomEffect): LibraryEntry {
  const colours = c.colours.length > 0 ? c.colours.slice(0, 8) : RAINBOW_PALETTE.map(userFromPalette);
  return {
    id: `c:${c.id}`,
    name: c.name,
    category: 'mine',
    pattern: c.pattern,
    speed: c.speed,
    colours,
    palette: colours.map(paletteFromUser),
    motion: patternInfo(c.pattern).motion,
  };
}

export function buildLibrary(custom: CustomEffect[], scope: LibraryScope = QUNTIS_SCOPE): LibraryEntry[] {
  if (!scope.effects) return [];
  return [...custom.map(customEntry), ...builtinEntries(scope)];
}

/** Category titles for the categories this library actually contains ("mine" always first). */
export function categoriesFor(library: LibraryEntry[]): Partial<Record<EffectCategory, string>> {
  const present = new Set(library.map((e) => e.category));
  const out: Partial<Record<EffectCategory, string>> = {};
  for (const [k, title] of Object.entries(CATEGORY_TITLES) as Array<[EffectCategory, string]>) {
    if (k === 'mine' || present.has(k)) out[k] = title;
  }
  return out;
}

/** Validate and normalise a custom effect coming from the settings page. */
export function sanitiseCustom(input: unknown, idFactory: () => string): CustomEffect {
  const o = (input ?? {}) as Record<string, unknown>;
  const name = String(o.name ?? '').trim().slice(0, 40);
  if (!name) throw new Error('Give the effect a name');
  const pattern = Math.round(Number(o.pattern));
  if (!BUILTIN_EFFECTS.includes(pattern)) throw new Error('Pick one of the controller patterns');
  const speed = clamp(Math.round(Number(o.speed) || 80), 1, 100);
  const coloursIn = Array.isArray(o.colours) ? o.colours : [];
  const colours = coloursIn.slice(0, 8).map((c) => {
    const cc = (c ?? {}) as Record<string, unknown>;
    return { h: clamp(Math.round(Number(cc.h) || 0), 0, 359), s: clamp(Math.round(Number(cc.s ?? 100)), 0, 100) };
  });
  if (colours.length === 0) throw new Error('Add at least one colour');
  const id = typeof o.id === 'string' && /^[a-z0-9]{4,16}$/.test(o.id) ? o.id : idFactory();
  return { id, name, pattern, speed, colours };
}

/** The BLE command for an entry at a given speed / brightness. */
export function entryCommand(entry: LibraryEntry, speed: number, brightness: number): LightCommand {
  const cmd = symphonyScene(entry.pattern, speed, brightness, entry.palette, entry.subMode ?? 0, entry.flags ?? 0x01);
  return { ...cmd, label: `effect "${entry.name}" speed ${speed} (e1 21)` };
}

/** Picker values for the device's Effect capability. */
export function pickerValues(library: LibraryEntry[]): Array<{ id: string; title: { en: string } }> {
  return [
    { id: 'static', title: { en: 'Static colour' } },
    ...library.map((e) => ({
      id: e.id,
      title: { en: e.category === 'mine' ? `★ ${e.name}` : e.name },
    })),
  ];
}
