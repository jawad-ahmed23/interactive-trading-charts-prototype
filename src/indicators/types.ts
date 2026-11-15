import type { Bar } from '../feed/types';

/**
 * Generic indicator contract (docs/indicator-engine-spec.md §2).
 *
 * Built-ins and, later, compiled Quill scripts implement exactly this interface.
 * The chart layer only reads definitions and outputs. It never special-cases a
 * particular indicator.
 */

export type InputDef =
  | { id: string; title: string; type: 'int'; default: number; min?: number; max?: number; step?: number }
  | { id: string; title: string; type: 'float'; default: number; min?: number; max?: number; step?: number }
  | { id: string; title: string; type: 'source'; default: PriceSource };

export type PriceSource = 'open' | 'high' | 'low' | 'close' | 'hl2' | 'hlc3' | 'ohlc4';
export const PRICE_SOURCES: PriceSource[] = ['open', 'high', 'low', 'close', 'hl2', 'hlc3', 'ohlc4'];

export type InputValues = Record<string, number | string>;

export interface PlotDef {
  id: string;
  title: string;
  kind: 'line' | 'histogram';
  color: string;
  /** Histogram only: colour bars by sign. */
  negativeColor?: string;
  lineWidth?: 1 | 2 | 3 | 4;
}

/** A filled band between two line plots (e.g. Bollinger upper/lower). */
export interface BandDef {
  upper: string;
  lower: string;
  color: string;
}

export interface LevelDef {
  value: number;
  title: string;
}

/** The per-bar step function. `state` is owned by the engine and must be cloneable. */
export interface IndicatorRuntime<S = unknown> {
  initial(): S;
  /** Advance `state` by one final-or-forming bar; return one value per plot (NaN = none). */
  step(state: S, bar: Bar): number[];
  clone(state: S): S;
}

export interface IndicatorDefinition<S = unknown> {
  id: string;
  name: string;
  shortName: string;
  placement: 'overlay' | 'pane';
  inputs: InputDef[];
  plots: PlotDef[];
  bands?: BandDef[];
  levels?: LevelDef[];
  /** Fixed price-scale range, e.g. RSI [0, 100]. */
  fixedRange?: [number, number];
  precision?: number;
  /** Index of the first non-none output for these inputs (documentation + tests). */
  warmup(inputs: InputValues): number;
  create(inputs: InputValues): IndicatorRuntime<S>;
}

/** One configured indicator on a chart. Serialisable (persisted in localStorage). */
export interface IndicatorInstance {
  instanceId: string;
  defId: string;
  inputs: InputValues;
  /** Optional per-instance plot colour overrides (e.g. EMA 20 vs EMA 50). */
  plotColors?: Record<string, string>;
}

export function defaultInputs(def: IndicatorDefinition): InputValues {
  const out: InputValues = {};
  for (const i of def.inputs) out[i.id] = i.default;
  return out;
}

/** Clamp and type-check user inputs against the definition; unknown keys are dropped. */
export function sanitizeInputs(def: IndicatorDefinition, raw: Partial<InputValues> | undefined): InputValues {
  const out = defaultInputs(def);
  for (const i of def.inputs) {
    const v = raw?.[i.id];
    if (i.type === 'source') {
      if (typeof v === 'string' && (PRICE_SOURCES as string[]).includes(v)) out[i.id] = v;
      continue;
    }
    if (typeof v !== 'number' || !Number.isFinite(v)) continue;
    let n = i.type === 'int' ? Math.round(v) : v;
    if (i.min !== undefined) n = Math.max(i.min, n);
    if (i.max !== undefined) n = Math.min(i.max, n);
    out[i.id] = n;
  }
  return out;
}

export function instanceLabel(def: IndicatorDefinition, inputs: InputValues): string {
  const nums = def.inputs.filter((i) => i.type !== 'source').map((i) => String(inputs[i.id]));
  return nums.length ? `${def.shortName} ${nums.join(' ')}` : def.shortName;
}
