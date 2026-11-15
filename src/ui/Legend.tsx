import { useState } from 'react';
import type { LegendState } from '../chart/ChartController';
import { timeframeLabel } from '../feed/timeframe';
import type { SymbolInfo, Timeframe } from '../feed/types';
import { THEME } from './theme';

interface Props {
  symbol: string;
  timeframe: Timeframe;
  info: SymbolInfo | null;
  state: LegendState | null;
  onRemove(instanceId: string): void;
  onEdit(instanceId: string): void;
}

export function Legend({ symbol, timeframe, info, state, onRemove, onEdit }: Props) {
  const bar = state?.bar ?? null;
  const p = state?.precision ?? 2;
  const color = bar ? (bar.close >= bar.open ? THEME.up : THEME.down) : THEME.text;
  const f = (v: number) => v.toFixed(p);
  // Phones start collapsed so indicator rows don't cover the candles.
  const [collapsed, setCollapsed] = useState(() => typeof window !== 'undefined' && window.matchMedia('(max-width: 640px)').matches);
  const count = state?.indicators.length ?? 0;
  return (
    <div className={`legend${collapsed ? ' collapsed' : ''}`}>
      <div className="legend-row">
        <strong>{symbol}</strong>
        <span className="dim">· {timeframeLabel(timeframe)} · {info?.venue ?? ''}</span>
        {bar && (
          <span className="ohlc" style={{ color }}>
            <span>O {f(bar.open)}</span>
            <span>H {f(bar.high)}</span>
            <span>L {f(bar.low)}</span>
            <span>C {f(bar.close)}</span>
            {state?.changePct !== null && state?.changePct !== undefined && (
              <span>
                {state.changePct >= 0 ? '+' : ''}
                {state.changePct.toFixed(2)}%
              </span>
            )}
            <span>V {state?.volumeText}</span>
          </span>
        )}
      </div>
      {bar && <div className="legend-row dim small legend-time">{state?.timeText}</div>}
      {count > 0 && (
        <button
          className="legend-toggle"
          onClick={() => setCollapsed((c) => !c)}
          aria-expanded={!collapsed}
          title={collapsed ? 'Show indicator values' : 'Hide indicator values'}
        >
          {collapsed ? `▸ ${count} indicator${count > 1 ? 's' : ''}` : '▾'}
        </button>
      )}
      {!collapsed && state?.indicators.map((ind) => (
        <div className="legend-row indicator" key={ind.instanceId}>
          <span className="ind-label">{ind.label}</span>
          {ind.values.map((v) => (
            <span key={v.title} style={{ color: v.color }} title={v.title}>
              {v.text}
            </span>
          ))}
          <span className="legend-actions">
            <button onClick={() => onEdit(ind.instanceId)} title="Settings">⚙</button>
            <button onClick={() => onRemove(ind.instanceId)} title="Remove">✕</button>
          </span>
        </div>
      ))}
    </div>
  );
}
