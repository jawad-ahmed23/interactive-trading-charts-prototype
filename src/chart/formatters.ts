import { TickMarkType, type Time } from 'lightweight-charts';

/** Time labels in the instrument's exchange timezone (review decision 4). */
export function makeTimeFormatters(timezone: string) {
  const fmt = (opts: Intl.DateTimeFormatOptions) => new Intl.DateTimeFormat('en-GB', { timeZone: timezone, ...opts });
  const year = fmt({ year: 'numeric' });
  const month = fmt({ month: 'short' });
  const day = fmt({ day: 'numeric', month: 'short' });
  const hm = fmt({ hour: '2-digit', minute: '2-digit', hourCycle: 'h23' });
  const hms = fmt({ hour: '2-digit', minute: '2-digit', second: '2-digit', hourCycle: 'h23' });
  const full = fmt({ weekday: 'short', day: '2-digit', month: 'short', year: '2-digit', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' });

  const toDate = (t: Time): Date => new Date((t as number) * 1000);

  return {
    tickMarkFormatter: (time: Time, type: TickMarkType): string => {
      const d = toDate(time);
      switch (type) {
        case TickMarkType.Year:
          return year.format(d);
        case TickMarkType.Month:
          return month.format(d);
        case TickMarkType.DayOfMonth:
          return day.format(d);
        case TickMarkType.Time:
          return hm.format(d);
        case TickMarkType.TimeWithSeconds:
          return hms.format(d);
        default:
          return hm.format(d);
      }
    },
    timeFormatter: (time: Time): string => full.format(toDate(time)),
    legendTime: (time: number): string => full.format(new Date(time * 1000)),
  };
}

export function formatVolume(v: number): string {
  const a = Math.abs(v);
  if (a >= 1e9) return `${(v / 1e9).toFixed(2)}B`;
  if (a >= 1e6) return `${(v / 1e6).toFixed(2)}M`;
  if (a >= 1e3) return `${(v / 1e3).toFixed(2)}K`;
  return v.toFixed(a < 10 ? 3 : 0);
}

export function formatValue(v: number | null | undefined, precision: number): string {
  return v === null || v === undefined || Number.isNaN(v) ? '—' : v.toFixed(precision);
}
