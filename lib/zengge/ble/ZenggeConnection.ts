/**
 * One BLE link to a Zengge ZGHB controller, using the Homey BLE manager.
 *
 * Responsibilities: connect / discover GATT, subscribe to notifications, serialise writes with a
 * minimum gap, frame commands with the transport layer, reassemble notifications and surface
 * disconnects. It knows nothing about Homey capabilities.
 */
import { EventEmitter } from 'events';
import type Homey from 'homey';
import {
  DecodedMessage,
  encodeFrames,
  FrameDecoder,
  FrameVersion,
  SequenceCounter,
  ZG_NOTIFY_CHAR_UUID,
  ZG_SERVICE_UUID,
  ZG_WRITE_CHAR_UUID,
} from '../protocol/transport';
import type { LightCommand } from '../protocol/commands';

type BlePeripheral = Homey.BlePeripheral;
type BleCharacteristic = Homey.BleCharacteristic;
type ManagerBLE = Homey.Homey['ble'];

export interface ConnectionOptions {
  peripheralUuid: string;
  frameVersion: FrameVersion;
  maxPacket: number;
  /** Minimum time between two GATT writes, to avoid flooding the controller. */
  minWriteGapMs: number;
  connectTimeoutMs: number;
  writeTimeoutMs: number;
  log: (...args: unknown[]) => void;
  debug: () => boolean;
  /**
   * Command whose reply proves notifications work (e.g. a state query). Sent right after every
   * connect; if no notification arrives the link is rebuilt. Seen on the Quntis: when Homey's own
   * connect flaps, writes still work but notifications silently stop until a fresh connect.
   */
  probe?: LightCommand;
}

const CONNECT_ATTEMPTS = 3;
const PROBE_TIMEOUT_MS = 2_500;
/** After a failed connect, further commands fail at once for this long instead of retrying. */
const FAIL_FAST_MS = 15_000;
/** Commands that may wait for the link; more are refused (protects the radio and memory). */
const MAX_QUEUED = 20;

/**
 * One connect at a time across the whole app: Homey has a single Bluetooth radio, and parallel
 * connects to several controllers make each of them slower and less reliable.
 */
let radioLock: Promise<unknown> = Promise.resolve();
function withRadio<T>(fn: () => Promise<T>): Promise<T> {
  const run = radioLock.then(fn, fn);
  radioLock = run.catch(() => undefined);
  return run;
}

/** Thrown inside an abandoned connect attempt (one that timed out) to stop it. */
class StaleAttempt extends Error {}

export interface ConnectionEvents {
  message: [DecodedMessage];
  disconnect: [];
  /** Link (re)established and notifications subscribed. */
  connected: [];
}

function shortUuid(uuid: string): string {
  const u = uuid.toLowerCase().replace(/-/g, '');
  const m = /^0000([0-9a-f]{4})00001000800000805f9b34fb$/.exec(u);
  return m ? m[1] : u;
}

export function withTimeout<T>(p: Promise<T>, ms: number, what: string): Promise<T> {
  let timer: NodeJS.Timeout | undefined;
  return Promise.race([
    p.finally(() => timer && clearTimeout(timer)),
    new Promise<T>((_, reject) => {
      timer = setTimeout(() => reject(new Error(`${what} timed out after ${ms} ms`)), ms);
    }),
  ]);
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

export class ZenggeConnection extends EventEmitter {
  private peripheral: BlePeripheral | null = null;
  private writeChar: BleCharacteristic | null = null;
  private notifyChar: BleCharacteristic | null = null;
  private readonly decoder = new FrameDecoder();
  private readonly seq = new SequenceCounter();
  private queue: Promise<unknown> = Promise.resolve();
  private lastWriteAt = 0;
  private connecting: Promise<void> | null = null;
  private closedByUs = false;
  /** Bumped on every connect attempt and teardown; an attempt that no longer matches gives up. */
  private generation = 0;
  private failedAt = 0;
  private lastError: Error | null = null;
  private queued = 0;

  constructor(private readonly ble: ManagerBLE, private opts: ConnectionOptions) {
    super();
  }

  updateOptions(patch: Partial<ConnectionOptions>): void {
    this.opts = { ...this.opts, ...patch };
  }

  get isConnected(): boolean {
    return !!this.peripheral && this.peripheral.isConnected && !!this.writeChar;
  }

  private dbg(...args: unknown[]): void {
    if (this.opts.debug()) this.opts.log('[ble]', ...args);
  }

  async connect(): Promise<void> {
    if (this.isConnected) return;
    if (!this.connecting) {
      const since = Date.now() - this.failedAt;
      if (since < FAIL_FAST_MS) {
        throw new Error(`light not reachable (${this.lastError?.message ?? 'connect failed'}); retrying in ${Math.ceil((FAIL_FAST_MS - since) / 1000)} s`);
      }
      this.connecting = withRadio(() => this.connectWithProbe())
        .then(() => {
          this.failedAt = 0;
          this.emit('connected');
        }, (err: Error) => {
          this.failedAt = Date.now();
          this.lastError = err;
          throw err;
        })
        .finally(() => {
          this.connecting = null;
        });
    }
    return this.connecting;
  }

  /** Connect, then verify notifications with the probe; rebuild the link if they are dead. */
  private async connectWithProbe(): Promise<void> {
    let lastErr: unknown = null;
    for (let attempt = 1; attempt <= CONNECT_ATTEMPTS; attempt++) {
      const gen = ++this.generation;
      try {
        await withTimeout(this.doConnect(gen), this.opts.connectTimeoutMs, 'BLE connect');
      } catch (err) {
        // Abandon this attempt: if it completes later it sees the new generation and disconnects.
        this.generation++;
        lastErr = err;
        await this.teardown();
        this.dbg(`connect attempt ${attempt} failed:`, (err as Error).message);
        continue;
      }
      if (!this.opts.probe || !this.notifyChar) return;
      if (await this.probeNotifications(this.opts.probe)) return;
      this.opts.log(`No reply from the controller after connecting (attempt ${attempt}); reconnecting`);
      await this.teardown();
      lastErr = new Error('controller does not answer (notifications not working)');
    }
    throw lastErr instanceof Error ? lastErr : new Error(String(lastErr));
  }

  /** Write the probe directly (not via the queue, which may be waiting on this connect). */
  private async probeNotifications(probe: LightCommand): Promise<boolean> {
    if (!this.writeChar) return false;
    const reply = new Promise<boolean>((resolve) => {
      const timer = setTimeout(() => { this.removeListener('message', onMsg); resolve(false); }, PROBE_TIMEOUT_MS);
      const onMsg = () => { clearTimeout(timer); resolve(true); };
      this.once('message', onMsg);
    });
    try {
      for (const frame of encodeFrames(probe.opcode, probe.payload, {
        seq: this.seq.next(), maxPacket: this.opts.maxPacket, version: this.opts.frameVersion,
      })) {
        this.dbg('probe ->', frame.toString('hex'));
        await withTimeout(this.writeChar.write(frame), this.opts.writeTimeoutMs, 'BLE write');
      }
      this.lastWriteAt = Date.now();
    } catch (err) {
      this.dbg('probe write failed:', (err as Error).message);
      return false;
    }
    return reply;
  }

  private async doConnect(gen: number): Promise<void> {
    this.closedByUs = false;
    this.dbg('finding', this.opts.peripheralUuid);
    const adv = await this.ble.find(this.opts.peripheralUuid);
    if (gen !== this.generation) throw new StaleAttempt('connect attempt abandoned');
    this.dbg('connecting, rssi', adv.rssi);
    const peripheral = await adv.connect();
    // Only the current peripheral may report a disconnect; an abandoned one is ignored.
    peripheral.once('disconnect', () => {
      if (peripheral === this.peripheral) this.onDisconnect();
    });
    const abandon = async () => {
      if (gen === this.generation) return;
      if (peripheral !== this.peripheral) await peripheral.disconnect().catch(() => undefined);
      throw new StaleAttempt('connect attempt abandoned');
    };
    await abandon();
    this.peripheral = peripheral;

    const services = await peripheral.discoverAllServicesAndCharacteristics();
    await abandon();
    const service = services.find((s) => shortUuid(s.uuid) === ZG_SERVICE_UUID);
    if (!service) {
      const found = services.map((s) => shortUuid(s.uuid)).join(', ');
      throw new Error(`Service 0xFFFF not found on device (found: ${found || 'none'})`);
    }
    const chars = service.characteristics.length ? service.characteristics : await service.discoverCharacteristics();
    const write = chars.find((c) => shortUuid(c.uuid) === ZG_WRITE_CHAR_UUID);
    const notify = chars.find((c) => shortUuid(c.uuid) === ZG_NOTIFY_CHAR_UUID);
    if (!write) throw new Error('Write characteristic 0xFF01 not found');
    this.writeChar = write;
    this.decoder.reset();
    if (notify) {
      this.notifyChar = notify;
      // Ignore notifications from subscriptions of earlier links.
      await notify.subscribeToNotifications((data: Buffer) => {
        if (notify === this.notifyChar) this.onNotification(data);
      });
      await abandon();
    } else {
      this.opts.log('Notify characteristic 0xFF02 not found; state feedback unavailable');
    }
    // Always logged once per connection: cheap and essential for supporting new hardware.
    this.opts.log('GATT:', services
      .map((s) => `${shortUuid(s.uuid)}{${(s.characteristics ?? []).map((c) => `${shortUuid(c.uuid)}[${(c.properties ?? []).join('|')}]`).join(' ')}}`)
      .join(' '));
  }

  private lastNotify: { hex: string; at: number } | null = null;

  private onNotification(data: Buffer): void {
    // Homey can deliver one notification several times when subscriptions from earlier
    // connections linger (seen on the Quntis: identical frames, same sequence number).
    const hex = data.toString('hex');
    const now = Date.now();
    if (this.lastNotify && this.lastNotify.hex === hex && now - this.lastNotify.at < 500) return;
    this.lastNotify = { hex, at: now };
    this.dbg('notify <-', hex);
    const msg = this.decoder.push(Buffer.from(data));
    if (msg && msg.type !== 2) this.emit('message', msg);
  }

  private onDisconnect(): void {
    // A drop while (re)connecting is handled by connectWithProbe, not reported as "link lost".
    const expected = this.closedByUs || this.connecting !== null;
    this.peripheral = null;
    this.writeChar = null;
    this.notifyChar = null;
    this.decoder.reset();
    this.dbg('disconnected', expected ? '(by us)' : '(unexpected)');
    if (!expected) this.emit('disconnect');
  }

  private async teardown(): Promise<void> {
    this.generation++;
    const p = this.peripheral;
    this.closedByUs = true;
    this.peripheral = null;
    this.writeChar = null;
    if (this.notifyChar) {
      await this.notifyChar.unsubscribeFromNotifications().catch(() => undefined);
      this.notifyChar = null;
    }
    if (p) await p.disconnect().catch(() => undefined);
  }

  async disconnect(): Promise<void> {
    await this.queue.catch(() => undefined);
    await this.teardown();
  }

  /** Queue a command; resolves once all its frames were written. */
  send(cmd: LightCommand): Promise<void> {
    if (this.queued >= MAX_QUEUED) return Promise.reject(new Error('too many commands waiting for the light'));
    this.queued++;
    const run = async () => {
      await this.connect();
      const frames = encodeFrames(cmd.opcode, cmd.payload, {
        seq: this.seq.next(),
        maxPacket: this.opts.maxPacket,
        version: this.opts.frameVersion,
      });
      for (const frame of frames) {
        const gap = this.lastWriteAt + this.opts.minWriteGapMs - Date.now();
        if (gap > 0) await sleep(gap);
        if (!this.writeChar) throw new Error('Not connected');
        this.dbg('write ->', cmd.label, frame.toString('hex'));
        await withTimeout(this.writeChar.write(frame), this.opts.writeTimeoutMs, 'BLE write');
        this.lastWriteAt = Date.now();
      }
    };
    const p = this.queue.then(run, run).finally(() => { this.queued--; });
    this.queue = p.catch(() => undefined);
    return p;
  }

  /**
   * Send a command and wait for the next notification that `accept` recognises as its reply
   * (by default any), so an unrelated push from the controller is not taken for the answer.
   */
  async request(cmd: LightCommand, timeoutMs: number, accept: (m: DecodedMessage) => boolean = () => true): Promise<DecodedMessage> {
    let handler: ((m: DecodedMessage) => void) | null = null;
    const response = new Promise<DecodedMessage>((resolve) => {
      handler = (m) => {
        if (!accept(m)) return;
        this.removeListener('message', handler!);
        resolve(m);
      };
      this.on('message', handler);
    });
    try {
      await this.send(cmd);
      return await withTimeout(response, timeoutMs, `response to ${cmd.label}`);
    } finally {
      if (handler) this.removeListener('message', handler);
    }
  }
}
