import { SYMBOLS } from '../feed';
import { isTimeframe } from '../feed/timeframe';
import type { Timeframe } from '../feed/types';
import type { ScaleMode } from '../chart/ChartController';
import { getDefinition } from '../indicators/registry';
import { sanitizeInputs, type IndicatorInstance } from '../indicators/types';

export interface Settings {
  symbol: string;
  timeframe: Timeframe;
  scaleMode: ScaleMode;
  indicators: IndicatorInstance[];
}

const KEY = 'chart-proto.settings.v1';

export function newInstanceId(): string {
  return typeof crypto !== 'undefined' && 'randomUUID' in crypto ? crypto.randomUUID() : `i${Date.now()}${Math.random()}`;
}

export function defaultSettings(): Settings {
  return {
    symbol: 'BTCUSDT',
    timeframe: '1h',
    scaleMode: 'normal',
    indicators: [
      { instanceId: newInstanceId(), defId: 'ema', inputs: { length: 20, source: 'close' } },
      { instanceId: newInstanceId(), defId: 'rsi', inputs: { length: 14, source: 'close' } },
    ],
  };
}

/** Validate untrusted persisted data; anything invalid falls back to defaults. */
export function parseSettings(raw: unknown): Settings {
  const d = defaultSettings();
  if (typeof raw !== 'object' || raw === null) return d;
  const r = raw as Record<string, unknown>;
  const symbol = typeof r.symbol === 'string' && SYMBOLS.some((s) => s.symbol === r.symbol) ? r.symbol : d.symbol;
  const timeframe = isTimeframe(r.timeframe) ? r.timeframe : d.timeframe;
  const scaleMode: ScaleMode = r.scaleMode === 'log' || r.scaleMode === 'percent' || r.scaleMode === 'normal' ? r.scaleMode : 'normal';
  const indicators: IndicatorInstance[] = [];
  if (Array.isArray(r.indicators)) {
    for (const item of r.indicators.slice(0, 20)) {
      if (typeof item !== 'object' || item === null) continue;
      const it = item as Record<string, unknown>;
      const def = typeof it.defId === 'string' ? getDefinition(it.defId) : undefined;
      if (!def || typeof it.instanceId !== 'string') continue;
      const inst: IndicatorInstance = {
        instanceId: it.instanceId,
        defId: def.id,
        inputs: sanitizeInputs(def, (it.inputs ?? {}) as Record<string, number | string>),
      };
      if (typeof it.plotColors === 'object' && it.plotColors !== null) {
        const colors: Record<string, string> = {};
        for (const [k, v] of Object.entries(it.plotColors)) if (typeof v === 'string' && /^#[0-9a-f]{6}$/i.test(v)) colors[k] = v;
        if (Object.keys(colors).length) inst.plotColors = colors;
      }
      indicators.push(inst);
    }
  }
  return { symbol, timeframe, scaleMode, indicators: Array.isArray(r.indicators) ? indicators : d.indicators };
}

export function loadSettings(storage: Pick<Storage, 'getItem'> | undefined = globalThis.localStorage): Settings {
  try {
    const raw = storage?.getItem(KEY);
    return raw ? parseSettings(JSON.parse(raw)) : defaultSettings();
  } catch {
    return defaultSettings();
  }
}

export function saveSettings(s: Settings, storage: Pick<Storage, 'setItem'> | undefined = globalThis.localStorage): void {
  try {
    storage?.setItem(KEY, JSON.stringify(s));
  } catch {
    // Private mode or quota: persistence is a convenience only.
  }
}
