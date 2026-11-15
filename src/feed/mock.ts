import { SessionCalendar } from './session';
import { bucketStart, bucketsForSessions, isIntraday, timeframeSeconds, type BucketSpan } from './timeframe';
import type { Bar, DataFeed, HistoryRequest, HistoryResult, StreamStatus, SymbolInfo, Timeframe, Unsubscribe } from './types';

/**
 * Deterministic synthetic data for instruments we do not pay for yet (AAPL, XAUUSD).
 * Prices come from a smooth, hash-based random path p(t), so any range can be
 * generated on demand and history and live bars always agree.
 * THIS IS NOT MARKET DATA.
 */

const NYSE_CLOSED = [
  '2025-01-01', '2025-01-09', '2025-01-20', '2025-02-17', '2025-04-18', '2025-05-26', '2025-06-19',
  '2025-07-04', '2025-09-01', '2025-11-27', '2025-12-25',
  '2026-01-01', '2026-01-19', '2026-02-16', '2026-04-03', '2026-05-25', '2026-06-19', '2026-07-03',
  '2026-09-07', '2026-11-26', '2026-12-25',
];

interface MockSpec {
  info: Omit<SymbolInfo, 'symbol'>;
  base: number;
  vol: number; // relative volatility scale
  seed: number;
}

const FIRST = Date.UTC(2015, 0, 1) / 1000;

const SPECS: Record<string, MockSpec> = {
  AAPL: {
    base: 200,
    vol: 0.012,
    seed: 11,
    info: {
      description: 'Apple Inc. (MOCK data)',
      kind: 'stock',
      venue: 'MOCK',
      timezone: 'America/New_York',
      sessions: [{ days: ['mon', 'tue', 'wed', 'thu', 'fri'], open: '09:30', close: '16:00' }],
      closedDates: NYSE_CLOSED,
      tickSize: 0.01,
      pricePrecision: 2,
      volumePrecision: 0,
      firstBarTime: FIRST,
      isMock: true,
    },
  },
  XAUUSD: {
    base: 2500,
    vol: 0.006,
    seed: 23,
    info: {
      description: 'Gold spot / USD (MOCK data)',
      kind: 'metal',
      venue: 'MOCK',
      timezone: 'America/New_York',
      // Opens Sun–Thu 18:05 and closes 16:59 the next day (provider-style metals hours, spec §5).
      sessions: [{ days: ['sun', 'mon', 'tue', 'wed', 'thu'], open: '18:05', close: '16:59' }],
      closedDates: [],
      tickSize: 0.01,
      pricePrecision: 2,
      volumePrecision: 0,
      firstBarTime: FIRST,
      isMock: true,
    },
  },
};

export const MOCK_SYMBOLS = Object.keys(SPECS);

function hash32(a: number, b: number, c: number): number {
  let h = Math.imul(a ^ 0x9e3779b9, 0x85ebca6b) ^ Math.imul(b, 0xc2b2ae35) ^ Math.imul(c + 0x27d4eb2f, 0x165667b1);
  h ^= h >>> 15;
  h = Math.imul(h, 0x2c1b3c6d);
  h ^= h >>> 12;
  h = Math.imul(h, 0x297a2d39);
  h ^= h >>> 15;
  return h >>> 0;
}

/** Uniform in [-1, 1] for an integer lattice point. */
function lattice(seed: number, octave: number, k: number): number {
  return (hash32(seed, octave, k) / 0xffffffff) * 2 - 1;
}

const OCTAVES: { period: number; weight: number }[] = [
  { period: 60, weight: 0.05 },
  { period: 600, weight: 0.12 },
  { period: 3_600, weight: 0.3 },
  { period: 21_600, weight: 0.7 },
  { period: 172_800, weight: 1.8 },
  { period: 864_000, weight: 3.5 },
  { period: 5_184_000, weight: 7 },
];

export function mockPrice(symbol: string, t: number): number {
  const spec = SPECS[symbol];
  if (!spec) throw new Error(`Unknown mock symbol ${symbol}`);
  let x = 0;
  OCTAVES.forEach((o, i) => {
    const u = t / o.period;
    const k = Math.floor(u);
    const f = u - k;
    const s = f * f * (3 - 2 * f); // smoothstep
    const v = lattice(spec.seed, i, k) * (1 - s) + lattice(spec.seed, i, k + 1) * s;
    x += v * o.weight;
  });
  return spec.base * Math.exp(x * spec.vol * 2);
}

/** OHLCV of the span [start, end) sampled from the price path. */
export function mockBar(symbol: string, start: number, end: number): Bar {
  const spec = SPECS[symbol]!;
  const span = Math.max(1, end - start);
  const stride = Math.max(60, Math.ceil(span / 120 / 60) * 60);
  const round = (p: number): number => Math.round(p / spec.info.tickSize) * spec.info.tickSize;
  const open = mockPrice(symbol, start);
  let high = open;
  let low = open;
  let close = open;
  for (let t = start + stride; t < end; t += stride) {
    close = mockPrice(symbol, t);
    if (close > high) high = close;
    if (close < low) low = close;
  }
  const last = mockPrice(symbol, end - 1);
  close = last;
  high = Math.max(high, last);
  low = Math.min(low, last);
  const volume = Math.round((span / 60) * (50 + (hash32(spec.seed, 99, Math.floor(start / 60)) % 200)));
  return { time: start, open: round(open), high: round(high), low: round(low), close: round(close), volume };
}

export interface MockFeedOptions {
  now?: () => number; // ms
  tickMs?: number;
}

export class MockFeed implements DataFeed {
  private readonly now: () => number;
  private readonly tickMs: number;
  private readonly calendars = new Map<string, SessionCalendar>();

  constructor(opts: MockFeedOptions = {}) {
    this.now = opts.now ?? Date.now;
    this.tickMs = opts.tickMs ?? 1_000;
  }

  async resolveSymbol(symbol: string): Promise<SymbolInfo> {
    const spec = SPECS[symbol];
    if (!spec) throw new Error(`Unknown mock symbol ${symbol}`);
    return { symbol, ...spec.info };
  }

  private calendar(info: SymbolInfo): SessionCalendar {
    let c = this.calendars.get(info.symbol);
    if (!c) {
      c = new SessionCalendar(info);
      this.calendars.set(info.symbol, c);
    }
    return c;
  }

  /** Bucket spans (ascending) that start before `to`, at most `limit`, never in the future. */
  spansBefore(info: SymbolInfo, tf: Timeframe, to: number, limit: number): BucketSpan[] {
    const nowSec = Math.floor(this.now() / 1000);
    const cal = this.calendar(info);
    const bound = Math.min(to, nowSec + 1);
    let spans: BucketSpan[];
    if (cal.is24x7) {
      const sec = timeframeSeconds(tf);
      const lastStart = bucketStart(bound - 1, tf, null)!;
      spans = [];
      for (let i = limit - 1; i >= 0; i--) {
        const s = lastStart - i * sec;
        if (s >= info.firstBarTime) spans.push({ start: s, end: s + sec });
      }
    } else {
      const perSession = isIntraday(tf) ? this.bucketsPerSession(info, tf) : 1;
      const sessionsNeeded = tf === '1w' ? (limit + 2) * 7 : Math.ceil(limit / perSession) + 2;
      const sessions = cal.sessionsBefore(bound, sessionsNeeded, info.firstBarTime);
      spans = bucketsForSessions(sessions, tf, cal).filter((b) => b.start < bound);
      if (tf === '1w' && spans.length > limit) spans = spans.slice(1); // first week may be partial
    }
    return spans.slice(-limit).map((b) => ({ start: b.start, end: Math.min(b.end, nowSec + 1) }));
  }

  private bucketsPerSession(info: SymbolInfo, tf: Timeframe): number {
    const w = info.sessions[0];
    if (!w) return 1;
    const [oh, om] = w.open.split(':').map(Number) as [number, number];
    const [ch, cm] = w.close.split(':').map(Number) as [number, number];
    let minutes = ch * 60 + cm - (oh * 60 + om);
    if (minutes <= 0) minutes += 24 * 60;
    return Math.max(1, Math.ceil((minutes * 60) / timeframeSeconds(tf)));
  }

  async getBars(info: SymbolInfo, tf: Timeframe, req: HistoryRequest): Promise<HistoryResult> {
    if (req.signal?.aborted) throw new DOMException('Aborted', 'AbortError');
    const spans = this.spansBefore(info, tf, req.to, req.limit);
    const bars = spans.map((s) => mockBar(info.symbol, s.start, s.end));
    const first = bars[0];
    return { bars, noMoreData: !first || first.time - timeframeSeconds(tf) < info.firstBarTime };
  }

  subscribeBars(info: SymbolInfo, tf: Timeframe, onBar: (bar: Bar) => void, onStatus?: (s: StreamStatus) => void): Unsubscribe {
    const cal = this.calendar(info);
    onStatus?.({ state: 'open', attempt: 0 });
    const timer = setInterval(() => {
      const nowSec = Math.floor(this.now() / 1000);
      const start = bucketStart(nowSec, tf, cal);
      if (start === null) return; // market closed: no ticks
      onBar(mockBar(info.symbol, start, nowSec + 1));
    }, this.tickMs);
    return () => {
      clearInterval(timer);
      onStatus?.({ state: 'closed', attempt: 0 });
    };
  }
}
