import { describe, expect, it } from 'vitest';
import { applyLiveBar, indexOfTime, isValidSeries, mergeBars, normalize } from '../src/feed/bars';
import type { Bar } from '../src/feed/types';

const bar = (time: number, close = time): Bar => ({ time, open: close, high: close + 1, low: close - 1, close, volume: 1 });
const range = (from: number, to: number, step = 60): Bar[] => {
  const out: Bar[] = [];
  for (let t = from; t < to; t += step) out.push(bar(t));
  return out;
};

describe('history merge (A9)', () => {
  it('prepends an older page', () => {
    const merged = mergeBars(range(6000, 9000), range(3000, 6000));
    expect(merged.length).toBe(100);
    expect(isValidSeries(merged)).toBe(true);
    expect(merged[0]!.time).toBe(3000);
  });

  it('dedupes overlapping chunks; the incoming chunk wins for equal times', () => {
    const a = range(0, 200 * 60); // bars 0–199
    const b = range(150 * 60, 350 * 60).map((x) => ({ ...x, close: -1 })); // bars 150–349, changed
    const merged = mergeBars(a, b);
    expect(merged.length).toBe(350);
    expect(new Set(merged.map((x) => x.time)).size).toBe(350);
    expect(merged.slice(150, 200).every((x) => x.close === -1)).toBe(true);
    expect(merged[149]!.close).toBe(149 * 60);
  });

  it('normalizes unsorted, duplicated and non-finite input', () => {
    const messy = [bar(120), bar(60), bar(120, 5), { ...bar(180), close: Number.NaN }];
    const n = normalize(messy);
    expect(n.map((x) => x.time)).toEqual([60, 120]);
    expect(n[1]!.close).toBe(5);
  });

  it('indexOfTime finds bars by binary search', () => {
    const bars = range(0, 6000);
    expect(indexOfTime(bars, 0)).toBe(0);
    expect(indexOfTime(bars, 5940)).toBe(99);
    expect(indexOfTime(bars, 30)).toBe(-1);
  });
});

describe('live tick: update current bar vs open a new bar (A10–A13)', () => {
  const T = 1_800_000_000; // last bar time

  it('a tick in the same period replaces the last bar (A10, A11)', () => {
    const bars = [bar(T - 300), { time: T, open: 100, high: 101, low: 99, close: 100, volume: 1 }];
    expect(applyLiveBar(bars, { time: T, open: 100, high: 102, low: 99, close: 102, volume: 2 })).toBe('replace');
    expect(bars.length).toBe(2);
    expect(bars[1]!.high).toBe(102);
    expect(applyLiveBar(bars, { time: T, open: 100, high: 102, low: 98, close: 100.5, volume: 3 })).toBe('replace');
    expect(bars[1]).toMatchObject({ high: 102, low: 98, close: 100.5 });
  });

  it('a tick in the next period appends a new bar and freezes the previous one (A12)', () => {
    const bars = [{ time: T, open: 100, high: 102, low: 98, close: 100.5, volume: 3 }];
    expect(applyLiveBar(bars, { time: T + 300, open: 101, high: 101, low: 101, close: 101, volume: 1 })).toBe('append');
    expect(bars.length).toBe(2);
    expect(bars[0]).toMatchObject({ close: 100.5, high: 102 });
  });

  it('an older bar is stale and ignored (A13)', () => {
    const bars = [bar(T), bar(T + 300)];
    expect(applyLiveBar(bars, bar(T))).toBe('stale');
    expect(bars.length).toBe(2);
  });
});
