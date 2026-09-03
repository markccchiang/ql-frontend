# ql-frontend

The TypeScript frontend for [`qlservice`](https://github.com/markccchiang/ql-backend):
React and Redux over a binary WebSocket, Protobuf `quantlib.v2` frames, talking
to a `ql-backend` that keeps a live QuantLib object graph per session.

`UI.md` is the guide to the interface and `TESTING.md` covers the suites and
how to run them. `PLAN.md` is the design
document — the constraints the protocol imposes on the
UI, the stack decisions and why they beat the alternatives, the gap analysis
against the backend, and the milestones. Read `ql-backend/HANDLERS.md` beside
it: it is the list of what the service actually prices, and it is narrower than
the schema.

**Status: M7, plus the handshake.** The service now says what it can price:
`Hello` is answered with a `Capabilities` frame, the client asks on connect,
and `protocol/drift.ts` diffs the answer against the tables this build gates
on. Any disagreement fails a test and shows as a badge in the status bar, so a
capability going stale is no longer something a user discovers by meeting an
unexplained rejection.

**Status: M7.** Session tabs are in: each tab holds its own workbook and its
own session, several sessions live on one socket at once, and a tab you are not
looking at keeps its graph warm. The interface is checked against WCAG 2 AA on
every end-to-end run, the bundle is split so the charts are not downloaded
until a panel is opened, and `UI.md` is the guide to the interface.

Two things M7 planned are still blocked at the backend, not here: the curve
viewer needs `curve_samples` and the cash-flow table needs `include_cashflows`,
both of which are still `UNSUPPORTED` (`session.cpp:1087-1089`).

**M6.** A batched Monte Carlo now reports as it
runs — a progress bar, a convergence trace and a cancel that stops work between
batches — the workbook survives a refresh and can be exported and imported as
canonical Protobuf JSON, and a **compare** panel prices the same trade in a
second session on the same socket without disturbing the one in front of you.

Checked against the running daemon rather than by eye: ten progress frames for
a 200,000-path run settling at 9.307731 ± 0.031144 (the analytic is 9.297476);
a cancel returning "cancelled after 200000 of 20000000 paths"; and two sessions
on one socket pricing 9.297476 against 7.939163 for three months less time
value, with the survivor unaffected when the other closed. That last one is
also the first evidence in this repo that the backend's thread-local evaluation
date works, which is what `QL_ENABLE_SESSIONS` is for.

Batching changes the answer, and the tests say so: single-shot 9.288545 against
batched 9.307731 at the same seed and sample count. Reproducibility keys on the
seed, the samples and the batch size together, which is why `PriceResult`
echoes the whole engine.

**Not done in M6: persistent session tabs.** Comparing works, but the store
still holds one workbook and one session, so you cannot keep several open side
by side. See `PLAN.md` §9.

**M5.** Swaps price. The market pane now authors the three objects a
swap needs — an index built from the conventions you send, a curve
bootstrapped from live pillars, and the past fixings a leg mid-period cannot do
without — and the trade builder authors an n-leg swap with a schedule per leg.
**Load swap example** builds a five-year fixed-against-Euribor-6M swap and the
market under it; against the running backend it prices to an NPV of −0.000002
with a fair rate of 0.027000, which is exactly the 5Y pillar the curve was
stripped from. A par swap is worth nothing, and that is the whole chain —
bootstrap, index, fixings, both legs, discounting — agreeing.

It is also the first workbook that exercises the forward reference the schema
allows: the index names the curve it forecasts off, and that curve's pillars
name the index for their conventions. The topological sort handles it because
the index edge is soft in one direction and hard in the other.

A fixed leg's rate quote is drawn in amber in the quote bar and its slider is
disabled: `FixedRateLeg` takes a value rather than a handle, so the rate is
read once at construction and moving the quote does nothing until the trade is
priced again.

**M4.** All six option styles this build prices are authorable —
vanilla, barrier, double barrier, Asian, lookback and forward start — with
quanto composing over the four that take it, and the capability matrix is
complete. Nothing selectable produces an `UNSUPPORTED`: choosing a style
narrows the exercises, the payoffs, the engines and the trees to what
`session.cpp` will actually dispatch, and every closed option carries the
reason. A down-and-out call at 90 prices to 7.621701 against the vanilla's
9.297476; a fixed-strike lookback to 18.040363.

One gate was there for a defect rather than a limit: this build used to price
a **quanto lookback as a plain lookback** and report no error. That is fixed in
the backend now — it refuses by name, `test/smoke_v2.py` covers it both ways,
and the switch here saves a round trip rather than preventing a wrong number.
`PLAN.md` §8 records what it was.

**M3.** Sweeps work, which is the thing the session model exists for.
Right-click a quote, or open the sweep panel, and N prices come back off one
live graph in one frame — relative multipliers, a linear range, or explicit
values — drawn as a ladder with the quote's live value marked. Clicking a point
writes that value to the market (an explicit `UpdateMarket`, not
`keep_final_value`: a sweep is a question, not an edit). Pin a result and every
later price carries a Δ against it.

A sweep is also the one long calculation here that can actually be stopped: the
worker checks the stop flag between points, so cancelling a 1500-point
finite-difference ladder comes back "cancelled after 229 of 1500 scenario
points" with the session still live and the quote restored.

**M2.** The trade is editable, the option space is gated, and every
rejection lands on a field. An option is built as payoff x exercise x
underlying x style; choices the backend will not price are disabled and carry
the reason. Switch the exercise to American and the integral and Monte Carlo
engines close ("European only"), the approximation control appears and blocks
the price until it is answered, and `payoff_at_expiry` appears as a Flag with
no default. Send something the backend refuses — an expiry before the
evaluation date — and the reply's `field_path` highlights the control that
produced it.

One thing the UI closes that the backend does not: `HANDLERS.md` says an engine
that cannot supply a result is a named rejection rather than a missing key, but
`session.cpp:379-411` catches QuantLib's error and leaves the key out. So the
results grid lists what was asked for and marks what did not come back — an
American approximation engine publishes no greeks, and "not supplied" is not
the same as zero.

**M1.** The market is editable and the graph is live. Quotes, flat
curves and constant volatility can be added, bound and renamed; the market is
topologically sorted on the way out so nobody orders it by hand; validation
catches client-side what the backend would reject; and the quote bar at the
bottom writes to the running graph and reprices as you drag. The reference
check still holds: the `HANDLERS.md` session prices to **12.459717**.

Two things are worth trying. Drag a slider — the price follows, and the writes
coalesce so only one round trip is ever in flight. Then stop the backend and
start it again: the socket reconnects, the workbook replays into a new session,
and the trade reprices, because the *client* owns the market definition
(DESIGN §9.4).

There is no trade builder yet; the instrument is fixed and that is M2.

## Running it

```bash
# 1. the backend, from its own checkout
./build/ql-backend --port 9111

# 2. this
npm install          # also generates the Protobuf bindings
npm run dev          # http://localhost:5173
```

Then press **Run** in the acceptance panel. `VITE_WS_URL` overrides the
backend address; see `.env.example`.

The `proto/` submodule is pinned to a commit, as any schema consumer should be:
a schema change that compiles is not necessarily one that stays wire
compatible. `npm run gen` regenerates `src/gen/`, which is **not committed** —
one source of truth, no stale bindings, which is `ql-protobuf`'s own rule.

## What is where

| Path | What it holds |
| --- | --- |
| `src/protocol/client.ts` | The socket: request_id allocation, the pending registry, the stall watchdog, reconnection |
| `src/protocol/errors.ts` | `WireError`, and the classification that decides how a rejection is presented |
| `src/protocol/middleware.ts` | Mirrors every frame into the store; owns none of the protocol |
| `src/store/` | `connection`, `session`, `requests`, `results`, `wire` |
| `src/store/workbookSlice.ts` | The document the client owns, and the structural/live edit split |
| `src/market/graph.ts` | Dependencies and the topological sort |
| `src/market/validation.ts` | What the backend would reject, caught before the round trip |
| `src/protocol/capabilities.ts` | What this build prices, as data — read from session.cpp, not the table |
| `src/trade/validation.ts` | What the dispatch would reject, caught before the frame |
| `src/components/trade/` | payoff x exercise x underlying x style, and the engine block |
| `src/session/scenario.ts` | The sweep: three point forms, and its cancel |
| `src/components/trade/StyleCard.tsx` | The style oneof and its per-style fields |
| `src/components/trade/QuantoCard.tsx` | The FX leg, and where quanto does not compose |
| `src/components/trade/SwapCard.tsx` | The n-leg swap, and `LegCard.tsx` for one leg and its schedule |
| `src/components/market/` | Index, fixings and bootstrap-pillar editors |
| `src/market/swapExample.ts` | The worked swap and the market under it |
| `src/session/compare.ts` | The second session, opened, priced and closed |
| `src/store/workbookCodec.ts` | The document as canonical Protobuf JSON, and `persistence.ts` around it |
| `src/components/BottomPanel.tsx` | The sweep, Monte Carlo and compare strip |
| `src/components/scenario/` | The ladder chart and its controls |
| `src/session/ops.ts` | open, close, price, write — the operations the UI drives |
| `src/session/repricer.ts` | Slider coalescing: one write-and-price in flight |
| `src/market/handlersSession.ts` | The `HANDLERS.md` session as the seed workbook |
| `src/devtools/FrameInspector.tsx` | Both directions as canonical Protobuf JSON |

## Two things the protocol decides for you

**A session dies with its socket** (DESIGN §9.4), so the client owns the market
definition and a reconnect is a *replay*, not a resume. `workbookSlice` is that
definition; `store/listeners.ts` is the replay.

**`UpdateMarket` writes quotes and nothing else.** A curve shape or the
evaluation date is a new session, so `workbook.structureRevision` counts
structural edits and the session goes stale against it. The pane says what a
rebuild costs — `SessionOpened.bootstrap_seconds` measured the last one — and
nothing rebuilds silently.

## Tests

`TESTING.md` is the operational page: how to run each suite, and what every
check is guarding. In short, `npm test` for the unit and integration checks and
`npm run e2e` for the browser ones. The integration and end-to-end checks that need a running `ql-backend`
skip when it is absent — they do not pass.

The Playwright suite exists because of what this project has actually shipped.
Its defects were not the kind a type system or a unit test can see: a control
that dropped its first edit while still claiming to be unanswered, a column
that scrolled the whole window out from under the pointer, a chart drawn as
1970 timestamps, a picker that never fired. Every one was found by opening the
app, and every one was found by hand, which meant none of them was guarded
afterwards. `e2e/` is that pass written down, and it failed on a fresh
unmemoised selector the first time it ran.

`npm test`. One of them, `src/lib/prose.test.ts`, is unusual and worth
knowing about: it asserts that no identifier-shaped word appears in rendered
text. Two mechanical renames have leaked out of the code and into a label —
"matches HANDLERS.md" became "isReference HANDLERS.md" — and neither the
compiler nor the linter can see it. The pure logic — dependency extraction, the topological sort,
validation, and mapping a backend `market[i]` path back to the object the user
authored — is covered; the protocol layer is exercised against a real daemon
rather than a mock, which is what the reference check is.
