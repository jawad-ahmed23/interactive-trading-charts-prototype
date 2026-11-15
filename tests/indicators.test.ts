import { describe, expect, it } from 'vitest';
import type { Bar } from '../src/feed/types';
import { IndicatorComputation } from '../src/indicators/engine';
import { getDefinition, listDefinitions, registerIndicator } from '../src/indicators/registry';
import { defaultInputs, type IndicatorDefinition, type InputValues } from '../src/indicators/types';
import rsiExample from './fixtures/rsi-wilder-example.json';
import { randomWalk } from './helpers';

const closesToBars = (closes: number[]): Bar[] =>
  closes.map((c, i) => ({ time: 1_700_000_000 + i * 60, open: c, high: c, low: c, close: c, volume: 1 }));

const linear = (n: number, start = 1): Bar[] => closesToBars(Array.from({ length: n }, (_, i) => start + i));

function run(defId: string, bars: Bar[], inputs?: Partial<InputValues>): Float64Array[] {
  const def = getDefinition(defId)!;
  return new IndicatorComputation(def, { ...defaultInputs(def), ...inputs } as InputValues).full(bars);
}

const firstValid = (col: Float64Array): number => col.findIndex((v) => !Number.isNaN(v));

// ---------------------------------------------------------------- independent textbook references

function refSma(x: number[], n: number): number[] {
  return x.map((_, i) => (i < n - 1 ? NaN : x.slice(i - n + 1, i + 1).reduce((a, b) => a + b, 0) / n));
}
function refEma(x: number[], n: number): number[] {
  const out: number[] = [];
  const k = 2 / (n + 1);
  let prev = NaN;
  let start = x.findIndex((v) => !Number.isNaN(v));
  for (let i = 0; i < x.length; i++) {
    if (start < 0 || i < start + n - 1) out.push(NaN);
    else if (i === start + n - 1) {
      prev = x.slice(start, start + n).reduce((a, b) => a + b, 0) / n;
      out.push(prev);
    } else {
      prev = x[i]! * k + prev * (1 - k);
      out.push(prev);
    }
  }
  return out;
}
function refRsi(x: number[], n: number): number[] {
  const out: number[] = [NaN];
  let ag = 0;
  let al = 0;
  for (let i = 1; i < x.length; i++) {
    const ch = x[i]! - x[i - 1]!;
    const g = Math.max(ch, 0);
    const l = Math.max(-ch, 0);
    if (i < n) {
      ag += g;
      al += l;
      out.push(NaN);
      continue;
    }
    if (i === n) {
      ag = (ag + g) / n;
      al = (al + l) / n;
    } else {
      ag = (ag * (n - 1) + g) / n;
      al = (al * (n - 1) + l) / n;
    }
    out.push(al === 0 ? (ag === 0 ? 50 : 100) : 100 - 100 / (1 + ag / al));
  }
  return out;
}
function refStdPop(x: number[], n: number): number[] {
  return x.map((_, i) => {
    if (i < n - 1) return NaN;
    const w = x.slice(i - n + 1, i + 1);
    const m = w.reduce((a, b) => a + b, 0) / n;
    return Math.sqrt(w.reduce((a, b) => a + (b - m) ** 2, 0) / n);
  });
}

function expectClose(actual: ArrayLike<number>, expected: number[], tol = 1e-9): void {
  expect(actual.length).toBe(expected.length);
  for (let i = 0; i < expected.length; i++) {
    const a = actual[i]!;
    const e = expected[i]!;
    if (Number.isNaN(e)) expect(Number.isNaN(a), `index ${i} should be none`).toBe(true);
    else expect(Math.abs(a - e), `index ${i}: ${a} vs ${e}`).toBeLessThanOrEqual(tol * Math.max(1, Math.abs(e)));
  }
}

// ---------------------------------------------------------------- correctness

describe('reference values', () => {
  it('RSI(14) matches the published Wilder worked example (to 2 dp)', () => {
    const [rsi] = run('rsi', closesToBars(rsiExample.closes), { length: 14 });
    expect(firstValid(rsi!)).toBe(14);
    rsiExample.expectedRsiFromIndex14.forEach((exp, k) => {
      expect(Math.abs(rsi![14 + k]! - exp)).toBeLessThanOrEqual(0.0051); // published values are rounded to 2 dp
    });
  });

  it('SMA and EMA on a linear series have closed forms (H1, H2)', () => {
    const bars = linear(40);
    const [sma] = run('sma', bars, { length: 5 });
    const [ema] = run('ema', bars, { length: 5 });
    expect(sma![3]).toBeNaN();
    expect(sma![4]).toBe(3);
    expect(sma![39]).toBe(38);
    // SMA seed puts the EMA at steady state immediately: EMA_t = x_t − (n−1)/2.
    expect(ema![4]).toBe(3);
    expect(ema![5]).toBeCloseTo(4, 12);
    expect(ema![39]).toBeCloseTo(38, 10);
  });

  it('MACD on a linear series: line = (slow−fast)/2 = 7, signal = 7, histogram = 0', () => {
    const [hist, line, signal] = run('macd', linear(80));
    expect(firstValid(line!)).toBe(25);
    expect(firstValid(signal!)).toBe(33);
    expect(firstValid(hist!)).toBe(33);
    expect(line![25]).toBeCloseTo(7, 9);
    expect(signal![60]).toBeCloseTo(7, 9);
    expect(hist![60]).toBeCloseTo(0, 9);
  });

  it('Bollinger on consecutive integers: σ = √((n²−1)/12), population', () => {
    const [mid, upper, lower] = run('bb', linear(50), { length: 20, mult: 2 });
    const sigma = Math.sqrt((20 * 20 - 1) / 12);
    expect(mid![19]).toBeCloseTo(10.5, 12);
    expect(upper![19]! - mid![19]!).toBeCloseTo(2 * sigma, 10);
    expect(mid![19]! - lower![19]!).toBeCloseTo(2 * sigma, 10);
  });

  it('matches independent textbook implementations on a 1000-bar random walk', () => {
    const bars = randomWalk(1000, 7);
    const closes = bars.map((b) => b.close);
    expectClose(run('sma', bars, { length: 20 })[0]!, refSma(closes, 20));
    expectClose(run('ema', bars, { length: 20 })[0]!, refEma(closes, 20), 1e-10);
    expectClose(run('rsi', bars, { length: 14 })[0]!, refRsi(closes, 14), 1e-10);
    const fast = refEma(closes, 12);
    const slow = refEma(closes, 26);
    const line = fast.map((f, i) => f - slow[i]!);
    const signal = refEma(line, 9);
    const [hist, mLine, mSignal] = run('macd', bars);
    expectClose(mLine!, line, 1e-10);
    expectClose(mSignal!, signal, 1e-10);
    expectClose(hist!, line.map((l, i) => l - signal[i]!), 1e-10);
    const [mid, up] = run('bb', bars, { length: 20, mult: 2 });
    const sd = refStdPop(closes, 20);
    expectClose(mid!, refSma(closes, 20));
    expectClose(up!, refSma(closes, 20).map((m, i) => m + 2 * sd[i]!));
  });

  it('honours the source input (hl2)', () => {
    const bars = randomWalk(50, 3);
    const [sma] = run('sma', bars, { length: 5, source: 'hl2' });
    expectClose(sma!, refSma(bars.map((b) => (b.high + b.low) / 2), 5));
  });
});

// ---------------------------------------------------------------- warm-up / none

describe('warm-up and none handling (H1–H7)', () => {
  const bars = linear(60);
  const cases: [string, Partial<InputValues>, number][] = [
    ['sma', { length: 5 }, 4],
    ['ema', { length: 5 }, 4],
    ['rsi', { length: 14 }, 14],
    ['macd', {}, 33],
    ['bb', { length: 20 }, 19],
  ];
  for (const [id, inputs, expected] of cases) {
    it(`${id} is none until index ${expected}, then valid`, () => {
      const def = getDefinition(id)!;
      const all = { ...defaultInputs(def), ...inputs } as InputValues;
      const cols = new IndicatorComputation(def, all).full(bars);
      // The last plot column becomes valid last (e.g. MACD signal, histogram).
      const lastValid = Math.max(...cols.map(firstValid));
      expect(lastValid).toBe(expected);
      expect(def.warmup(all)).toBe(expected);
      for (const c of cols) for (let i = 0; i < firstValid(c); i++) expect(c[i]).toBeNaN();
    });
  }

  it('RSI on a flat series is 50 (gain = loss = 0 convention, H4)', () => {
    const [rsi] = run('rsi', closesToBars(Array(30).fill(5)));
    expect(rsi![14]).toBe(50);
    expect(rsi![29]).toBe(50);
  });

  it('RSI on a strictly rising series is 100 at index 14 (H3)', () => {
    const [rsi] = run('rsi', linear(40));
    expect(rsi![13]).toBeNaN();
    expect(rsi![14]).toBe(100);
  });

  it('returns all-none when there are fewer bars than the warm-up', () => {
    const [sma] = run('sma', linear(3), { length: 5 });
    expect(Array.from(sma!).every(Number.isNaN)).toBe(true);
  });
});

// ---------------------------------------------------------------- full vs incremental

/** Replay bars as ticks: each bar arrives as 3 partial versions, then its final version. */
function replay(def: IndicatorDefinition, inputs: InputValues, bars: Bar[], seedBars: number): number[][] {
  const comp = new IndicatorComputation(def, inputs);
  const seed = bars.slice(0, seedBars);
  const cols = comp.full(seed).map((c) => Array.from(c));
  for (let i = seedBars; i < bars.length; i++) {
    const final = bars[i]!;
    const partials: Bar[] = [0.25, 0.5, 0.75].map((f) => ({
      time: final.time,
      open: final.open,
      high: final.open + (final.high - final.open) * f,
      low: final.open - (final.open - final.low) * f,
      close: final.open + (final.close - final.open) * f,
      volume: final.volume * f,
    }));
    const previous = i > 0 ? bars[i - 1] : undefined;
    partials.forEach((p, k) => {
      const v = comp.update(p, k === 0, previous);
      v.forEach((x, pi) => (cols[pi]![i] = x));
    });
    const v = comp.update(final, false);
    v.forEach((x, pi) => (cols[pi]![i] = x));
  }
  return cols;
}

describe('full() vs incremental update() over a 1000-bar replay', () => {
  const bars = randomWalk(1000, 99);
  for (const def of listDefinitions()) {
    it(`${def.id}: identical outputs (bit-for-bit) after tick-by-tick replay`, () => {
      const inputs = defaultInputs(def);
      const full = new IndicatorComputation(def, inputs).full(bars).map((c) => Array.from(c));
      const inc = replay(def, inputs, bars, 1);
      expect(inc).toEqual(full);
    });
  }

  it('replay starting from an empty series also matches', () => {
    const def = getDefinition('macd')!;
    const inputs = defaultInputs(def);
    const full = new IndicatorComputation(def, inputs).full(bars).map((c) => Array.from(c));
    expect(replay(def, inputs, bars, 0)).toEqual(full);
  });

  it('a tick never changes closed bars: the committed value equals the batch value (H11)', () => {
    const def = getDefinition('ema')!;
    const comp = new IndicatorComputation(def, { length: 10, source: 'close' });
    comp.full(bars.slice(0, 500));
    const wild = { ...bars[499]!, close: 1e9, high: 1e9 };
    comp.update(wild, false); // a crazy intrabar tick on the live bar …
    comp.update(bars[499]!, false); // … corrected by the final tick
    const next = comp.update(bars[500]!, true, bars[499]);
    const batch = new IndicatorComputation(def, { length: 10, source: 'close' }).full(bars.slice(0, 501));
    expect(next[0]).toBe(batch[0]![500]);
  });

  it('throws if a new bar opens without the previous final bar', () => {
    const comp = new IndicatorComputation(getDefinition('sma')!, { length: 3, source: 'close' });
    comp.full(bars.slice(0, 10));
    expect(() => comp.update(bars[10]!, true)).toThrow();
  });
});

// ---------------------------------------------------------------- registry

describe('registry: built-ins use the same path a compiled script will', () => {
  it('registers a third-party definition through the public API', () => {
    const def: IndicatorDefinition<{ n: number }> = {
      id: 'test:barcount',
      name: 'Bar counter',
      shortName: 'CNT',
      placement: 'pane',
      inputs: [],
      plots: [{ id: 'n', title: 'n', kind: 'line', color: '#fff' }],
      warmup: () => 0,
      create: () => ({ initial: () => ({ n: 0 }), step: (s) => [++s.n], clone: (s) => ({ ...s }) }),
    };
    registerIndicator(def as IndicatorDefinition);
    const cols = new IndicatorComputation(getDefinition('test:barcount')!, {}).full(linear(5));
    expect(Array.from(cols[0]!)).toEqual([1, 2, 3, 4, 5]);
    expect(() => registerIndicator(def as IndicatorDefinition)).toThrow();
  });
});

describe('custom indicator: ATR (doc test H5)', () => {
  it('uses H−L for bar 0 and Wilder smoothing; first value at index length−1', () => {
    // SEQ-UP: H = L = C = 1, 2, 3, … so TR[0] = 0 and TR[1..] = 1
    const [atr] = run('atr', linear(40), { length: 14 });
    expect(atr![12]).toBeNaN();
    expect(atr![13]).toBeCloseTo(13 / 14, 12);
    expect(atr![14]).toBeCloseTo(((13 / 14) * 13 + 1) / 14, 12);
  });
});
