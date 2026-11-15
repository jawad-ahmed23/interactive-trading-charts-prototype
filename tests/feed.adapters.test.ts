import { afterEach, describe, expect, it, vi } from 'vitest';
import { BinanceFeed, backoffMs, parseKlineMessage, parseKlineRow } from '../src/feed/binance';
import { MockFeed, mockBar } from '../src/feed/mock';
import { isValidSeries } from '../src/feed/bars';
import { SessionCalendar } from '../src/feed/session';
import type { Bar } from '../src/feed/types';
import { utc } from './helpers';

describe('Binance parsing', () => {
  it('parses REST kline rows', () => {
    const row = [1_700_000_000_000, '1.5', '2', '1', '1.75', '10', 1_700_000_059_999];
    expect(parseKlineRow(row)).toEqual({ time: 1_700_000_000, open: 1.5, high: 2, low: 1, close: 1.75, volume: 10 });
    expect(parseKlineRow(['x'])).toBeNull();
    expect(parseKlineRow([1, 'a', 'b', 'c', 'd', 'e'])).toBeNull();
  });

  it('parses stream messages', () => {
    const msg = { e: 'kline', k: { t: 1_700_000_000_000, o: '1', h: '3', l: '0.5', c: '2', v: '7', x: false } };
    expect(parseKlineMessage(msg)).toEqual({ time: 1_700_000_000, open: 1, high: 3, low: 0.5, close: 2, volume: 7 });
    expect(parseKlineMessage({})).toBeNull();
  });

  it('backs off exponentially with jitter, capped at 30 s', () => {
    expect(backoffMs(0, () => 0.5)).toBe(500);
    expect(backoffMs(3, () => 0.5)).toBe(4000);
    expect(backoffMs(20, () => 0.5)).toBe(30_000);
    expect(backoffMs(0, () => 0)).toBe(400);
    expect(backoffMs(0, () => 1)).toBe(600);
  });
});

describe('BinanceFeed.getBars', () => {
  const row = (t: number) => [t * 1000, '1', '2', '0.5', '1.5', '3'];

  it('requests endTime = to − 1 ms and limit ≤ 1000, and flags noMoreData on a short page', async () => {
    const fetchImpl = vi.fn(async (url: string) => {
      const u = new URL(url);
      expect(u.searchParams.get('endTime')).toBe(String(6000 * 1000 - 1));
      expect(u.searchParams.get('limit')).toBe('1000');
      return new Response(JSON.stringify([row(5880), row(5940)]));
    });
    const feed = new BinanceFeed({ fetchImpl: fetchImpl as unknown as typeof fetch });
    const info = await feed.resolveSymbol('BTCUSDT');
    const res = await feed.getBars(info, '1m', { to: 6000, limit: 5000 });
    expect(res.bars.map((b) => b.time)).toEqual([5880, 5940]);
    expect(res.noMoreData).toBe(true);
  });

  it('falls back to the second base URL when the first fails, and remembers it', async () => {
    const calls: string[] = [];
    const fetchImpl = vi.fn(async (url: string) => {
      calls.push(new URL(url).origin);
      if (url.startsWith('https://a.test')) return new Response('blocked', { status: 451 });
      return new Response(JSON.stringify([row(60)]));
    });
    const feed = new BinanceFeed({ restBases: ['https://a.test', 'https://b.test'], fetchImpl: fetchImpl as unknown as typeof fetch });
    const info = await feed.resolveSymbol('ETHUSDT');
    await feed.getBars(info, '1m', { to: 120, limit: 1 });
    await feed.getBars(info, '1m', { to: 120, limit: 1 });
    expect(calls).toEqual(['https://a.test', 'https://b.test', 'https://b.test']);
  });
});

/** Minimal fake WebSocket for reconnect tests. */
class FakeSocket {
  static instances: FakeSocket[] = [];
  readonly OPEN = 1;
  readyState = 0;
  onopen: (() => void) | null = null;
  onmessage: ((ev: { data: string }) => void) | null = null;
  onerror: (() => void) | null = null;
  onclose: (() => void) | null = null;
  constructor(readonly url: string) {
    FakeSocket.instances.push(this);
  }
  open() {
    this.readyState = 1;
    this.onopen?.();
  }
  send() {}
  push(bar: Bar) {
    this.onmessage?.({ data: JSON.stringify({ e: 'kline', k: { t: bar.time * 1000, o: bar.open, h: bar.high, l: bar.low, c: bar.close, v: bar.volume } }) });
  }
  close() {
    this.readyState = 3;
    this.onclose?.();
  }
}

describe('BinanceFeed.subscribeBars reconnect (A22)', () => {
  afterEach(() => {
    vi.useRealTimers();
    FakeSocket.instances = [];
  });

  it('reconnects with backoff on another base, back-fills the gap and stops after unsubscribe', async () => {
    vi.useFakeTimers();
    let nowMs = 10_000 * 1000;
    const restBars = [9_700, 9_760, 9_820].map((t) => [t * 1000, '1', '1', '1', '1', '1']);
    const fetchImpl = vi.fn(async () => new Response(JSON.stringify(restBars)));
    const feed = new BinanceFeed({
      wsBases: ['wss://one.test', 'wss://two.test'],
      fetchImpl: fetchImpl as unknown as typeof fetch,
      webSocketImpl: FakeSocket as unknown as typeof WebSocket,
      now: () => nowMs,
    });
    const info = await feed.resolveSymbol('BTCUSDT');
    const got: number[] = [];
    const states: string[] = [];
    const unsub = feed.subscribeBars(info, '1m', (b) => got.push(b.time), (s) => states.push(s.state));

    const first = FakeSocket.instances[0]!;
    expect(first.url).toBe('wss://one.test/ws/btcusdt@kline_1m');
    first.open();
    first.push({ time: 9_640, open: 1, high: 1, low: 1, close: 1, volume: 1 });
    first.close(); // network drop
    expect(states).toContain('reconnecting');

    await vi.advanceTimersByTimeAsync(1_000);
    const second = FakeSocket.instances[1]!;
    expect(second.url).toBe('wss://two.test/ws/btcusdt@kline_1m');
    nowMs += 200_000;
    second.open();
    await vi.advanceTimersByTimeAsync(0);
    expect(fetchImpl).toHaveBeenCalledTimes(1);
    expect(got).toEqual([9_640, 9_700, 9_760, 9_820]);

    unsub();
    expect(states[states.length - 1]).toBe('closed');
    await vi.advanceTimersByTimeAsync(60_000);
    expect(FakeSocket.instances.length).toBe(2);
  });

  it('closes a silent socket after 30 s and reconnects', async () => {
    vi.useFakeTimers();
    let nowMs = 0;
    const feed = new BinanceFeed({ webSocketImpl: FakeSocket as unknown as typeof WebSocket, now: () => nowMs });
    const info = await feed.resolveSymbol('SOLUSDT');
    const unsub = feed.subscribeBars(info, '5m', () => {});
    FakeSocket.instances[0]!.open();
    nowMs = 31_000;
    await vi.advanceTimersByTimeAsync(5_000);
    await vi.advanceTimersByTimeAsync(1_000);
    expect(FakeSocket.instances.length).toBe(2);
    unsub();
  });
});

describe('MockFeed', () => {
  it('is deterministic and serves valid ascending bars', async () => {
    const now = utc('2026-01-07T18:00:00Z') * 1000;
    const feed = new MockFeed({ now: () => now });
    const info = await feed.resolveSymbol('AAPL');
    const a = await feed.getBars(info, '5m', { to: utc('2026-01-07T18:00:00Z'), limit: 300 });
    const b = await feed.getBars(info, '5m', { to: utc('2026-01-07T18:00:00Z'), limit: 300 });
    expect(a.bars).toEqual(b.bars);
    expect(a.bars.length).toBe(300);
    expect(isValidSeries(a.bars)).toBe(true);
  });

  it('only produces bars inside sessions and never in the future', async () => {
    const nowSec = utc('2026-01-07T18:00:00Z');
    const feed = new MockFeed({ now: () => nowSec * 1000 });
    const info = await feed.resolveSymbol('AAPL');
    const cal = new SessionCalendar(info);
    const { bars } = await feed.getBars(info, '15m', { to: nowSec + 10_000, limit: 500 });
    expect(bars.every((x) => cal.sessionAt(x.time) !== null)).toBe(true);
    expect(bars[bars.length - 1]!.time).toBeLessThanOrEqual(nowSec);
    expect(bars.some((x) => x.time >= utc('2026-01-19T00:00:00Z') && x.time < utc('2026-01-20T00:00:00Z'))).toBe(false);
  });

  it('pages contiguously: an older page ends right before the newer one', async () => {
    const nowSec = utc('2026-01-07T18:00:00Z');
    const feed = new MockFeed({ now: () => nowSec * 1000 });
    const info = await feed.resolveSymbol('XAUUSD');
    const newer = await feed.getBars(info, '1h', { to: nowSec + 1, limit: 100 });
    const older = await feed.getBars(info, '1h', { to: newer.bars[0]!.time, limit: 100 });
    expect(older.bars.length).toBe(100);
    expect(older.bars[99]!.time).toBeLessThan(newer.bars[0]!.time);
  });

  it('live bars agree with history for the forming bar', async () => {
    const nowSec = utc('2026-01-07T18:00:30Z');
    const feed = new MockFeed({ now: () => nowSec * 1000 });
    const info = await feed.resolveSymbol('AAPL');
    const { bars } = await feed.getBars(info, '1m', { to: nowSec + 60, limit: 2 });
    expect(bars[1]).toEqual(mockBar('AAPL', utc('2026-01-07T18:00:00Z'), nowSec + 1));
  });
});
