/**
 * Persistence for "My effects", per device (like the Surplife app, which stores DIY effects per
 * device). Kept in the app's settings store so they survive restarts and app updates.
 * Homey-specific glue around the pure library module.
 */
import type Homey from 'homey';
import { randomBytes } from 'crypto';
import { buildLibrary, CustomEffect, LibraryEntry, LibraryScope, sanitiseCustom } from './library';

/** Before 0.3.0 "My effects" were shared by all lights under this key. */
export const LEGACY_CUSTOM_EFFECTS_KEY = 'customEffects';
const MAX_CUSTOM = 30;

type Settings = Homey.Homey['settings'];

/** Everything the store needs to know about one light. */
export interface DeviceScope extends LibraryScope {
  deviceId: string;
}

export function customEffectsKey(deviceId: string): string {
  return `customEffects.${deviceId}`;
}

export function getCustomEffects(settings: Settings, scope: DeviceScope): CustomEffect[] {
  let raw = settings.get(customEffectsKey(scope.deviceId));
  // First use after the update: start from the effects that used to be shared.
  if (!Array.isArray(raw)) raw = settings.get(LEGACY_CUSTOM_EFFECTS_KEY);
  return validStored(raw);
}

/**
 * Stored effects are checked again when read: app settings can also be written outside the API
 * (by the settings page or the Web API), and one malformed entry must not break the picker.
 */
export function validStored(raw: unknown): CustomEffect[] {
  if (!Array.isArray(raw)) return [];
  const out: CustomEffect[] = [];
  for (const item of raw.slice(0, MAX_CUSTOM)) {
    try {
      out.push(sanitiseCustom(item, () => { throw new Error('missing id'); }));
    } catch {
      // skip the malformed entry
    }
  }
  return out;
}

export function getLibrary(settings: Settings, scope: DeviceScope): LibraryEntry[] {
  return buildLibrary(getCustomEffects(settings, scope), scope);
}

export function findEntry(settings: Settings, scope: DeviceScope, id: string): LibraryEntry | undefined {
  return getLibrary(settings, scope).find((e) => e.id === id);
}

/** Create or update a custom effect of one light; returns the stored effect. */
export function saveCustomEffect(settings: Settings, scope: DeviceScope, input: unknown): CustomEffect {
  if (!scope.effects) throw new Error('This light does not support effects');
  const effect = sanitiseCustom(input, () => randomBytes(4).toString('hex'));
  const list = getCustomEffects(settings, scope).filter((e) => e.id !== effect.id);
  if (list.length >= MAX_CUSTOM) throw new Error(`You can save up to ${MAX_CUSTOM} effects per light`);
  list.unshift(effect);
  settings.set(customEffectsKey(scope.deviceId), list);
  return effect;
}

export function deleteCustomEffect(settings: Settings, scope: DeviceScope, id: string): void {
  settings.set(customEffectsKey(scope.deviceId), getCustomEffects(settings, scope).filter((e) => e.id !== id));
}
