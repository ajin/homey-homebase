/**
 * Runs device commands one at a time in the background, so a capability change can answer Homey
 * at once even while the Bluetooth link is still (re)connecting, which can take 10 s or more.
 *
 * Jobs have a key ("power", "light", "effect", ...). Queuing a key that is still waiting replaces
 * that job and moves it to the end, so only the latest request per key runs, in the order the user
 * made them. A job that is already running is left to finish.
 */
export class CommandQueue {
  private jobs: { key: string; run: () => Promise<void> }[] = [];
  private running = false;

  constructor(private readonly onResult: (err: Error | null) => void) {}

  push(key: string, run: () => Promise<void>): void {
    this.jobs = this.jobs.filter((j) => j.key !== key);
    this.jobs.push({ key, run });
    if (!this.running) this.drain();
  }

  /** The job waiting for a key, if any (used to merge partial updates). */
  has(key: string): boolean {
    return this.jobs.some((j) => j.key === key);
  }

  private async drain(): Promise<void> {
    this.running = true;
    try {
      for (let job = this.jobs.shift(); job; job = this.jobs.shift()) {
        try {
          await job.run();
          this.onResult(null);
        } catch (err) {
          this.onResult(err instanceof Error ? err : new Error(String(err)));
        }
      }
    } finally {
      this.running = false;
    }
  }
}

/**
 * Merge a newer partial light update into one still waiting. A newer colour drops a waiting
 * white temperature and the other way round, so the last choice wins.
 */
export function mergeLightValues(
  waiting: Record<string, number | string>,
  newer: Record<string, number | string>,
): Record<string, number | string> {
  const merged = { ...waiting };
  const colour = 'light_hue' in newer || 'light_saturation' in newer || newer.light_mode === 'color';
  const white = 'light_temperature' in newer || newer.light_mode === 'temperature';
  if (colour) {
    delete merged.light_temperature;
    if (merged.light_mode === 'temperature') delete merged.light_mode;
  }
  if (white) {
    delete merged.light_hue;
    delete merged.light_saturation;
    if (merged.light_mode === 'color') delete merged.light_mode;
  }
  return { ...merged, ...newer };
}
