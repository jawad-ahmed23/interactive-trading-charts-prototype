# Build Plan

A phased roadmap. Each feature is mapped to **LWC v5 built-in** 🟢, **LWC + our plugin/primitive** 🟡, or
**our code** 🔵, and to the **spec section** that defines it. Estimates are engineer-weeks (ew) for one
experienced TypeScript developer. Multiply by about 0.6 for two people working in parallel.

> **Confidence:** estimates are DESIGN (judgement, ±40 %). LWC capability mapping VERIFIED against v5.3.0. Provider facts VERIFIED as of 2026-11-15.

Pin `lightweight-charts@5.3.x` and review release notes before minor upgrades.

---

## Phase 0: Foundations (2.5–3.5 ew)
| Feature | Map | Spec | Est |
|---|---|---|---|
| Monorepo (pnpm), Vite app, TS strict, Vitest, Playwright | 🔵 | — | 0.5 |
| Canonical types: `Instrument`, `Timeframe`, `Bar`, `MarketDataSource` | 🔵 | data-feed §2–3 | 0.25 |
| `MockSource` (deterministic synthetic bars with sessions, DST, holidays) | 🔵 | data-feed §3, test-cases fixtures | 0.5 |
| `SessionCalendar` (IANA tz, DST, closed/short days, extended hours, CT/ET venues) | 🔵 | data-feed §5 | 1.25 |
| CI with canvas screenshot tests | 🔵 | test-cases | 0.5 |

## Phase 1: Chart foundation (6.5–8 ew)
| Feature | Map | Spec | Est |
|---|---|---|---|
| Candles / bars / line / area / baseline / histogram | 🟢 | rendering §6 | 0.25 |
| Price formatting from `tickSize`/`pricePrecision`/`fractionalFormat` | 🟢 + 🔵 | rendering §3 | 0.5 |
| Time axis in exchange timezone (`tickMarkFormatter`) | 🟢 + 🔵 | rendering §2 | 0.5 |
| Scroll, zoom, pinch, kinetic; right-edge zoom with ⌘/Ctrl → cursor anchor | 🟢 | rendering §4 | 0.5 |
| Crosshair (MagnetOHLC) + DOM legend | 🟢 + 🔵 | rendering §5 | 0.5 |
| `BarStore`: merge, dedupe, **validation before LWC**, LRU | 🔵 | data-feed §4.1, rendering §8 | 0.75 |
| History paging at the left edge, with view preservation | 🔵 | data-feed §4.2, rendering §4 | 0.75 |
| Bar stream, replace-or-append, live-edge follow | 🟢 + 🔵 | data-feed §3.1, rendering §4 | 0.5 |
| Countdown label primitive | 🟡 | rendering §3 | 0.25 |
| Instrument search: debounce + abort, grouped results | 🔵 | data-feed §3 | 0.5 |
| Timeframe switch with clear-reload | 🔵 | data-feed §1 (O9) | 0.25 |
| Client aggregation (session-aligned) | 🔵 | data-feed §4.3–4.4 | 0.75 |
| Gateway v0: one crypto venue (Binance or Coinbase), history cache, WS fan-out, heartbeat, reconnect + gap back-fill | 🔵 | data-feed §6–7 | 1.5 |
| Local persistence of last instrument/timeframe/style | 🔵 | indicator-engine §8 | 0.25 |
| Attribution (logo or About-page link + NOTICE) | 🟢 | rendering §9 | 0.05 |

**Milestone:** a usable crypto chart with live data. Exit checks: frame time < 4 ms at 5 000 visible bars, test groups A–E green.

## Phase 2: Indicators and panes (6–7.5 ew)
| Feature | Map | Spec | Est |
|---|---|---|---|
| Multi-pane, pane resize, stretch factors | 🟢 | rendering §5 | 0.5 |
| Indicator worker: columnar `IndicatorOutput`, rollback, warm-up rules | 🔵 | indicator-engine §2–3 | 1.5 |
| 25 built-ins with golden tests (formula conventions table) | 🔵 | quill §8.1 | 1.5 |
| Settings dialog generated from `InputDef[]` | 🔵 | indicator-engine §2 | 0.75 |
| Overlay/pane placement, own scales, levels, fills (primitive) | 🟢 + 🟡 | indicator-engine §4 | 0.75 |
| Indicator-on-indicator DAG | 🔵 | indicator-engine §5 | 0.5 |
| Log / percent / indexed scale modes | 🟢 | rendering §3 | 0.1 |
| Heikin-Ashi transform | 🔵 | rendering §6 | 0.25 |
| US equities adapter (Massive or Alpaca), extended-hours shading primitive | 🔵 + 🟡 | data-feed §5–6 | 1.0 |
| Quote streams + watchlist panel (pause when hidden) | 🔵 | data-feed §3 | 0.5 |
| Future-time labels via whitespace bars | 🟢 + 🔵 | rendering §2 | 0.25 |

## Phase 3: Drawings, layouts, alerts, Quill v1 (11–15 ew)
| Feature | Map | Spec | Est |
|---|---|---|---|
| Drawing framework: data-space anchors, `hitTest`, edit state machine, undo/redo | 🟡 | rendering §7 | 2.5 |
| 9 tools (trendline, horizontal, ray, rectangle, fib retracement, channel, text, arrow, measure) | 🟡 | rendering §7 | 2.0 |
| Layout document, backend persistence, migrations | 🔵 | indicator-engine §8 | 1.0 |
| Multi-chart grid + `LayoutBus` sync (instrument/timeframe/crosshair/time), cross-tab | 🟢 + 🔵 | indicator-engine §8 | 1.5 |
| **Quill v1:** lexer, parser, checker, JS codegen, runtime, stdlib, sandbox, error codes | 🔵 | quill §3–8 | 4.0 |
| `on()` higher-timeframe and other-instrument contexts (confirmed + live modes) | 🔵 | quill §5.5, indicator-engine §6 | 1.5 |
| Script editor (Monaco) with diagnostics from Quill error spans | 🔵 | quill §6 | 1.0 |
| Alerts service (same engine, server-side isolate) | 🔵 | indicator-engine §7, quill §7 | 1.5 |
| Renko / range bars / line break | 🔵 | rendering §6 | 1.0 |
| FX/metals adapter (OANDA or Twelve Data) | 🔵 | data-feed §5–6 | 0.75 |

## Phase 4: Depth (open-ended)
| Feature | Map | Spec | Est |
|---|---|---|---|
| Strategies + broker emulator + equity pane | 🔵 | quill §5.6 | 3.0 |
| Quill drawing objects (`line.new` …) | 🟡 | quill §8 | 1.5 |
| WASM backend | 🔵 | quill §6 | 3–4 |
| COMEX futures (Databento) with continuous contracts | 🔵 | data-feed §5–6 | 1.5 |
| Replay mode | 🔵 | **not yet specified** (open question) | 1.5 |
| Volume profile custom series | 🟡 | **not yet specified** (open question) | 1.5 |
| Mobile touch polish | 🟢 + 🔵 | rendering §4 (touch options) | 1.0 |
| Script sharing / public library | 🔵 | **not yet specified** (open question) | 2+ |

**Total to the end of Phase 3:** about 26–34 ew solo, or about 4–5 months for two engineers.

---

## Spec ↔ plan coverage check
Every spec section maps to at least one plan row above. Three Phase 4 items have **no spec yet**
(replay, volume profile, script sharing). They are listed in `review/open-questions.md` and are not
needed before Phase 4.

## Risks and mitigations
> **Confidence:** DESIGN. Licensing facts VERIFIED (CTA/UTP plans, LWC licence).

| Risk | Impact | Mitigation |
|---|---|---|
| **Market data licensing**: realtime SIP display needs vendor agreements, per-user reporting and fees | High: legal and cost | Start with crypto (free public feeds). Free users get IEX realtime or delayed data. Budget CTA/UTP fees before launch. Never redistribute vendor data beyond the licence |
| Provider history limits (Kraken: 720 candles via REST; Coinbase: 350 per page) | Medium | Prefer Binance/Coinbase for crypto history; cache in the gateway |
| Session/DST edge cases misalign bars; overnight US equity sessions start in 2026–27 | High | `SessionCalendar` as an isolated package with property tests over 10 years of transitions; data-driven calendars; `extendedHours.kind = 'overnight'` already modelled |
| LWC production build skips data validation | Medium | `BarStore` validation layer (rendering §8) with tests |
| LWC gaps (drawings, fills, non-time axes) | Medium | Primitives and custom series. Synthetic times for Renko. Fork only as a last resort (Apache-2.0; keep NOTICE) |
| Indicator recompute cost on long histories | Medium | Worker, typed arrays, live-bar incremental updates, history cap (e.g. 50 000 bars) |
| Quill scope creep | High | v1 = indicators + alerts only; strategies and drawing objects in Phase 4; conformance tests |
| Sandbox escape (alerts run server-side) | High | Codegen-only output, frozen runtime, `isolated-vm`, fuzzing |
| Resemblance to the reference product (UI, names, palette, assets) | Medium: IP | Own visual design and palette tokens, permissively licensed icons (Lucide/Tabler), original Quill vocabulary (clean-room review done). Keep LWC attribution |
