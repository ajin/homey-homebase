import type Homey from 'homey';
import { describeEntry, scan } from './lib/zengge/discovery';
import { BUILTIN_EFFECTS } from './lib/zengge/protocol/effects';
import { categoriesFor, customEntry, LibraryEntry, patternName, sanitiseCustom } from './lib/zengge/effects/library';
import { patternInfo } from './lib/zengge/effects/patterns';
import { deleteCustomEffect, DeviceScope, saveCustomEffect } from './lib/zengge/effects/store';

type Ctx = { homey: Homey.Homey; params: Record<string, string>; body: unknown; query: Record<string, string> };

interface EffectDevice {
  getName(): string;
  getData(): { id: string };
  runEntry(id: string, speed?: number): Promise<void>;
  playEntry(entry: LibraryEntry, speed: number): Promise<void>;
  showStaticColour(): Promise<void>;
  currentEffectId(): string | null;
  currentEffectSpeed(): number | null;
  effectScope(): DeviceScope;
  effectLibrary(): LibraryEntry[];
  modelName(): string;
  getAvailable(): boolean;
}

/**
 * What every device of the app can offer the app settings page. Each kind of device has its own
 * page there (its "panel"); devices of the same kind share one. Both methods are optional: a device
 * without them is still listed, with nothing to open.
 */
interface PanelDevice {
  getName(): string;
  getData(): { id: string };
  getClass(): string;
  getAvailable(): boolean;
  settingsPanel?(): string | null;
  panelSummary?(): { status: string; live: boolean };
  modelName?(): string;
}

function allDevices(homey: Homey.Homey): PanelDevice[] {
  return Object.values(homey.drivers.getDrivers()).flatMap((driver) => driver.getDevices()) as unknown as PanelDevice[];
}

/** The devices whose page is the effect studio (panel "effects"). */
function devices(homey: Homey.Homey): EffectDevice[] {
  return allDevices(homey).filter((d) => d.settingsPanel?.() === 'effects') as unknown as EffectDevice[];
}

/**
 * The light an effect studio request is about. The studio always works on one light, like a
 * vendor app's per-device effect page; without an id the first such light is used.
 */
function device(homey: Homey.Homey, id?: unknown): EffectDevice {
  if (id !== undefined && typeof id !== 'string') throw new Error('Invalid device id');
  const all = devices(homey);
  if (all.length === 0) throw new Error('No device with effects is paired yet');
  const d = id ? all.find((x) => x.getData().id === id) : all[0];
  if (!d) throw new Error('That device is no longer paired or has no effects');
  return d;
}

/**
 * App API, used by the effect studio (settings/index.html) and for diagnostics.
 * All endpoints are local to the Homey and require a Homey session.
 */
export = {
  /** GET /diagnostics/scan - BLE scan of compatible controllers (no credentials involved). */
  async scan({ homey }: Ctx) {
    const result = await scan(homey.ble);
    return {
      recognised: result.recognised.map(describeEntry),
      unrecognisedZenggeOui: result.unrecognisedZenggeOui.map(describeEntry),
    };
  },

  /**
   * GET /devices - every paired device for the settings start screen, with the page ("panel") it
   * opens. Devices of any driver are listed; a device with no panel has nothing to open there.
   */
  async listDevices({ homey }: Ctx) {
    return allDevices(homey).map((d) => {
      const summary = d.panelSummary?.() ?? { status: '', live: false };
      return {
        id: d.getData().id,
        name: d.getName(),
        model: d.modelName?.() ?? '',
        class: d.getClass(),
        panel: d.settingsPanel?.() ?? null,
        status: summary.status,
        live: summary.live,
        available: d.getAvailable(),
      };
    });
  },

  /**
   * GET /effects?device=<id> - what one light can play (its model's scenes, patterns and its own
   * effects) plus the list of lights for the studio's light switcher.
   */
  async listEffects({ homey, query }: Ctx) {
    const d = device(homey, query?.device);
    const effects = d.effectLibrary();
    return {
      device: { id: d.getData().id, name: d.getName(), model: d.modelName(), effect: d.currentEffectId(), speed: d.currentEffectSpeed() },
      devices: devices(homey).map((x) => ({ id: x.getData().id, name: x.getName(), model: x.modelName() })),
      categories: categoriesFor(effects),
      patterns: d.effectScope().effects ? BUILTIN_EFFECTS.map((n) => ({ n, name: patternName(n), motion: patternInfo(n).motion })) : [],
      effects,
    };
  },

  /** POST /effects - create or update one of a light's "My effects". Body: { device, ...effect }. */
  async saveEffect({ homey, body }: Ctx) {
    const b = (body ?? {}) as { device?: string };
    const d = device(homey, b.device);
    return saveCustomEffect(homey.settings, d.effectScope(), body);
  },

  /** DELETE /effects/:id?device=<id> - remove one of a light's "My effects". */
  async deleteEffect({ homey, params, query }: Ctx) {
    const d = device(homey, query?.device);
    deleteCustomEffect(homey.settings, d.effectScope(), params.id);
    return { ok: true };
  },

  /**
   * POST /play - run an effect on one light. Body: { device, effect: "<entry id>", speed? },
   * { device, stop: true } for the static colour, or { device, custom: {pattern, colours, speed} }
   * to try an unsaved effect.
   */
  async play({ homey, body }: Ctx) {
    const b = (body ?? {}) as { effect?: unknown; custom?: unknown; speed?: unknown; device?: unknown; stop?: unknown };
    const d = device(homey, typeof b.device === 'string' ? b.device : undefined);
    let speed: number | undefined;
    if (b.speed !== undefined && b.speed !== null) {
      speed = Number(b.speed);
      if (!Number.isFinite(speed)) throw new Error('Speed must be a number from 1 to 100');
      speed = Math.min(100, Math.max(1, Math.round(speed)));
    }
    if (b.stop) {
      await d.showStaticColour();
    } else if (b.custom) {
      const entry = customEntry(sanitiseCustom({ name: 'Preview', ...(b.custom as object) }, () => 'preview'));
      await d.playEntry(entry, entry.speed);
    } else if (typeof b.effect === 'string' && b.effect) {
      await d.runEntry(b.effect, speed);
    } else {
      throw new Error('No effect given');
    }
    return { ok: true };
  },
};
