# Behavioural Test Cases

Every case is **concrete and checkable**: fixture → action → expected result. **Source** says whether the
expectation comes from an observation of the reference platform (O-number, INFERRED), a verified
external fact (VERIFIED), or our own design (DESIGN).

> **Confidence:** expectations are DESIGN unless the Source column says otherwise.

## Fixtures (all synthetic, never real market data)

| Id | Definition |
|---|---|
| **FX-CRYPTO** | Instrument `TEST:CRYPTO`, 24×7, UTC, tickSize 0.01. `5m` bars from `T0 = 2026-01-05T00:00Z`, 10 000 bars. Close follows a seeded random walk (seed 42); H/L = close ± 0.5; volume 1 |
| **FX-US** | Instrument `TEST:US`, `America/New_York`, regular 09:30–16:00 Mon–Fri, pre-market 04:00–09:30, post-market 16:00–20:00. Closed 2026-01-19. Short day 2026-11-27 (13:00 close). `1m` bars across 2026-03-02 … 2026-03-20 (covers the DST change on 2026-03-08) |
| **FX-METAL** | Instrument `TEST:XAU`, `America/New_York`, Sun–Fri 18:05–16:59, `1m` bars for 2 weeks |
| **SEQ-UP** | 40 bars, close = 1, 2, 3, …, 40 (O=H=L=C, volume 1). Used for indicator warm-up |
| **TICKS-A** | Live ticks on FX-CRYPTO at T_last + 10 s, + 70 s, + 290 s (same `5m` bucket), then + 301 s (next bucket) |

`MockSource` serves the fixtures through `MarketDataSource`, records every call, and can delay
responses by a set number of milliseconds.

---

## A. Data source and bars

| ID | Fixture / given | Action | Expected | Source |
|---|---|---|---|---|
| A1 | FX-CRYPTO, empty cache | open the chart on `5m` | exactly 1 `loadHistory` call with `{limit: 300, purpose: 'initial'}`; series length 300; last bar = fixture bar 9 999 | O4 |
| A2 | any loaded series | inspect `BarStore` | times strictly ascending and unique; for every bar `low ≤ min(open, close)` and `high ≥ max(open, close)` | O5 |
| A3 | FX-US `1d` (aggregated from regular hours) | diff consecutive bar open times | Fri 2026-03-06 → Mon 2026-03-09 = 255 600 s (3 days − 1 h, DST starts 03-08); Mon → Tue = 86 400 s; no diff is assumed to be a multiple of 86 400 | VERIFIED (US DST rules) |
| A4 | FX-CRYPTO | diff consecutive times | every diff = 300 s | O15 / VERIFIED |
| A5 | FX-US `1h` | render with barSpacing 6 | x distance between the last bar of Friday and the first bar of Monday = 6 px (no gap in index space) | O15 / VERIFIED (LWC index axis) |
| A6 | FX-CRYPTO loaded (300 bars), MockSource delay 500 ms | call `setVisibleLogicalRange({from: 40, to: 140})`, then within 100 ms `{from: 30, to: 130}` and `{from: 20, to: 120}` | exactly 1 `loadHistory` call, with `{before: <time of first loaded bar>, purpose: 'page'}` and `limit ≥ 150` | O12 |
| A7 | after A6 resolves with 300 older bars | read the visible range | `from` increased by exactly 300 (± 0.01); series length 600; no duplicate times; the bar previously at logical 40 is at logical 340 | O12 |
| A8 | MockSource returns `exhausted: true` for page 3 | keep the visible range at `from < 50` for 3 s | no further `loadHistory` calls after the exhausted response | DESIGN |
| A9 | two overlapping chunks: bars 0–199 then 150–349, with bars 150–199 changed in the 2nd chunk | merge | 350 unique bars; bars 150–199 equal the 2nd chunk's values | DESIGN |

### A-live. Live tick updates the current bar vs opens a new bar
| ID | Fixture / given | Action | Expected | Source |
|---|---|---|---|---|
| A10 | FX-CRYPTO, last bar L at time T_last, close 100, high 101, low 99 | tick price 102 at T_last+10 s | bar count unchanged; last bar time = T_last; high = 102; close = 102; low = 99; `series.update` called once with `time = T_last` | O10 |
| A11 | after A10 | tick 98 at T_last+70 s, then 100.5 at T_last+290 s | count unchanged; low = 98; close = 100.5; high = 102 | O10 |
| A12 | after A11 | tick 101 at T_last+301 s | count +1; new bar time = T_last+300; O=H=L=C=101; the previous bar is frozen at its A11 values; indicator `Commit` fired exactly once | O10 |
| A13 | after A12 | a bar with time T_last arrives (stale) | ignored; `staleBar` metric = 1; `series.update` **not** called (LWC would throw) | VERIFIED (LWC throws on older time) |

### A-agg. Aggregation across session gaps
| ID | Fixture / given | Action | Expected | Source |
|---|---|---|---|---|
| A14 | FX-US `1m`, provider without native `1h` | request `1h`, regular hours only | each day has 7 bars at 09:30, 10:30, …, 15:30; the 15:30 bar covers 30 `1m` bars; no bar spans the overnight gap | DESIGN |
| A15 | FX-US, 2026-11-27 short day | aggregate `1h` | 4 bars that day: 09:30, 10:30, 11:30, 12:30 (the last covers 30 min) | VERIFIED (NYSE early close) |
| A16 | FX-US, 2026-01-19 closed | aggregate `1d` | no bar dated 2026-01-19; the Fri 16 Jan → Tue 20 Jan diff = 4 days | VERIFIED |
| A17 | FX-US with extended hours on | aggregate `1h` | pre-market buckets start 04:00 (04:00 … 08:00, then 09:00–09:30 = 30 min); then regular buckets 09:30, 10:30 …; no bucket crosses 09:30 or 16:00 | DESIGN |
| A18 | FX-METAL | aggregate `1h` around the daily break | no bar between 16:59 and 18:05; the first bar after the break starts at 18:05 | VERIFIED (provider hours) |
| A19 | FX-US 1m across 2026-03-08 | aggregate `1h` regular hours | 09:30 bars are at 14:30 UTC before the change and 13:30 UTC after | VERIFIED (DST) |
| A20 | FX-US | request `1d` | served from the provider's native daily endpoint; zero intraday requests | DESIGN |
| A21 | FX-CRYPTO, `5m` → `1h` switch | apply | the series is cleared, then 300 `1h` bars load; every indicator recomputes before the first paint of new data | O9 |

### A-net. Transport
| ID | Fixture / given | Action | Expected | Source |
|---|---|---|---|---|
| A22 | open stream; mock server stops sending pings | wait 20 s | the client reconnects (backoff starting at 0.5 s), re-opens streams, calls `loadHistory({purpose: 'gap'})` from the last cached bar; after reconnect, the series has no missing `5m` bucket | O11 |
| A23 | server sends `{op: 'ping', n: <k>}` | — | the client sends `{op: 'pong', n: <k>}` within 1 s | O11 |
| A24 | type "BTCUSD" as 6 keystrokes 40 ms apart | — | ≤ 6 `findInstruments` calls; all but the last were aborted (`signal.aborted === true`); only the last response is rendered | O13 |
| A25 | a match with 2 `alternates` | render results | one row with an expander listing the 2 alternates | O14 |

## B. Time scale
| ID | Fixture / given | Action | Expected | Source |
|---|---|---|---|---|
| B1 | barSpacing 8, `rightOffset` 5, pane width 800 | render | `timeScale().logicalToCoordinate(lastIndex)` = 800 − 5·8 − 4 = 756 (± 1); consecutive bars 8 px apart | VERIFIED (LWC model) |
| B2 | FX-CRYPTO spanning 2026-01-31 → 2026-02-01, barSpacing 1 | read rendered labels | a month label ("Feb") is present at the month boundary; no two labels overlap (each label's box is disjoint) | VERIFIED (LWC label selection) |
| B3 | FX-CRYPTO, barSpacing 30 | read labels | labels are times (hh:mm); a day label appears at the first bar of each day | VERIFIED (LWC) |
| B4 | FX-US `1m`, `tickMarkFormatter` set to `America/New_York` | read the first label of a regular session | "09:30" (not "14:30" or "13:30") | DESIGN |
| B5 | realtime edge visible | a new bar opens | the visible logical range shifts by exactly +1 | VERIFIED (`shiftVisibleRangeOnNewBar` default true) |
| B6 | scrolled 200 bars into history | a new bar opens | the visible logical range is unchanged | VERIFIED (LWC) |
| B7 | `futureLabels: true`, 10 whitespace bars appended | render | whitespace bars have session-calendar times (FX-US: skip Sat/Sun); no candles are drawn for them | DESIGN |

## C. Price scale
| ID | Fixture / given | Action | Expected | Source |
|---|---|---|---|---|
| C1 | auto-scale on; visible bars' low 90 / high 110; margins 0.2/0.1 | render | price range top = 110 + 20·0.2/0.7 ≈ 115.71, bottom = 90 − 20·0.1/0.7 ≈ 87.14 (± 0.01) | VERIFIED (LWC default margins) |
| C2 | all visible bars equal 100 | render | top > bottom; no NaN or Infinity in coordinates | DESIGN |
| C3 | drag the price axis by 50 px | release | `autoScale === false`; double-click the axis → `autoScale === true` | VERIFIED (LWC options) |
| C4 | tickSize 0.01, pricePrecision 2 | format 1234.5 | "1,234.50" | DESIGN |
| C5 | tickSize 0.00001, pricePrecision 5 | format 1.1 | "1.10000" | DESIGN |
| C6 | Logarithmic mode, visible range 10 … 1000 | measure y(10), y(100), y(1000) | y(10) − y(100) = y(100) − y(1000) (± 1 px) | VERIFIED (log mapping) |
| C7 | Percentage mode, first visible close 50 | read value of close 55 | +10.00 % | VERIFIED (mode definition) |
| C8 | live bar `closeTime − now` = 125 s | advance fake clock by 1 s | label reads "02:04"; series canvas paint count unchanged | DESIGN |

## D. Scroll and zoom
| ID | Fixture / given | Action | Expected | Source |
|---|---|---|---|---|
| D1 | default app settings (`rightBarStaysOnScroll: true`), cursor at x = 300 | 5 wheel notches out | x of the last bar unchanged (± 0.5 px) | O17 + VERIFIED (LWC option) |
| D2 | ⌘/Ctrl held | 5 wheel notches out at x = 300 | `coordinateToLogical(300)` before = after (± 0.05 bar) | VERIFIED (LWC cursor anchor) |
| D3 | touch, two fingers centred at x = 400 | spread fingers to double the distance | the logical index under x = 400 is unchanged (± 0.1); barSpacing approximately doubles | VERIFIED (LWC pinch) |
| D4 | `maxBarSpacing` 50 | zoom in 20 notches | barSpacing ≤ 50; further notches do not change the range | VERIFIED (option exists) |
| D5 | `minBarSpacing` 0.5 | zoom out 40 notches | barSpacing ≥ 0.5; history paging triggers if `from < 50` (A6 rules) | VERIFIED |
| D6 | barSpacing 10 | drag right 200 px, no fling | the visible range moves 20 bars into history (± 0.5) | VERIFIED (LWC model) |
| D7 | `kineticScroll.mouse: true` | fling drag at 2 px/ms | the range keeps moving for > 100 ms after release and stops within 3 s; a pointerdown during motion stops it within one frame | DESIGN |
| D8 | scrolled 500 bars back, barSpacing 3 | press the reset shortcut | `resetTimeScale()` called; the last bar is visible; `autoScale === true` | O18 / VERIFIED (method) |
| D9 | scrolled 500 bars back | click "scroll to realtime" | `scrollToRealTime()` called; the last bar is visible within 1 s | VERIFIED (method) |

## E. Crosshair, legend, panes
| ID | Fixture / given | Action | Expected | Source |
|---|---|---|---|---|
| E1 | MagnetOHLC; bar O=10 H=14 L=8 C=12 | pointer at y of price 13.6 over that bar | horizontal crosshair at 14 | VERIFIED (mode) |
| E2 | pointer over bar k | read legend | shows bar k's O/H/L/C and each indicator's value at k | DESIGN |
| E3 | pointer leaves the chart | read legend | shows the last bar's values | DESIGN |
| E4 | 100 pointer moves in 1 s | count paints | the series canvas repaints 0 times | VERIFIED (LWC layering) |
| E5 | 3 panes with stretch 1 / 0.25 / 0.25 | drag the first separator down 50 px, reload | the stretch ratio is persisted; heights after reload equal heights before (± 1 px) | DESIGN |
| E6 | 3 panes | scroll the time scale | all panes show the same logical range | VERIFIED |

## F. Chart types
| ID | Fixture / given | Action | Expected | Source |
|---|---|---|---|---|
| F1 | bars (O,H,L,C) = (10,12,9,11), (11,13,10,12) | Heikin-Ashi | HA0: close 10.5, open 10.5, high 12, low 9. HA1: close 11.5, open 10.5, high 13, low 10 | VERIFIED (formula) |
| F2 | HA live bar | 3 ticks | only the last HA bar changes | DESIGN |
| F3 | Renko box 1, reversal 2, closes 10 → 15 | build | 5 up bricks: [10,11] … [14,15] | VERIFIED (convention) |
| F4 | after F3 | close 13.5 | no new brick | VERIFIED |
| F5 | after F3 | close 13 | 1 down brick [13,14] | VERIFIED |
| F6 | Renko output | inspect times | strictly ascending; each maps back to a source time via the lookup table | DESIGN |

## G. Drawings
| ID | Fixture / given | Action | Expected | Source |
|---|---|---|---|---|
| G1 | FX-CRYPTO, trendline from (T0+10 m, 100) to (T0+50 m, 110) on `5m` | switch to `1h` | the endpoints keep the same time and price; x is at fraction 10/60 and 50/60 of the first `1h` bar's width | DESIGN |
| G2 | the same trendline | zoom ×2 and pan 100 px | `coordinateToPrice(y)` and `coordinateToTime`/logical of both handles are unchanged | DESIGN |
| G3 | FX-US, a point 3 trading days after the last bar (Friday) | render | x = x(last) + (bars in Mon–Wed) · barSpacing; Saturday/Sunday are skipped | DESIGN |
| G4 | pointer 3 px from a line; then 5 px; then 4 px from an endpoint | `hitTest` | `body`; then null; then `handle` | DESIGN |
| G5 | two overlapping drawings with zOrder 1 and 2 | click the overlap | zOrder 2 is selected | DESIGN |
| G6 | create, move, delete | undo ×3, then redo ×3 | after undo: empty; after redo: deleted state | DESIGN |
| G7 | 2×2 layout, two charts on `TEST:CRYPTO` | draw on chart 1 | the drawing appears on chart 2 within 1 s | DESIGN |

## H. Indicators and Quill

### H-warm. Warm-up and `none` handling (SEQ-UP fixture)
| ID | Action | Expected | Source |
|---|---|---|---|
| H1 | `sma(close, 5)` | indexes 0–3 = none; index 4 = 3; index 39 = 38 | VERIFIED (SMA) |
| H2 | `ema(close, 5)` | indexes 0–3 = none; index 4 = 3 (SMA seed); index 5 = 3 + (6 − 3)·(2/6) = 4 | VERIFIED (SMA seed convention) |
| H3 | `rsi(close, 14)` | indexes 0–13 = none; index 14 = 100 (all gains) | VERIFIED (first valid at n) |
| H4 | `rsi` on a flat series (all closes 5) | index 14 = 50 (U = D = 0 convention) | DESIGN (convention) |
| H5 | `atr(14)` on SEQ-UP (H = L = C) | TR[0] = H−L = 0; TR[1..] = 1; index 12 = none; index 13 = (0 + 13·1)/14 ≈ 0.928571; index 14 = (0.928571·13 + 1)/14 ≈ 0.933673 | VERIFIED (Wilder seed; bar-0 TR = H−L convention) |
| H6 | `macd(close,12,26,9)` | line first at index 25; signal first at index 33 | VERIFIED |
| H7 | `stoch(14,3,3)` on a flat series | fast %K = 50 everywhere valid (HH = LL); %D first at index 17 | DESIGN (convention) |
| H8 | `sma(x, 5)` where x[10] = none | indexes 10–14 = none; index 15 valid | DESIGN |
| H9 | `ema(x, 5)` where x[10] = none | index 10 = none; index 11 continues from the state at index 9 | DESIGN |
| H10 | plot with `none` values | send to LWC | whitespace items `{time}` are sent; zero NaN values passed to LWC | VERIFIED (LWC prod skips checks) |

### H-live. Live bar and history
| ID | Action | Expected | Source |
|---|---|---|---|
| H11 | `sma(close,5)` on FX-CRYPTO, apply TICKS-A | after each tick in the same bucket, only the last output index changes; after the 4th tick, output at the old last index equals a batch computation over the closed bars | O10 / DESIGN |
| H12 | prepend 300 bars (A7) with `ema(close,20)` attached | outputs for the previously loaded 300 bars equal a fresh full computation over all 600 (± 1e-12) | O12 |
| H13 | RSI added | goes to a new pane; `autoscaleInfoProvider` range [0,100]; levels 30/70 drawn | DESIGN |
| H14 | SMA overlay + volume | the SMA uses the main price scale; volume uses scale `vol` with margins {0.8, 0} | DESIGN |
| H15 | B = sma(source = A.plot) | change A's input | A recomputes before B (recorded order: A, B) | DESIGN |
| H16 | bind A → B → A | — | rejected with `CYCLE` error; no instance created | DESIGN |

### H-mtf. Multi-timeframe without look-ahead
| ID | Fixture / given | Action | Expected | Source |
|---|---|---|---|---|
| H17 | FX-CRYPTO `5m`, script `on("1d", close)` | evaluate chart bars of 2026-01-07 | every value = the `1d` close of 2026-01-06; none of them equals any 2026-01-07 price | DESIGN |
| H18 | same | mutate all bars of 2026-01-07 after 12:00 UTC, recompute | values for bars before 12:00 UTC on 2026-01-07 are unchanged (no future data used) | DESIGN |
| H19 | `on("1d", close, live=true)` | evaluate the 10:00 UTC bar of 2026-01-07 | equals that chart bar's close | DESIGN |
| H20 | `on("1d", high, live=true)` | evaluate the 10:00 UTC bar of 2026-01-07 | equals max(high) of chart bars from 00:00 to 10:00 UTC that day, not the day's final high | DESIGN |
| H21 | FX-US `5m`, `on("1d", close)` | first regular bar of Monday | equals Friday's close (weekend skipped) | DESIGN |

### H-rt. Script runtime errors and loop protection
| ID | Script | Expected | Source |
|---|---|---|---|
| H22 | `while true` loop in the body | `LOOP_BUDGET` error at bar 0 within 50 ms; chart and other indicators keep updating; error badge shows code and bar index | DESIGN |
| H23 | `for i in 0..1000000000` | `LOOP_BUDGET` at bar 0 (budget 10 000 iterations per bar) | DESIGN |
| H24 | a computation that bypasses the counter (e.g. a heavy stdlib call over a 100 000-element array per bar) | watchdog terminates the worker after 2 s; `TIMEOUT` error; worker restarts; other indicators recompute and are correct | DESIGN |
| H25 | references `fetch` | compile error `UNKNOWN_NAME`; no worker started | DESIGN |
| H26 | `x[5000]` with the default buffer | `HISTORY_DEPTH` error with a `maxBars` hint | DESIGN |
| H27 | `if bar.index == 1234` then calls `array.get(a, 10)` on an empty array | runtime error at `barIndex` 1234; outputs 0–1233 kept | DESIGN |
| H28 | `1 / 0` | result `none`, no error | DESIGN |
| H29 | script declares 4 inputs (int, float with step, choice, timeframe) | open settings | 4 fields with the declared types, defaults, min/max/step; changing one triggers a run but **no** recompile (compile count unchanged) | DESIGN |
| H30 | sandbox escape attempts: `globalThis`, `constructor.constructor("…")`, recursion depth 10⁵, `array` of 10⁷ elements | each fails with a compile or runtime error; the main thread is unaffected | DESIGN |

## I. Alerts
| ID | Given | Action | Expected | Source |
|---|---|---|---|---|
| I1 | crossUp(close, 100), `oncePerBar` | within one bar: 99 → 101 → 99 → 101 | exactly 1 notification | DESIGN |
| I2 | `onceOnBarClose` | crosses to 101 intrabar, closes at 99 | 0 notifications | DESIGN |
| I3 | fired on bar k; the worker restarts | replay bar k | 0 new notifications | DESIGN |
| I4 | `everyTick` | 20 qualifying ticks in 10 s | ≤ 2 notifications (1 per 5 s limit) | DESIGN |

## J. State and layouts
| ID | Given | Action | Expected | Source |
|---|---|---|---|---|
| J1 | set instrument `TEST:US`, timeframe `1h`, type Heikin-Ashi | reload | all three restored **before** the first `loadHistory` call | O20 |
| J2 | layout JSON at schema 1 | load in an app expecting schema 2 | migrated without loss; the next save writes schema 2 | DESIGN |
| J3 | 2×2 grid, instrument sync on, timeframe sync off | change chart 1 to `TEST:US` | charts 2–4 show `TEST:US`; their timeframes are unchanged | DESIGN |
| J4 | crosshair sync, chart 1 `5m`, chart 2 `1h` | hover the 10:35 bar on chart 1 | chart 2's crosshair is on the 10:00 `1h` bar (FX-CRYPTO) | DESIGN |
| J5 | the same layout open in 2 tabs | edit in tab 1 | tab 2 updates via BroadcastChannel within 1 s; a stale save gets HTTP 412 and a merge prompt | DESIGN |
| J6 | watchlist panel hidden | check the quote stream | `QuoteStream.pause()` called; resume on show | O24 |
