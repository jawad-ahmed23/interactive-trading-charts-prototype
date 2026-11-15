import { useEffect, useMemo, useRef, useState } from 'react';
import type { ScaleMode } from '../chart/ChartController';
import { SYMBOLS } from '../feed';
import { TIMEFRAMES, type Timeframe } from '../feed/types';
import { timeframeLabel } from '../feed/timeframe';

interface Props {
  symbol: string;
  timeframe: Timeframe;
  scaleMode: ScaleMode;
  onSymbol(symbol: string): void;
  onTimeframe(tf: Timeframe): void;
  onScaleMode(mode: ScaleMode): void;
  onIndicators(): void;
}

const SCALE_LABELS: Record<ScaleMode, string> = { normal: 'Linear', log: 'Log', percent: '%' };

export function Toolbar(p: Props) {
  return (
    <header className="toolbar">
      <SymbolSearch value={p.symbol} onSelect={p.onSymbol} />
      {/* Wide screens: button groups. Narrow screens: compact selects (CSS decides). */}
      <div className="group wide-only" role="group" aria-label="Timeframe">
        {TIMEFRAMES.map((tf) => (
          <button key={tf} className={tf === p.timeframe ? 'active' : ''} onClick={() => p.onTimeframe(tf)}>
            {timeframeLabel(tf)}
          </button>
        ))}
      </div>
      <select
        className="narrow-only compact"
        aria-label="Timeframe"
        value={p.timeframe}
        onChange={(e) => p.onTimeframe(e.target.value as Timeframe)}
      >
        {TIMEFRAMES.map((tf) => (
          <option key={tf} value={tf}>
            {timeframeLabel(tf)}
          </option>
        ))}
      </select>
      <button className="tool" onClick={p.onIndicators} aria-label="Indicators" title="Indicators">
        ƒx<span className="wide-only-inline"> Indicators</span>
      </button>
      <div className="spacer" />
      <div className="group wide-only" role="group" aria-label="Price scale">
        {(Object.keys(SCALE_LABELS) as ScaleMode[]).map((m) => (
          <button key={m} className={m === p.scaleMode ? 'active' : ''} onClick={() => p.onScaleMode(m)}>
            {SCALE_LABELS[m]}
          </button>
        ))}
      </div>
      <select
        className="narrow-only compact"
        aria-label="Price scale"
        value={p.scaleMode}
        onChange={(e) => p.onScaleMode(e.target.value as ScaleMode)}
      >
        {(Object.keys(SCALE_LABELS) as ScaleMode[]).map((m) => (
          <option key={m} value={m}>
            {SCALE_LABELS[m]}
          </option>
        ))}
      </select>
    </header>
  );
}

/** Rank: symbol prefix > symbol substring > description word prefix > description substring. */
export function rankSymbols(query: string) {
  const q = query.trim().toUpperCase();
  if (!q) return SYMBOLS;
  const score = (s: (typeof SYMBOLS)[number]): number => {
    const d = s.description.toUpperCase();
    if (s.symbol.startsWith(q)) return 0;
    if (s.symbol.includes(q)) return 1;
    if (d.split(/[^A-Z0-9]+/).some((w) => w.startsWith(q))) return 2;
    if (d.includes(q)) return 3;
    return -1;
  };
  return SYMBOLS.map((s, i) => ({ s, i, k: score(s) }))
    .filter((x) => x.k >= 0)
    .sort((a, b) => a.k - b.k || a.i - b.i)
    .map((x) => x.s);
}

function SymbolSearch({ value, onSelect }: { value: string; onSelect(s: string): void }) {
  const [query, setQuery] = useState('');
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(0);
  const boxRef = useRef<HTMLDivElement>(null);

  const matches = useMemo(() => rankSymbols(query), [query]);

  useEffect(() => {
    const close = (e: MouseEvent) => {
      if (boxRef.current && !boxRef.current.contains(e.target as Node)) setOpen(false);
    };
    window.addEventListener('mousedown', close);
    return () => window.removeEventListener('mousedown', close);
  }, []);

  const choose = (s: string) => {
    onSelect(s);
    setQuery('');
    setOpen(false);
  };

  return (
    <div className="search" ref={boxRef}>
      <input
        aria-label="Symbol search"
        value={open ? query : value}
        placeholder="Symbol"
        inputMode="search"
        autoComplete="off"
        spellCheck={false}
        onFocus={() => {
          setOpen(true);
          setActive(0);
        }}
        onChange={(e) => {
          setQuery(e.target.value);
          setActive(0);
          setOpen(true);
        }}
        onKeyDown={(e) => {
          if (e.key === 'ArrowDown') setActive((a) => Math.min(a + 1, matches.length - 1));
          else if (e.key === 'ArrowUp') setActive((a) => Math.max(a - 1, 0));
          else if (e.key === 'Enter' && matches[active]) choose(matches[active]!.symbol);
          else if (e.key === 'Escape') {
            setOpen(false);
            (e.target as HTMLInputElement).blur();
          }
        }}
      />
      {open && (
        <ul className="search-results" role="listbox">
          {matches.length === 0 && <li className="dim">No matches</li>}
          {matches.map((s, i) => (
            <li
              key={s.symbol}
              role="option"
              aria-selected={i === active}
              className={i === active ? 'active' : ''}
              onMouseDown={(e) => {
                e.preventDefault();
                choose(s.symbol);
              }}
            >
              <strong>{s.symbol}</strong>
              <span className="dim">{s.description}</span>
              <span className={`badge ${s.source === 'Mock' ? 'warn' : ''}`}>{s.source}</span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
