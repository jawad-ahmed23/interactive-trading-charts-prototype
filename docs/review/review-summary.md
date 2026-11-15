# Review Summary

Review of `./docs/` before any application code is written. Date: 2026-11-15. No application code was
written or scaffolded.

Sources checked: Lightweight Charts **v5.3.0** typings, development build and GitHub source, plus
official docs and demos. Indicator formulas: StockCharts ChartSchool, bollingerbands.com, ta-lib.org.
Market facts: NYSE hours page, NIST (DST), CME contract specs, OANDA hours and v20 docs. Providers: the
official docs of Binance, Coinbase, Kraken, Alpaca and Databento, Massive's blog, and the CTA/UTP plan documents.

> Security note: one fetched page (StockCharts' StochRSI article) contained text aimed at AI agents,
> asking for a web request. It was ignored, and nothing from it entered the docs.

## 1. Contamination findings fixed (details in `contamination-log.md`)

| Type | Count |
|---|---|
| Reference-platform protocol names, keys, encodings and internal numbers | 19 |
| API structure mirroring the vendor's charting-library datafeed API | 6 |
| DSL vocabulary or example structure echoing the vendor's scripting language or UI | 15 |
| Trademark or product/UI names | 2 |
| No-value vendor detail (bundle chunk counts) | 1 |
| **Total changed** | **43** (+ 2 reviewed and kept) |

No captured market data, credentials, tokens, minified code or copied scripts were found.

## 2. Claims by classification

Counted per factual claim reviewed. DESIGN statements (our own decisions) are not counted. Test rows
are counted by the source of their expected result.

| Doc | VERIFIED | INFERRED | WRONG (fixed) | UNKNOWN |
|---|---|---|---|---|
| architecture-overview | 0 | 24 | 0 | 4 |
| data-feed-spec | 22 | 9 | 3 | 2 |
| rendering-and-interaction | 37 | 5 | 5 | 1 |
| indicator-engine-spec | 6 | 6 | 0 | 0 |
| script-language-design | 17 | 2 | 0 (9 underspecified, now specified) | 1 |
| build-plan | 6 | 0 | 1 | 0 |
| test-cases (108 rows) | 38 | 16 | 2 | 0 |
| **Total** | **126** | **62** | **11** | **8** |

"INFERRED" rows are behaviour observed once on the reference platform in a free, logged-out session.
They are fine as design inspiration, and nothing in our design depends on them being exact.

## 3. Top 10 corrections

1. **Data API de-contamination:** the datafeed interface, timeframe strings and session syntax mirrored the vendor's charting-library API. They are replaced with our own `MarketDataSource`, `Timeframe` (`5m`/`1h`/`1d`) and `SessionWindow`, consistently across all docs.
2. **Tick-mark weights:** the rendering doc presented the vendor's internal values (with a week level) as the algorithm. LWC's levels are internal, have **no week level**, and select labels greedily by `ceil(labelWidth / barSpacing)`. We only supply a timezone-aware `tickMarkFormatter`.
3. **Production LWC skips data validation:** ordering, duplicate and NaN checks run only in development builds. Added `BarStore` validation and a rule that `none`/NaN is always sent as whitespace bars.
4. **`series.update` with an older time throws in production** (unless `historicalUpdate`). The bar-stream contract now drops stale bars before LWC.
5. **Zoom anchor:** LWC zooms at the cursor by default; `rightBarStaysOnScroll: true` anchors at the right edge. No custom wheel handler is needed: toggle the option while ⌘/Ctrl is held.
6. **Crosshair:** LWC's default is Magnet, which snaps to close. Snapping to O/H/L/C is `MagnetOHLC`, which we now use.
7. **US extended hours are venue-dependent** (NYSE Arca/Nasdaq 04:00; other NYSE venues 07:00), and overnight exchange sessions are not live yet. The July 3 early close applies only when July 3 is a trading day.
8. **Metals/futures hours:** COMEX is published in **Central Time** (17:00–16:00 CT). OANDA spot metals break about 17:00–18:05 New York.
9. **Provider facts:** Alpaca's free plan includes historical SIP; Kraken REST is capped at 720 candles; Coinbase allows 350 candles per request and its WS candles are 5-minute only; Polygon is now Massive; IEX Cloud is gone.
10. **Indicator conventions specified:** EMA SMA-seed; RSI first value at index n and U=D=0 → 50; ATR bar-0 TR = H−L; population σ for Bollinger; Supertrend starts "up"; HMA uses floor(n/2) and floor(√n); zero-range rules for Stochastic and CCI. Also fixed: the LWC attribution requires NOTICE **and** a link (the logo satisfies the link part); `maxBarSpacing` and `rightOffsetPixels` exist in v5.

Also completed in Step 3: canonical names across all docs; a spec↔plan coverage table (3 Phase 4 items
lack specs and are flagged); `test-cases.md` rewritten with fixtures and exact expected values; 35+ new
tests for history paging, tick-vs-new-bar, aggregation across gaps, warm-up/`none`, MTF without
look-ahead, and runtime errors and loop protection.

## 4. Decisions needed before Phase 1

| # | Decision | Options | Recommendation |
|---|---|---|---|
| 1 | Default wheel-zoom anchor | (a) right edge, ⌘/Ctrl for cursor (as observed) · (b) cursor (LWC default) | **(a)**. Keeps the latest bar fixed for live trading. It's one option toggle, so it's easy to change later |
| 2 | First data venue | (a) Coinbase · (b) Binance · (c) Kraken | **(a) Coinbase** if you are US-based (history pageable at 350 per request, public trades WS). **(b) Binance** elsewhere (deeper paging, `1s`). Avoid Kraken for history (720 cap) |
| 3 | Browser-direct vs gateway from day 1 | (a) browser connects to the exchange directly · (b) thin gateway | **(b)**. Keeps keys server-side and gives one normalised protocol and a cache. Needed for stocks anyway |
| 4 | Axis timezone | (a) exchange tz · (b) user local · (c) UTC | **(a) exchange tz by default**, with a user override. Session boundaries then read naturally |
| 5 | Timezone library | (a) Temporal (polyfill) · (b) Luxon | **(b) Luxon** for Phase 0–1, behind a small interface so we can swap to Temporal later |
| 6 | Instrument id scheme | (a) `VENUE:CODE` · (b) opaque ids + lookup | **(a)**. Readable in layouts and URLs. Normalise codes per venue in the gateway |
| 7 | Attribution | (a) keep the LWC logo · (b) hide it, link on an About page | **(a)** for Phase 1. Revisit with the visual design |
| 8 | History parameters | initial 300 bars; page at < 50 bars headroom; page size 1.5 × visible (min 150) | **Accept** as defaults; tune after R6 measurements |

## 5. Verdict: **GO for Phase 1**, with conditions

**Reasons for go**
- Everything Phase 1 relies on is VERIFIED against LWC v5.3.0: series, scales, zoom/scroll options, visible-range APIs, crosshair, update semantics, pane basics, attribution.
- Contamination is fixed. Our APIs, names and examples are our own, and the docs no longer contain vendor protocol material.
- Phase 1 depends on **no UNKNOWN items**. The open items (compile flow, layout payloads, overnight sessions, CME 24/7) affect Phase 2+ or are comparison-only.
- Test groups A–E are concrete enough to write first (test-driven).

**Conditions (do these first)**
1. Make decisions 1–6 above (≈ 1 hour).
2. Do Phase 0 before Phase 1: `SessionCalendar` with DST and holiday property tests, plus `MockSource`. Phase 1 correctness depends on them.
3. Confirm R1 (`TickMarkType` members in the v5.3 typings), a 5-minute check.
4. Pin `lightweight-charts@5.3.x`.

**Not yet** for Phase 3 (Quill, alerts, layouts): S2–S4 and L2–L4 need decisions first. That is not urgent.
