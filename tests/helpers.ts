import { SessionCalendar } from '../src/feed/session';
import type { Bar, SymbolInfo } from '../src/feed/types';

export const US_INFO: Pick<SymbolInfo, 'timezone' | 'sessions' | 'closedDates'> = {
  timezone: 'America/New_York',
  sessions: [{ days: ['mon', 'tue', 'wed', 'thu', 'fri'], open: '09:30', close: '16:00' }],
  closedDates: ['2026-01-19'],
};

export const METAL_INFO: Pick<SymbolInfo, 'timezone' | 'sessions' | 'closedDates'> = {
  timezone: 'America/New_York',
  sessions: [{ days: ['sun', 'mon', 'tue', 'wed', 'thu'], open: '18:05', close: '16:59' }],
  closedDates: [],
};

export const utc = (iso: string): number => Date.parse(iso) / 1000;

/** 1m bars for every minute inside the calendar's sessions in [from, to); close = running index. */
export function sessionMinuteBars(cal: SessionCalendar, from: number, to: number): Bar[] {
  const out: Bar[] = [];
  for (const s of cal.sessionsBetween(from, to)) {
    for (let t = Math.max(s.open, from); t < Math.min(s.close, to); t += 60) {
      const c = out.length + 1;
      out.push({ time: t, open: c, high: c + 0.5, low: c - 0.5, close: c, volume: 1 });
    }
  }
  return out;
}

/** Deterministic pseudo-random walk (mulberry32), for indicator tests. */
export function randomWalk(n: number, seed = 42, start = 100): Bar[] {
  let a = seed >>> 0;
  const rnd = (): number => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  const out: Bar[] = [];
  let close = start;
  for (let i = 0; i < n; i++) {
    const open = close;
    close = Math.max(1, open + (rnd() - 0.5) * 2);
    const high = Math.max(open, close) + rnd() * 0.5;
    const low = Math.min(open, close) - rnd() * 0.5;
    out.push({ time: 1_700_000_000 + i * 60, open, high, low, close, volume: 1 + Math.floor(rnd() * 100) });
  }
  return out;
}

export function usCalendar(): SessionCalendar {
  return new SessionCalendar(US_INFO);
}
