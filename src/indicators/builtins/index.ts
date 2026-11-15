import type { Bar } from '../../feed/types';
import { emaInit, rmaInit, smaStep, smootherStep, source, windowInit, windowMean, windowPush, windowStdev, type SmootherState, type WindowState } from '../ops';
import type { IndicatorDefinition, IndicatorRuntime, InputValues, PriceSource } from '../types';
import { THEME } from '../../ui/theme';

const int = (v: InputValues, k: string): number => Math.max(1, Math.round(Number(v[k])));
const num = (v: InputValues, k: string): number => Number(v[k]);
const src = (v: InputValues, k = 'source'): PriceSource => (v[k] ?? 'close') as PriceSource;

/** Build a runtime whose state is plain data and clones with structuredClone. */
function runtime<S>(initial: () => S, step: (s: S, bar: Bar) => number[]): IndicatorRuntime<S> {
  return { initial, step, clone: (s) => structuredClone(s) };
}

// ------------------------------------------------------------------ SMA

export const SMA: IndicatorDefinition<WindowState> = {
  id: 'sma',
  name: 'Simple Moving Average',
  shortName: 'SMA',
  placement: 'overlay',
  inputs: [
    { id: 'length', title: 'Length', type: 'int', default: 20, min: 1, max: 1000 },
    { id: 'source', title: 'Source', type: 'source', default: 'close' },
  ],
  plots: [{ id: 'sma', title: 'SMA', kind: 'line', color: THEME.accent1 }],
  warmup: (i) => int(i, 'length') - 1,
  create(i) {
    const n = int(i, 'length');
    const s = src(i);
    return runtime(() => windowInit(n), (st, bar) => [smaStep(st, source(bar, s))]);
  },
};

// ------------------------------------------------------------------ EMA

export const EMA: IndicatorDefinition<SmootherState> = {
  id: 'ema',
  name: 'Exponential Moving Average',
  shortName: 'EMA',
  placement: 'overlay',
  inputs: [
    { id: 'length', title: 'Length', type: 'int', default: 20, min: 1, max: 1000 },
    { id: 'source', title: 'Source', type: 'source', default: 'close' },
  ],
  plots: [{ id: 'ema', title: 'EMA', kind: 'line', color: THEME.accent2 }],
  warmup: (i) => int(i, 'length') - 1,
  create(i) {
    const n = int(i, 'length');
    const s = src(i);
    return runtime(() => emaInit(n), (st, bar) => [smootherStep(st, source(bar, s))]);
  },
};

// ------------------------------------------------------------------ RSI (Wilder)

interface RsiState {
  prev: number;
  up: SmootherState;
  down: SmootherState;
}

export const RSI: IndicatorDefinition<RsiState> = {
  id: 'rsi',
  name: 'Relative Strength Index',
  shortName: 'RSI',
  placement: 'pane',
  inputs: [
    { id: 'length', title: 'Length', type: 'int', default: 14, min: 2, max: 500 },
    { id: 'source', title: 'Source', type: 'source', default: 'close' },
  ],
  plots: [{ id: 'rsi', title: 'RSI', kind: 'line', color: THEME.accent3 }],
  levels: [
    { value: 70, title: 'Upper' },
    { value: 30, title: 'Lower' },
  ],
  fixedRange: [0, 100],
  precision: 2,
  warmup: (i) => int(i, 'length'),
  create(i) {
    const n = int(i, 'length');
    const s = src(i);
    return runtime<RsiState>(
      () => ({ prev: Number.NaN, up: rmaInit(n), down: rmaInit(n) }),
      (st, bar) => {
        const x = source(bar, s);
        if (Number.isNaN(st.prev)) {
          st.prev = x;
          return [Number.NaN];
        }
        const change = x - st.prev;
        st.prev = x;
        const u = smootherStep(st.up, Math.max(change, 0));
        const d = smootherStep(st.down, Math.max(-change, 0));
        if (Number.isNaN(u) || Number.isNaN(d)) return [Number.NaN];
        if (d === 0) return [u === 0 ? 50 : 100];
        return [100 - 100 / (1 + u / d)];
      },
    );
  },
};

// ------------------------------------------------------------------ MACD

interface MacdState {
  fast: SmootherState;
  slow: SmootherState;
  signal: SmootherState;
}

export const MACD: IndicatorDefinition<MacdState> = {
  id: 'macd',
  name: 'Moving Average Convergence Divergence',
  shortName: 'MACD',
  placement: 'pane',
  inputs: [
    { id: 'fast', title: 'Fast length', type: 'int', default: 12, min: 1, max: 500 },
    { id: 'slow', title: 'Slow length', type: 'int', default: 26, min: 1, max: 500 },
    { id: 'signal', title: 'Signal length', type: 'int', default: 9, min: 1, max: 500 },
    { id: 'source', title: 'Source', type: 'source', default: 'close' },
  ],
  plots: [
    { id: 'hist', title: 'Histogram', kind: 'histogram', color: THEME.upAlpha, negativeColor: THEME.downAlpha },
    { id: 'macd', title: 'MACD', kind: 'line', color: THEME.accent1, lineWidth: 2 },
    { id: 'signal', title: 'Signal', kind: 'line', color: THEME.accent2, lineWidth: 2 },
  ],
  warmup: (i) => Math.max(int(i, 'fast'), int(i, 'slow')) - 1 + int(i, 'signal') - 1,
  create(i) {
    const f = int(i, 'fast');
    const sl = int(i, 'slow');
    const sg = int(i, 'signal');
    const s = src(i);
    return runtime<MacdState>(
      () => ({ fast: emaInit(f), slow: emaInit(sl), signal: emaInit(sg) }),
      (st, bar) => {
        const x = source(bar, s);
        const a = smootherStep(st.fast, x);
        const b = smootherStep(st.slow, x);
        const line = a - b; // NaN until both are seeded
        const sig = smootherStep(st.signal, line);
        return [line - sig, line, sig];
      },
    );
  },
};

// ------------------------------------------------------------------ Bollinger Bands

export const BOLLINGER: IndicatorDefinition<WindowState> = {
  id: 'bb',
  name: 'Bollinger Bands',
  shortName: 'BB',
  placement: 'overlay',
  inputs: [
    { id: 'length', title: 'Length', type: 'int', default: 20, min: 2, max: 1000 },
    { id: 'mult', title: 'Width (σ)', type: 'float', default: 2, min: 0.1, max: 10, step: 0.1 },
    { id: 'source', title: 'Source', type: 'source', default: 'close' },
  ],
  plots: [
    { id: 'middle', title: 'Middle', kind: 'line', color: THEME.accent2, lineWidth: 1 },
    { id: 'upper', title: 'Upper', kind: 'line', color: THEME.accent4, lineWidth: 1 },
    { id: 'lower', title: 'Lower', kind: 'line', color: THEME.accent4, lineWidth: 1 },
  ],
  bands: [{ upper: 'upper', lower: 'lower', color: 'rgba(45, 212, 191, 0.07)' }],
  warmup: (i) => int(i, 'length') - 1,
  create(i) {
    const n = int(i, 'length');
    const k = num(i, 'mult');
    const s = src(i);
    return runtime(
      () => windowInit(n),
      (st, bar) => {
        if (!windowPush(st, source(bar, s))) return [Number.NaN, Number.NaN, Number.NaN];
        const mid = windowMean(st);
        const dev = k * windowStdev(st, mid); // population σ (Bollinger)
        return [mid, mid + dev, mid - dev];
      },
    );
  },
};

export const BUILTINS: IndicatorDefinition[] = [SMA, EMA, RSI, MACD, BOLLINGER] as IndicatorDefinition[];
