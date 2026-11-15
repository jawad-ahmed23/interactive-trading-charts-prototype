import type { Bar } from './types';

/** Binary search: index of the bar with exactly `time`, or -1. */
export function indexOfTime(bars: readonly Bar[], time: number): number {
  let lo = 0;
  let hi = bars.length - 1;
  while (lo <= hi) {
    const mid = (lo + hi) >> 1;
    const t = bars[mid]!.time;
    if (t === time) return mid;
    if (t < time) lo = mid + 1;
    else hi = mid - 1;
  }
  return -1;
}

/** True when bars are strictly ascending by time and every OHLC value is finite. */
export function isValidSeries(bars: readonly Bar[]): boolean {
  for (let i = 0; i < bars.length; i++) {
    const b = bars[i]!;
    if (![b.open, b.high, b.low, b.close, b.volume].every(Number.isFinite)) return false;
    if (i > 0 && bars[i - 1]!.time >= b.time) return false;
  }
  return true;
}

/**
 * Merge two bar arrays into one ascending, de-duplicated array.
 * For equal times the bar from `incoming` wins (newer fetch wins, spec §4.1).
 */
export function mergeBars(existing: readonly Bar[], incoming: readonly Bar[]): Bar[] {
  const sortedIn = normalize(incoming);
  const out: Bar[] = [];
  let i = 0;
  let j = 0;
  while (i < existing.length || j < sortedIn.length) {
    const a = existing[i];
    const b = sortedIn[j];
    if (b === undefined || (a !== undefined && a.time < b.time)) {
      out.push(a!);
      i++;
    } else if (a === undefined || b.time < a.time) {
      out.push(b);
      j++;
    } else {
      out.push(b);
      i++;
      j++;
    }
  }
  return out;
}

/** Sort ascending and drop duplicate times (last occurrence wins) and non-finite bars. */
export function normalize(bars: readonly Bar[]): Bar[] {
  const map = new Map<number, Bar>();
  for (const b of bars) {
    if ([b.time, b.open, b.high, b.low, b.close, b.volume].every(Number.isFinite)) map.set(b.time, b);
  }
  return [...map.values()].sort((x, y) => x.time - y.time);
}

export type LiveApplyResult = 'replace' | 'append' | 'stale';

/**
 * Apply a live bar to an ascending array in place (data-feed-spec §3.1).
 * same time → replace last; newer → append; older → stale (ignored).
 */
export function applyLiveBar(bars: Bar[], bar: Bar): LiveApplyResult {
  const last = bars[bars.length - 1];
  if (!last || bar.time > last.time) {
    bars.push(bar);
    return 'append';
  }
  if (bar.time === last.time) {
    bars[bars.length - 1] = bar;
    return 'replace';
  }
  return 'stale';
}
