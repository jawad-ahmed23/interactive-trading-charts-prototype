import { useEffect, useRef, useState } from 'react';
import { ChartController, type ChartStatus, type LegendState, type ScaleMode } from '../chart/ChartController';
import { CompositeFeed } from '../feed';
import type { SymbolInfo, Timeframe } from '../feed/types';
import { WorkerIndicatorHost } from '../indicators/host';
import { SessionCalendar } from '../feed/session';
import type { IndicatorInstance } from '../indicators/types';
import { Legend } from './Legend';

interface Props {
  symbol: string;
  timeframe: Timeframe;
  scaleMode: ScaleMode;
  indicators: IndicatorInstance[];
  onRemoveIndicator(instanceId: string): void;
  onEditIndicator(instanceId: string): void;
}

declare global {
  interface Window {
    __chart?: ChartController;
  }
}

export function ChartView({ symbol, timeframe, scaleMode, indicators, onRemoveIndicator, onEditIndicator }: Props) {
  const containerRef = useRef<HTMLDivElement>(null);
  const controllerRef = useRef<ChartController | null>(null);
  const [legend, setLegend] = useState<LegendState | null>(null);
  const [status, setStatus] = useState<ChartStatus | null>(null);
  const [info, setInfo] = useState<SymbolInfo | null>(null);
  const [showRealtime, setShowRealtime] = useState(false);

  // Create the chart once per mount; dispose everything on unmount (no leaked sockets/workers).
  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    const host = new WorkerIndicatorHost();
    const controller = new ChartController(el, new CompositeFeed(), host, {
      onLegend: setLegend,
      onRealtimeButton: setShowRealtime,
      onStatus: setStatus,
      onSymbolInfo: setInfo,
    });
    controllerRef.current = controller;
    if (import.meta.env.DEV) window.__chart = controller;
    return () => {
      controller.destroy();
      host.dispose();
      controllerRef.current = null;
      if (window.__chart === controller) delete window.__chart;
    };
  }, []);

  useEffect(() => {
    void controllerRef.current?.setSymbol(symbol, timeframe);
  }, [symbol, timeframe]);

  useEffect(() => {
    controllerRef.current?.setIndicators(indicators);
  }, [indicators]);

  useEffect(() => {
    controllerRef.current?.setScaleMode(scaleMode);
  }, [scaleMode]);

  const stream = status?.stream?.state;
  const [marketOpen, setMarketOpen] = useState(true);
  useEffect(() => {
    if (!info || info.sessions.length === 0) {
      setMarketOpen(true);
      return;
    }
    const cal = new SessionCalendar(info);
    const check = () => setMarketOpen(cal.sessionAt(Math.floor(Date.now() / 1000)) !== null);
    check();
    const t = setInterval(check, 30_000);
    return () => clearInterval(t);
  }, [info]);
  return (
    <div className="chart-wrap">
      <div ref={containerRef} className="chart-canvas" />
      <Legend
        symbol={symbol}
        timeframe={timeframe}
        info={info}
        state={legend}
        onRemove={onRemoveIndicator}
        onEdit={onEditIndicator}
      />
      {showRealtime && (
        <button className="realtime-btn" onClick={() => controllerRef.current?.scrollToRealtime()} title="Scroll to the latest bar">
          Latest ⇥
        </button>
      )}
      <div className="status-bar">
        {status?.loading && <span>Loading…</span>}
        {status?.historyLoading && <span>Loading older bars…</span>}
        {status?.historyExhausted && !status.loading && <span className="dim">Start of history</span>}
        {status?.message && <span className="error">{status.message}</span>}
        <span className="spacer" />
        {!marketOpen && <span className="badge">Market closed</span>}
        {info?.isMock && <span className="badge warn">MOCK DATA</span>}
        <span className="dim">{status?.barCount ?? 0} bars</span>
        <span className={`dot ${stream === 'open' ? 'ok' : stream === 'reconnecting' ? 'warn' : 'off'}`} title={`Stream: ${stream ?? 'idle'}`} />
        <span className="dim">{info?.timezone === 'UTC' ? 'UTC' : info?.timezone}</span>
      </div>
    </div>
  );
}
