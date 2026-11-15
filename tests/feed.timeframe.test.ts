import { describe, expect, it } from 'vitest';
import { SessionCalendar } from '../src/feed/session';
import { aggregateBars, bucketStart, bucketsForSessions } from '../src/feed/timeframe';
import { METAL_INFO, sessionMinuteBars, usCalendar, utc } from './helpers';

describe('bucketStart — 24×7 (crypto, UTC aligned)', () => {
  it('aligns intraday buckets to UTC multiples', () => {
    const t = utc('2026-01-07T10:37:12Z');
    expect(bucketStart(t, '1m', null)).toBe(utc('2026-01-07T10:37:00Z'));
    expect(bucketStart(t, '5m', null)).toBe(utc('2026-01-07T10:35:00Z'));
    expect(bucketStart(t, '15m', null)).toBe(utc('2026-01-07T10:30:00Z'));
    expect(bucketStart(t, '1h', null)).toBe(utc('2026-01-07T10:00:00Z'));
    expect(bucketStart(t, '4h', null)).toBe(utc('2026-01-07T08:00:00Z'));
    expect(bucketStart(t, '1d', null)).toBe(utc('2026-01-07T00:00:00Z'));
  });

  it('starts weekly buckets on Monday 00:00 UTC', () => {
    // 2026-01-07 is a Wednesday; 2026-01-05 is the Monday.
    expect(bucketStart(utc('2026-01-07T10:37:12Z'), '1w', null)).toBe(utc('2026-01-05T00:00:00Z'));
    expect(bucketStart(utc('2026-01-05T00:00:00Z'), '1w', null)).toBe(utc('2026-01-05T00:00:00Z'));
    expect(bucketStart(utc('2026-01-04T23:59:59Z'), '1w', null)).toBe(utc('2025-12-29T00:00:00Z'));
  });
});

describe('bucketStart — session instruments (US stock, America/New_York)', () => {
  const cal = usCalendar();

  it('aligns intraday buckets to the 09:30 session open, not to UTC (A14)', () => {
    // 2026-01-07 10:40 New York (EST, UTC−5) = 15:40Z
    expect(bucketStart(utc('2026-01-07T15:40:00Z'), '1h', cal)).toBe(utc('2026-01-07T15:30:00Z')); // 10:30 NY
    expect(bucketStart(utc('2026-01-07T20:59:00Z'), '1h', cal)).toBe(utc('2026-01-07T20:30:00Z')); // 15:30 NY
    expect(bucketStart(utc('2026-01-07T15:40:00Z'), '4h', cal)).toBe(utc('2026-01-07T14:30:00Z')); // 09:30 NY
  });

  it('returns null outside the session', () => {
    expect(bucketStart(utc('2026-01-07T14:00:00Z'), '1m', cal)).toBeNull(); // 09:00 NY
    expect(bucketStart(utc('2026-01-10T15:00:00Z'), '1m', cal)).toBeNull(); // Saturday
    expect(bucketStart(utc('2026-01-19T15:00:00Z'), '1m', cal)).toBeNull(); // closed date
  });

  it('daily bucket = session open; weekly = first open of the ISO week', () => {
    expect(bucketStart(utc('2026-01-07T18:00:00Z'), '1d', cal)).toBe(utc('2026-01-07T14:30:00Z'));
    expect(bucketStart(utc('2026-01-08T18:00:00Z'), '1w', cal)).toBe(utc('2026-01-05T14:30:00Z'));
    // Week of the 2026-01-19 holiday starts on Tuesday 01-20.
    expect(bucketStart(utc('2026-01-22T18:00:00Z'), '1w', cal)).toBe(utc('2026-01-20T14:30:00Z'));
  });

  it('follows DST: 09:30 NY is 14:30Z before and 13:30Z after 2026-03-08 (A19)', () => {
    expect(bucketStart(utc('2026-03-06T15:00:00Z'), '1d', cal)).toBe(utc('2026-03-06T14:30:00Z'));
    expect(bucketStart(utc('2026-03-09T15:00:00Z'), '1d', cal)).toBe(utc('2026-03-09T13:30:00Z'));
  });
});

describe('aggregateBars across session gaps', () => {
  const cal = usCalendar();
  const from = utc('2026-03-02T00:00:00Z');
  const to = utc('2026-03-21T00:00:00Z');
  const minutes = sessionMinuteBars(cal, from, to);

  it('builds 1m fixtures only inside sessions (390 per day, 15 days)', () => {
    expect(minutes.length).toBe(390 * 15);
  });

  it('1m → 5m: 78 bars per day with OHLCV merged', () => {
    const five = aggregateBars(minutes, '5m', cal);
    expect(five.length).toBe(78 * 15);
    const first = five[0]!;
    expect(first.time).toBe(utc('2026-03-02T14:30:00Z'));
    expect(first.open).toBe(1);
    expect(first.close).toBe(5);
    expect(first.high).toBe(5.5);
    expect(first.low).toBe(0.5);
    expect(first.volume).toBe(5);
  });

  it('1m → 1h: 7 bars per day at 09:30 … 15:30; the 15:30 bar holds 30 minutes; none spans the night (A14)', () => {
    const hourly = aggregateBars(minutes, '1h', cal);
    expect(hourly.length).toBe(7 * 15);
    const dayOne = hourly.slice(0, 7).map((b) => b.time);
    expect(dayOne).toEqual([0, 1, 2, 3, 4, 5, 6].map((k) => utc('2026-03-02T14:30:00Z') + k * 3600));
    expect(hourly[6]!.volume).toBe(30);
    expect(hourly[7]!.time).toBe(utc('2026-03-03T14:30:00Z'));
  });

  it('1m → 1d steps across weekend and DST: Fri→Mon = 255 600 s, Mon→Tue = 86 400 s (A3)', () => {
    const daily = aggregateBars(minutes, '1d', cal);
    expect(daily.length).toBe(15);
    const diffs = daily.slice(1).map((b, i) => b.time - daily[i]!.time);
    expect(diffs).toContain(255_600); // Fri 03-06 → Mon 03-09 across DST start
    expect(diffs).toContain(259_200); // ordinary weekend
    expect(diffs.filter((d) => d === 86_400).length).toBe(12); // 14 diffs − 2 weekends
  });

  it('drops bars outside the session', () => {
    const outside = { time: utc('2026-03-02T13:00:00Z'), open: 1, high: 1, low: 1, close: 1, volume: 1 };
    expect(aggregateBars([outside], '5m', cal)).toEqual([]);
  });
});

describe('metals session crossing midnight (A18)', () => {
  const cal = new SessionCalendar(METAL_INFO);

  it('has a daily break between 16:59 and 18:05 New York', () => {
    // Tue 2026-01-06 16:58 NY = 21:58Z (inside); 17:30 NY = 22:30Z (break); 18:05 NY = 23:05Z (open)
    expect(cal.sessionAt(utc('2026-01-06T21:58:00Z'))).not.toBeNull();
    expect(cal.sessionAt(utc('2026-01-06T22:30:00Z'))).toBeNull();
    expect(cal.sessionAt(utc('2026-01-06T23:05:00Z'))!.open).toBe(utc('2026-01-06T23:05:00Z'));
  });

  it('1h buckets align to 18:05 and the trading date is the close date', () => {
    const spans = bucketsForSessions(cal.sessionsBetween(utc('2026-01-06T23:00:00Z'), utc('2026-01-07T23:00:00Z')), '1h', cal);
    expect(spans[0]!.start).toBe(utc('2026-01-06T23:05:00Z'));
    const last = spans.find((s) => s.end === utc('2026-01-07T21:59:00Z'));
    expect(last).toBeDefined();
    expect(spans.some((s) => s.start > utc('2026-01-07T21:59:00Z') && s.start < utc('2026-01-07T23:05:00Z'))).toBe(false);
    expect(cal.sessionAt(utc('2026-01-07T12:00:00Z'))!.tradingDate).toBe('2026-01-07');
  });

  it('is closed from Friday 16:59 until Sunday 18:05', () => {
    expect(cal.sessionAt(utc('2026-01-10T12:00:00Z'))).toBeNull(); // Saturday
    expect(cal.sessionAt(utc('2026-01-11T23:10:00Z'))).not.toBeNull(); // Sunday 18:10 NY
  });
});
