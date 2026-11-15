/**
 * Provider-agnostic market data types (docs/data-feed-spec.md §2–3).
 *
 * Prototype note: method names follow the Phase 1 prototype brief
 * (resolveSymbol / getBars / subscribeBars). See PROTOTYPE_NOTES.md for the
 * naming conflict with the spec's canonical names.
 */

/** Canonical timeframe identifiers (lowercase). The UI may show "1H", "4H" … */
export type Timeframe = '1m' | '5m' | '15m' | '1h' | '4h' | '1d' | '1w';

export const TIMEFRAMES: readonly Timeframe[] = ['1m', '5m', '15m', '1h', '4h', '1d', '1w'];

export type Weekday = 'mon' | 'tue' | 'wed' | 'thu' | 'fri' | 'sat' | 'sun';

/**
 * A trading window in exchange-local time. `days` are the weekdays on which the
 * window OPENS. If `close <= open` the window crosses midnight.
 */
export interface SessionWindow {
  days: Weekday[];
  open: string; // "HH:MM"
  close: string; // "HH:MM"
}

export interface SymbolInfo {
  symbol: string; // e.g. "BTCUSDT"
  description: string;
  kind: 'crypto' | 'stock' | 'metal';
  venue: string;
  timezone: string; // IANA
  /** Empty array = trades 24×7 (buckets aligned to UTC). */
  sessions: SessionWindow[];
  /** Exchange-local YYYY-MM-DD full-day closures. */
  closedDates: string[];
  tickSize: number;
  pricePrecision: number;
  volumePrecision: number;
  /** Earliest bar time we can serve (UTC seconds). */
  firstBarTime: number;
  isMock: boolean;
}

export interface Bar {
  time: number; // UTC seconds, bar OPEN time
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
}

export interface HistoryRequest {
  /** Exclusive upper bound (UTC seconds): return bars with time < to. */
  to: number;
  limit: number;
  signal?: AbortSignal;
}

export interface HistoryResult {
  bars: Bar[]; // ascending, unique time
  /** True when no older data exists. */
  noMoreData: boolean;
}

export type Unsubscribe = () => void;

export interface StreamStatus {
  state: 'connecting' | 'open' | 'reconnecting' | 'closed';
  attempt: number;
}

export interface DataFeed {
  resolveSymbol(symbol: string): Promise<SymbolInfo>;
  getBars(info: SymbolInfo, timeframe: Timeframe, req: HistoryRequest): Promise<HistoryResult>;
  /**
   * Live bars of `timeframe`. Contract (data-feed-spec §3.1):
   * same time as the last bar → replace; newer → append; older → caller ignores.
   */
  subscribeBars(
    info: SymbolInfo,
    timeframe: Timeframe,
    onBar: (bar: Bar) => void,
    onStatus?: (status: StreamStatus) => void,
  ): Unsubscribe;
}
