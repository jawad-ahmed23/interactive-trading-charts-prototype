# Open Questions for a Second Research Pass

Each item: why it matters · the build phase it blocks · how to answer it
(**PUB** = public docs, **DEC** = our own design decision, **REA** = another observation pass on the reference platform).

## Data

| # | Question | Why it matters | Blocks | Answer via |
|---|---|---|---|---|
| D1 | First crypto venue for Phase 1 (Binance vs Coinbase vs Kraken). Kraken REST serves only 720 recent candles, and Binance.com availability depends on jurisdiction | Determines history depth and the legal setup | Phase 1 | DEC + PUB (check your jurisdiction) |
| D2 | US overnight trading: exchange overnight sessions wait on the SIP change scheduled for Dec 6 2026, with ATS overnight trading live today. Which sessions do we show by default? | Session calendar, the bar count per day, extended-hours shading | Phase 2 | PUB (re-check after Dec 2026) + DEC |
| D3 | Does CME's 2026 24/7 trading for its 1-ounce gold contract change GC/SI hours? | Futures session calendar | Phase 4 | PUB (CME notice) |
| D4 | Holiday and short-day data source (exchange calendars, a vendor endpoint, or a maintained library) | Correct closed and short days | Phase 0 | PUB + DEC |
| D5 | Corporate actions: split-adjusted by default; dividend adjustment as an option? How to invalidate cached history on a new split | Correct equity charts | Phase 2 | DEC + PUB (vendor endpoints) |
| D6 | Size of the reference platform's history page (~145 bars), and whether it scales with viewport width or zoom | Only for tuning our page size; we already chose 1.5 × visible | — (nice to have) | REA (repeat at 2 viewport widths) |
| D7 | Whether the reference platform's realtime throttle (~1 update/s) is server-side or depends on account tier | Our UX target for update rate | — | REA (logged-in free account) |

## Rendering

| # | Question | Why it matters | Blocks | Answer via |
|---|---|---|---|---|
| R1 | Confirm `TickMarkType` members and the `tickMarkFormatter` signature in v5.3 typings (not covered by the verification pass) | Exchange-timezone labels | Phase 1 | PUB (typings.d.ts) |
| R2 | Default zoom anchor: right edge (matches the observed platform) or cursor (LWC default)? | UX; tests D1/D2 | Phase 1 | DEC |
| R3 | Time-axis display timezone: exchange, user-local, or UTC; per chart or global? | Labels, legend, drawings UX | Phase 1 | DEC |
| R4 | Price-axis label density and formatting for very small tick sizes (crypto with 8 decimals) | Readability | Phase 1 | PUB (LWC priceFormat) + DEC |
| R5 | How to label "future" positions: whitespace bars could interfere with `shiftVisibleRangeOnNewBar` and `allowShiftVisibleRangeOnWhitespaceReplacement` | Future labels and drawings past the last bar | Phase 2 | PUB + prototype |
| R6 | Performance budget on low-end devices (frame time at 5 000 bars plus 5 indicators) | Phase 1 exit criterion | Phase 1 | Prototype measurement |
| R7 | Replay mode: what it means for data paging and indicators | Unspecified Phase 4 feature | Phase 4 | DEC (spec needed) |
| R8 | Volume profile: data needs (intrabar volume at price) and rendering approach | Unspecified Phase 4 feature | Phase 4 | DEC + PUB (custom series docs) |

## Indicators

| # | Question | Why it matters | Blocks | Answer via |
|---|---|---|---|---|
| I1 | Which conventions to match for golden tests: TA-Lib defaults or another reference? (EMA seed = SMA chosen; ATR bar-0 TR = H−L chosen; TA-Lib drops bar 0) | Users compare values with other tools | Phase 2 | DEC |
| I2 | Stochastic RSI scale: 0–100 with 3/3 smoothing (platform convention) or 0–1 unsmoothed (original definition) | User expectation | Phase 2 | DEC |
| I3 | Swing-point tie handling (strictly greater on both sides vs ≥ on one side) | Deterministic tests | Phase 2 | DEC |
| I4 | Recursive smoothers and `none` inputs: hold state and resume (chosen) vs reset | Output after data gaps | Phase 2 | DEC (confirm) |
| I5 | Whether to compute volume as an indicator (as observed) or as a series field | Pane and scale handling | Phase 2 | DEC |
| I6 | Alert evaluation for intrabar (`everyTick`) alerts: gateway tick granularity per provider | Alert accuracy | Phase 3 | PUB (provider WebSocket docs) |

## Script engine

| # | Question | Why it matters | Blocks | Answer via |
|---|---|---|---|---|
| S1 | Reference platform's compile flow (server vs client, request/response shape, error format). Login-gated, not observed | Only as a comparison; our design doesn't depend on it | — | REA with a logged-in free account (**needs owner approval**) |
| S2 | Execution budgets: loop budget 10 000 iterations per bar, 2 s watchdog, 64 plots, 500 marks. Are these right for real scripts? | Usability vs safety | Phase 3 | Prototype + DEC |
| S3 | Server isolate choice for alerts: `isolated-vm` vs worker threads with `resourceLimits` vs WASM-only | Security of server-side user code | Phase 3 | PUB + security review |
| S4 | Quill packaging: language name, file extension, versioning header (`quill 1`) for forward compatibility | Scripts must not break on upgrades | Phase 3 | DEC |
| S5 | Script sharing and the public library: licensing of user scripts, moderation | Unspecified Phase 4 feature | Phase 4 | DEC + legal |

## State and layout

| # | Question | Why it matters | Blocks | Answer via |
|---|---|---|---|---|
| L1 | Reference platform's server-side layout save/load payload shape and autosave cadence (account-only, not observed) | Comparison only | — | REA with a logged-in account (**needs owner approval**) |
| L2 | Accounts and auth model for our product (anonymous local-only vs required login for saving) | Persistence design | Phase 3 | DEC |
| L3 | Drawings scope: per user × instrument (chosen) vs per layout; behaviour when an instrument is renamed or delisted | Data model | Phase 3 | DEC |
| L4 | Conflict resolution for concurrent edits across devices (etag + merge prompt chosen; CRDT later?) | Multi-device UX | Phase 3 | DEC |
