# Working on ql-frontend

The developer's page: what the code is, where each piece lives, what every
milestone added and what it cost. `README.md` is the page for someone who wants
to know what the application *is*, and `doc/` is the guide to using it.

The TypeScript frontend for [`qlservice`](https://github.com/markccchiang/ql-backend):
React and Redux over a binary WebSocket, Protobuf `quantlib.v2` frames, talking
to a `ql-backend` that keeps a live QuantLib object graph per session.

`UI.md` is the short guide to the interface and `TESTING.md` covers the suites
and how to run them. `PLAN.md` is the design document — the constraints the
protocol imposes on the UI, the stack decisions and why they beat the
alternatives, the gap analysis against the backend, and the milestones. Read
`ql-backend/HANDLERS.md` beside it: it is the list of what the service actually
prices, and it is narrower than the schema.

**Status: M8 — the gap list is empty.** `PLAN.md` §8 was the analysis of what
the backend did not offer this frontend, and it has been worked entry by entry
until nothing is left on it. Closing it took seven schema changes and twelve
backend commits, because the entries were not features this client wanted but
questions it could not ask: what volatility does this price imply, how does this
move in spot *and* vol, what is my whole book worth, what does a cancel actually
cost, and is anything there at all.

Three entries turned out not to be what they said. Cancellation was documented
as one mechanism and is two — every request is cancellable and only the price
differs — and the UI had been agreeing with the wrong page. "No auth, loopback
only, fine for local use" had the right conclusion about TLS and the wrong
premise about loopback: a WebSocket upgrade is not subject to the same-origin
policy, so any page in any tab could drive the service. And "no session resume,
handled by client-side replay" was a claim nothing had tested — no check here
had ever cut the socket — which held for the tab in front and not for the ones
behind it. All three are now written down with checks that would catch a
regression.

**The handshake.** The service now says what it can price:
`Hello` is answered with a `Capabilities` frame, the client asks on connect,
and `protocol/drift.ts` diffs the answer against the tables this build gates
on. Any disagreement fails a test and shows as a badge in the status bar, so a
capability going stale is no longer something a user discovers by meeting an
unexplained rejection.

**M7.** Session tabs are in: each tab holds its own workbook and its
own session, several sessions live on one socket at once, and a tab you are not
looking at keeps its graph warm. The interface is checked against WCAG 2 AA on
every end-to-end run, the bundle is split so the charts are not downloaded
until a panel is opened, and `UI.md` is the guide to the interface.

Both panels that M7 planned and could not build now work, because the backend
serves what they needed. The curve viewer draws the term structure sampled from
the handle the engine priced against rather than rebuilt here, and a swap shows
the cash flows its NPV adds up to — the sum of the present-value column is the
price, which is what makes the table worth showing.

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

**M4.** Every option style this build prices is authorable — vanilla, barrier,
double barrier, Asian, lookback, forward start, and compound since — with
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

A sweep also stops cleanly: the worker checks the stop flag between points, so
cancelling a 1500-point finite-difference ladder comes back "cancelled after 229
of 1500 scenario points" with the session still live and the quote restored.
This was taken to mean sweeps were the *only* thing here that could be stopped,
and the UI offered a cancel nowhere else. §8 established otherwise — every
request can be called off, and what differs is whether the session survives it
or is rebuilt behind you.

**M2.** The trade is editable, the option space is gated, and every
rejection lands on a field. An option is built as payoff x exercise x
underlying x style; choices the backend will not price are disabled and carry
the reason. Switch the exercise to American and the integral and Monte Carlo
engines close ("European only"), the approximation control appears and blocks
the price until it is answered, and `payoff_at_expiry` appears as a Flag with
no default. Send something the backend refuses — an expiry before the
evaluation date — and the reply's `field_path` highlights the control that
produced it.

The results grid marks what did not come back, and the service now says so
itself: `PriceResult.unavailable_results` names every kind asked for and not
supplied. An American approximation engine publishes no greeks, and "not
supplied" is not the same as zero. The grid used to deduce that by diffing;
it repeats it now.

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

## Running it

```bash
# 1. the backend, from its own checkout
./build/ql-backend --port 9111

# 2. this
npm install          # also generates the Protobuf bindings
npm run dev          # http://localhost:5173
```

Then press **run reference check** at the top of the centre column: it opens a
session on the `HANDLERS.md` market and prices it, and **12.459717** means the
whole chain is working. `VITE_WS_URL` overrides the backend address; see
`.env.example`.

The backend checks the browser's `Origin` on the WebSocket upgrade — loopback
is not a boundary against a browser, because a WebSocket is not subject to the
same-origin policy — and its defaults already include the Vite dev and preview
origins. Serve this app from anywhere else and start the backend with
`--allow-origin <that origin>`, or the socket is refused with a `403` before
the app can say anything about it.

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
| `src/store/` | One slice per file: `connection`, `session`, `tabs`, `requests`, `results`, `scenario`, `book`, `curve`, `compare`, `capabilities`, `ui`, `wire` |
| `src/store/listeners.ts` | Reconnect means resume, then replay: every tab's session, not only the visible one |
| `src/store/workbookSlice.ts` | The document the client owns, and the structural/live edit split |
| `src/market/graph.ts` | Dependencies and the topological sort |
| `src/market/validation.ts` | What the backend would reject, caught before the round trip |
| `src/protocol/capabilities.ts` | What this build prices, as data — read from session.cpp, not the table |
| `src/protocol/drift.ts` | Those tables against the `Capabilities` the service advertises |
| `src/trade/validation.ts` | What the dispatch would reject, caught before the frame |
| `src/components/trade/` | payoff x exercise x underlying x style, and the engine block |
| `src/session/scenario.ts` | The sweep: three point forms, N axes, and the partial result a cancel returns |
| `src/components/trade/StyleCard.tsx` | The style oneof and its per-style fields |
| `src/components/trade/QuantoCard.tsx` | The FX leg, and where quanto does not compose |
| `src/components/trade/SwapCard.tsx` | The n-leg swap, and `LegCard.tsx` for one leg and its schedule |
| `src/components/market/` | Index, fixings and bootstrap-pillar editors |
| `src/market/swapExample.ts` | The worked swap and the market under it |
| `src/session/compare.ts` | The second session, opened, priced and closed |
| `src/store/workbookCodec.ts` | The document as canonical Protobuf JSON, and `persistence.ts` around it |
| `src/components/BottomPanel.tsx` | The sweep, Monte Carlo and compare strip |
| `src/components/scenario/` | The ladder chart, and `AxisCard.tsx` for the second axis that makes it a grid |
| `src/components/trade/ImpliedVolatilityCard.tsx` | The price to invert, and "from last price" |
| `src/components/book/` `curve/` `cashflows/` | The three panels M7 and M8 unblocked |
| `src/components/StatusBar.tsx` | Connection, session, round trip, the cancel, and why a socket was refused |
| `src/session/ops.ts` | open, close, price, write, cancel everything, ask `/healthz` why the socket will not open |
| `src/session/tabs.ts` | A session per tab on one socket, reopened lazily when you switch back |
| `src/session/book.ts` | The book as one `PriceBatch`, and a rejection read back onto its own row |
| `src/session/curves.ts` | `curve_samples` and the cash-flow table, off the handles the engine priced with |
| `src/session/repricer.ts` | Slider coalescing: one write-and-price in flight |
| `src/market/handlersSession.ts` | The `HANDLERS.md` session as the seed workbook |
| `src/devtools/FrameInspector.tsx` | Both directions as canonical Protobuf JSON |

## Two things the protocol decides for you

**A session outlives its socket by a grace window** (DESIGN §9.4), so a
reconnect is a *resume* first and a replay second. `session/ops.ts` holds
`resumeSession`, which presents the token `SessionOpened` minted; when the
service refuses it — restarted, or too late — `workbookSlice` is the definition
that gets replayed and `store/listeners.ts` is what replays it. The fallback is
the path that must not rot: it is the only one that works when the service
remembers nothing.

**`UpdateMarket` writes quotes and nothing else.** A curve shape or the
evaluation date is a new session, so `workbook.structureRevision` counts
structural edits and the session goes stale against it. The pane says what a
rebuild costs — `SessionOpened.bootstrap_seconds` measured the last one — and
nothing rebuilds silently.

## The guide

`doc/` is the user's guide — Sphinx, MyST markdown, MathJax — and `npm run
docs` builds it into `doc/_build/html`.

It renders in the Read the Docs theme, which lives in a virtualenv of its own
rather than in whatever Python is on the machine:

```bash
python3 -m venv doc/.venv
doc/.venv/bin/pip install -r doc/requirements.txt
```

`npm run docs` uses `doc/.venv` when it is there and falls back to whatever
`sphinx-build` is on `PATH` otherwise, which builds the same pages in Sphinx's
own theme — `conf.py` picks the theme by whether it can import it. A guide that
will not build is worse than one that builds in the wrong colours.

The screenshot in `doc/images/` is the app against a live backend, and it is
worth retaking rather than editing when the layout moves.

### Two languages

The guide is built twice out of one source tree: English at `doc/_build/html`
and Traditional Chinese at `doc/_build/html/zh-tw`, with a switch in the
sidebar that keeps you on the same page. `doc/build.sh` does both and is what
`npm run docs` runs.

The English Markdown is the source; the Chinese lives in gettext catalogues
under `doc/locale/zh_TW/LC_MESSAGES/`, one per page. When the English changes:

```bash
doc/.venv/bin/sphinx-build -b gettext doc doc/_build/gettext
cd doc && .venv/bin/sphinx-intl update -p _build/gettext -l zh_TW
```

Changed paragraphs come back marked `#, fuzzy` with the old translation kept
for reference, and new ones come back empty. **An untranslated string falls
back to English**, which is the property that makes this safe to leave
half-finished: the page still builds and still reads, and nothing silently
shows a translation of a sentence that has since changed.

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

The unit suite covers the pure logic — dependency extraction, the topological
sort, validation, and mapping a backend `market[i]` path back to the object the
user authored. The protocol layer is exercised against a real daemon rather than
a mock: `PLAN.md` §10 records why the planned fixtures and mock socket server
were dropped in favour of that, and the one path it leaves untested.

One check is unusual and worth knowing about. `src/lib/prose.test.ts` asserts
that no identifier-shaped word appears in rendered text, because two mechanical
renames have leaked out of the code and into a label — "matches HANDLERS.md"
became "isReference HANDLERS.md" — and neither the compiler nor the linter can
see that class of defect.
