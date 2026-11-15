# Market Data Source Specification (provider-agnostic)

Defines the interface between our chart app and any market data source. Observed behaviour is cited
as O-numbers from `architecture-overview.md`. Everything else is **Design**.

Canonical names (used in every doc): `Instrument`, `InstrumentId`, `Timeframe`, `Bar`,
`MarketDataSource`, `BarStore`, `SessionCalendar`.

---

## 1. Lessons taken from the observed platform
> **Confidence:** left column INFERRED (observed behaviour); right column DESIGN.

| Observation | What we adopt |
|---|---|
| O3 Instrument metadata is looked up once per symbol, separately from data | `describeInstrument()` returns an `Instrument` that drives price formatting, sessions and the time axis |
| O4 Initial history = 300 bars | Default `initialBars = 300`; configurable per timeframe |
| O12 History paged in ~145-bar chunks, one request in flight | `loadHistory({before, limit})` with a single-flight guard per series; chunk size ≈ 1.5 × visible bars |
| O9 Timeframe change clears, reloads and recomputes | Key the series cache by `(instrumentId, timeframe)`; never mix timeframes in one buffer |
| O10 Live bar updated in place; new bar when the period rolls | Bar-stream contract §3.1: same `time` ⇒ replace last bar, greater ⇒ append, smaller ⇒ ignore |
| O11 10 s ping + echoed heartbeat | Transport heartbeat every 10 s; reconnect after 2 missed |
| O13 Search fires per keystroke and cancels stale requests | `findInstruments()` takes an `AbortSignal`; the UI debounces 120–150 ms (our choice) and aborts superseded calls |
| O15 Session gaps exist only in time, not in bar index | Bars are a dense array; gaps are never filled with empty bars (LWC's time scale is index-based too) |
| O19 Bars carry a close time for the countdown | `Bar.closeTime?` optional; otherwise derived from the `SessionCalendar` |

---

## 2. Types
> **Confidence:** DESIGN (canonical types for all docs).

```ts
/** Canonical timeframe identifiers. Used everywhere: datafeed, cache keys, indicators, DSL, layouts. */
export type Timeframe =
  | '1s' | '5s' | '15s' | '30s'                      // optional, crypto only
  | '1m' | '3m' | '5m' | '15m' | '30m'
  | '1h' | '2h' | '4h'
  | '1d' | '1w' | '1mo'
  | `${number}${'s' | 'm' | 'h' | 'd' | 'w' | 'mo'}`;  // custom multiples, e.g. '45m', '3d'

/** "<VENUE>:<CODE>", e.g. "COINBASE:BTC-USD", "NASDAQ:AAPL", "OANDA:XAU-USD". */
export type InstrumentId = string;

export interface SessionWindow {
  days: ('mon' | 'tue' | 'wed' | 'thu' | 'fri' | 'sat' | 'sun')[];
  open: string;          // "HH:MM", exchange-local
  close: string;         // "HH:MM", exchange-local; close < open means the window crosses midnight
}

export interface Instrument {
  id: InstrumentId;
  displayName: string;
  description: string;
  kind: 'crypto' | 'stock' | 'etf' | 'forex' | 'metal' | 'futures' | 'index';
  venue: string;
  currency: string;
  timezone: string;                       // IANA, e.g. "America/New_York"
  regularHours: SessionWindow[];          // empty = 24×7
  extendedHours?: { kind: 'pre' | 'post' | 'overnight'; windows: SessionWindow[] }[];
  closedDates?: string[];                 // YYYY-MM-DD exchange-local full-day closures
  shortDays?: { date: string; close: string }[];
  // Price formatting
  tickSize: number;                       // e.g. 0.01
  pricePrecision: number;                 // decimals shown, e.g. 2
  fractionalFormat?: { denominator: number; subDenominator?: number };   // bonds / some futures
  tickTable?: { below: number; tickSize: number }[];                     // e.g. sub-$1 stocks
  volumePrecision: number;
  capabilities: {
    intraday: boolean;
    seconds: boolean;
    extendedHours: boolean;
    nativeTimeframes: Timeframe[];        // served directly by the provider
  };
  dataDelaySec: number;                   // 0 = realtime, 900 = 15-min delayed
}

export interface Bar {
  time: number;                           // UTC seconds, bar OPEN time
  open: number; high: number; low: number; close: number;
  volume?: number;
  closeTime?: number;                     // UTC seconds; used by the countdown label
}

export interface HistoryRequest {
  instrument: Instrument;
  timeframe: Timeframe;
  before: number;                         // exclusive upper bound, UTC seconds
  limit: number;                          // max bars, ending just before `before`
  purpose: 'initial' | 'page' | 'gap';    // gap = back-fill after reconnect
  signal?: AbortSignal;
}

export interface HistoryResponse {
  bars: Bar[];                            // ascending, unique `time`
  exhausted: boolean;                     // no older data exists (listing date or provider limit)
  olderAvailableAt?: number;              // if this window was empty: time of the nearest older bar
}

export interface InstrumentMatch {
  id: InstrumentId; displayName: string; description: string;
  venue: string; kind: Instrument['kind']; currency: string;
  logoUrl?: string;
  alternates?: InstrumentMatch[];         // same instrument on other venues / contracts (O14)
}
```

## 3. The interface
> **Confidence:** DESIGN. The LWC `update()` semantics are VERIFIED (v5.3.0).

```ts
export interface MarketDataSource {
  /** Static capabilities: supported timeframes, venues, instrument kinds. */
  capabilities(): Promise<SourceCapabilities>;

  /** O13: called per keystroke; must honour `signal`. */
  findInstruments(query: string, opts?: { kind?: Instrument['kind']; venue?: string; signal?: AbortSignal }): Promise<InstrumentMatch[]>;

  /** O3: one round-trip per instrument; cached for the app session. */
  describeInstrument(id: InstrumentId): Promise<Instrument>;

  /** O4/O12: initial load, left-edge paging and reconnect back-fill use the same call. */
  loadHistory(req: HistoryRequest): Promise<HistoryResponse>;

  /** O10: realtime bars of the requested timeframe. */
  openBarStream(instrument: Instrument, timeframe: Timeframe, onBar: (bar: Bar) => void): BarStream;

  /** Lightweight quotes for watchlists and headers (O24). */
  openQuoteStream(ids: InstrumentId[], fields: QuoteField[], onQuote: (q: Quote) => void): QuoteStream;

  /** Server clock (UTC seconds) for countdowns and the session clock. */
  now?(): Promise<number>;
}

export interface BarStream {
  close(): void;
  /** Fired when cached history is no longer valid (reconnect gap too large, correction, split). */
  onInvalidate(cb: (reason: 'gap' | 'correction' | 'corporate-action') => void): void;
}
export interface QuoteStream { close(): void; pause(): void; resume(): void; }   // pause/resume: O24
```

### 3.1 Bar-stream contract (`onBar`)
1. `bar.time === last.time` → **replace** the last bar. Its high/low already include the new tick.
2. `bar.time > last.time` → **append**. The previous bar is now final, so indicators commit it.
3. `bar.time < last.time` → ignore it and increment a `staleBar` metric. Corrections must go through `onInvalidate`.

This maps onto LWC v5 `series.update(bar)`, which replaces when the time is equal and appends when it is greater. An **older** time throws in production (VERIFIED). Rule 3 therefore has to run before LWC is called.

## 4. Client pipeline
> **Confidence:** DESIGN. LWC range APIs VERIFIED. The aggregation rules are standard OHLCV practice.

```mermaid
flowchart LR
  A[loadHistory / openBarStream] --> B[BarStore<br/>key = instrumentId|timeframe]
  B --> C{native timeframe?}
  C -- yes --> E[Series buffer]
  C -- no --> D[Aggregator<br/>from finest native base]
  D --> E
  E --> F[Indicator worker]
  E --> G[LWC series.setData / update]
```

### 4.1 Cache and dedupe
- `BarStore` holds sorted, unique arrays per key. Merging uses **binary search on `time`**. Overlaps are deduplicated by `time`, and the most recent fetch wins.
- **Single-flight per key.** A second `loadHistory` for the same key while one is pending reuses the pending promise (O12).
- LRU eviction across keys (e.g. 2 million bars in total). The visible key is pinned.
- Optional IndexedDB persistence for `1d` and higher.

### 4.2 Paging trigger (pairs with `rendering-and-interaction.md §4`)
Subscribe with `timeScale().subscribeVisibleLogicalRangeChange(range => …)`. When
`range.from < 50` (fewer than 50 bars of headroom on the left), `!exhausted`, and no request is in
flight, call `loadHistory({before: firstBar.time, limit: max(150, 1.5 × visibleBars), purpose: 'page'})`.
Prepend the result with `setData`, then shift the visible logical range by the number of new bars
so the view does not jump. (LWC's own infinite-history demo uses a 10-bar threshold. We prefetch earlier, at 50.)
`BarStore` must check ascending, unique times itself, because LWC only checks in development builds (VERIFIED).

### 4.3 Native vs aggregated timeframes

| Requested | Fetch natively if the provider supports it | Else aggregate from |
|---|---|---|
| `1m`, `5m`, `15m` | always try native | `1m` |
| `30m`, `1h`, `2h`, `4h` | native if available | `1m` or `5m`, aligned to the session |
| `1d` | **always native**, so the official close/settlement is used | — |
| `1w` | native if available | `1d` (week starts on the first trading day of the week) |
| `1mo` | native if available | `1d` (calendar month, exchange timezone) |
| custom (`45m`, `3d`) | — | the nearest native divisor |

Rules:
- **Intraday buckets are aligned to the session open, not to UTC midnight** (US `1h` bars start 09:30, 10:30, …, and the last bar of the day is 15:30–16:00, a short bar). Crypto aligns to UTC.
- **Daily bars are not built from intraday bars** for official charts, because vendor daily bars include auction and settlement prices.
- Aggregation: open = first, high = max, low = min, close = last, volume = sum.

### 4.4 Realtime aggregation
```
onTick(price, size, ts):
  start = calendar.bucketStart(ts, timeframe)      // session- and DST-aware
  if !last or start > last.time:  append {time: start, open=high=low=close=price, volume=size}
  elif start == last.time:        high=max, low=min, close=price, volume+=size; replace
  else:                           late tick → ignore (or patch that bar if cached)
```
Rendering is throttled to ≤ 1 update per animation frame. The indicator worker receives **every** tick
when a script uses tick-persistent (`tick`) variables. O10 showed about 1 update per second on the wire.

## 5. Sessions, weekends and DST
> **Confidence:** VERIFIED against exchange and provider sources (NYSE hours page, NIST DST, CME contract specs, OANDA hours, Binance docs), except where marked.

`SessionCalendar` is built from an `Instrument`'s `regularHours`, `extendedHours`, `closedDates`,
`shortDays` and `timezone`:
- `isOpen(ts)`, `bucketStart(ts, timeframe)`, `nextOpen(ts)`, `sessionClose(ts)`, `futureBarTimes(fromTs, n)` (for drawings and labels past the last bar).
- All math happens in **exchange-local wall time** and converts to UTC with an IANA timezone library (Temporal where available, otherwise Luxon).
- **DST:** a session that opens at 09:30 New York time opens at 13:30 UTC in summer and 14:30 UTC in winter. Daily bar open times therefore step by 86 400 ± 3 600 s across a transition (O15). Never assume fixed 86 400 s spacing.
- Closed dates and short days remove or shorten bars. A missing day is simply absent from the dense bar array.
- **US short days:** NYSE closes at 13:00 ET the day after Thanksgiving and on Christmas Eve, and on July 3 **only when July 3 is a trading day**. In 2026, July 3 is a full holiday; in 2027, Dec 24 is a full holiday. Load closed and short dates from a maintained calendar, never from a rule.
- US and EU DST switch on different dates, so UTC offsets between venues change twice a year for a few weeks.

| Asset class | Hours (exchange-local) | Weekend | Time-axis effect |
|---|---|---|---|
| Crypto | 24×7; buckets aligned to UTC | none | uniform spacing (O15) |
| US stocks | regular 09:30–16:00 ET. Extended hours **depend on the venue**: NYSE Arca and Nasdaq 04:00–09:30 and 16:00–20:00; other NYSE venues 07:00–09:30 and 16:00–20:00. Overnight exchange sessions are approved but **not live yet** (they wait on the SIP's extended-hours change, scheduled for Dec 6 2026); off-exchange ATSs trade 20:00–04:00 | Sat/Sun closed | overnight and weekend gaps collapse in index space; extended hours optional and shaded |
| FX | Sun 17:00 → Fri 17:00 New York; daily rollover at 17:00 New York (triple rollover Wednesdays) | Fri 17:00 → Sun 17:00 | the `1d` bar starts at 17:00 New York time (OANDA's default daily alignment) |
| Spot gold/silver | OANDA example: Sun–Fri 18:05–16:59 New York, so a daily break of about 17:00–18:05 and a Sunday open around 18:00. **Varies by provider** | as FX | about 1 h daily gap |
| COMEX gold/silver futures | CME publishes Sun–Fri **17:00–16:00 CT** (= 18:00–17:00 ET), with a 60-minute daily break from 16:00 CT. Store the session in `America/Chicago` | weekend | contract rolls; continuous back-adjusted series optional. CME announced 24/7 trading for a 1-ounce gold contract in 2026; whether GC/SI are affected is UNKNOWN |

## 6. Suggested real providers (check current licensing and limits before committing)
> **Confidence:** VERIFIED against provider docs as of 2026-11-15. Prices and plans change, so re-check before signing up.

| Asset class | Realtime | History | Notes |
|---|---|---|---|
| **Crypto** | Exchange WebSockets: Binance kline streams (incl. `1s`); Coinbase Advanced Trade `market_trades` (public; its `candles` channel is 5-minute only); Kraken v2 `ohlc` | Binance klines: ≤ 1000 per request, pageable. Coinbase candles: ≤ 350 per request, pageable. **Kraken REST returns only the 720 most recent candles**, so deep history needs its trades endpoint or downloadable files | UTC-aligned buckets. Coinbase streams need heartbeat subscriptions to stay open. Aggregators (CoinAPI, Kaiko, CCData) for a composite price |
| **US stocks** | Massive (Polygon.io rebranded Oct 30 2025), Alpaca (free: IEX realtime; paid plan: SIP realtime), Databento | Massive aggregates; Alpaca bars (free plan includes **historical SIP** except the latest 15 min; ≤ 10 000 bars per page); Databento | Realtime SIP display needs CTA/UTP vendor agreements, per-user reporting and fees (about $1/month per non-professional user per plan). IEX Cloud no longer exists (retired Aug 2024). Use **split-adjusted** history by default |
| **Gold/silver** | OANDA v20 pricing stream (XAU_USD, XAG_USD), Twelve Data WebSocket (higher plans) | OANDA candles (≤ 5000 per request), Twelve Data time series | OTC spot, so prices vary by provider. For COMEX futures use Databento `GLBX.MDP3` or a broker API |
| **FX** | OANDA, Massive forex, Twelve Data | same | Use mid prices; bid/ask candles optional |

Gateway responsibilities: keep API keys server-side, normalise to `InstrumentId`, cache history (Redis
or Postgres/Timescale), and fan out realtime over **one WebSocket per client** with per-subscription ids
(the useful pattern from O1).

## 7. Wire protocol between our gateway and the browser (our own design)
> **Confidence:** DESIGN.

```jsonc
// client → server
{ "op": "stream.open",   "sub": "s1", "instrument": "COINBASE:BTC-USD", "tf": "5m" }
{ "op": "history.load",  "req": "h7", "instrument": "…", "tf": "5m", "before": "<timestamp>", "limit": 300 }
{ "op": "stream.close",  "sub": "s1" }
{ "op": "pong",          "n": "<counter>" }
// server → client
{ "op": "history",       "req": "h7", "bars": [["<t>","<o>","<h>","<l>","<c>","<v>"], …], "exhausted": false }
{ "op": "bar",           "sub": "s1", "bar": ["<t>","<o>","<h>","<l>","<c>","<v>"] }   // replace-or-append per §3.1
{ "op": "invalidate",    "sub": "s1", "reason": "gap|correction|corporate-action" }
{ "op": "ping",          "n": "<counter>" }                                               // every 10 s
{ "op": "error",         "req": "h7", "code": "RATE_LIMIT", "retryAfter": "<seconds>" }
```
Bars travel as positional arrays `[t,o,h,l,c,v]`, smaller on the wire than keyed objects.

### Reconnect lifecycle
1. Detect: socket `close`/`error`, or 2 missed pings (20 s).
2. Back off: 0.5 s → 1 s → 2 s → … capped at 30 s, with ±20% jitter.
3. On reopen, **re-open streams**. For each live series call `loadHistory({before: now, limit: N, purpose: 'gap'})` covering the period since the last cached bar, merge by time, then resume streaming.
4. If the gap is larger than the cache window, fire `onInvalidate('gap')` and reload fully.
