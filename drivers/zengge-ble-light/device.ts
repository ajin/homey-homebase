import { CommandQueue, mergeLightValues } from '../../lib/core/commandQueue';
import Homey from 'homey';
import { ZenggeConnection } from '../../lib/zengge/ble/ZenggeConnection';
import { parseAdvertisement } from '../../lib/zengge/protocol/advertisement';
import { BrightnessCurve, clamp, dimToLevel, homeyToHsv, Hsv, levelToDim } from '../../lib/zengge/protocol/color';
import { CommandProfile, LightCommand, parseHex, checksum, PROFILES, ProfileId } from '../../lib/zengge/protocol/commands';
import { chooseProfile } from '../../lib/zengge/protocol/profiles';
import { entryCommand, LibraryEntry, pickerValues } from '../../lib/zengge/effects/library';
import { customEffectsKey, DeviceScope, findEntry, getLibrary, LEGACY_CUSTOM_EFFECTS_KEY } from '../../lib/zengge/effects/store';
import { productName } from '../../lib/zengge/effects/models';
import { correctHue, uncorrectHue } from '../../lib/zengge/protocol/colorCorrection';
import { isStateOpcode, notificationPayload, parseState } from '../../lib/zengge/protocol/state';
import { DEFAULT_REMOTE_MODE, parseRemoteConfig, RemoteConfig, remoteConfigQuery, RemoteMode, setRemoteMode, unpairRemotes } from '../../lib/zengge/protocol/remotes';
import { DecodedMessage, frameVersionForBle } from '../../lib/zengge/protocol/transport';

interface Store {
  peripheralUuid: string;
  mac: string;
  productId: number;
  bleVersion: number;
  firmwareVersion: number;
  ledVersion: number;
  autoProfile: ProfileId;
}

interface Settings {
  command_profile: 'auto' | ProfileId;
  max_packet: string;
  idle_disconnect: number;
  min_write_gap: number;
  restore_on_reconnect: boolean;
  colour_correction: boolean;
  brightness_curve: BrightnessCurve;
  remote_control: RemoteMode;
  info_remotes?: string;
  debug_logging: boolean;
}

/** Development-only switches from env.json; reads only keys that exist (Homey warns otherwise). */
function devEnv(key: string): string | undefined {
  const env = Homey.env as Record<string, string>;
  return Object.keys(env).includes(key) ? env[key] : undefined;
}

const RECONNECT_BACKOFF_MS = [5_000, 15_000, 30_000, 60_000, 120_000];
const STATE_QUERY_TIMEOUT_MS = 2_500;
/** Ignore advertised power for this long after we sent a command (adverts lag behind). */
const ADVERT_GRACE_MS = 8_000;

class ZenggeBleLightDevice extends Homey.Device {
  private conn!: ZenggeConnection;
  private profile!: CommandProfile;
  private idleTimer: NodeJS.Timeout | null = null;
  private commands!: CommandQueue;
  /** Light values waiting in the command queue, so a newer partial change can merge into them. */
  private pendingLight: Record<string, number | string> | null = null;
  private commandWarning = false;
  private reconnectTimer: NodeJS.Timeout | null = null;
  private reconnectAttempt = 0;
  private lastCommandAt = 0;
  private lastHsv: Hsv | null = null;
  private lastOn: boolean | null = null;
  /** The effect currently running (so dimming can re-send it instead of switching to a colour). */
  private activeEffect: { entryId: string; pattern: number; speed: number } | null = null;
  private pickerSignature = '';
  /** Ids currently offered by the Effect picker (others, like studio previews, are not shown). */
  private pickerIds = new Set<string>(['static']);
  private wasUnexpectedlyDisconnected = false;
  private advertSubscribed = false;
  private deleted = false;
  private initTimer: NodeJS.Timeout | null = null;
  private pollTimer: NodeJS.Timeout | null = null;
  /** Last controller message for the read-only "last state" setting, written at most every 30 s. */
  private infoState: { value: string; written: string; timer: NodeJS.Timeout | null } = { value: '', written: '', timer: null };
  /** A colour or white change made while the light was off, applied when it is turned on. */
  private applyOnPowerOn = false;

  private get storeData(): Store {
    return this.getStore() as Store;
  }

  private get settings(): Settings {
    return this.getSettings() as Settings;
  }

  async onInit(): Promise<void> {
    const store = this.storeData;
    this.profile = this.resolveProfile(this.settings.command_profile);
    this.conn = new ZenggeConnection(this.homey.ble, {
      peripheralUuid: store.peripheralUuid,
      frameVersion: frameVersionForBle(store.bleVersion),
      maxPacket: Number(this.settings.max_packet) || 255,
      minWriteGapMs: this.settings.min_write_gap,
      connectTimeoutMs: 20_000,
      writeTimeoutMs: 5_000,
      log: (...a) => this.log(...a),
      // env.json DEBUG=1 (development only, not shipped) forces frame logging on.
      debug: () => this.settings.debug_logging || devEnv('DEBUG') === '1',
      // The reply also syncs Homey with changes made meanwhile with the remote or phone app.
      probe: this.resolveProfile(this.settings.command_profile).stateQueries()[0],
    });
    this.conn.on('message', (m: DecodedMessage) => this.onMessage(m));
    this.conn.on('disconnect', () => this.onUnexpectedDisconnect());

    await this.updateInfoSettings().catch(this.error);

    // Capability changes answer Homey at once and are sent in the background (latest wins), so
    // the controls never time out while the Bluetooth link reconnects after an idle disconnect.
    this.commands = new CommandQueue((err) => this.onCommandResult(err));
    this.registerCapabilityListener('onoff', async (value: boolean) => {
      this.commands.push('power', async () => {
        await this.setPower(value);
        if (value && this.applyOnPowerOn) {
          this.applyOnPowerOn = false;
          await this.onLightValues({});
        }
      });
    });
    // Added in 0.2.0: devices paired earlier get the capability on start.
    if (!this.hasCapability('lighting_effect')) await this.addCapability('lighting_effect').catch(this.error);
    this.registerCapabilityListener('lighting_effect', async (value: string) => {
      this.commands.push('effect', () => this.onEffectPicked(value));
    });
    await this.refreshEffectPicker().catch(this.error);
    // "My effects" edited in the app settings page -> update this device's picker.
    this.onSettingsChanged = (key: string) => {
      if (key === customEffectsKey(this.getData().id) || key === LEGACY_CUSTOM_EFFECTS_KEY) this.refreshEffectPicker().catch(this.error);
    };
    this.homey.settings.on('set', this.onSettingsChanged);
    this.homey.settings.on('unset', this.onSettingsChanged);
    if (!this.hasCapability('lighting_effect_speed')) await this.addCapability('lighting_effect_speed').catch(this.error);
    // Stored as 0.01-1 (Homey shows "%" sliders as value x 100), like dim.
    const storedSpeed = this.getCapabilityValue('lighting_effect_speed');
    if (storedSpeed === null || storedSpeed > 1) {
      await this.setCapabilityValue('lighting_effect_speed', 1).catch(this.error);
    }
    // Debounced: dragging the slider sends one effect command when the finger stops.
    this.registerMultipleCapabilityListener(
      ['lighting_effect_speed'],
      async (values: Record<string, number>) => {
        const speed = values.lighting_effect_speed * 100;
        this.commands.push('speed', () => this.onSpeedChanged(speed));
      },
      400,
    );

    // Added in 0.3.0: white light on the controller's warm/cool white channels.
    for (const cap of ['light_temperature', 'light_mode']) {
      if (!this.hasCapability(cap)) await this.addCapability(cap).catch(this.error);
    }
    this.registerMultipleCapabilityListener(
      ['dim', 'light_hue', 'light_saturation', 'light_temperature', 'light_mode'],
      async (values: Record<string, number | string>) => {
        const merged = this.commands.has('light') && this.pendingLight ? mergeLightValues(this.pendingLight, values) : { ...values };
        this.pendingLight = merged;
        this.commands.push('light', async () => {
          this.pendingLight = null;
          await this.onLightValues(merged);
        });
      },
      300,
    );

    this.subscribeToAdvertisements().catch((err) => this.log('Advertisement subscription unavailable:', err.message));

    // First contact in the background: connect and ask for state, without blocking init.
    this.initTimer = this.homey.setTimeout(async () => {
      this.initTimer = null;
      await this.queryState().catch((err) => this.log('Initial state query failed:', err.message));
      await this.readRemoteConfig().catch((err) => this.log('Remote settings query failed:', err.message));
      await this.runDevTestSequence().catch((err) => this.log('Test sequence failed:', err.message));
    }, 2_000);
    this.log(`Initialised ${store.mac} product 0x${store.productId.toString(16)} using ${this.profile.name}`);

    // Development only: env.json POLL_STATE_MS polls the controller so external changes
    // (handheld remote, phone app) can be observed.
    const poll = Number(devEnv('POLL_STATE_MS'));
    if (poll > 0) {
      this.pollTimer = this.homey.setInterval(() => {
        this.queryState().catch((err) => this.log('Poll failed:', err.message));
      }, poll);
    }
  }

  private resolveProfile(setting: Settings['command_profile']): CommandProfile {
    if (setting && setting !== 'auto') return PROFILES[setting];
    // Recomputed every start so catalogue improvements apply to already-paired devices.
    const s = this.storeData;
    return PROFILES[chooseProfile(s.productId, s.bleVersion, s.firmwareVersion).profile];
  }

  private async updateInfoSettings(lastState?: string): Promise<void> {
    const s = this.storeData;
    const patch: Record<string, string> = {
      info_mac: s.mac,
      info_product: `0x${s.productId.toString(16).padStart(2, '0')} (${s.productId})`,
      info_versions: `${s.bleVersion} / ${s.firmwareVersion} / ${s.ledVersion}`,
      info_profile: `${this.profile.name}${this.settings.command_profile === 'auto' ? ' (automatic)' : ''}`,
    };
    if (lastState !== undefined) patch.info_last_state = lastState;
    await this.setSettings(patch);
    if (lastState !== undefined) this.infoState.written = lastState;
  }

  /**
   * Show the controller's last message in the device settings. Settings are stored on disk and
   * pushed to open apps, so write only when it changed, and at most every 30 s.
   */
  private noteLastState(value: string): void {
    this.infoState.value = value;
    if (value === this.infoState.written || this.infoState.timer || this.deleted) return;
    this.infoState.timer = this.homey.setTimeout(() => {
      this.infoState.timer = null;
      if (this.infoState.value !== this.infoState.written) {
        this.updateInfoSettings(this.infoState.value).catch(this.error);
      }
    }, 30_000);
  }

  // ---------------------------------------------------------------- connection

  private touch(): void {
    this.lastCommandAt = Date.now();
    if (this.idleTimer) this.homey.clearTimeout(this.idleTimer);
    this.idleTimer = null;
    // env.json KEEP_CONNECTED=1 (development only) holds the link open.
    const idle = devEnv('KEEP_CONNECTED') === '1' ? 0 : this.settings.idle_disconnect;
    if (idle > 0) {
      this.idleTimer = this.homey.setTimeout(() => {
        this.conn.disconnect().catch(this.error);
      }, idle * 1000);
    }
  }

  private async send(cmd: LightCommand): Promise<void> {
    try {
      await this.conn.send(cmd);
      this.touch();
      if (!this.getAvailable()) await this.setAvailable();
      // Reconnected by this command: report it, but do not restore old state over the command.
      if (this.wasUnexpectedlyDisconnected) this.afterReconnect(false).catch(this.error);
    } catch (err) {
      const msg = (err as Error).message;
      this.error(`Command "${cmd.label}" failed:`, msg);
      throw new Error(`The light did not accept the command (${msg}). Check that it is powered and in Bluetooth range.`);
    }
  }

  isLinkOpen(): boolean {
    return this.conn.isConnected;
  }

  private onUnexpectedDisconnect(): void {
    if (this.deleted) return;
    this.wasUnexpectedlyDisconnected = true;
    this.log('Link lost unexpectedly');
    this.homey.flow.getDeviceTriggerCard('connection_lost').trigger(this, {}, {}).catch(this.error);
    // Only actively reconnect when the user wants a permanent link; otherwise reconnect on demand.
    if (this.settings.idle_disconnect === 0) this.scheduleReconnect();
  }

  private scheduleReconnect(): void {
    if (this.reconnectTimer || this.deleted) return;
    const delay = RECONNECT_BACKOFF_MS[Math.min(this.reconnectAttempt, RECONNECT_BACKOFF_MS.length - 1)];
    this.reconnectAttempt++;
    this.reconnectTimer = this.homey.setTimeout(async () => {
      this.reconnectTimer = null;
      // The user may have switched to idle mode meanwhile: then reconnect on demand only.
      if (this.deleted || this.settings.idle_disconnect !== 0) return;
      try {
        await this.conn.connect();
        this.touch();
        await this.afterReconnect(true);
      } catch (err) {
        this.log(`Reconnect attempt ${this.reconnectAttempt} failed:`, (err as Error).message);
        if (this.reconnectAttempt >= 3) {
          await this.setUnavailable(`Bluetooth connection lost: ${(err as Error).message}`).catch(this.error);
        }
        this.scheduleReconnect();
      }
    }, delay);
  }

  private async afterReconnect(restore: boolean): Promise<void> {
    this.reconnectAttempt = 0;
    if (!this.wasUnexpectedlyDisconnected) return;
    this.wasUnexpectedlyDisconnected = false;
    await this.setAvailable().catch(this.error);
    this.homey.flow.getDeviceTriggerCard('connection_restored').trigger(this, {}, {}).catch(this.error);
    if (restore && this.settings.restore_on_reconnect && this.lastOn !== null) {
      this.log('Restoring last state after reconnect');
      await this.send(this.profile.power(this.lastOn));
      if (this.lastOn && this.lastHsv) await this.send(this.profile.color(this.toDevice(this.lastHsv)));
    }
  }

  private async subscribeToAdvertisements(): Promise<void> {
    if (!this.homey.hasFeature || !this.homey.hasFeature('ble-advertisements')) return;
    await this.homey.ble.subscribeToAdvertisements(this.storeData.peripheralUuid, { rateLimitMs: 5_000 }, (adv) => {
      const parsed = parseAdvertisement({
        localName: adv.localName,
        address: adv.address,
        manufacturerData: adv.manufacturerData,
        serviceData: adv.serviceData,
      });
      if (!parsed) return;
      if (!this.getAvailable() && !this.conn.isConnected) {
        // The controller is advertising again: it is reachable.
        this.setAvailable().catch(this.error);
      }
      if (parsed.powerOn !== null && Date.now() - this.lastCommandAt > ADVERT_GRACE_MS) {
        if (this.getCapabilityValue('onoff') !== parsed.powerOn) {
          this.setCapabilityValue('onoff', parsed.powerOn).catch(this.error);
        }
      }
    });
    this.advertSubscribed = true;
  }

  // ------------------------------------------------------------------ commands

  /** Homey colour -> colour to send, applying the calibrated hue correction when enabled. */
  private toDevice(hsv: Hsv): Hsv {
    return this.settings.colour_correction === false ? hsv : { ...hsv, h: correctHue(hsv.h) };
  }

  /** Background capability commands: show a failure on the device tile until one succeeds. */
  private onCommandResult(err: Error | null): void {
    if (err) {
      this.error('Background command failed:', err.message);
      this.commandWarning = true;
      this.setWarning(err.message).catch(this.error);
    } else if (this.commandWarning) {
      this.commandWarning = false;
      this.unsetWarning().catch(this.error);
    }
  }
  private async setPower(on: boolean): Promise<void> {
    await this.send(this.profile.power(on));
    this.lastOn = on;
  }

  /**
   * Homey light_temperature (0 = cool, 1 = warm) -> controller cool-white percentage.
   * Pass the new value from a capability listener: Homey stores it only after the listener ran.
   */
  private coolPercent(newValue?: number): number {
    const t = newValue ?? this.getCapabilityValue('light_temperature') ?? 1;
    return clamp(Math.round((1 - t) * 100), 0, 100);
  }

  /** True when the light shows white from the white channels rather than an RGB colour. */
  private inTemperatureMode(): boolean {
    return !!this.profile.whiteTemperature && this.getCapabilityValue('light_mode') === 'temperature';
  }

  private async sendTemperature(brightness: number, temperature?: number): Promise<void> {
    await this.send(this.profile.whiteTemperature!(this.coolPercent(temperature), brightness));
  }

  private async onLightValues(input: Record<string, number | string>): Promise<void> {
    const values = input as Record<string, number>;
    const dim = values.dim ?? this.getCapabilityValue('dim') ?? 1;
    if (dim <= 0) {
      await this.setPower(false);
      await this.setCapabilityValue('onoff', false).catch(this.error);
      return;
    }
    if (this.getCapabilityValue('onoff') === false) {
      // Homey's light rules: only dim turns a light on; colour and white changes made while it is
      // off are applied when it is turned on.
      if (!('dim' in values)) {
        this.applyOnPowerOn = true;
        return;
      }
      await this.setPower(true);
      await this.setCapabilityValue('onoff', true).catch(this.error);
    }
    this.applyOnPowerOn = false;
    const hue = values.light_hue ?? this.getCapabilityValue('light_hue') ?? 0;
    const sat = values.light_saturation ?? this.getCapabilityValue('light_saturation') ?? 0;
    const hsv = homeyToHsv(hue, sat, this.level(dim) / 100);
    const colourChanged = 'light_hue' in values || 'light_saturation' in values;
    const mode = input.light_mode as string | undefined;
    const temperatureChosen = 'light_temperature' in values || mode === 'temperature';
    if (this.profile.whiteTemperature && (temperatureChosen || (!colourChanged && mode !== 'color' && !this.activeEffect && this.inTemperatureMode()))) {
      // White channels: warm-cool slider, or dimming while white.
      this.activeEffect = null;
      if (this.getCapabilityValue('light_mode') !== 'temperature') {
        await this.setCapabilityValue('light_mode', 'temperature').catch(this.error);
      }
      await this.sendTemperature(hsv.v, values.light_temperature);
      this.lastHsv = null;
      return;
    }
    if (colourChanged && this.getCapabilityValue('light_mode') !== 'color') {
      await this.setCapabilityValue('light_mode', 'color').catch(this.error);
    }
    if (!colourChanged && this.activeEffect) {
      // Dimming while an effect runs: re-send the effect at the new brightness.
      const e = findEntry(this.homey.settings, this.effectScope(), this.activeEffect.entryId);
      if (e) await this.sendEntry(e, this.activeEffect.speed, hsv.v);
      return;
    }
    this.activeEffect = null;
    // On the Quntis, bright_value_v2 switches to white (it zeroes saturation), so only use it
    // when the light is white; otherwise re-send the colour at the new level.
    const brightnessCmd = hsv.s === 0 ? this.profile.brightness(hsv.v) : null;
    await this.send(brightnessCmd ?? this.profile.color(this.toDevice(hsv)));
    this.lastHsv = hsv;
  }

  /** Controller brightness 1-100 for a Homey dim value, through the brightness curve setting. */
  private level(dim: number): number {
    return dimToLevel(dim, this.settings.brightness_curve ?? 'perceptual');
  }
  private currentBrightness(): number {
    return this.level(this.getCapabilityValue('dim') ?? 1);
  }

  private async ensureOn(): Promise<void> {
    if (this.getCapabilityValue('onoff') === false) {
      await this.setPower(true);
      await this.setCapabilityValue('onoff', true).catch(this.error);
    }
  }

  private onSettingsChanged: ((key: string) => void) | null = null;

  /** Put the effect library (named, patterns, my effects) into the device's Effect picker. */
  private async refreshEffectPicker(): Promise<void> {
    if (!this.hasCapability('lighting_effect')) return;
    const values = pickerValues(this.effectLibrary());
    this.pickerIds = new Set(values.map((v) => v.id));
    const signature = JSON.stringify(values);
    if (signature === this.pickerSignature) return;
    this.pickerSignature = signature;
    await this.setCapabilityOptions('lighting_effect', { values });
  }

  private entry(id: string): LibraryEntry {
    // Values from 0.2.0 were plain pattern numbers.
    const normalised = /^\d+$/.test(id) ? `p:${id}` : id;
    const e = findEntry(this.homey.settings, this.effectScope(), normalised);
    if (!e) throw new Error('This effect no longer exists. Pick another one.');
    return e;
  }

  /** Effect waiting to be sent while another effect command is still on its way (latest wins). */
  private pendingEffect: { entry: LibraryEntry; speed: number; brightness: number } | null = null;
  private effectSending = false;

  /**
   * Send an effect. Taps made while the light is still (re)connecting do not queue up: a newer
   * effect replaces the one that is waiting, so only the last choice is sent (also covers double taps).
   */
  private async sendEntry(entry: LibraryEntry, speed: number, brightness: number): Promise<void> {
    if (!this.profile.namedEffects) throw new Error(`Effects are not available with the "${this.profile.name}" command set`);
    this.pendingEffect = { entry, speed: clamp(Math.round(speed), 1, 100), brightness };
    if (this.effectSending) return;
    this.effectSending = true;
    try {
      while (this.pendingEffect) {
        const p = this.pendingEffect;
        this.pendingEffect = null;
        await this.send(entryCommand(p.entry, p.speed, p.brightness));
        this.activeEffect = { entryId: p.entry.id, pattern: p.entry.pattern, speed: p.speed };
        this.syncSpeedCapability(p.speed);
        this.reportEffect(p.entry.id, p.entry.pattern, p.entry.name);
      }
    } finally {
      this.effectSending = false;
      this.pendingEffect = null;
    }
  }

  /** Run any library entry ("n:…", "p:…", "c:…"). Used by the picker, Flows and the settings page. */
  async runEntry(id: string, speed?: number): Promise<void> {
    const e = this.entry(id);
    await this.ensureOn();
    await this.sendEntry(e, speed ?? this.currentSpeed(), this.currentBrightness());
  }

  /** Play an entry that is not (yet) in the library, e.g. an unsaved effect in the studio. */
  async playEntry(entry: LibraryEntry, speed: number): Promise<void> {
    await this.ensureOn();
    await this.sendEntry(entry, speed, this.currentBrightness());
  }

  /** Back to the static colour (studio "Stop"). */
  async showStaticColour(): Promise<void> {
    await this.onEffectPicked('static');
  }

  /** What this light can play: its model's Surplife scenes, the raw patterns and its own effects. */
  effectScope(): DeviceScope {
    return { deviceId: this.getData().id, productId: this.storeData.productId, effects: !!this.profile.namedEffects };
  }

  effectLibrary(): LibraryEntry[] {
    return getLibrary(this.homey.settings, this.effectScope());
  }

  /** Model shown in the app settings, e.g. "Zengge Symphony RGBWW controller · 0x86 · sold as Quntis". */
  modelName(): string {
    return productName(this.storeData.productId);
  }

  /**
   * The page the app settings open for this device. Each kind of device has its own page; this
   * light's is the effect studio, for models that support effects (docs/ADDING_DEVICES.md).
   */
  settingsPanel(): string | null {
    return this.effectScope().effects ? 'effects' : null;
  }

  /** One line for this device's card on the app settings start screen. */
  panelSummary(): { status: string; live: boolean } {
    if (!this.effectScope().effects) return { status: 'No effects on this model', live: false };
    const id = this.currentEffectId();
    const effect = id ? this.effectLibrary().find((e) => e.id === id) : undefined;
    return effect ? { status: `Playing: ${effect.name}`, live: true } : { status: 'Static colour', live: false };
  }

  /** Library id of the effect that is running, or null for the static colour. */
  currentEffectId(): string | null {
    return this.activeEffect?.entryId ?? null;
  }

  /** Speed of the effect that is running, or null. */
  currentEffectSpeed(): number | null {
    return this.activeEffect?.speed ?? null;
  }

  /** Effect picker on the device page. */
  private async onEffectPicked(value: string): Promise<void> {
    if (value === 'static') {
      this.activeEffect = null;
      await this.ensureOn();
      if (this.inTemperatureMode()) {
        await this.sendTemperature(this.currentBrightness());
        this.reportEffect('static', 0, 'Static colour');
        return;
      }
      const hsv = this.lastHsv ?? homeyToHsv(
        this.getCapabilityValue('light_hue') ?? 0,
        this.getCapabilityValue('light_saturation') ?? 0,
        this.currentBrightness() / 100,
      );
      await this.send(hsv.s === 0 ? (this.profile.brightness(hsv.v) ?? this.profile.color(hsv)) : this.profile.color(this.toDevice(hsv)));
      this.reportEffect('static', 0, 'Static colour');
      return;
    }
    await this.runEntry(value);
  }

  private lastReportedEffect: string | null = null;
  private lastEffectSpeed: number | null = null;

  /** Speed for the next effect: the slider value, else the last reported speed, else 100. */
  private currentSpeed(): number {
    const v = this.hasCapability('lighting_effect_speed') ? this.getCapabilityValue('lighting_effect_speed') : null;
    return clamp(Math.round(v !== null ? v * 100 : (this.lastEffectSpeed ?? 100)), 1, 100);
  }

  /** Speed slider: re-send the running effect at the new speed, or remember it for the next one. */
  private async onSpeedChanged(value: number): Promise<void> {
    if (!this.activeEffect) return;
    // An open device page can echo an old slider value right after we moved the slider
    // ourselves (seen 50 ms after a state update). Ignore that echo and restore the real speed.
    if (Date.now() - this.speedSetByAppAt < 2_000) {
      this.log(`Ignoring speed ${Math.round(value)} echoed right after a state update`);
      this.syncSpeedCapability(this.activeEffect.speed, true);
      return;
    }
    const e = findEntry(this.homey.settings, this.effectScope(), this.activeEffect.entryId);
    if (e) await this.sendEntry(e, value, this.currentBrightness());
  }

  private speedSetByAppAt = 0;

  private syncSpeedCapability(speed: number, force = false): void {
    if (!this.hasCapability('lighting_effect_speed')) return;
    const value = clamp(speed, 1, 100) / 100;
    if (force || Math.abs((this.getCapabilityValue('lighting_effect_speed') ?? -1) - value) > 0.001) {
      this.speedSetByAppAt = Date.now();
      this.setCapabilityValue('lighting_effect_speed', value).catch(this.error);
    }
  }

  /** Keep the effect picker in sync and fire "Effect changed" (pattern 0 = static colour). */
  private reportEffect(id: string, pattern: number, name: string): void {
    if (!this.pickerIds.has(id)) return; // e.g. an unsaved effect previewed in the studio
    if (id === this.lastReportedEffect) return;
    const first = this.lastReportedEffect === null;
    this.lastReportedEffect = id;
    if (this.hasCapability('lighting_effect') && this.getCapabilityValue('lighting_effect') !== id) {
      this.setCapabilityValue('lighting_effect', id).catch(this.error);
    }
    if (!first) {
      this.homey.flow.getDeviceTriggerCard('effect_changed').trigger(this, { effect: pattern, name }, {}).catch(this.error);
    }
  }

  /** Flow: built-in pattern by number. */
  async runEffect(effect: number, speed: number): Promise<void> {
    await this.runEntry(`p:${Math.round(effect)}`, speed);
  }

  async sendRaw(opcode: number, hex: string, appendChecksum: boolean): Promise<void> {
    let payload = parseHex(hex);
    if (appendChecksum) payload = Buffer.concat([payload, Buffer.from([checksum(payload)])]);
    const sent = payload.toString('hex');
    const label = `raw ${sent.length > 64 ? `${sent.slice(0, 64)}… (${payload.length} bytes)` : sent}`;
    await this.send({ opcode: opcode & 0xff, payload, label, provenance: 'derived' });
  }

  /**
   * Development only: env.json TEST_SEQUENCE = JSON array of {op, hex, label}. Each step is sent
   * with a 10 s pause so the person watching the lights can say which step had an effect.
   * env.json is bundled with the app, so it must hold no switches for a release
   * (`npm run release-check` refuses to continue otherwise).
   */
  private async runDevTestSequence(): Promise<void> {
    const raw = devEnv('TEST_SEQUENCE');
    if (!raw) return;
    const steps = JSON.parse(raw) as Array<{ op: number; hex: string; label: string }>;
    for (let i = 0; i < steps.length; i++) {
      const s = steps[i];
      this.log(`TEST step ${i + 1}/${steps.length}: ${s.label}`);
      await this.send({ opcode: s.op, payload: parseHex(s.hex), label: `TEST ${i + 1} ${s.label}`, provenance: 'derived' })
        .catch((err) => this.log(`TEST step ${i + 1} failed:`, err.message));
      await new Promise((r) => this.homey.setTimeout(r, Number(devEnv('TEST_INTERVAL_MS')) || 10_000));
    }
    this.log('TEST sequence finished');
  }

  /** Try each state query of the active profile until one gets a reply. */
  async queryState(): Promise<void> {
    let lastErr: Error | null = null;
    for (const q of this.profile.stateQueries()) {
      try {
        const reply = await this.conn.request(q, STATE_QUERY_TIMEOUT_MS, (m) => isStateOpcode(m.opcode) || parseState(notificationPayload(m)).format !== 'unknown');
        this.touch();
        this.log(`State reply to ${q.label}: opcode ${reply.opcode} ${reply.payload.toString('hex')}`);
        if (!this.getAvailable()) await this.setAvailable();
        return;
      } catch (err) {
        lastErr = err as Error;
      }
    }
    this.touch();
    throw lastErr ?? new Error('No state query available');
  }

  // ------------------------------------------------------------- notifications

  private onMessage(msg: DecodedMessage): void {
    const hex = msg.payload.toString('hex');
    this.homey.flow.getDeviceTriggerCard('notification_received')
      .trigger(this, { opcode: msg.opcode, hex }, {})
      .catch(this.error);
    const data = notificationPayload(msg);
    const state = parseState(data);
    if (devEnv('DEBUG') === '1' && state.format !== 'unknown') {
      const h = (n: number | null) => (n === null ? '-' : `0x${n.toString(16).padStart(2, '0')}`);
      this.log(`STATE on=${state.on} mode=${h(state.mode)} sub=${h(state.subMode)} speed=${state.speed ?? '-'} `
        + `effect=${h(state.effectId)} hue=${state.hue ?? '-'} sat=${state.saturation ?? '-'} bri=${state.brightness ?? '-'} `
        + `raw=${data.subarray(5).toString('hex')}`);
    }
    if (state.format === 'unknown' && !isStateOpcode(msg.opcode)) return;
    this.noteLastState(`opcode ${msg.opcode}: ${data.toString('hex')}`);
    if (state.on !== null && this.getCapabilityValue('onoff') !== state.on) {
      this.setCapabilityValue('onoff', state.on).catch(this.error);
    }
    const updates: Array<[string, number]> = [];
    if (state.brightness !== null && state.brightness > 0) updates.push(['dim', levelToDim(state.brightness, this.settings.brightness_curve ?? 'perceptual')]);
    if (state.hue !== null) {
      const hue = this.settings.colour_correction === false ? state.hue : uncorrectHue(state.hue);
      updates.push(['light_hue', hue / 360]);
    }
    if (state.saturation !== null) updates.push(['light_saturation', state.saturation / 100]);
    for (const [cap, value] of updates) {
      if (Math.abs((this.getCapabilityValue(cap) ?? -1) - value) > 0.005) {
        this.setCapabilityValue(cap, value).catch(this.error);
      }
    }
    // A static colour set elsewhere (remote, phone app) means the light is in colour mode. The
    // state reply does not include the white temperature, so temperature mode is only set by Homey.
    if (state.mode === 0x24 && (state.saturation ?? 0) > 0 && this.hasCapability('light_mode')
      && this.getCapabilityValue('light_mode') !== 'color') {
      this.setCapabilityValue('light_mode', 'color').catch(this.error);
    }
    if (state.mode === 0x24 && state.subMode === 0x14) {
      this.activeEffect = null; // static colour (set by us, the remote or the phone app)
      this.reportEffect('static', 0, 'Static colour');
    } else if (state.mode === 0x25 && state.effectId !== null) {
      if (state.speed !== null && state.speed >= 1 && state.speed <= 100) {
        this.lastEffectSpeed = state.speed;
        this.syncSpeedCapability(state.speed); // e.g. the remote resets speed to 100
      }
      if (this.activeEffect && this.activeEffect.pattern === state.effectId) return; // ours
      // Changed externally (remote / phone app): show it as the matching built-in pattern.
      const id = `p:${state.effectId}`;
      const e = findEntry(this.homey.settings, this.effectScope(), id);
      if (e) {
        this.activeEffect = { entryId: id, pattern: state.effectId, speed: state.speed ?? 100 };
        this.reportEffect(id, state.effectId, e.name);
      }
    }
  }

  // ---------------------------------------------------------------- lifecycle

  // ------------------------------------------------------------ remote controls

  /**
   * Read which radio remotes the light obeys and show it in the device settings. Settings are
   * written only when they differ, and setSettings from code does not call onSettings.
   */
  async readRemoteConfig(): Promise<RemoteConfig> {
    const reply = await this.conn.request(remoteConfigQuery(), STATE_QUERY_TIMEOUT_MS, (m) => parseRemoteConfig(notificationPayload(m)) !== null);
    const config = parseRemoteConfig(notificationPayload(reply))!;
    this.touch();
    const paired = String(config.paired);
    if (this.settings.remote_control !== config.mode || this.settings.info_remotes !== paired) {
      await this.setSettings({ remote_control: config.mode, info_remotes: paired }).catch(this.error);
    }
    this.log(`Remote settings: ${config.mode}, ${config.paired} paired`);
    return config;
  }

  /** Flow action: remove every radio remote paired with this light. */
  async unpairAllRemotes(): Promise<void> {
    await this.send(unpairRemotes());
    await this.readRemoteConfig().catch((err) => this.log('Remote settings query failed:', err.message));
  }

  /** Put the light's remote settings back to the factory state (used when it is removed). */
  private async resetRemotes(): Promise<void> {
    await this.send(unpairRemotes());
    await this.send(setRemoteMode(DEFAULT_REMOTE_MODE));
    this.log('Remote settings reset: remotes unpaired, all remotes allowed');
  }

  async onSettings({ newSettings, changedKeys }: { newSettings: Record<string, unknown>; changedKeys: string[] }): Promise<string | void> {
    const s = newSettings as unknown as Settings;
    if (changedKeys.includes('remote_control')) {
      // Fails (and Homey keeps the old value) when the light cannot be reached.
      await this.send(setRemoteMode(s.remote_control));
      const check = await this.conn.request(remoteConfigQuery(), STATE_QUERY_TIMEOUT_MS, (m) => parseRemoteConfig(notificationPayload(m)) !== null)
        .then((m) => parseRemoteConfig(notificationPayload(m)))
        .catch(() => null);
      if (check && check.mode !== s.remote_control) {
        throw new Error('The light did not take the new remote setting. Try again.');
      }
    }
    if (changedKeys.includes('command_profile')) {
      this.profile = this.resolveProfile(s.command_profile);
      this.homey.setTimeout(() => this.updateInfoSettings().catch(this.error), 500);
    }
    this.conn.updateOptions({
      maxPacket: Number(s.max_packet) || 255,
      minWriteGapMs: s.min_write_gap,
    });
    if (changedKeys.includes('idle_disconnect')) {
      // Settings are stored only after this returns, so act on the new value directly.
      if (this.idleTimer) this.homey.clearTimeout(this.idleTimer);
      this.idleTimer = null;
      if (s.idle_disconnect === 0) {
        if (!this.conn.isConnected) this.conn.connect().catch((err) => this.log('Connect failed:', err.message));
      } else {
        if (this.reconnectTimer) this.homey.clearTimeout(this.reconnectTimer);
        this.reconnectTimer = null;
        if (this.conn.isConnected) {
          this.idleTimer = this.homey.setTimeout(() => this.conn.disconnect().catch(this.error), s.idle_disconnect * 1000);
        }
      }
    }
  }

  async onUninit(): Promise<void> {
    await this.cleanup();
  }

  async onDeleted(): Promise<void> {
    // Leave the light as it came: no paired remotes, all remotes allowed. Bounded, so removing
    // a light that is out of range is not held up.
    await Promise.race([
      this.resetRemotes(),
      new Promise((_, reject) => this.homey.setTimeout(() => reject(new Error('timed out')), 20_000)),
    ]).catch((err) => this.log('Could not reset the remote settings on removal:', (err as Error).message));
    this.deleted = true;
    // Stop listening first, so removing this light's effects does not refresh a deleted device.
    await this.cleanup();
    // This light's own effects go with it.
    try { this.homey.settings.unset(customEffectsKey(this.getData().id)); } catch (err) { this.error(err); }
  }

  private async cleanup(): Promise<void> {
    for (const t of [this.idleTimer, this.reconnectTimer, this.initTimer, this.infoState.timer]) {
      if (t) this.homey.clearTimeout(t);
    }
    if (this.pollTimer) this.homey.clearInterval(this.pollTimer);
    this.idleTimer = this.reconnectTimer = this.initTimer = this.pollTimer = this.infoState.timer = null;
    if (this.onSettingsChanged) {
      this.homey.settings.removeListener('set', this.onSettingsChanged);
      this.homey.settings.removeListener('unset', this.onSettingsChanged);
    }
    if (this.advertSubscribed) {
      await this.homey.ble.unsubscribeFromAdvertisements(this.storeData.peripheralUuid).catch(() => undefined);
    }
    this.conn?.removeAllListeners();
    await this.conn?.disconnect().catch(() => undefined);
  }
}

export = ZenggeBleLightDevice;
