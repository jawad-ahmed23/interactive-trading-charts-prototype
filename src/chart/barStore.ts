import { applyLiveBar, indexOfTime, mergeBars, normalize, type LiveApplyResult } from '../feed/bars';
import type { Bar } from '../feed/types';

/**
 * The single source of truth for one series' bars: ascending, unique, finite
 * (rendering-and-interaction §8: LWC's production build does not validate).
 */
export class BarStore {
  private data: Bar[] = [];

  get bars(): readonly Bar[] {
    return this.data;
  }

  get length(): number {
    return this.data.length;
  }

  get first(): Bar | undefined {
    return this.data[0];
  }

  get last(): Bar | undefined {
    return this.data[this.data.length - 1];
  }

  reset(bars: readonly Bar[]): void {
    this.data = normalize(bars);
  }

  /** Merge an older page. Returns the number of bars added. */
  prepend(older: readonly Bar[]): number {
    const before = this.data.length;
    this.data = mergeBars(this.data, older);
    return this.data.length - before;
  }

  applyLive(bar: Bar): LiveApplyResult {
    if (![bar.time, bar.open, bar.high, bar.low, bar.close, bar.volume].every(Number.isFinite)) return 'stale';
    return applyLiveBar(this.data, bar);
  }

  byTime(time: number): Bar | undefined {
    const i = indexOfTime(this.data, time);
    return i >= 0 ? this.data[i] : undefined;
  }

  indexOf(time: number): number {
    return indexOfTime(this.data, time);
  }
}
