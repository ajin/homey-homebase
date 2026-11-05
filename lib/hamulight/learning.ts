import { checksumOk, cleanLevels, commandByte, Frame, LearnedRemote, remoteId, TOGGLE_COMMAND } from './protocol';

/** How many separate presses of the same frame identify the on/off button. */
export const TOGGLE_PRESSES = 2;

export type LearnPhase = 'toggle' | 'levels';

export interface LearnStatus {
  phase: LearnPhase;
  remoteId: number | null;
  toggle: Frame | null;
  levels: Frame[];
  /** Presses heard per frame while finding the on/off button. */
  presses: { frame: Frame; count: number }[];
  /**
   * True when the remote's frames carry the known checksum (HM3002 generation): brightness is then
   * calculated from ring positions and the ring step is not needed.
   */
  calculated: boolean;
}

/**
 * Learns a remote in two steps, fed with frames from the radio (no Homey imports, unit tested):
 *  1. toggle: a frame with a valid checksum and the on/off command (A0) is the on/off button at
 *     once; other frames with a valid checksum (the ring) never are. A frame without a valid
 *     checksum (unknown remote type) needs TOGGLE_PRESSES separate presses. Its first 16 bits
 *     are the remote id.
 *  2. levels (only for remotes without the known checksum): the user slides along the brightness
 *     ring from darkest to brightest; every new frame of that remote (except on/off) becomes the
 *     next brightness level. HM3002-type remotes skip this: brightness is calculated.
 */
export class RemoteLearner {
  private phase: LearnPhase = 'toggle';
  private pressCounts = new Map<Frame, number>();
  private remote: number | null = null;
  private toggle: Frame | null = null;
  private sweep: Frame[] = [];

  /** Feed one heard frame. Returns true when the status changed. */
  add(frame: Frame, repeat: boolean): boolean {
    if (this.phase === 'toggle') {
      if (repeat) return false;
      const n = (this.pressCounts.get(frame) ?? 0) + 1;
      this.pressCounts.set(frame, n);
      // Frames with a valid checksum come from a remote type whose on/off command is known
      // (A0): only that command is on/off, so ring codes can never be taken for it. The
      // two-press rule is only for remotes whose frames do not follow the checksum rule.
      const valid = checksumOk(frame);
      const knownToggle = valid && commandByte(frame) === TOGGLE_COMMAND;
      if (knownToggle || (!valid && n >= TOGGLE_PRESSES)) {
        this.toggle = frame;
        this.remote = remoteId(frame);
        this.phase = 'levels';
      }
      return true;
    }
    if (this.remote === null || remoteId(frame) !== this.remote || frame === this.toggle) return false;
    if (this.sweep.includes(frame)) return false;
    this.sweep.push(frame);
    return true;
  }

  /** Use an on/off code entered by hand (e.g. captured with another receiver). */
  setToggle(frame: Frame): void {
    this.toggle = frame;
    this.remote = remoteId(frame);
    this.phase = 'levels';
    this.sweep = [];
  }

  restartLevels(): void {
    this.sweep = [];
  }

  restart(): void {
    this.phase = 'toggle';
    this.pressCounts.clear();
    this.remote = null;
    this.toggle = null;
    this.sweep = [];
  }

  status(): LearnStatus {
    return {
      phase: this.phase,
      remoteId: this.remote,
      toggle: this.toggle,
      levels: [...this.sweep],
      presses: [...this.pressCounts.entries()].map(([frame, count]) => ({ frame, count })),
      calculated: this.toggle !== null && checksumOk(this.toggle),
    };
  }

  result(): LearnedRemote | null {
    if (this.remote === null || this.toggle === null) return null;
    // Calculated remotes need no captured levels (ring frames heard by chance would only be noise).
    const levels = checksumOk(this.toggle) ? [] : cleanLevels(this.sweep, this.remote, this.toggle);
    return { remoteId: this.remote, toggle: this.toggle, levels };
  }
}

/** Text for the "brightness levels" label in the device settings. */
export function levelsInfo(r: LearnedRemote): string {
  return checksumOk(r.toggle) ? 'Not needed (calculated from ring position)' : String(r.levels.length);
}
