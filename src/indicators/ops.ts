import type { Bar } from '../feed/types';
import type { PriceSource } from './types';

/**
 * Stateful series operators used by built-ins (and later by compiled scripts).
 * States are plain data, so they clone with structuredClone.
 * Conventions follow script-language-design.md §8.1 (verified formulas):
 * - SMA: first value at index n−1; a none input inside the window gives none.
 * - EMA: α = 2/(n+1), seeded with the SMA of the first n valid inputs.
 * - RMA (Wilder): α = 1/n, seeded with the SMA of the first n valid inputs.
 * - Recursive smoothers skip none inputs (output none) and keep their state.
 */

export function source(bar: Bar, src: PriceSource): number {
  switch (src) {
    case 'open':
      return bar.open;
    case 'high':
      return bar.high;
    case 'low':
      return bar.low;
    case 'hl2':
      return (bar.high + bar.low) / 2;
    case 'hlc3':
      return (bar.high + bar.low + bar.close) / 3;
    case 'ohlc4':
      return (bar.open + bar.high + bar.low + bar.close) / 4;
    default:
      return bar.close;
  }
}

// ------------------------------------------------------------------ window

export interface WindowState {
  buf: number[];
  head: number;
  count: number;
}

export function windowInit(n: number): WindowState {
  return { buf: new Array<number>(n).fill(Number.NaN), head: 0, count: 0 };
}

/** Push x into a ring of length n. Returns true when the window is full. */
export function windowPush(w: WindowState, x: number): boolean {
  const n = w.buf.length;
  w.buf[w.head] = x;
  w.head = (w.head + 1) % n;
  if (w.count < n) w.count++;
  return w.count === n;
}

/** Mean of a full window (NaN if any element is NaN). Summed in insertion order. */
export function windowMean(w: WindowState): number {
  const n = w.buf.length;
  let sum = 0;
  for (let k = 0; k < n; k++) sum += w.buf[(w.head + k) % n]!;
  return sum / n;
}

/** Population standard deviation of a full window around `mean`. */
export function windowStdev(w: WindowState, mean: number): number {
  const n = w.buf.length;
  let ss = 0;
  for (let k = 0; k < n; k++) {
    const d = w.buf[(w.head + k) % n]! - mean;
    ss += d * d;
  }
  return Math.sqrt(ss / n);
}

export function smaStep(w: WindowState, x: number): number {
  return windowPush(w, x) ? windowMean(w) : Number.NaN;
}

// ------------------------------------------------------------------ EMA / RMA

export interface SmootherState {
  n: number;
  alpha: number;
  value: number;
  seedSum: number;
  seedCount: number;
}

export function emaInit(n: number): SmootherState {
  return { n, alpha: 2 / (n + 1), value: Number.NaN, seedSum: 0, seedCount: 0 };
}

export function rmaInit(n: number): SmootherState {
  return { n, alpha: 1 / n, value: Number.NaN, seedSum: 0, seedCount: 0 };
}

export function smootherStep(s: SmootherState, x: number): number {
  if (Number.isNaN(x)) return Number.NaN;
  if (s.seedCount < s.n) {
    s.seedSum += x;
    s.seedCount++;
    if (s.seedCount === s.n) s.value = s.seedSum / s.n;
    return s.seedCount === s.n ? s.value : Number.NaN;
  }
  s.value = s.alpha * x + (1 - s.alpha) * s.value;
  return s.value;
}
