import { timeframeSeconds } from './timeframe';
import type { Bar, DataFeed, HistoryRequest, HistoryResult, StreamStatus, SymbolInfo, Timeframe, Unsubscribe } from './types';

const REST_BASES = ['https://api.binance.com', 'https://data-api.binance.vision'];
const WS_BASES = ['wss://stream.binance.com:9443', 'wss://data-stream.binance.vision'];
const MAX_LIMIT = 1000;
/** Kline streams push about every 2 s; treat 30 s of silence as a dead socket. */
const STALE_MS = 30_000;
/** Earliest data we ask for (BTCUSDT listed mid-2017). */
const FIRST_BAR_TIME = Date.UTC(2017, 6, 1) / 1000;

const CATALOG: Record<string, Pick<SymbolInfo, 'description' | 'tickSize' | 'pricePrecision' | 'volumePrecision'>> = {
  BTCUSDT: { description: 'Bitcoin / Tether', tickSize: 0.01, pricePrecision: 2, volumePrecision: 5 },
  ETHUSDT: { description: 'Ethereum / Tether', tickSize: 0.01, pricePrecision: 2, volumePrecision: 4 },
  SOLUSDT: { description: 'Solana / Tether', tickSize: 0.01, pricePrecision: 2, volumePrecision: 3 },
};

export const BINANCE_SYMBOLS = Object.keys(CATALOG);

export interface BinanceFeedOptions {
  restBases?: string[];
  wsBases?: string[];
  fetchImpl?: typeof fetch;
  webSocketImpl?: typeof WebSocket;
  now?: () => number; // ms
}

/** Parse one REST kline row: [openTime, o, h, l, c, v, closeTime, …]. */
export function parseKlineRow(row: unknown): Bar | null {
  if (!Array.isArray(row) || row.length < 6) return null;
  const bar: Bar = {
    time: Math.floor(Number(row[0]) / 1000),
    open: Number(row[1]),
    high: Number(row[2]),
    low: Number(row[3]),
    close: Number(row[4]),
    volume: Number(row[5]),
  };
  return Object.values(bar).every(Number.isFinite) ? bar : null;
}

/** Parse one kline stream message (`{ e: 'kline', k: { t, o, h, l, c, v, … } }`). */
export function parseKlineMessage(data: unknown): Bar | null {
  if (typeof data !== 'object' || data === null) return null;
  const k = (data as { k?: Record<string, unknown> }).k;
  if (!k) return null;
  const bar: Bar = {
    time: Math.floor(Number(k.t) / 1000),
    open: Number(k.o),
    high: Number(k.h),
    low: Number(k.l),
    close: Number(k.c),
    volume: Number(k.v),
  };
  return Object.values(bar).every(Number.isFinite) ? bar : null;
}

export function backoffMs(attempt: number, rand: () => number = Math.random): number {
  const base = Math.min(30_000, 500 * 2 ** attempt);
  return Math.round(base * (0.8 + 0.4 * rand()));
}

export class BinanceFeed implements DataFeed {
  private readonly restBases: string[];
  private readonly wsBases: string[];
  private readonly fetchImpl: typeof fetch;
  private readonly WS: typeof WebSocket;
  private readonly now: () => number;
  private preferredRest = 0;

  constructor(opts: BinanceFeedOptions = {}) {
    this.restBases = opts.restBases ?? REST_BASES;
    this.wsBases = opts.wsBases ?? WS_BASES;
    this.fetchImpl = opts.fetchImpl ?? ((...args) => fetch(...args));
    this.WS = opts.webSocketImpl ?? WebSocket;
    this.now = opts.now ?? Date.now;
  }

  async resolveSymbol(symbol: string): Promise<SymbolInfo> {
    const meta = CATALOG[symbol];
    if (!meta) throw new Error(`Unknown Binance symbol ${symbol}`);
    return {
      symbol,
      ...meta,
      kind: 'crypto',
      venue: 'BINANCE',
      timezone: 'UTC',
      sessions: [],
      closedDates: [],
      firstBarTime: FIRST_BAR_TIME,
      isMock: false,
    };
  }

  async getBars(info: SymbolInfo, tf: Timeframe, req: HistoryRequest): Promise<HistoryResult> {
    const limit = Math.max(1, Math.min(MAX_LIMIT, req.limit));
    const params = new URLSearchParams({
      symbol: info.symbol,
      interval: tf,
      endTime: String(req.to * 1000 - 1),
      limit: String(limit),
    });
    const rows = await this.fetchJson(`/api/v3/klines?${params}`, req.signal);
    if (!Array.isArray(rows)) throw new Error('Unexpected klines response');
    const bars: Bar[] = [];
    for (const row of rows) {
      const b = parseKlineRow(row);
      if (b && b.time < req.to && (bars.length === 0 || b.time > bars[bars.length - 1]!.time)) bars.push(b);
    }
    const first = bars[0];
    return { bars, noMoreData: rows.length < limit || (first !== undefined && first.time <= info.firstBarTime) };
  }

  /** Try the preferred REST base first, then the fallbacks; remember what worked. */
  private async fetchJson(path: string, signal?: AbortSignal): Promise<unknown> {
    let lastError: unknown = null;
    for (let k = 0; k < this.restBases.length; k++) {
      const idx = (this.preferredRest + k) % this.restBases.length;
      try {
        const res = await this.fetchImpl(this.restBases[idx] + path, signal ? { signal } : undefined);
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const json: unknown = await res.json();
        this.preferredRest = idx;
        return json;
      } catch (e) {
        if (signal?.aborted) throw e;
        lastError = e;
      }
    }
    throw lastError instanceof Error ? lastError : new Error('All Binance REST endpoints failed');
  }

  subscribeBars(info: SymbolInfo, tf: Timeframe, onBar: (bar: Bar) => void, onStatus?: (s: StreamStatus) => void): Unsubscribe {
    let ws: WebSocket | null = null;
    let closed = false;
    let attempt = 0;
    let wsIndex = 0;
    let everOpened = false;
    let lastTime = 0;
    let lastMessage = 0;
    let retryTimer: ReturnType<typeof setTimeout> | null = null;
    let watchdog: ReturnType<typeof setInterval> | null = null;
    let backfill: AbortController | null = null;

    const emit = (bar: Bar): void => {
      if (bar.time < lastTime) return;
      lastTime = bar.time;
      onBar(bar);
    };

    const status = (state: StreamStatus['state']): void => onStatus?.({ state, attempt });

    const scheduleReconnect = (): void => {
      if (closed || retryTimer) return;
      status('reconnecting');
      const delay = backoffMs(attempt);
      attempt++;
      wsIndex = (wsIndex + 1) % this.wsBases.length;
      retryTimer = setTimeout(() => {
        retryTimer = null;
        connect();
      }, delay);
    };

    /** After a reconnect, fetch bars missed while disconnected (spec §7 lifecycle). */
    const backfillGap = async (): Promise<void> => {
      if (lastTime === 0) return;
      backfill?.abort();
      backfill = new AbortController();
      try {
        const to = Math.floor(this.now() / 1000) + timeframeSeconds(tf);
        const { bars } = await this.getBars(info, tf, { to, limit: MAX_LIMIT, signal: backfill.signal });
        for (const b of bars) if (b.time >= lastTime && !closed) emit(b);
      } catch {
        // The live stream continues; a later reconnect retries the back-fill.
      }
    };

    const connect = (): void => {
      if (closed) return;
      status(everOpened ? 'reconnecting' : 'connecting');
      const url = `${this.wsBases[wsIndex]}/ws/${info.symbol.toLowerCase()}@kline_${tf}`;
      const sock = new this.WS(url);
      ws = sock;
      sock.onopen = () => {
        if (closed) return;
        const isReconnect = everOpened;
        everOpened = true;
        attempt = 0;
        lastMessage = this.now();
        status('open');
        if (isReconnect) void backfillGap();
      };
      sock.onmessage = (ev: MessageEvent) => {
        lastMessage = this.now();
        try {
          const bar = parseKlineMessage(JSON.parse(String(ev.data)));
          if (bar) emit(bar);
        } catch {
          // ignore malformed frames
        }
      };
      sock.onerror = () => sock.close();
      sock.onclose = () => {
        if (ws === sock) ws = null;
        if (!closed) scheduleReconnect();
      };
    };

    watchdog = setInterval(() => {
      if (ws && ws.readyState === ws.OPEN && this.now() - lastMessage > STALE_MS) ws.close();
    }, 5_000);

    connect();

    return () => {
      closed = true;
      if (retryTimer) clearTimeout(retryTimer);
      if (watchdog) clearInterval(watchdog);
      backfill?.abort();
      if (ws) {
        ws.onclose = null;
        ws.onmessage = null;
        ws.close();
        ws = null;
      }
      onStatus?.({ state: 'closed', attempt });
    };
  }
}
