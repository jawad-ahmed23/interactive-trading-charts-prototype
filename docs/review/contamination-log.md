# Contamination Log (Step 1)

Review date: 2026-11-15. Scope: every file in `./docs/`. Each entry **describes** what was found
without reproducing it. Removed content is not kept anywhere.

**Types:** P = reference-platform protocol name/key/encoding · A = API structure mirroring the
vendor's separately licensed charting-library product · V = vocabulary or example structure echoing
the vendor's scripting language or UI · T = trademark or product/UI name · N = no-value detail.
**Severity:** H / M / L.

Scan found **no** minified code, mangled identifiers, bundle module ids, CSS class names, asset file
names, hostnames, real prices or volumes, session tokens, cookies, user ids, auth headers, or full
request/response bodies. No vendor built-in or community script source had been copied. The two
items closest to that, the MACD and Supertrend examples (#24, #26), were our own code that mirrored
known scripts' structure, and they were rewritten.

| # | File | Line / section | Type | Sev | What was found (described) | Action |
|---|---|---|---|---|---|---|
| 1 | architecture-overview | §2 O1 | P | H | The literal key names of the WebSocket message envelope | Replaced with a generic description of a method-name + positional-params JSON frame |
| 2 | architecture-overview | §2 O2 | P | H | Server-hello field names, the literal placeholder token value used when logged out, and the vendor's names for its two channel types | Rewritten as connection-setup steps in neutral terms |
| 3 | architecture-overview | §2 O3 | P | H | The request/response method names for symbol lookup | "separate symbol-lookup request/response" |
| 4 | architecture-overview | §2 O3 | P | H | 13 raw metadata key names from the symbol-lookup response | Replaced with a generic list of the metadata's *meanings* |
| 5 | architecture-overview | §2 O5; indicator-engine §1 | P | H | Literal per-bar object keys in the bar and indicator payloads | Generic "(index, [time, values…]) tuple" |
| 6 | architecture-overview | §2 O6 | P | H | The literal layout of the tick-mark tuple | "each bar is sent with a label-importance level" |
| 7 | architecture-overview | §2 O7 | P | H | The vendor's internal numeric label-importance values | Replaced with a graded description (minute → year); no numbers |
| 8 | rendering-and-interaction | §2 tick marks | P | H | The same internal numbers presented as if they were our algorithm (including a week level) | Replaced with LWC's public, Apache-licensed behaviour; the vendor values removed |
| 9 | test-cases | B4 | P | M | A test asserting the vendor's week-level weight | Rewritten as a timezone-formatter test |
| 10 | architecture-overview | §2 O8 | P | H | Four indicator-lifecycle message names | "create request → loading → data → completed" |
| 11 | architecture-overview | §2 O12 | P | H | The literal history-paging method name | "a request for more history" |
| 12 | architecture-overview | §2 O13 | P | M | Query-parameter names of the vendor's search endpoint | Described by purpose (text, exchange, type, language, grouping filters) |
| 13 | architecture-overview | §2 O14 | P | M | Response key names of the search endpoint | Described by structure (grouped results with nested alternates/contracts) |
| 14 | architecture-overview | §2 O19 | P | M | The literal bar-close-time key | "bar payload includes its close time" |
| 15 | architecture-overview | §2 O24; indicator-engine §8; test-cases J6 | P | M | A verb echoing one of the vendor's quote-session method names | "pause" |
| 16 | architecture-overview | §3 diagram | P | L | The vendor's channel-type terms as edge and node labels | "chart channel", "quote channel", "chart channel manager" |
| 17 | script-language-design | §1 | P | M | Handshake field names (metadata hash, runtime version) | "server advertises version info for its study runtime" |
| 18 | indicator-engine-spec | §1 | P | L | The vendor's channel-type term | "per chart" |
| 19 | architecture-overview | §2 O20 | P | L | A paraphrase of the vendor's local-storage key names | "persist in browser local storage" |
| 20 | data-feed-spec | §3 interface | A | H | Method names, callback-with-listener-id pattern and reset callback matching the vendor's charting-library datafeed API | Replaced with our own `MarketDataSource` (`findInstruments`, `describeInstrument`, `loadHistory`, `openBarStream` returning a handle with `onInvalidate`, `openQuoteStream`, `now`) |
| 21 | data-feed-spec | §2 request/result types | A | H | Request/result field names matching the same API (count-back, first-request flag, no-data flag, next-time hint) | `{before, limit, purpose}` → `{bars, exhausted, olderAvailableAt}` |
| 22 | data-feed-spec | §2 timeframe type | A | H | The vendor's resolution-string encoding | Canonical `Timeframe` (`1m`, `5m`, `1h`, `1d`, `1w`, `1mo`) used in all docs |
| 23 | data-feed-spec | §5 session format | A | H | The vendor's session-string syntax and weekday numbering | Structured `SessionWindow { days, open, close }` |
| 24 | data-feed-spec | §2 symbol type | A | H | A metadata type whose fields were one-to-one renamings of the vendor's keys | Our own `Instrument` type (`tickSize`, `pricePrecision`, `fractionalFormat`, `tickTable`, `capabilities`) |
| 25 | build-plan, test-cases, data-feed-spec | references to #20–#22 | A | M | Downstream uses of the replaced names | Updated to the new names |
| 26 | script-language-design | §3, §9 (13 lines) | V | M | Colour hex values matching the vendor's default indicator palette | Theme palette tokens (`$accent1…`, `$up`, `$down`) |
| 27 | script-language-design | §9 MACD | V | M | A histogram colouring rule whose 4-state structure and colours mirrored the vendor's built-in MACD | Single sign-based colour from our palette |
| 28 | script-language-design | §3, §9 alerts | V | M | The vendor's alert-message placeholder syntax | Our `${…}` templates |
| 29 | script-language-design | §9 Supertrend | V | M | A direction-flip expression mirroring a widely shared community script line for line | Rewritten from the published algorithm as explicit if-blocks |
| 30 | script-language-design | §5, §8 stdlib | V | M | Library names taken from the vendor's language (missing-value replace, value-when, bars-since, highest/lowest bar offset, last-bar index, bar-confirmed and close-time names) | `orElse`, `carryForward`, `lastWhere`, `barsSinceTrue`, `highestOffset`/`lowestOffset`, the `bar` object |
| 31 | script-language-design | keyword | V | M | The vendor's missing-value keyword | `none` / `isNone()` (confirmed by owner) |
| 32 | indicator-engine-spec | §2 PlotDef | V | M | A plot-style list mirroring the vendor's style constants | `line, step, histogram, area, bars, dots, plus, shape`; `shade`/`paint` as separate outputs |
| 33 | indicator-engine-spec, script-language-design | display option | V/T | L | The name of the vendor's values side-panel | `values-only` |
| 34 | script-language-design | §9 Bollinger | V | L | The vendor's title for the middle band | "Middle" |
| 35 | script-language-design | §5.6, bonus example | V | L | Strategy order verbs and an equity-percent sizing name echoing the vendor's language | `buy`, `sell`, `flatten`, `protect`, `sizePct()` |
| 36 | script-language-design, indicator-engine-spec | horizontal-line statement | V | L | The vendor's horizontal-line function name | `level` |
| 37 | script-language-design | input types | V | L | An input constructor name matching the vendor's | `choice(…)` |
| 38 | script-language-design, indicator-engine-spec | alert frequency and condition names | V/T | L | Frequency and condition labels matching the vendor's alert dialog wording | `once`, `oncePerBar`, `onceOnBarClose`, `everyTick`; `above/below`, `enterRange/exitRange` |
| 39 | script-language-design | §9 pivots example | V | L | Label text and a function name matching a common vendor-language idiom | `swingHigh/swingLow`, labels "H"/"L" |
| 40 | script-language-design | qualifier names | V | L | A qualifier keyword matching the vendor's type-system term | `fixed` |
| 41 | architecture-overview | §1 table, O22 | T | L | The vendor's script-editor product name | "the vendor's script editor" |
| 42 | indicator-engine-spec | §4 | T | L | The vendor's name for its drawing/indicator list panel | "layers panel" |
| 43 | architecture-overview | §2 O23 | N | L | Counts of the vendor's JS and CSS bundle chunks (no design value) | Deleted |
| 44 | rendering-and-interaction, test-cases | crosshair "Magnet" | — | — | Also LWC's public, Apache-licensed enum name | **Kept** (owner confirmed); now cites LWC |
| 45 | data-feed-spec | 120–150 ms search debounce | — | — | Our own value, not observed from the vendor | **Kept** (clean) |

**Totals:** 43 changes (P: 19, A: 6, V: 15, T: 2, N: 1) plus 2 reviewed and kept. The step-1 preview listed
38. Entries #36–#40 were found while rewriting the DSL and are logged here for completeness. The
reference platform is still named only in the clean-room context. Observed *behaviour* (counts,
timings, sequencing) was kept, because it is not copyrightable expression and is the purpose of the study.
