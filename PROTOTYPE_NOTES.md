# Phase 1 Prototype: Notes

A working chart foundation built from `docs/` and public library docs only (clean-room). Stack: Vite 6 ·
React 18 · TypeScript (strict) · Lightweight Charts **5.3.0** · Luxon (sessions/DST) · Vitest.

```bash
npm install
npm run dev        # http://localhost:5173 (live BTCUSDT 1H by default)
npm test           # 71 unit tests
npm run build      # type-check + production build
```

## What works (verified)

Verified in a headless Chrome against the dev server and the production build (`vite preview`), plus unit tests.

| Feature | Status | How it was checked |
|---|---|---|
| Live BTCUSDT/ETHUSDT/SOLUSDT from Binance (REST history + kline WebSocket, no API key) | ✅ | Close price changed during the run; stream status dot green |
| REST fallback `api.binance.com` → `data-api.binance.vision`; WS fallback `stream.binance.com:9443` → `data-stream.binance.vision` | ✅ | Unit test (fallback is remembered) |
| Reconnect with jittered exponential backoff (0.5 s → 30 s), resubscribe, **gap back-fill via REST**, 30 s stale-socket watchdog, dedupe by time | ✅ | Unit tests with a fake WebSocket |
| MockFeed for AAPL (09:30–16:00 New York, weekends + 2025/26 NYSE holidays closed) and XAUUSD (Sun–Fri 18:05–16:59 New York), deterministic, DST-correct | ✅ | Unit tests + screenshots (1H bars at 09:30 … 15:30 NY; metal buckets at :05/:20/:35/:50) |
| Candles + volume in its own pane; dark theme; exchange-timezone time axis | ✅ | Screenshots |
| Timeframes 1m, 5m, 15m, 1H, 4H, 1D, 1W | ✅ | All switched with no errors |
| Symbol search (5 symbols, keyboard navigation, ranked results) | ✅ | Browser + unit test (ranking bug found and fixed: "eth" used to pick Bitcoin/T**eth**er) |
| Infinite history: pages load near the left edge, single-flight guard, stop at "no more data", 50 000-bar cap | ✅ | Browser: 300 → 554 → 808 → 1 288 bars while panning/zooming; view does not jump. Unit tests for the pager |
| Live tick updates the current bar; a new period appends a bar | ✅ | Unit tests + browser |
| "Latest ⇥" scroll-to-realtime button appears when scrolled away, hides after use | ✅ | Browser |
| Crosshair legend: O/H/L/C/% change/V + every indicator value for the hovered bar (last bar when not hovering) | ✅ | Browser |
| Price scale Linear / Log / % | ✅ | Screenshots |
| Zoom keeps the latest bar fixed; hold ⌘/Ctrl to zoom at the cursor (review decision 1) | ✅ | Browser: right edge unchanged after wheel zoom |
| Persistence of symbol, timeframe, scale mode and indicators (validated on load) | ✅ | Browser reload + unit tests |
| Indicator engine in a **Web Worker**: SMA, EMA, RSI (own pane, 0–100, 30/70 levels), MACD (own pane, histogram + 2 lines), Bollinger Bands (overlay + band fill) | ✅ | Browser with 6 instances at once; unit tests |
| `full()` and incremental `update()` give **bit-identical** results | ✅ | 1 000-bar tick-by-tick replay for every indicator |
| Correct warm-up (`none` = NaN internally, whitespace points in LWC) | ✅ | Unit tests per indicator |
| Recompute after history prepend without breaking live state | ✅ | Worker test + browser |
| Indicators dialog: add/remove, edit inputs, multiple instances (EMA 20 + EMA 50 with distinct colours) | ✅ | Browser (rapid-add bug found and fixed) |
| No leaks on symbol/timeframe switching | ✅ | 3 rounds × 15 switches: exactly 1 data stream open at the end, event listeners constant (291), heap plateaus (7.6 → 7.9 → 8.0 MB) |

### The generic indicator API (ready for compiled scripts)
`src/indicators/types.ts`: an `IndicatorDefinition` declares `inputs`, `plots` (line/histogram),
`bands`, `levels`, `fixedRange`, `placement` and `create(inputs) → { initial, step, clone }`. Built-ins
register through `registerIndicator()`, the same path a compiled Quill script will use. A unit test
registers a third-party definition. The chart layer (`ChartController`) only reads definitions and
output columns and never branches on an indicator id.

## Test coverage vs `docs/test-cases.md`

| Doc case | Covered by | Notes |
|---|---|---|
| A2 valid series | `feed.adapters`, `feed.bars`, `chart-logic` | |
| A3 DST daily step (255 600 s) | `feed.timeframe` | |
| A6 single-flight paging, A7 prepend merge, A8 stop when exhausted | `chart-logic` (HistoryPager, BarStore) | A7's view preservation checked in the browser |
| A9 overlapping chunks | `feed.bars` | |
| A10–A13 tick replaces / new bar appends / stale ignored | `feed.bars`, `chart-logic` (worker) | |
| A14 session-aligned 1H aggregation; A16 closed date; A18 metals break; A19 DST | `feed.timeframe` | |
| A22 reconnect + back-fill | `feed.adapters` (fake WebSocket) | |
| H1–H4, H6 warm-up and conventions | `indicators` | Includes the published Wilder RSI example to 2 dp |
| H11 live ticks never change closed bars | `indicators` | |
| H12 prepend recompute equals full | `chart-logic` (worker) | |
| J1 persistence | `chart-logic` + browser reload | |
| Full vs incremental, 1 000-bar replay (prompt) | `indicators` | All 5 built-ins, bit-for-bit |
| **Not covered** | A15 short days, A17 extended hours (not modelled); H5 ATR, H7 Stochastic (not built); H8–H9 `none` inside windows (no source produces NaN); H13–H30 (multi-timeframe, Quill: Phase 3); B/C/D/E groups are LWC behaviour, checked manually in the browser, not automated |

Test files: `tests/feed.timeframe.test.ts`, `tests/feed.bars.test.ts`, `tests/feed.adapters.test.ts`,
`tests/indicators.test.ts`, `tests/chart-logic.test.ts`. Fixture: `tests/fixtures/rsi-wilder-example.json`.

## Known limitations
- **No backend** (per this brief). The browser calls Binance directly. Binance blocks some jurisdictions (e.g. HTTP 451 from `api.binance.com` in the US). The `binance.vision` fallbacks are public market-data mirrors, but **check Binance's terms for your region** before shipping.
- Binance tick sizes and precisions are hard-coded (not read from `exchangeInfo`).
- **MockFeed is synthetic**, not market data, and is labelled "MOCK DATA" in the UI. No short days or extended hours; holidays only for 2025–2026; no ticks while the market is closed ("Market closed" badge).
- Pane order, pane sizes and per-instance colours are not editable in the UI (colours are assigned automatically).
- Prepending history triggers a full indicator recompute (fine up to the 50 000-bar cap; ~ms per indicator).
- Browser checks were run with an ad-hoc DevTools script, not a committed e2e suite.
- React `StrictMode` double-mounts in dev. The controller handles it (generation counter), but expect two worker creations in dev.
- No retry button after a failed history load; switch symbol or timeframe to retry.

## Doc conflicts found (prompt wins for the prototype)

| # | Docs say | Prototype does | Recommendation |
|---|---|---|---|
| 1 | Thin gateway from day one (review decision 3); keys server-side, one normalised protocol | Browser → Binance directly (prompt: "no backend") | Add the gateway in Phase 2, before equities with paid keys |
| 2 | Canonical API `MarketDataSource` with `findInstruments / describeInstrument / loadHistory / openBarStream`, type `Instrument`, request `{before, limit, purpose}` → `{bars, exhausted}`. **The clean-room review replaced these names because they mirrored the vendor's charting-library API** | Prompt's names: `DataFeed`, `SymbolInfo`, `resolveSymbol / getBars / subscribeBars`, `{to, limit}` → `{bars, noMoreData}` | **Rename to the canonical names before Phase 2** (mechanical: one interface, 3 adapters, 1 controller) to keep the clean-room separation |
| 3 | `data-feed-spec §4.2` and `rendering §4`: after prepending N bars, call `setVisibleLogicalRange({from + N, to + N})` | **No manual shift.** LWC anchors the view to the right edge, so prepending already keeps the same bars in view (observed: the range moved by exactly N on its own). A manual shift would double-shift | Fix both docs |
| 4 | Volume as an overlay with margins {0.8, 0} on the main pane (`indicator-engine §4`) | Volume in its own pane (prompt allowed either) | Keep the pane; update the doc |
| 5 | Prompt: warm-up values are `null` | Engine uses `NaN` (= spec's `none`); the chart sends LWC whitespace points (rendering §8: never send NaN) | Docs are right; no change |
| 6 | `IndicatorDefinition.warmup: number \| 'auto'`; `PlotDef.kind` has 8 kinds; `IndicatorOutput` has `marks/paint/shade/events` | `warmup(inputs)` is a function; only `line` and `histogram` plus `bands` (prompt's "band"); output = columns only | Update the spec to `warmup(inputs)`; add the other kinds in Phase 2/3 |
| 7 | Timeframe ids `1m … 1d, 1w, 1mo` | Same ids internally (`1h`, `4h`, `1d`, `1w`); UI labels `1H/4H/1D/1W`; no `1mo` (not in the prompt) | None |
| 8 | Search debounce 120–150 ms with abort | Not needed: the 5-symbol search is local | Implement when search hits a network service |
| 9 | Spec mentions short days and extended-hours windows | Only `closedDates` and regular sessions are modelled | Phase 2 (`SessionCalendar` extension) |

Open question **R1** from `docs/review/open-questions.md` is resolved: LWC 5.3.0 `TickMarkType` = Year(0), Month(1), DayOfMonth(2), Time(3), TimeWithSeconds(4); formatter signature `(time, tickMarkType, locale) => string | null`.

## What Phase 2 needs
1. **Rename the data API to the canonical clean-room names** (conflict 2), then add the **gateway** (conflict 1): Binance + Coinbase adapters server-side, history cache, one WebSocket per client, the protocol from `data-feed-spec §7`.
2. **US equities adapter** (Massive or Alpaca) with split-adjusted history; extended-hours and short-day modelling in `SessionCalendar`; maintained holiday data (open question D4).
3. **More indicators** from the formula table (ATR, Stochastic, VWAP, Supertrend, Keltner, Donchian, CCI, MFI, HMA, Heikin-Ashi chart type), plus the remaining plot kinds and outputs (`dots`, `step`, `area`, marks, shading, bar colouring).
4. **Indicator-on-indicator DAG** and the layers panel (reorder, move between panes, per-instance style editing).
5. **Committed e2e suite** (Playwright) for test groups B–E (zoom anchoring, paging, realtime button, crosshair legend, pane resizing), plus a frame-time budget check (open question R6).
6. **Future-time labels** via whitespace bars and a bar-close countdown label (O19).
7. **Error/retry UX** for failed history pages and a visible reconnect state.
8. Doc fixes from the conflict table (3, 4, 6), and close the open decisions R2/R3 (zoom anchor and axis timezone are implemented as recommended; confirm them).
