# ql-frontend — Requirements and Design Plan

The TypeScript/React/Redux frontend for `qlservice`. Talks to `ql-backend`
(`ws://127.0.0.1:9111`) with Protobuf `quantlib.v2` frames over a binary
WebSocket, schema from the [`ql-protobuf`](https://github.com/markccchiang/ql-protobuf)
submodule.

Read `ql-backend/HANDLERS.md` first: it is the flat list of what the service
actually prices, and it is *narrower than the schema*. Everything the schema
expresses and the build does not price comes back as `UNSUPPORTED` naming the
field. The single biggest job of this frontend is to never let a user build one
of those requests by accident.

---

## 1. The eight backend facts that shape the UI

Each of these is a UI decision the protocol has already made for us.

1. **`session_id` is connection-scoped** (DESIGN §9.4). A dropped socket closes
   every session on it; a reconnecting client gets new ids and cannot resume.
   → *The client is the source of truth for the market definition.* The Redux
   store holds a **workbook**; the live session is a derived, disposable
   resource we can rebuild at any time. Reconnect ⇒ replay, not resume.

2. **Two speeds of edit.** `UpdateMarket` writes *quotes only*; anything that
   changes graph structure (a curve shape, a new index, the evaluation date) is
   a new session. → The UI must make the two visually distinct: a quote edit is
   live and free, a structural edit costs a rebuild whose price is reported in
   `SessionOpened.bootstrap_seconds`.

2. **Anything varying is a quote id, never a literal.** `Number` is
   `quote_id | fixed`. → Every numeric market input is a two-state control:
   *fixed* or *bound to a named quote*. Bound quotes get a slider. This is what
   "interactive" means here, and it is worth designing the whole left pane
   around.

3. **Market objects must arrive in dependency order** (one exception:
   `Index.forwarding_curve_id` may forward-reference). → The user must never
   order them by hand. We hold a DAG, topologically sort on send, and detect
   cycles/dangling ids client-side.

4. **Zero is `*_UNSPECIFIED` and is rejected; a `Flag` is not a `bool`.** →
   No control may have a silent default. A `Flag` renders as a three-state
   segmented control with nothing preselected — never a checkbox, because an
   unticked checkbox is exactly the silent `FLAG_FALSE` the schema exists to
   prevent.

5. **Errors carry a dotted proto path and, for `UNKNOWN_ID`, `known_ids`.** →
   Server-driven form validation: every input registers its proto path
   (`instrument.option.barrier.level`), errors focus and highlight it, and an
   unknown id renders the known ones as a one-click fix.

6. **One terminal frame per request; `Progress` is the only non-terminal one.**
   → A request registry keyed on `request_id`, with cancel, progress and a
   watchdog. Note that `Progress` (and therefore *working* cancellation) exists
   only for a **batched Monte Carlo**, and that batching **changes the price**.

8. **`PriceResult` echoes the `Engine` as it ran.** → Results are comparable
   artifacts, not numbers on a screen. Every result card shows its as-run engine
   and can be pinned as a baseline to diff against.

---

## 2. Stack decisions

**Settled 2026-09-02:** `@bufbuild/protobuf` v2 for codegen, Mantine 7 for
components, and M0-M3 (scaffold -> market -> vanilla pricing -> sweeps) as the
first deliverable. The table below keeps the alternatives on record so the
reasoning survives.

| Layer | Recommendation | Alternative considered | Why |
| --- | --- | --- | --- |
| Build | **Vite 6 + TS strict** | Next.js | No SSR value: this is a stateful socket app behind a desk. Vite's dev proxy fronts `:9111`. |
| UI runtime | **React 19** | — | |
| State | **Redux Toolkit + listener middleware** | RTK Query, Zustand | RTK Query is request/response-shaped; we need one socket, correlated ids, progress frames and cancellation. A hand-written `wsMiddleware` + `requests` slice is ~200 lines and models the protocol exactly. |
| Protobuf | **`@bufbuild/protobuf` v2 + `protoc-gen-es` (buf as an npm dev-dep)** | `ts-proto` | protobuf-es gives `oneof` as a discriminated union (`{case:'openSession', value}`) — which *is* the domain model here — plus exhaustive `switch`, canonical JSON (free workbook persistence), and a runtime descriptor set we can drive forms from (§6). `ts-proto` produces flatter interfaces but loses the descriptors. |
| Component kit | **Mantine 7** (or MUI 6) | Tailwind + shadcn | Dense forms, number inputs, tables, tri-state segmented controls, dark theme — all present. Hand-rolling those is the whole budget. |
| Charts | **uPlot** for ladders/convergence, **ECharts** for surfaces | Recharts | Sweep charts redraw on every slider release; uPlot handles 10k points at 60 fps. ECharts only where a 3-D/heatmap surface is needed. |
| Tables | **TanStack Table** | — | Greeks grid, cashflow table, blotter. |
| Forms | **Path-addressed store, no form library** | RHF, Formik | Field identity must be the *proto path* so backend `field_path` errors bind (§1.6). A form library owns field identity and fights that. |
| Tests | **Vitest + RTL**, **Playwright** E2E against the real daemon | — | The backend already ships a working binary and `smoke_v2.py`; E2E against it is cheap and is the only thing that catches capability drift. |
| Format / lint | **The house config**: `carta-frontend`'s `.prettierrc.json` and `eslint.config.mjs`, copied rather than reinvented | a fresh Prettier/ESLint setup | This was missing from the first cut of this plan and had to be retrofitted after four milestones of code had been written in a different dialect. A repo's style is not a decision to make per project. |

Toolchain present on this machine: Node 25.8.1, npm 11.11.0, `protoc` 34. `buf`
is not installed — pull it as `@bufbuild/buf` so codegen is `npm run` and not a
machine setup step.

**Generated code is not committed**, matching `ql-protobuf`'s own rule: one
source of truth, no stale bindings. `npm run gen` (a `prepare` hook) emits into
`src/gen/`, which is gitignored.

---

## 3. Repository layout

```
ql-frontend/
  proto/                      # submodule: ql-protobuf, PINNED TO A COMMIT
  buf.gen.yaml                # protoc-gen-es -> src/gen
  src/
    gen/                      # generated, gitignored
    protocol/
      socket.ts               # WebSocket, binaryType='arraybuffer', reconnect
      middleware.ts           # frames <-> actions, request registry
      requests.ts             # request_id allocation, terminal/progress/cancel
      replay.ts               # workbook -> OpenSession + UpdateMarket sequence
      capabilities.ts         # the support matrix of HANDLERS.md, as data
    store/
      workbook/               # the document: evaluation date, market, trades
      session/                # connection + session lifecycle, dirty tracking
      requests/               # in-flight
      results/                # last result + pinned baselines + scenarios
      ui/                     # layout, selection, field errors by proto path
    market/                   # left pane: quotes, curves, vol, indices, fixings
    trade/                    # centre: payoff x exercise x underlying x style
    engine/                   # centre: method -> parameter block
    results/                  # right: NPV, greeks, engine echo, charts
    quotes/                   # bottom: the live quote bar (sliders)
    devtools/                 # frame inspector, Python-snippet export
    lib/                      # units, dates, formatting, topo sort
  test/
    fixtures/                 # frames captured from smoke_v2.py runs
  PLAN.md  README.md  UI.md
```

---

## 4. The workbook: what the client owns

```ts
interface Workbook {
  id: string;
  label: string;                  // -> OpenSession.client_label
  evaluationDate: string;         // ISO
  market: MarketObjectDraft[];    // proto JSON + UI metadata (position, notes)
  quoteOverrides: Record<string, number>;  // live values, replayed after reopen
  fixings: FixingSeriesDraft[];
  trades: TradeDraft[];           // Instrument + Engine + requested ResultKinds
  baselines: Record<string, PriceResultJson>;
}
```

Because protobuf-es round-trips canonical JSON, the workbook **is** the wire
format. That buys three features for free:

- **Persistence** to IndexedDB, so a refresh loses nothing but the socket.
- **Import/export** a `.qlwb.json` file — a reproducible, shareable pricing case.
- **Replay**: `replay.ts` turns a workbook into exactly `OpenSession` +
  `UpdateMarket` + `PriceRequest`, which is also what reconnection runs.

Session state machine, surfaced in the status bar:

```
disconnected -> connecting -> connected
                                 |
              (workbook dirty)   v
     idle -> opening -> live -> stale(structural edit) -> opening -> live
                          |
                          +-- pricing / sweeping (n in flight)
```

`stale` is a first-class state, not an error: the market pane shows an amber
"structure changed — rebuild (last bootstrap 0.42 s)" bar with a rebuild button,
and an auto-rebuild toggle for when bootstrap is fast.

---

## 5. The protocol layer

- **One socket, several sessions.** The backend explicitly supports it, so
  the app supports **session tabs**: two evaluation dates, or two vol surfaces,
  with the same trade, side by side. This is the cheapest differentiating
  feature in the plan.
- **Request registry.** `request_id` is a monotonically increasing `bigint`,
  never reused. Each entry holds `{kind, sessionId, startedAt, progress,
  resolve, reject}`. Every `ServerFrame` with `terminal=true` settles exactly
  one. A watchdog flags any request with no frame for N seconds — a missing
  terminal frame is a backend bug and should be visible, not a hang.
- **Cancellation.** `CancelRequest` is offered on any in-flight request, but the
  UI is honest about what it does: work is only actually interrupted at a Monte
  Carlo batch boundary (DESIGN §3 — workers are threads today, so a kill only
  disowns). An FD or lattice price runs to completion; the button says
  "stop waiting" there, not "cancel".
- **Reconnect** with exponential backoff; on open, replay every live workbook,
  then re-price the selected trade. Toast: "session rebuilt in 0.42 s".
- **Backpressure.** Nothing to do client-side beyond reading fast, but note the
  4 MB inbound frame cap: a `VarianceSurface` with a large grid is the one
  message that can approach it. Validate size before send and say so.
- **Frame inspector** (dev drawer, shipped in production behind a toggle): the
  exact `ClientFrame`/`ServerFrame` JSON, with a **"copy as Python"** button
  emitting the `HANDLERS.md` idiom. For a pricing tool this is trust
  infrastructure — a quant who disagrees with a number needs to see the request.

---

## 6. The highest-leverage idea: schema-driven forms with a capability overlay

`instrument.proto` is 560 lines of nested `oneof`s. Hand-writing a form per arm
is weeks of work that goes stale the next time the schema moves.

**Approach:** a generic renderer walks the protobuf-es *descriptor*:

- `oneof` → a selector plus the chosen arm's fields
- `enum` → a select with no default; `*_UNSPECIFIED` is never an option
- `Flag` → tri-state segmented control, nothing preselected
- `Number` → the fixed/quote-bound control of §1.3
- `quantlib.v1.Date` → an ISO date input; `Calendar`/`DayCounter` → bespoke
  composite controls (they are messages with required sub-conventions)
- `repeated` → an editable table

Over that sits two data layers, both plain TypeScript tables:

1. **`capabilities.ts`** — HANDLERS.md as data: which `style × exercise ×
   method × quanto` combinations build, which trees a barrier accepts, which of
   the 24 `ResultKind`s the 16 supported ones are, which market shapes are live
   vs frozen vs unbuilt. It drives *disabling with a reason*: every greyed
   control carries the sentence from HANDLERS.md explaining itself
   ("QuantLib's barrier lattice takes Cox-Ross-Rubinstein only").
2. **`overrides/`** — bespoke components for the ~20 fields that deserve them:
   strike (with moneyness readout), barrier level (drawn against spot), the MC
   panel, the FD grid presets, the schedule builder.

Result: the vanilla-option hot path feels hand-built; the long tail (swap legs,
variance surfaces, pillars) renders for free and keeps up with schema changes.

This is a recommendation, not a certainty — the risk is a generic renderer that
feels generic. Mitigation: build the hot path bespoke in M2 *first*, and let the
generic renderer serve only what the bespoke layer has not reached.

---

## 7. UI design

### Layout — a workbook, four panes

```
┌───────────────────────────────────────────────────────────────────────┐
│ Session tabs: [Base 2026-09-01] [Shocked +1d] [+]      ● live  4.2 ms │
├──────────────────┬──────────────────────────────┬─────────────────────┤
│ MARKET           │ TRADE                        │ RESULTS             │
│ ─ Quotes         │ ┌─payoff─┐┌─exercise─┐       │   NPV  12.459717    │
│   S   100.00 ●   │ │ call   ││ European │       │   ────────────────  │
│   R   5.00 %     │ │ K 100  ││ 2027-09-01       │   delta      0.5216 │
│   V   20.0 %     │ └────────┘└──────────┘       │   gamma      0.0195 │
│ ─ Curves         │ ┌─underlying──┐┌─style─┐     │   vega      37.52   │
│   RC  flat on R  │ │ S/RC/QC/VOL ││vanilla│     │   ────────────────  │
│   QC  flat on Q  │ └─────────────┘└───────┘     │   engine: analytic  │
│ ─ Volatility     │ ┌─engine──────────────┐      │   0.31 ms  ⚲ pin    │
│   VOL constant   │ │ analytic ▾          │      │  ┌────────────────┐ │
│ [graph view]     │ └─────────────────────┘      │  │ sweep chart    │ │
│ ⚠ structure      │ results: NPV ✓ Δ ✓ Γ ✓ ν ✓   │  └────────────────┘ │
│   changed        │              [Price] [Sweep] │                     │
├──────────────────┴──────────────────────────────┴─────────────────────┤
│ S ├──────●────────┤ 105.00   R ├──●──────┤ 5.00%   V ├───●───┤ 20.0%  │
└───────────────────────────────────────────────────────────────────────┘
```

The bottom **quote bar** is the product. Everything above it describes a
calculation; that strip is what a user actually drags for an hour.

### Twelve UX principles

1. **Make the two edit speeds visible.** Live quote edits are green and
   instantaneous. Structural edits turn the market pane amber and offer a
   rebuild with its measured cost. Never rebuild silently — the user should
   learn which edits are cheap.
2. **Compose, don't fill in a form.** An option is *payoff × exercise ×
   underlying × style*; render four adjacent cards, not a scrolling form. The
   schema's shape is the best information architecture available and it was
   derived from QuantLib's own decomposition.
3. **Progressive narrowing.** Choosing the style collapses everything
   downstream: pick `barrier` + `American` and the method select offers only
   lattice and FD, with analytic greyed and captioned "analytic barrier is
   European only". The user should be unable to author an `UNSUPPORTED`.
4. **No silent defaults, and say what is missing.** A "3 required fields"
   chip next to the Price button, clicking it jumps to the first. This mirrors
   the backend's `UNSPECIFIED_ENUM` discipline into the form so it is caught
   before the round trip.
5. **Three error presentations, because there are three error meanings.**
   `UNSPECIFIED_ENUM` → "fill this in", inline on the field.
   `INVALID_ARGUMENT` → "this value cannot work", inline with the constraint
   (`0 < lower < upper`). `UNSUPPORTED` → a panel, not a field error: "this
   build does not price it", with the HANDLERS sentence and what to change.
   Infrastructure codes (`WORKER_DIED`, `OVERLOADED`) → a toast with retry.
   `UNKNOWN_ID` → the `known_ids` list as clickable fixes.
6. **Latency honesty and adaptive repricing.** Watch
   `PriceResult.calculation_seconds` + round trip. Under ~150 ms, sliders
   reprice continuously (debounced 16 ms, one in flight, coalesce). Above it,
   the slider switches to reprice-on-release and says why. An FD `FINE` grid or
   a 10⁶-path MC is not a slider.
7. **Sweeps are the flagship, and they are one gesture.** Right-click any quote
   → "sweep ±20%, plot delta" → `Scenario{relative}` with `plot=DELTA`, drawn
   as a ladder. `keep_final_value` stays off and is never wired to a chart
   click; "apply this value to the market" is an explicit, separate
   `UpdateMarket`. A sweep is a question, not an edit — the schema says so and
   the UI should not blur it.
8. **Reproducibility on the face of the result.** Show the echoed engine, the
   seed, the sample count, `calculation_seconds`, and for MC the ±1.96·SE band
   as an error bar on the NPV. "Pin as baseline" adds a Δ column to every
   subsequent result.
9. **Cancellation only where it is real.** The MC card's progress checkbox is
   labelled "report progress and allow cancel — *changes the price*", because
   `progress_every_paths` alters the RNG draw. Reproducibility keys on
   `(seed, samples, progress_every_paths)`; show all three.
10. **Quant-shaped numeric input.** Unit-aware from `Quote.Unit`: rates and
    vols display as % while the wire stays decimal, bp quotes as bp; ↑/↓ nudge,
    shift ×10, alt ÷10; slider ranges defaulted per unit (rate 0–20 %, vol
    0–150 %, spot ±50 % of the opening value) and user-adjustable.
11. **Two traps deserve explicit UI.** A fixed swap leg freezes its rate at
    construction, so its bound quote's slider must be disabled with "a fixed
    leg's rate is read once — reprice to change it". And omitting
    `dividend_curve_id` means a **zero** dividend yield, not the risk-free
    curve; the underlying card states the effective yield rather than leaving
    the field blank.
12. **Dark by default, colourblind-safe diffs, keyboard-complete.** This is a
    tool people stare at all day; red/green Δ columns must survive deuteranopia
    (use direction glyphs plus colour).

### Panels, in build order of value

| Panel | Contents | Backend support today |
| --- | --- | --- |
| Quote bar | every live quote, slider + input, unit-aware | full |
| Market pane | quotes, flat/zero/discount/bootstrap curves, constant & variance vol, indices, fixings; DAG view | full for the four curve shapes, three vol shapes, two index families |
| Trade builder | option: 7 payoffs × 3 exercises × 6 styles × quanto; swap: fixed + Ibor legs | full |
| Engine card | analytic/lattice/FD/MC/integral/discounting, per-method params | full |
| Results grid | NPV + 16 result kinds + additional results | full |
| Sweep chart | ladder over a quote, one plotted kind | full |
| MC monitor | progress, running NPV, running SE, convergence trace, cancel | batched MC only |
| Curve/surface viewer | plot the curve the backend priced with | **blocked** — `curve_samples` is `UNSUPPORTED` |
| Cashflow table | per-leg rows, PV reconciliation | **blocked** — `include_cashflows` is `UNSUPPORTED` |
| Frame inspector | wire JSON, copy-as-Python | full |

---

## 8. What is missing, and what to ask the backend for

Gap analysis against the schema and the running build. Ordered by what it costs
this frontend.

1. **One instrument per `PriceRequest`.** A blotter of 40 trades is 40 frames
   serialized on one worker thread. Acceptable at desk scale; show queue depth
   in the status bar and reconsider a batch request if it becomes the wait.
2. **Cancellation interrupts more than the documentation says.** HANDLERS.md
   states that `Progress` "arrives only from a batched Monte Carlo" and is the
   only point at which a calculation can be stopped. A **scenario sweep** also
   emits `Progress` per point and checks the stop flag between them
   (`worker.cpp:245-257`), so a sweep is cancellable — confirmed live:
   "cancelled after 229 of 1500 scenario points", session still alive. Only the
   single engine call in the middle of one point cannot be interrupted. The UI
   offers cancel where it works and says nothing where it does not, but the
   page understates the service.
3. **No session enumeration or resume**, by design (DESIGN §9.4). Handled by
   client-side replay (§4); no backend change requested.
4. **No auth, loopback only.** Fine for local use. If this is ever hosted, TLS
   termination, auth and origin checks are all out of scope in the backend and
   would need a proxy in front — worth deciding before anyone demos it off the
   machine.
5. **No health/version HTTP endpoint.** The socket connecting is the only
    liveness signal; a `GET /healthz` would let the dev proxy and any future
    container orchestration do something sensible.

Things I checked and found **not** missing: the `Flag`/`*_UNSPECIFIED`
discipline, the error `field_path`, `known_ids`, the engine echo, the
`ScenarioResult.series` pre-shaping, `Progress.running_standard_error`, and
`SessionOpened.market_ids`. Each of those exists specifically to let a frontend
do something better, and each is used above.

---

### Fixed rather than requested

**A sweep moved one quote.** Asking how a price moves in spot *and* vol meant
one sweep per value of the second quote: N round trips, N progress streams and
N restores, all against a graph that was already warm and that none of them
changed. The note here said a `repeated Scenario` would halve the frames. It
does better than that — a grid is one frame — and the reason to do it rather
than loop in the client is that the client's loop cannot be cancelled as one
thing, cannot report progress as one thing, and gets the restore wrong if any
frame in the middle fails.

`PriceRequest.scenarios` is repeated, on the tag the singular field used: a
singular message field parses as a one-element repeated one, and a sweep of one
quote is a grid with one axis. Axes sweep as a *product*, row-major with the
last varying fastest, which is the order `DoubleMatrix` already documents, so
two axes and a plot kind fill a `ScenarioResult.surface` whose labels are the
axis values and nothing needs rearranging on arrival.

What it deliberately is not is a lockstep shift — move these three quotes
together. That is a market edit with an undo, which `UpdateMarket` already does,
and folding it into the same message would make the common case ambiguous.

Three rules a grid adds, each refused on its own axis path before a quote is
written: a quote may appear on one axis only (the later write would win at every
point and the earlier axis would silently move nothing), only the first axis may
set `plot`, and the product must fit `Capabilities.max_scenario_points` —
because a product multiplies, and three innocent 200-step axes are eight million
engine calls.

The panel draws a grid as a **family of lines**, one per value of the second
axis, rather than as a heat map: reading a price off a colour is guessing and
reading it off a line is not. It also says the point count before the run —
`S × V = 27 prices, one request` — and refuses to send one over the ceiling the
handshake advertised.

Two defects fell out of building it. The sweep panel's own **run** button
dispatched the *toggle* the top strip uses, so running a sweep closed the panel
it was about to draw into; it shows the panel now instead of toggling it. And
uPlot does not count its legend in the height it is given, which one series
nearly got away with and a family of them did not — the canvas gives the legend
rows back now.


**`RESULT_KIND_IMPLIED_VOLATILITY` was in the enum and not mapped.** It could
not have been: inverting a price needs a target price, and nothing in
`PriceRequest` was one. The only thing the old shape could have returned is the
volatility the client sent in, which is why the gap survived so long — it looks
like a missing `case` in a switch and is actually a missing field.

`PriceRequest.implied_volatility` carries the target now, with the bracket and
tolerance optional. The solve is QuantLib's own `Instrument::impliedVolatility`
rather than a search built here, and whether an instrument has one is a trait
for the same reason the quanto greeks are: the method is declared on
`VanillaOption`, `BarrierOption` and `DoubleBarrierOption` and on no base they
share. Asked of any other style the kind comes back in `unavailable_results`,
like any other result an engine cannot supply.

Asked for with no target the request is refused rather than answered, because
the alternative is a circle: invert the price this request is about to compute
and the answer is the volatility that was sent. The frontend says so before the
frame, and offers the last price as one click — which is the question this is
actually for ("what vol does *this* price imply?"). The round trip is closed in
both suites: price the seed option, hand the price back as the target, and the
volatility that comes out is the 0.2 the market holds.


**An unsupported result kind was a missing key rather than a named anything.**
`HANDLERS.md` promised a rejection and `session.cpp` swallowed QuantLib's error,
and the two had disagreed since the beginning. The document was right about the
problem — a client that asked for vega and got a map without it cannot tell
that from a vega of zero — and wrong about the remedy, because a rejection
costs the price as well: ask a lattice for vega and you lose the NPV you also
asked for, and a client that wanted a number would learn to ask for nothing.

The absence is named on the result instead. `PriceResult.unavailable_results`
carries every kind asked for and not supplied, and the price comes with it. The
frontend used to infer this by diffing what it asked for against what came
back; that guess is gone, and the "not supplied" row now repeats what the
service said. An American Barone-Adesi price returns its NPV and names delta,
gamma and vega absent, which is exactly what the results grid had been deducing
since M2.


**`include_cashflows` was `UNSUPPORTED`,** so a swap showed an NPV with no
working. It is served for cash-flow instruments now, and the reason the table
is worth having is a property rather than a list of numbers: the sum of its
present-value column is the NPV, exactly, because each row's discount is the
one the engine used rather than one recomputed here. The backend's suite checks
that sum.

Asked of an option it stays `UNSUPPORTED`. An empty table would read as an
instrument that happens to have no cash flows rather than one that was never
going to have any — the same distinction that keeps a missing greek from being
reported as a zero.


**`curve_samples` was `UNSUPPORTED`,** so the curve viewer stayed designed and
disabled through six milestones. It is served now: each sample names a market
object and a quantity and comes back as a `Series`, taken off the very handle
the engine priced against. That is the point of it — the alternative is
shipping the term structure and re-implementing QuantLib's interpolation in
TypeScript, and then drawing a curve nothing was priced with.

Four quantities are built: zero rate, forward rate, discount factor and black
volatility. The backend's own suite checks the result by consistency rather
than against a constant — the discount factors must equal exp(-z t) for the
zero rate the same curve reports — and because the live-graph section has
already written that quote by then, a sample that failed to follow it would
fail there.


**There was no capability handshake.** The support matrix here had to be
hand-kept in sync with `HANDLERS.md`, and a copy drifts: the client would go on
offering something the service had stopped pricing, or hide something it had
learned, and the only way to find out was a user meeting an unexplained
rejection.

`Hello` and `Capabilities` now exist. It is a request rather than a frame
pushed on connect, because everything else in this protocol is a request and an
unsolicited frame would be the only one a client could not account for. The
reply carries **sets** — styles, methods, trees, approximations, result kinds,
market shapes, leg kinds — and not the combinations, because whether an
analytic barrier takes an American exercise is a rule about a pair and there
are more pairs than belong on a wire. `protocol/capabilities.ts` still holds
those rules; what it no longer holds alone is the list of what exists.

`protocol/drift.ts` diffs the two and `drift.integration.test.ts` fails on any
disagreement, so drift is now a red test rather than a support question. The
first thing it reported was a fault in the comparison rather than real drift:
`floating` is a payoff the service builds and only a lookback may take, so
diffing against the base payoff table rather than the union across styles
claimed a mismatch that was not there. Sets and combinations are different
things, and the check has to know which it is looking at.


**A quanto lookback used to be priced as a plain one.** The lookback arm built
its engines on `graph.process` and never consulted `graph.quanto`, so the FX
adjustment was dropped: no `UNSUPPORTED`, no error, just a number for a
different trade. It was the one place the service answered on a substitute,
which is the failure mode the whole schema exists to prevent, and it led this
list.

`HANDLERS.md` had said quanto was unavailable on a lookback all along, so the
fix was to make the code agree: one `QLS_FIELD_REQUIRE` on `graph.quanto` in
that arm, phrased like the Asian one beside it. QuantLib has no quanto lookback
instrument to carry the results and no reference value to check one against, so
refusing by name is the honest answer rather than building a path nothing
verifies.

`test/smoke_v2.py` now covers it both ways — the quanto form is refused at
`instrument.option.quanto`, and the plain form still prices, so the refusal is
about the FX leg rather than about lookbacks. The frontend keeps its gate,
which now saves a round trip rather than preventing a wrong number.

## 9. Milestones

| # | Deliverable | Proves |
| --- | --- | --- |
| **M0** ✅ | `git init`, proto submodule pinned, buf codegen, Vite/RTK skeleton, socket + request registry, status bar, frame inspector | the `HANDLERS.md` session opens and `SessionOpened` renders |
| **M1** ✅ | Market pane: quotes, flat curves, constant vol; DAG + topo sort + validation; quote bar with sliders; `UpdateMarket`; the workbook and its replay on reconnect | the slider moves and the graph is live |
| **M2** ✅ | Trade + engine (vanilla, European/American/Bermudan; analytic/lattice/FD/integral), capability gating, results grid, full error mapping to proto paths | 12.459717 on screen, and every rejection lands on a field |
| **M3** ✅ | Sweeps: `Scenario` all three point forms, ladder chart, baselines and Δ, and a cancel that works | the reason the backend is stateful |
| **M4** ✅ | Remaining styles (barrier, double barrier, asian, lookback, forward start) + quanto + the capability matrix complete, and the Monte Carlo parameter block | no user-authorable `UNSUPPORTED` |
| **M5** ✅ | Swaps: legs, schedules, indices, fixings, bootstrapped curves, and a worked example that prices to par | the largest form surface |
| **M6** ◑ | Monte Carlo progress, convergence trace and the batching that enables them; workbook persistence, import/export; comparing two sessions on one socket. **Session tabs are not done** — see below | the long-running path and the document story |
| **M7** ◑ | Session tabs, a11y pass, perf pass, `README.md` + `UI.md`. Curve and cash-flow panels stay blocked at the backend | ship |

**What M7 did with the tabs refactor.** Keying the workbook, session and
results slices by a tab id would have meant rewriting every reducer and every
selector to read an active id — a large change for a feature that only needs
the state to be *somewhere* while you are not using it. Instead the active tab
lives in those slices as it always did, and the others live as snapshots in a
`tabs` slice, swapped in and out on a switch. Three `restored` reducers and a
thunk, against a refactor that would have touched every milestone before it.

The one thing that did have to change is the middleware: it mirrors every frame
into the store, so a price finishing in a parked tab would have landed in the
pane of the tab in front of the user. Replies are now matched against the
active session.

**What M6 left.** Comparing two sessions is built and checked against the
daemon, which is the capability "session tabs" existed to exercise. Keeping
several sessions open side by side is a different thing: it means the workbook,
session, results and request state all become keyed collections, and every
component has to read an active id. That is the largest refactor in the project
and it would touch every milestone before it, so it is M7's opening move rather
than something to bolt on at the end of M6.

M0–M3 is the demonstrable core: open, bump, price, sweep.

---

## 10. Testing

- **Contract fixtures.** Capture real `ClientFrame`/`ServerFrame` pairs from a
  `smoke_v2.py` run into `test/fixtures/`. Unit-test every request builder
  against them — this is what stops the frontend from drifting off the 209
  reference rows the backend already verifies.
- **Vitest + RTL** for slices, selectors, the topo sort, unit formatting, and
  the error-path → field binding.
- **A mock socket server** in Node using the same generated code, for
  progress/cancel/reconnect/`WORKER_DIED` paths that are hard to provoke live.
- **Playwright E2E** against a real `./build/ql-backend --port 9111`: open,
  price the reference, run a batched Monte Carlo to completion, compare two
  sessions, reload and confirm the workbook survived. Skipped, not passed, when
  the daemon is absent.

  Two invariants in it are worth naming, because both were shipped defects
  rather than hypotheticals. Every check asserts the page reported **no console
  errors**, which is where unmemoised selectors announce themselves — the suite
  found a third one on its first run. And every check asserts the **window
  itself does not scroll**: the panes scroll, the frame does not, and when that
  broke every control moved out from under the pointer mid-interaction.

## 11. Risks

| Risk | Mitigation |
| --- | --- |
| Capability matrix drifts from the build | ask for the handshake (§8.1); until then, an E2E test that asserts every "supported" combo actually prices |
| Generic renderer feels generic on the hot path | bespoke components first, generic only for the tail (§6) |
| Slider latency on FD/MC | adaptive repricing (§7.6), one request in flight per trade, coalesce |
| Session lost mid-work | workbook is client-owned and persisted; replay is a first-class code path tested in CI, not an afterthought |
| Proto submodule moves under us | pin the commit, regenerate in `prepare`, and fail the build on a descriptor diff that touches a field the UI binds |
| Scope: the schema is far larger than the build | ship M0–M3 against the vanilla path before touching swaps |
