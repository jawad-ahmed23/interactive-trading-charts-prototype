import { describe, expect, it, vi } from 'vitest';
import { BarStore } from '../src/chart/barStore';
import { HistoryPager } from '../src/chart/historyPager';
import type { HistoryResult } from '../src/feed/types';
import { IndicatorComputation } from '../src/indicators/engine';
import type { FromWorker } from '../src/indicators/protocol';
import { getDefinition } from '../src/indicators/registry';
import { IndicatorWorkerCore } from '../src/indicators/workerCore';
import { defaultSettings, loadSettings, parseSettings, saveSettings } from '../src/state/settings';
import { randomWalk } from './helpers';

const deferred = <T,>() => {
  let resolve!: (v: T) => void;
  let reject!: (e: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
};

describe('HistoryPager — scroll-left history loading (A6–A8)', () => {
  it('issues exactly one request while one is pending (single flight)', async () => {
    const d = deferred<HistoryResult>();
    const load = vi.fn((_to: number, _limit: number, _signal: AbortSignal) => d.promise);
    const pager = new HistoryPager(load);
    const p1 = pager.maybeLoad({ from: 40, to: 140 }, 6000);
    const p2 = pager.maybeLoad({ from: 30, to: 130 }, 6000);
    const p3 = pager.maybeLoad({ from: 20, to: 120 }, 6000);
    expect(load).toHaveBeenCalledTimes(1);
    expect(load.mock.calls[0]![0]).toBe(6000); // before = first loaded bar time
    expect(load.mock.calls[0]![1]).toBeGreaterThanOrEqual(150);
    d.resolve({ bars: [{ time: 10, open: 1, high: 1, low: 1, close: 1, volume: 1 }], noMoreData: false });
    expect(await p1).not.toBeNull();
    expect(await p2).toBeNull();
    expect(await p3).toBeNull();
    expect(pager.loading).toBe(false);
  });

  it('does nothing while 50+ bars remain on the left', async () => {
    const load = vi.fn();
    const pager = new HistoryPager(load);
    expect(await pager.maybeLoad({ from: 50, to: 150 }, 6000)).toBeNull();
    expect(load).not.toHaveBeenCalled();
  });

  it('page size = 1.5 × visible bars, at least 150, at most 1000', () => {
    const pager = new HistoryPager(vi.fn());
    expect(pager.pageSize(40)).toBe(150);
    expect(pager.pageSize(200)).toBe(300);
    expect(pager.pageSize(5000)).toBe(1000);
  });

  it('stops after the source reports no more data (A8)', async () => {
    const load = vi.fn(async () => ({ bars: [], noMoreData: true }));
    const pager = new HistoryPager(load);
    await pager.maybeLoad({ from: 0, to: 100 }, 6000);
    expect(pager.exhausted).toBe(true);
    await pager.maybeLoad({ from: 0, to: 100 }, 6000);
    await pager.maybeLoad({ from: -20, to: 80 }, 6000);
    expect(load).toHaveBeenCalledTimes(1);
  });

  it('reset() aborts the pending request and drops its result (symbol switch)', async () => {
    const d = deferred<HistoryResult>();
    let signal: AbortSignal | null = null;
    const pager = new HistoryPager((_to, _limit, s) => {
      signal = s;
      return d.promise;
    });
    const p = pager.maybeLoad({ from: 0, to: 100 }, 6000);
    pager.reset();
    expect(signal!.aborted).toBe(true);
    d.resolve({ bars: [{ time: 1, open: 1, high: 1, low: 1, close: 1, volume: 1 }], noMoreData: false });
    expect(await p).toBeNull();
    expect(pager.loading).toBe(false);
  });

  it('a failed page can be retried', async () => {
    const load = vi.fn().mockRejectedValueOnce(new Error('network')).mockResolvedValueOnce({ bars: [], noMoreData: true });
    const pager = new HistoryPager(load);
    await expect(pager.maybeLoad({ from: 0, to: 100 }, 6000)).rejects.toThrow('network');
    expect(pager.loading).toBe(false);
    await pager.maybeLoad({ from: 0, to: 100 }, 6000);
    expect(load).toHaveBeenCalledTimes(2);
  });
});

describe('BarStore', () => {
  it('prepend returns the number of new bars and keeps the series valid (A7)', () => {
    const s = new BarStore();
    const all = randomWalk(600, 5);
    s.reset(all.slice(300));
    expect(s.prepend(all.slice(0, 310))).toBe(300); // 10 overlapping bars deduped
    expect(s.length).toBe(600);
    expect(s.first!.time).toBe(all[0]!.time);
    expect(s.indexOf(all[300]!.time)).toBe(300);
  });

  it('rejects non-finite live bars', () => {
    const s = new BarStore();
    s.reset(randomWalk(3));
    expect(s.applyLive({ ...s.last!, close: Number.NaN })).toBe('stale');
  });
});

describe('IndicatorWorkerCore (worker protocol)', () => {
  const collect = () => {
    const msgs: FromWorker[] = [];
    const core = new IndicatorWorkerCore((m) => msgs.push(m));
    return { core, msgs };
  };
  const ema = { instanceId: 'e1', defId: 'ema', inputs: { length: 10, source: 'close' } };

  it('computes full results on instances and on new bars', () => {
    const { core, msgs } = collect();
    const bars = randomWalk(100);
    core.handle({ type: 'bars', version: 1, bars });
    core.handle({ type: 'instances', version: 1, instances: [ema] });
    const full = msgs.find((m) => m.type === 'full');
    expect(full && full.type === 'full' && full.columns[0]!.length).toBe(100);
    expect(full && full.type === 'full' && full.times[99]).toBe(bars[99]!.time);
  });

  it('live replace/append ticks equal a full recompute; prepends recompute everything', () => {
    const { core, msgs } = collect();
    const all = randomWalk(400, 11);
    core.handle({ type: 'instances', version: 1, instances: [ema] });
    core.handle({ type: 'bars', version: 1, bars: all.slice(200, 300) });
    for (let i = 300; i < 400; i++) {
      const b = all[i]!;
      core.handle({ type: 'live', version: 1, bar: { ...b, close: b.open }, kind: 'append' });
      core.handle({ type: 'live', version: 1, bar: b, kind: 'replace' });
    }
    const ticks = msgs.filter((m): m is Extract<FromWorker, { type: 'tick' }> => m.type === 'tick');
    const lastTicks = new Map<number, number>();
    for (const t of ticks) lastTicks.set(t.index, t.values[0]!);
    const reference = new IndicatorComputation(getDefinition('ema')!, ema.inputs).full(all.slice(200, 400));
    for (const [idx, v] of lastTicks) expect(v).toBe(reference[0]![idx]);

    // History prepend: the main thread sends the merged series with a new version.
    msgs.length = 0;
    core.handle({ type: 'bars', version: 2, bars: all });
    const full = msgs.find((m) => m.type === 'full')!;
    expect(full.version).toBe(2);
    const ref2 = new IndicatorComputation(getDefinition('ema')!, ema.inputs).full(all);
    expect(full.type === 'full' && Array.from(full.columns[0]!)).toEqual(Array.from(ref2[0]!));
  });

  it('ignores live bars from an older dataset version', () => {
    const { core, msgs } = collect();
    core.handle({ type: 'instances', version: 3, instances: [ema] });
    core.handle({ type: 'bars', version: 3, bars: randomWalk(20) });
    msgs.length = 0;
    core.handle({ type: 'live', version: 2, bar: randomWalk(21)[20]!, kind: 'append' });
    expect(msgs.length).toBe(0);
  });

  it('keeps unchanged instances and recomputes edited ones only', () => {
    const { core, msgs } = collect();
    core.handle({ type: 'bars', version: 1, bars: randomWalk(50) });
    core.handle({ type: 'instances', version: 1, instances: [ema, { instanceId: 'r1', defId: 'rsi', inputs: { length: 14, source: 'close' } }] });
    msgs.length = 0;
    core.handle({ type: 'instances', version: 1, instances: [ema, { instanceId: 'r1', defId: 'rsi', inputs: { length: 7, source: 'close' } }] });
    expect(msgs.map((m) => m.instanceId)).toEqual(['r1']);
  });

  it('reports unknown definitions as errors', () => {
    const { core, msgs } = collect();
    core.handle({ type: 'instances', version: 1, instances: [{ instanceId: 'x', defId: 'nope', inputs: {} }] });
    expect(msgs[0]?.type).toBe('error');
  });
});

describe('persisted settings (J1)', () => {
  it('round-trips symbol, timeframe, scale mode and indicators', () => {
    const mem = new Map<string, string>();
    const storage = { getItem: (k: string) => mem.get(k) ?? null, setItem: (k: string, v: string) => void mem.set(k, v) };
    const s = { ...defaultSettings(), symbol: 'AAPL', timeframe: '4h' as const, scaleMode: 'log' as const };
    saveSettings(s, storage);
    expect(loadSettings(storage)).toEqual(s);
  });

  it('sanitises untrusted data and falls back to defaults', () => {
    const p = parseSettings({
      symbol: 'NOPE',
      timeframe: '7m',
      scaleMode: 'weird',
      indicators: [
        { instanceId: 'a', defId: 'ema', inputs: { length: 99999, source: 'evil' } },
        { instanceId: 'b', defId: 'unknown', inputs: {} },
        'garbage',
      ],
    });
    expect(p.symbol).toBe('BTCUSDT');
    expect(p.timeframe).toBe('1h');
    expect(p.scaleMode).toBe('normal');
    expect(p.indicators).toEqual([{ instanceId: 'a', defId: 'ema', inputs: { length: 1000, source: 'close' } }]);
    expect(loadSettings({ getItem: () => '{not json' }).symbol).toBe('BTCUSDT');
  });
});

describe('symbol search ranking', async () => {
  const { rankSymbols } = await import('../src/ui/Toolbar');
  it('prefers symbol matches over description matches ("eth" must not pick Bitcoin/Tether)', () => {
    expect(rankSymbols('eth')[0]!.symbol).toBe('ETHUSDT');
    expect(rankSymbols('sol')[0]!.symbol).toBe('SOLUSDT');
    expect(rankSymbols('gold')[0]!.symbol).toBe('XAUUSD');
    expect(rankSymbols('apple')[0]!.symbol).toBe('AAPL');
    expect(rankSymbols('zzz')).toEqual([]);
    expect(rankSymbols('').length).toBe(5);
  });
});
