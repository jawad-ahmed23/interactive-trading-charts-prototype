import type { SessionCalendar, SessionInterval } from './session';
import type { Bar, Timeframe } from './types';

const SECONDS: Record<Timeframe, number> = {
  '1m': 60,
  '5m': 300,
  '15m': 900,
  '1h': 3_600,
  '4h': 14_400,
  '1d': 86_400,
  '1w': 604_800,
};

/** 1970-01-05T00:00Z was a Monday; weekly buckets for 24×7 instruments start Monday 00:00 UTC. */
const MONDAY_EPOCH_OFFSET = 4 * 86_400;

export function timeframeSeconds(tf: Timeframe): number {
  return SECONDS[tf];
}

export function isIntraday(tf: Timeframe): boolean {
  return SECONDS[tf] < 86_400;
}

export function timeframeLabel(tf: Timeframe): string {
  return tf.endsWith('m') ? tf : tf.toUpperCase();
}

export function isTimeframe(value: unknown): value is Timeframe {
  return typeof value === 'string' && value in SECONDS;
}

/**
 * Open time of the bar containing `ts`.
 * - 24×7 (calendar null or no sessions): aligned to UTC (weeks start Monday).
 * - Session instruments: intraday buckets align to the session open; `1d` = the
 *   session open; `1w` = the first session open of the ISO week. Returns null
 *   when `ts` is outside any session.
 */
export function bucketStart(ts: number, tf: Timeframe, cal: SessionCalendar | null): number | null {
  const sec = SECONDS[tf];
  if (!cal || cal.is24x7) {
    if (tf === '1w') return Math.floor((ts - MONDAY_EPOCH_OFFSET) / sec) * sec + MONDAY_EPOCH_OFFSET;
    return Math.floor(ts / sec) * sec;
  }
  const s = cal.sessionAt(ts);
  if (!s) return null;
  if (isIntraday(tf)) return s.open + Math.floor((ts - s.open) / sec) * sec;
  if (tf === '1d') return s.open;
  return firstOpenOfWeek(cal, s);
}

function firstOpenOfWeek(cal: SessionCalendar, s: SessionInterval): number {
  const key = cal.weekKey(s);
  const earlier = cal.sessionsBetween(s.open - 8 * 86_400, s.open + 1);
  for (const x of earlier) if (cal.weekKey(x) === key) return x.open;
  return s.open;
}

export interface BucketSpan {
  start: number;
  end: number; // exclusive
}

/** Bucket spans for a session instrument built from a list of sessions, ascending. */
export function bucketsForSessions(sessions: SessionInterval[], tf: Timeframe, cal: SessionCalendar): BucketSpan[] {
  const out: BucketSpan[] = [];
  if (tf === '1w') {
    let cur: BucketSpan | null = null;
    let curKey = '';
    for (const s of sessions) {
      const k = cal.weekKey(s);
      if (cur && k === curKey) cur.end = s.close;
      else {
        if (cur) out.push(cur);
        cur = { start: s.open, end: s.close };
        curKey = k;
      }
    }
    if (cur) out.push(cur);
    return out;
  }
  if (tf === '1d') return sessions.map((s) => ({ start: s.open, end: s.close }));
  const sec = SECONDS[tf];
  for (const s of sessions) {
    for (let t = s.open; t < s.close; t += sec) out.push({ start: t, end: Math.min(t + sec, s.close) });
  }
  return out;
}

/**
 * Aggregate ascending bars into `tf` bars. Bars outside the session are dropped.
 * open = first, high = max, low = min, close = last, volume = sum.
 */
export function aggregateBars(bars: readonly Bar[], tf: Timeframe, cal: SessionCalendar | null): Bar[] {
  const out: Bar[] = [];
  let cur: Bar | null = null;
  for (const b of bars) {
    const start = bucketStart(b.time, tf, cal);
    if (start === null) continue;
    if (cur && cur.time === start) {
      cur.high = Math.max(cur.high, b.high);
      cur.low = Math.min(cur.low, b.low);
      cur.close = b.close;
      cur.volume += b.volume;
    } else {
      if (cur) out.push(cur);
      cur = { time: start, open: b.open, high: b.high, low: b.low, close: b.close, volume: b.volume };
    }
  }
  if (cur) out.push(cur);
  return out;
}
