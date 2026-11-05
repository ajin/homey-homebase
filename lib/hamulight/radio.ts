import { EventEmitter } from 'events';
import type Homey from 'homey';
import { bitsToFrame, Frame, frameHex, packedPayload, txPlan } from './protocol';

/** A frame heard on 433 MHz. `repeat` is true for repetitions of the same press. */
export interface HeardFrame {
  frame: Frame;
  repeat: boolean;
}

/** Repetitions of one press (or a finger resting on the ring) arrive within this time of each other. */
const REPEAT_WINDOW_MS = 800;

/**
 * Shared access to the `hamulight` 433 MHz signal. Receiving is switched on only while something
 * listens (a paired device or a pairing session), because receiving costs Homey CPU.
 * Transmissions are sent one after another.
 */
export class HamulightRadio extends EventEmitter {
  private signal: Homey.Signal433;
  private txSignal: Homey.Signal433;
  private rxUsers = new Set<string>();
  private rxOn = false;
  private txChain: Promise<void> = Promise.resolve();
  /** When each frame was last heard, to tell repetitions of one press from a new press. */
  private lastHeard = new Map<Frame, number>();

  constructor(homey: Homey.Homey, private readonly log: (...args: unknown[]) => void) {
    super();
    this.signal = homey.rf.getSignal433('hamulight');
    this.txSignal = homey.rf.getSignal433('hamulight_tx');
    this.signal.on('payload', (payload: number[]) => this.onPayload(payload));
  }

  /** Start receiving for `who` (ref counted by name). */
  async listen(who: string): Promise<void> {
    this.rxUsers.add(who);
    if (this.rxOn) return;
    this.rxOn = true;
    try {
      await this.signal.enableRX();
      this.log('433 MHz receive on');
    } catch (err) {
      this.rxOn = false;
      throw err;
    }
  }

  async unlisten(who: string): Promise<void> {
    this.rxUsers.delete(who);
    if (this.rxUsers.size > 0 || !this.rxOn) return;
    this.rxOn = false;
    await this.signal.disableRX().catch((err) => this.log('disableRX failed', err));
    this.log('433 MHz receive off');
  }

  /**
   * Transmit a frame about `repeats` times in one call: up to FRAMES_PER_TX copies packed in one
   * transmission, repeated by Homey. (Each tx call takes seconds on a Homey Pro 2023 however few
   * frames it carries, so one call is the fastest.) Pass the device so Homey uses its antenna.
   */
  send(frame: Frame, repeats: number, device?: Homey.Device): Promise<void> {
    const run = async () => {
      const started = Date.now();
      const { perTx, repetitions } = txPlan(repeats);
      this.log(`Sending 433 MHz Hamulight code ${frameHex(frame)} (${perTx} frames x${repetitions})`);
      // `device` lets Homey pick the antenna chosen for that device (Homey Pro or a Homey Bridge
      // in satellite mode, device > Advanced settings).
      await this.txSignal.tx(packedPayload(frame, perTx), { repetitions, device });
      this.log(`Sent ${frameHex(frame)} in ${Date.now() - started} ms`);
    };
    const p = this.txChain.then(run, run);
    this.txChain = p.catch(() => undefined);
    return p;
  }

  private onPayload(payload: number[]): void {
    const frame = bitsToFrame(payload);
    if (frame === null) return;
    const now = Date.now();
    // Per frame: the ring can interleave two codes, so comparing with the previous frame is not enough.
    const prev = this.lastHeard.get(frame);
    const repeat = prev !== undefined && now - prev < REPEAT_WINDOW_MS;
    this.lastHeard.set(frame, now);
    if (this.lastHeard.size > 256) {
      for (const [f, at] of this.lastHeard) if (now - at > REPEAT_WINDOW_MS) this.lastHeard.delete(f);
    }
    this.emit('frame', { frame, repeat } as HeardFrame);
  }
}
