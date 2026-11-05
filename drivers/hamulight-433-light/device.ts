import Homey from 'homey';
import { CommandQueue } from '../../lib/core/commandQueue';
import { HeardFrame } from '../../lib/hamulight/radio';
import {
  buildFrame, checksumOk, commandByte, dimForLevelIndex, dimForRingPosition, Frame, frameHex, generatedDimFrame, hex,
  LearnedRemote, levelIndexFor, parseRingPosition, PRESET_DIM, remoteId, RING_DEFAULTS, RingDirection, RingRange, ringPositionFor,
} from '../../lib/hamulight/protocol';
import type HamulightDriver = require('./driver');
import { levelsInfo } from '../../lib/hamulight/learning';

interface Store {
  remoteId: number;
  toggle: Frame;
  levels: Frame[];
}

interface Settings {
  info_remote: string;
  info_levels: string;
  dim_source: 'ring' | 'learned' | 'generated';
  ring_dark: string;
  ring_bright: string;
  ring_direction: RingDirection;
  repetitions: number;
  on_brightness: boolean;
  follow_remote: boolean;
}

/** Gap between the on/off code and a brightness code, so the light handles them separately. */
const AFTER_TOGGLE_MS = 600;
/**
 * Minimum time between two toggles Homey sends. FHEM users reported 8-10 s for their lights, but
 * the user's L2046 follows remote presses 2 s apart, so 2 s is enough.
 */
const SEND_GAP_MS = 2000;
/**
 * Homey hands received frames to the app in batches: one remote press arrived as 1-2 batches up to
 * 2.4 s apart (measured 2026-11-05). A repeat of on/off within this time is the same press (or
 * Homey hearing its own send late), not a new one.
 */
const REMOTE_DUPLICATE_MS = 3000;
/** Homey hears its own transmission back in batches, seen up to 3.4 s after the send finished. */
const OWN_ECHO_MS = 5000;

class HamulightDevice extends Homey.Device {
  private lastSentAt = 0;
  /**
   * The light only understands "toggle", and every send takes seconds on Homey. Commands run in
   * the background queue; `lightOn` is what we believe the light is doing and `wantOn` what the
   * user asked for last, so quick taps (on, off, on) send only the toggles that are needed.
   */
  private commands!: CommandQueue;
  private lightOn = false;
  private wantOn = false;
  private wantDim: number | null = null;
  private lastToggleAt = 0;
  private onFrame = (h: HeardFrame) => this.handleHeard(h);
  private listening = false;

  private get radio() {
    return (this.driver as HamulightDriver).radio;
  }

  private get learned(): Store {
    return this.getStore() as Store;
  }

  private get settings(): Settings {
    return this.getSettings() as Settings;
  }

  async onInit(): Promise<void> {
    this.lightOn = this.getCapabilityValue('onoff') === true;
    this.wantOn = this.lightOn;
    this.commands = new CommandQueue((err) => {
      if (err) this.error('Command failed:', err.message);
    });
    this.registerCapabilityListener('onoff', async (value: boolean) => {
      this.wantOn = value;
      this.commands.push('power', () => this.applyPower());
    });
    this.registerCapabilityListener('dim', async (value: number) => {
      if (value <= 0) {
        this.wantOn = false;
        await this.setCapabilityValue('onoff', false);
        this.commands.push('power', () => this.applyPower());
        return;
      }
      if (!this.wantOn) {
        this.wantOn = true;
        await this.setCapabilityValue('onoff', true);
        this.commands.push('power', () => this.applyPower());
      }
      this.wantDim = value;
      this.commands.push('dim', () => this.applyDim());
    });
    // Remotes with checksummed frames (HM3002) send ring positions, which are better generated
    // than replayed: switch devices paired before this was known, once.
    if (!this.getStoreValue('ringMigrated')) {
      if (checksumOk(this.learned.toggle) && this.settings.dim_source === 'learned') await this.setSettings({ dim_source: 'ring' });
      await this.setStoreValue('ringMigrated', true);
    }
    // Calculated remotes do not use captured ring levels: drop them (pairing no longer stores them).
    if (!this.getStoreValue('levelsCleared') && checksumOk(this.learned.toggle)) {
      await this.setStoreValue('levels', []);
      await this.setSettings({ info_levels: levelsInfo(this.learned) });
      await this.setStoreValue('levelsCleared', true);
    }
    // One unbroken transmission of up to 3 frames replaces repeated transmissions.
    if (!this.getStoreValue('singleTxMigrated')) {
      if (this.settings.repetitions !== 3) await this.setSettings({ repetitions: 3 });
      await this.setStoreValue('singleTxMigrated', true);
    }
    // Dark end of the ring: 55 (RFFHEM mapping) instead of the first guess 4F.
    if (!this.getStoreValue('ringDark55Migrated')) {
      if (String(this.settings.ring_dark).toUpperCase() === '4F') await this.setSettings({ ring_dark: '55' });
      await this.setStoreValue('ringDark55Migrated', true);
    }
    // 3 frames per command proved too few (missed toggles); repeats no longer cost extra time.
    if (!this.getStoreValue('repeats10Migrated')) {
      if (this.settings.repetitions < 10) await this.setSettings({ repetitions: 10 });
      await this.setStoreValue('repeats10Migrated', true);
    }
    await this.updateListening();
    this.log(`Hamulight remote ${hex(this.learned.remoteId, 4)}, brightness from ${this.settings.dim_source}, ${this.learned.levels.length} learned level(s)`);
  }

  // --- used by flows and the driver -------------------------------------------------------------

  /** Flow: press the on/off button whatever the state is, and flip the state in Homey. */
  async pressToggle(): Promise<void> {
    await this.sendToggle();
    await this.markState(!this.lightOn);
  }

  /** Flow / remote: correct what Homey believes without sending anything. */
  async markState(on: boolean): Promise<void> {
    this.lightOn = on;
    this.wantOn = on;
    await this.setCapabilityValue('onoff', on);
  }

  private async applyPower(): Promise<void> {
    if (this.wantOn === this.lightOn) return;
    const turningOn = this.wantOn;
    await this.sendToggle();
    this.lightOn = turningOn;
    if (turningOn && this.settings.on_brightness && !this.commands.has('dim')) {
      const dim = this.getCapabilityValue('dim');
      if (typeof dim === 'number' && dim > 0) {
        await this.wait(AFTER_TOGGLE_MS);
        await this.sendDim(dim);
      }
    }
  }

  private async applyDim(): Promise<void> {
    if (this.wantDim === null || !this.lightOn) return; // brightness codes do nothing while off
    await this.wait(AFTER_TOGGLE_MS);
    await this.sendDim(this.wantDim);
  }

  async sendFrame(frame: Frame): Promise<void> {
    this.lastSentAt = Date.now();
    await this.radio.send(frame, this.settings.repetitions, this);
    this.lastSentAt = Date.now();
  }

  /** Repair: store a newly learned remote. */
  async applyLearned(r: LearnedRemote): Promise<void> {
    await this.setStoreValue('remoteId', r.remoteId);
    await this.setStoreValue('toggle', r.toggle);
    await this.setStoreValue('levels', r.levels);
    await this.setSettings({
      info_remote: `${hex(r.remoteId, 4)} / ${frameHex(r.toggle)}`,
      info_levels: levelsInfo(r),
      dim_source: checksumOk(r.toggle) ? 'ring' : r.levels.length >= 2 ? 'learned' : 'generated',
    });
    this.log(`Relearned remote ${hex(r.remoteId, 4)}, ${r.levels.length} level(s)`);
  }

  // --- sending -----------------------------------------------------------------------------------

  private async sendToggle(): Promise<void> {
    const wait = this.lastToggleAt + SEND_GAP_MS - Date.now();
    if (wait > 0) {
      this.log(`Waiting ${Math.round(wait / 100) / 10} s before the next toggle`);
      await this.wait(wait);
    }
    await this.sendFrame(this.learned.toggle);
    this.lastToggleAt = Date.now();
  }

  private ringRange(s: Partial<Settings> = this.settings): RingRange {
    return {
      dark: parseRingPosition(s.ring_dark, RING_DEFAULTS.dark),
      bright: parseRingPosition(s.ring_bright, RING_DEFAULTS.bright),
      direction: s.ring_direction === 'up' ? 'up' : 'down',
    };
  }

  private async sendDim(dim: number): Promise<void> {
    const { levels, remoteId: id } = this.learned;
    if (this.settings.dim_source === 'ring') {
      const pos = ringPositionFor(dim, this.ringRange());
      this.log(`Brightness ${Math.round(dim * 100)}% -> ring position ${hex(pos, 2)}`);
      await this.sendFrame(buildFrame(id, pos));
      return;
    }
    if (this.settings.dim_source === 'learned') {
      if (levels.length === 0) {
        throw new Error('No brightness levels learned. Use Repair on this device to teach the brightness ring.');
      }
      await this.sendFrame(levels[levelIndexFor(dim, levels.length)]);
      return;
    }
    await this.sendFrame(generatedDimFrame(id, Math.max(1, Math.round(dim * 100))));
  }

  private wait(ms: number): Promise<void> {
    return new Promise((resolve) => this.homey.setTimeout(resolve, ms));
  }

  // --- following the handheld remote -------------------------------------------------------------

  private async updateListening(want = this.settings.follow_remote): Promise<void> {
    if (want === this.listening) return;
    this.listening = want;
    if (want) {
      this.radio.on('frame', this.onFrame);
      await this.radio.listen(this.getData().id).catch((err) => this.error('Could not enable 433 MHz receive', err));
    } else {
      this.radio.off('frame', this.onFrame);
      await this.radio.unlisten(this.getData().id);
    }
  }

  private handleHeard(h: HeardFrame): void {
    const { toggle, levels, remoteId: id } = this.learned;
    if (h.repeat || remoteId(h.frame) !== id) return;
    if (Date.now() - this.lastSentAt < OWN_ECHO_MS) return;
    if (h.frame === toggle) {
      // Homey delivers part of one press up to ~2.4 s late, which looked like a second press.
      const since = Date.now() - this.lastToggleAt;
      if (since < REMOTE_DUPLICATE_MS) {
        this.log(`Handheld remote: on/off repeat ignored (${Math.round(since / 100) / 10} s after the last toggle)`);
        return;
      }
      this.lastToggleAt = Date.now();
      const on = !this.lightOn;
      this.log('Handheld remote: on/off ->', on ? 'on' : 'off');
      this.markState(on).catch(this.error);
      this.homey.flow.getDeviceTriggerCard('hamulight_remote_pressed').trigger(this).catch(this.error);
      return;
    }
    if (this.settings.dim_source === 'ring') {
      // Not followed yet: the HM3002 also reports a resting position (3C) every few seconds
      // without being touched, which would move Homey's slider. Logged for analysis.
      const cmd = commandByte(h.frame);
      if (PRESET_DIM[cmd] !== undefined) {
        this.log(`Handheld remote: preset ${Math.round(PRESET_DIM[cmd] * 100)}%`);
        this.setCapabilityValue('dim', PRESET_DIM[cmd]).catch(this.error);
        return;
      }
      if (cmd < 0x80) {
        const d = dimForRingPosition(cmd, this.ringRange());
        this.log(`Handheld remote: ring position ${hex(cmd, 2)} (${d === null ? 'outside range' : `${Math.round(d * 100)}%`})`);
      } else {
        this.log(`Handheld remote: button ${hex(cmd, 2)}`);
      }
      return;
    }
    const i = levels.indexOf(h.frame);
    if (i >= 0) {
      this.setCapabilityValue('dim', dimForLevelIndex(i, levels.length)).catch(this.error);
      return;
    }
    this.log('Handheld remote sent a code that was not learned:', frameHex(h.frame));
  }

  async onSettings({ newSettings, changedKeys }: { newSettings: Partial<Settings>; changedKeys: string[] }): Promise<void> {
    if (changedKeys.includes('follow_remote')) await this.updateListening(!!newSettings.follow_remote);
  }

  async onUninit(): Promise<void> {
    if (this.listening) {
      this.listening = false;
      this.radio.off('frame', this.onFrame);
      await this.radio.unlisten(this.getData().id);
    }
  }

  async onDeleted(): Promise<void> {
    await this.onUninit();
  }
}

export = HamulightDevice;
