import { DateTime } from 'luxon';
import type { SessionWindow, SymbolInfo, Weekday } from './types';

/** One concrete trading session in UTC seconds. */
export interface SessionInterval {
  open: number;
  close: number;
  /** Exchange-local date on which the session closes (YYYY-MM-DD). */
  tradingDate: string;
}

const WEEKDAYS: Weekday[] = ['mon', 'tue', 'wed', 'thu', 'fri', 'sat', 'sun'];
const DAY = 86_400;

function parseHm(hm: string): { hour: number; minute: number } {
  const [h, m] = hm.split(':').map(Number);
  if (h === undefined || m === undefined || Number.isNaN(h) || Number.isNaN(m)) {
    throw new Error(`Invalid session time "${hm}"`);
  }
  return { hour: h, minute: m };
}

/**
 * Exchange session calendar (docs/data-feed-spec.md §5).
 * All math is done in exchange-local wall time via Luxon, so DST is handled.
 */
export class SessionCalendar {
  readonly timezone: string;
  private readonly windows: SessionWindow[];
  private readonly closed: Set<string>;
  private readonly cache = new Map<string, SessionInterval[]>();

  constructor(info: Pick<SymbolInfo, 'timezone' | 'sessions' | 'closedDates'>) {
    this.timezone = info.timezone;
    this.windows = info.sessions;
    this.closed = new Set(info.closedDates);
  }

  get is24x7(): boolean {
    return this.windows.length === 0;
  }

  /** Sessions that OPEN on the given exchange-local date. */
  private sessionsOpeningOn(localDate: DateTime): SessionInterval[] {
    const key = localDate.toISODate() ?? '';
    const hit = this.cache.get(key);
    if (hit) return hit;
    const weekday = WEEKDAYS[localDate.weekday - 1];
    const out: SessionInterval[] = [];
    for (const w of this.windows) {
      if (!weekday || !w.days.includes(weekday)) continue;
      const o = parseHm(w.open);
      const c = parseHm(w.close);
      const crosses = c.hour * 60 + c.minute <= o.hour * 60 + o.minute;
      const openDt = localDate.set({ hour: o.hour, minute: o.minute, second: 0, millisecond: 0 });
      const closeDay = crosses ? localDate.plus({ days: 1 }) : localDate;
      const closeDt = closeDay.set({ hour: c.hour, minute: c.minute, second: 0, millisecond: 0 });
      const tradingDate = closeDay.toISODate() ?? '';
      if (this.closed.has(tradingDate)) continue;
      out.push({ open: Math.round(openDt.toSeconds()), close: Math.round(closeDt.toSeconds()), tradingDate });
    }
    out.sort((a, b) => a.open - b.open);
    this.cache.set(key, out);
    return out;
  }

  private localDate(ts: number): DateTime {
    return DateTime.fromSeconds(ts, { zone: this.timezone }).startOf('day');
  }

  /** Sessions overlapping [from, to), ascending. */
  sessionsBetween(from: number, to: number): SessionInterval[] {
    if (this.is24x7) throw new Error('sessionsBetween() is not defined for 24x7 instruments');
    const out: SessionInterval[] = [];
    let d = this.localDate(from - 2 * DAY);
    const end = this.localDate(to + DAY);
    while (d <= end) {
      for (const s of this.sessionsOpeningOn(d)) {
        if (s.close > from && s.open < to) out.push(s);
      }
      d = d.plus({ days: 1 });
    }
    return out;
  }

  /** The session containing `ts` (open ≤ ts < close), or null when closed. */
  sessionAt(ts: number): SessionInterval | null {
    for (const s of this.sessionsBetween(ts, ts + 1)) {
      if (s.open <= ts && ts < s.close) return s;
    }
    return null;
  }

  /**
   * Walk backwards from `before` (exclusive) and return up to `count` sessions
   * that open before `before`, ascending. Stops at `notBefore`.
   */
  sessionsBefore(before: number, count: number, notBefore: number): SessionInterval[] {
    const out: SessionInterval[] = [];
    let d = this.localDate(before + DAY);
    const stop = this.localDate(notBefore - DAY);
    while (out.length < count && d >= stop) {
      const day = this.sessionsOpeningOn(d);
      for (let i = day.length - 1; i >= 0; i--) {
        const s = day[i]!;
        if (s.open < before && s.close > notBefore) out.push(s);
        if (out.length >= count) break;
      }
      d = d.minus({ days: 1 });
    }
    return out.reverse();
  }

  /** ISO-week key ("2026-W11") of a session's trading date. */
  weekKey(s: SessionInterval): string {
    const dt = DateTime.fromISO(s.tradingDate, { zone: this.timezone });
    return `${dt.weekYear}-W${String(dt.weekNumber).padStart(2, '0')}`;
  }
}
