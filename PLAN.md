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
| Protobuf | **`@bufbuild/protobuf` v2 + `protoc-gen-es` (buf as an npm dev-dep)** | `ts-proto` | protobuf-es gives `oneof` as a discriminated union (`{case:'openSession', value}`) — which *is* the domain model here — plus exhaustive `switch`, canonical JSON (free workbook persistence), and a runtime descriptor set to drive forms from — which went unused, for a reason that does not change this choice (§6). `ts-proto` produces flatter interfaces but loses the descriptors. |
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
    protocol/                 # the wire, and what it is allowed to carry
      client.ts               # WebSocket, binaryType='arraybuffer', request registry
      middleware.ts           # frames <-> actions, request_id allocation, cancel
      capabilities.ts         # the support matrix of HANDLERS.md, as data
      drift.ts                # those tables against the handshake
      errors.ts               # Error.Code -> a class, and the remedy to show
    store/                    # one slice per file, no subdirectories
      workbookSlice.ts        # the document: evaluation date, market, trades
      workbookCodec.ts        # <-> canonical JSON, for persistence and tabs
      sessionSlice.ts         # session lifecycle and dirty tracking
      connectionSlice.ts      # socket state, url, /healthz diagnosis
      tabsSlice.ts            # several workbooks, each with its own session
      requestsSlice.ts        # in-flight, by request_id
      resultsSlice.ts         # last result, pinned baselines, named absences
      scenarioSlice.ts        # sweep axes and their outcome
      bookSlice.ts curveSlice.ts compareSlice.ts capabilitiesSlice.ts
      uiSlice.ts              # layout, selection, field errors by proto path
      listeners.ts            # reconnect means replay (DESIGN §9.4)
      persistence.ts selectors.ts hooks.ts rootReducer.ts index.ts
    session/                  # what a request means: building one, reading one back
      ops.ts                  # price, cancel everything, diagnose the socket
      repricer.ts             # one request in flight per trade, coalesced
      tabs.ts book.ts compare.ts curves.ts scenario.ts referenceCheck.ts
    market/                   # domain logic, not UI: the graph and its rules
      model.ts graph.ts       # objects, dependency extraction, topological sort
      validation.ts           # the rules, and market[i] -> the object authored
      handlersSession.ts swapExample.ts
    trade/                    # domain logic: the rules, and how to name a trade
      validation.ts describe.ts
    components/               # all of the UI, grouped by the panel it draws
      MarketPane.tsx trade/   # left pane; centre: payoff/exercise/style/engine
      ResultPane.tsx          # right: NPV, greeks, engine echo
      QuoteBar.tsx            # the live quote bar (sliders)
      BottomPanel.tsx         # the strip, with scenario/ mc/ compare/ in it
      curve/ cashflows/ book/ # the panels M7 and M8 unblocked
      TabBar.tsx StatusBar.tsx WorkbookBar.tsx SessionPanel.tsx
      market/ conventions/    # the editors the panes are built from
    devtools/                 # frame inspector, Python-snippet export
    lib/                      # units, enum labels, formatting
  e2e/                        # Playwright specs and the strict console fixture
  doc/                        # the user's guide: Sphinx, MyST markdown, MathJax
  README.md                   # what the application is, for a reader
  DEVELOPING.md               # what the code is, for someone changing it
  PLAN.md  UI.md  TESTING.md
```

Three things about this differ from what was planned here, and each is a
decision rather than a drift.

**State is flat.** The plan grouped slices into `store/workbook/`,
`store/session/` and so on. Every one of those turned out to be a single file,
and a directory holding one file is a directory that has to be opened to find
out it holds one file.

**Logic and rendering are separated by kind, not by pane.** The plan named the
top-level folders after the four panes. What actually happened is that
`market/` and `trade/` kept the rules — validation, the dependency graph, how
to describe a trade — with no React in them, and every component moved under
`components/`. The rules are the part with tests and the part the backend can
contradict; the panes are an arrangement, and they were rearranged twice.

**`session/` was not planned at all.** It is the layer that turned out to be
missing: building a request from the workbook and reading its reply back into
the store, for each shape of request this client sends. `protocol/` is too low for it
(it knows frames, not trades) and the slices are too high (a reducer cannot
send). Nearly everything §8 added landed here.
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

## 6. The idea that turned out not to be needed: schema-driven forms

**What this section proposed.** `instrument.proto` is 560 lines of nested
`oneof`s, and hand-writing a form per arm looked like weeks of work that would
go stale the next time the schema moved. The answer was a generic renderer
walking the protobuf-es *descriptor* — `oneof` → a selector plus the chosen
arm's fields, `enum` → a select with `*_UNSPECIFIED` never offered, `repeated`
→ an editable table — under two data layers: `capabilities.ts` holding
HANDLERS.md as data, and an `overrides/` directory of bespoke components for
the twenty or so fields that deserved them.

**What was built.** The capability layer, and nothing else.
`src/protocol/capabilities.ts` is 542 lines and is precisely what this section
asked for: every closed choice carries the sentence that explains it
("AnalyticDoubleBarrierEngine prices knock-in and knock-out only", "There is no
quanto lookback engine in QuantLib, and the backend refuses it by name"), and
`ChoiceSelect` renders a closed option *visible and disabled* rather than
hiding it, so a user is never left wondering whether the service cannot do it
or they cannot find it.

The renderer was never written. `overrides/` does not exist, because there is
nothing for it to be an exception to. The whole trade builder — eleven
components from payoff through engine, including the swap legs that were meant
to be the generic tail — is 1,419 lines.

**Why the estimate was wrong.** A descriptor describes the *schema*. A form has
to describe *what this build can price*, and those are very different sets: the
second is a small fraction of the first, and the difference is exactly what
`capabilities.ts` enumerates. A faithful descriptor walk would have rendered
all 560 lines, most of them leading to an `UNSUPPORTED` the user discovers by
being refused. So the capability table was never the overlay on the renderer —
it was the load-bearing piece, and once it existed the surface left to
hand-write was small enough that hand-writing it was the cheaper option.

The reuse a generic renderer promises arrived anyway, from two small things
rather than one large one: `ChoiceSelect` (72 lines), which is every
`oneof`/`enum` in the builder, and `useFieldIssue`, where a control asks once
about a dotted path and gets either the client's complaint or the backend's
`field_path` — the backend wins, because it saw the frame we actually sent.
That is reuse of the two parts that were genuinely hard, without a renderer.

**The mitigation was the whole answer.** This section hedged: build the hot
path bespoke in M2 first, and let the generic renderer serve only what the
bespoke layer has not reached. Following that rule meant the generic renderer
was never reached — the bespoke layer got to the tail first, and cheaply. The
hedge was better than the idea it was hedging.

**When to revisit.** If the supported set grows toward the full schema — the
arms `capabilities.ts` currently marks "Not built" (cliquet, compound, chooser,
basket, spread) plus the frozen market shapes — the arithmetic changes, and the
descriptors are still sitting in the generated code where §2 left them.
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

Gap analysis against the schema and the running build, ordered by what it costs
this frontend. **The list is empty.** Everything that was on it is below, with
what it turned out to be — and two of them were not what the entry said.


Things I checked and found **not** missing: the `Flag`/`*_UNSPECIFIED`
discipline, the error `field_path`, `known_ids`, the engine echo, the
`ScenarioResult.series` pre-shaping, `Progress.running_standard_error`, and
`SessionOpened.market_ids`. Each of those exists specifically to let a frontend
do something better, and each is used above.

---

### Fixed rather than requested

**No health endpoint.** The socket connecting was the only liveness signal,
which is unusable by the things that need one: a proxy or a container runtime
would have to speak WebSocket and Protobuf to decide whether to restart the
process. `GET /healthz` answers over plain HTTP with the build, the QuantLib
version, the uptime and the live connection and session counts.

What the reply proves is that **the loop is turning** — the gateway is
single-threaded and everything under it runs on worker threads, so answering
means frames are being served and says nothing about whether a particular graph
is healthy. That is the honest scope of a liveness check and the one an
orchestrator wants: restarting on it is right, and it will not restart the
process because a client sent a bad trade. The counts are live rather than a
fixed string, and the backend's suite checks that by asserting the endpoint sees
the connection and sessions the test itself is holding — otherwise it is a
constant dressed as a measurement. No `Access-Control-Allow-Origin`, so a
browser can send the request from any page but cannot read the answer.

The frontend got the better half of it. A failed WebSocket handshake reports
*nothing* to script — no status, no reason, by design — so "the service is not
running" and "the service is running and refused this page" were the same event
here. Since the gateway started checking `Origin` the second became a real way
to be stuck with no clue, and it is one this project introduced. The status bar
now probes `/healthz` on the way down and says which: **nothing answering**, or
**running, but refusing this page**, the second with the flag that fixes it.
Confirmed by starting the backend with a deliberately wrong allowed origin and
watching the badge come up.

The e2e fixture that fails a test on any console error grew a per-test
`allowedConsoleErrors`, empty by default. A test that blocks a request gets the
browser's own complaint about the block, and that is the block working rather
than the app failing; declaring the pattern keeps the check strict for every
other test instead of loosening it for all of them.


**"No auth, loopback only — fine for local use" was two-thirds right.** The
conclusion was that TLS and authentication belong in a proxy and not in the
backend, which still holds. The premise was that loopback made the current
deployment safe, and that is where it went wrong: **a WebSocket upgrade is not
subject to the same-origin policy.** Any page in any tab a developer has open
can connect to `ws://127.0.0.1:9111` and drive this service. Nothing here is
worth stealing; the exposure is what it costs to run, and one frame can commit
a hundred thousand engine calls.

So the origin check was not a hosting concern to defer. It is the only exposure
the deployment as it stands actually has, and it is about ten lines. The rule:
an `Origin` that is **present** must be on the allowed list, one that is
**absent** is let through. Only browsers send the header, so this closes the
browser path and leaves the smoke test, any CLI and any proxy that already
checked untouched — which is why the whole suite passed without being told the
check existed.

The other half of having no authentication is that nothing stopped one client
taking everything. Sockets are capped and refused at the upgrade with a `503`,
so a client reads a status rather than an unexplained disconnect; sessions are
capped per socket and refused with `OVERLOADED`, because a session is a live
QuantLib graph on a worker seat and that is the resource worth protecting.
Both are refusals rather than breakages — close one and the next opens.

`OVERLOADED` got its own error class here rather than staying under
"infrastructure", because "retry or back off" is wrong advice for a limit that
is per socket and under the user's own control. The remedy says to close a tab,
which is the thing that actually fixes it.


**"No session resume — handled by client-side replay" was half true, and the
half that was missing had no test.** The backend keeps no log for an absent
client and never claimed to (DESIGN §9.4); the frontend's answer is to reopen
from the workbook, which it does, and one bootstrap is the honest price. That
much held up.

What did not is that a socket carries *every* tab's session, and only the tab
in front was being told it had lost one. A parked tab kept a snapshot saying
`live` and a session id that had stopped existing, so switching to it showed a
healthy session and then priced into nothing. Marking them is one line in the
right place — `tabsSlice` reacts to the same `lost` action the session slice
does, because the two facts are one event.

Reopening is deliberately lazy. Doing it for every tab at the moment of the
drop would spend a bootstrap on each, most of them for a document nobody is
about to look at; a tab is reopened on the way *in*, and the pane reports the
bootstrap like any other.

The test is worth more than the fix. Nothing had ever cut the socket, so the
whole replay path — the claim this entry rested on — was unexercised. Playwright
routes the WebSocket straight through to the running service and then closes
it, which is a real drop with no test-only seam in the client, and the check
fails on the old code with the parked tab still holding `s-112`.

One more thing fell out of the same reading. The workbook codec had been
writing the book since the day it existed and the store's preloaded state
dropped it on the way back in, so a set-aside trade lasted exactly until a
refresh. Both fixes were confirmed by watching their tests fail first.


**Cancellation was documented as one thing and is two.** HANDLERS.md said
`Progress` "arrives only from a batched Monte Carlo" and was "the only point at
which a running calculation can be stopped". Three shapes emit it — a batched
Monte Carlo, a sweep, a batch — and those three take the stop where they stand.
This frontend had worked that out by reading `worker.cpp`, which is the wrong
way to learn what a service does.

The half nobody had written down was the other row, and this note had it wrong
too. It said the engine call "cannot be interrupted", and left it there. What
actually happens is that after a 250 ms grace the supervisor gives up on the
worker, terminates the request and replays the session into a fresh one — and
because this build hosts workers as threads, `ThreadProcessHost::kill` is a
disown rather than a kill: it asks, marks the seat dead, and detaches. So the
client is freed and the session survives, while the abandoned calculation runs
to completion on a thread nobody is listening to.

Which makes the true statement a much more useful one: **every request is
cancellable, and what differs is the cost.** At a seam it costs nothing and the
work stops. Anywhere else it costs one bootstrap and buys the session back, not
the processor. HANDLERS.md now says that in a table, and each row of it is a
check in the backend's own suite — the two seam rows were claims nothing tested,
and the third was the one the page had backwards.

The UI consequence is the interesting one. It used to offer cancel only where
the stop was free, which quietly agreed with the wrong documentation: a single
price on a slow engine, a curve sample and a comparison had no way to be called
off at all. The status bar now offers one for whatever is running and says what
it buys, because "you get your session back in a quarter of a second" is worth
having and is not the same promise as "the machine stops".

One inconsistency fell out of the same reading. A cancelled batch came back with
the prices it had; a cancelled sweep threw its points away. The two disagreed
for no reason beyond the order they were written in, and the sweep had the worse
half — stopping a 1200-point ladder at 883 lost 883 prices that were computed
correctly. It keeps them now, with `abandoned_after` saying how far it got and
the axes trimmed so a partial ladder is a prefix rather than a mislabelled
whole.


**One instrument per `PriceRequest`.** A book of forty trades was forty
requests, serialised on the one worker the session owns: forty round trips,
forty terminal frames to match up, and no way to stop the lot. The note here
said to show queue depth and reconsider a batch if it became the wait. Queue
depth would have described the problem rather than fixed it.

`PriceBatch` carries the requests and `BatchResult` answers one entry per
request **in order**, so a client matches by position and the wire needs no ids.
What shapes the message is what a failing trade costs. Refusing the whole book
because trade seventeen names a curve that is not there would throw away sixteen
prices that were computed correctly — the same argument that made an unsupplied
result a named absence rather than a rejection — so an entry carries either its
price or the rejection it would have been sent on its own, `field_path` and all,
prefixed with the row it came from.

The exception is a failure that dirties the graph. `Session::dirty` means only
part of it was invalidated, so every later price would be computed against
something no longer coherent; the rest of the book is abandoned rather than
answered with numbers nobody should trust, and `abandoned_after` says how many
were tried. Progress arrives per entry and the stop flag is checked between
them, so a batch is cancellable at trade boundaries exactly as a sweep is
cancellable at point boundaries. The placement decision is taken over the whole
book — a Monte Carlo eleven trades in moves the session to a sacrificial seat
before the batch starts, because the batch runs to completion wherever it
begins.

A sweep inside a batch is refused rather than served. Both shapes already mean
"price this many times", and nesting them is a product one `completed`/`total`
pair cannot describe.

The frontend grew the **book** the batch is for: trades set aside beside the
live one, in the workbook, sharing its market by construction — which is what
makes them a book rather than several tabs, and why the total is a total rather
than a coincidence. Rows are named from the trades themselves (`call 100 ·
european · analytic`), because the wire carries no label and the alternative is
asking someone to name forty rows. Two trades, one request: the frame log goes
up by four, not by eight.

`Capabilities` gained `frames`, because a batch is a frame rather than a
`PriceRequest` option and listing it beside `include_cashflows` would have been
a category error.


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
| **M6** ✅ | Monte Carlo progress, convergence trace and the batching that enables them; workbook persistence, import/export; comparing two sessions on one socket | the long-running path and the document story |
| **M7** ✅ | Session tabs, a11y pass, perf pass, `README.md` + `UI.md`, and the Playwright suite | ship |
| **M8** ✅ | §8 worked to empty: the quanto lookback refusal, the capability handshake, curve and cash-flow panels, named absences, implied volatility, grid sweeps, the book, the truth about cancellation, replay across every tab, the door, `/healthz` | that the gap list was defects rather than wishes — seven schema changes and twelve backend commits to close it |

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

**What M8 was, and why it is the odd one out.** Every milestone before it is a
frontend deliverable. M8 is §8 above — the gap analysis — worked entry by entry
until the list was empty, and closing it meant changing the *service* seven
times in the schema and twelve times in the backend. A frontend milestone that
mostly lands in another repository is worth being suspicious of; the reason it
did is that the entries were not features the frontend wanted, they were
questions the frontend could not ask.

Three of them turned out not to be what the entry said, which is the part worth
keeping:

- **"Cancellation interrupts more than the documentation says"** was itself
  wrong in the other direction. It said the engine call could not be
  interrupted; in fact the supervisor gives up on the worker after a grace and
  replays the session, so *every* request is cancellable and what differs is the
  cost. The UI had been agreeing with the wrong page — it offered cancel only
  where the stop was free, so most requests could not be called off at all.
- **"No auth, loopback only — fine for local use"** had the right conclusion
  about TLS and the wrong premise about loopback. A WebSocket upgrade is not
  subject to the same-origin policy, so any page in any tab could drive the
  service. That made the origin check the one thing that mattered *now* rather
  than on the way to being hosted.
- **"No session resume — handled by client-side replay"** was a claim rather
  than a request, and nothing had ever tested it: no check in this project had
  cut the socket. It held for the tab in front and not for the others, which
  kept a session id that had stopped existing. The entry was true about the
  backend and wrong about this client.

The rest were real and shallow: a result kind in the enum and not in a switch, a
sweep that moved one quote, a blotter that cost one frame per trade. Each closed
with a check in the backend's own suite as well as here, because a gap that only
this client knows about is a gap that reopens — and where the entry was a claim
rather than an ask, the check came first and was watched to fail.

M0–M3 is the demonstrable core: open, bump, price, sweep. M8 is what happens
when you read the gap list back as a to-do rather than as an excuse.

---

## 10. Testing

`TESTING.md` is the operational version of this — what to run, and what each
check is guarding. This section is the strategy, and what became of it.

**Three layers**, 18 unit and integration files (108 checks) plus 28 in
Playwright:

- **Vitest + RTL** for slices, selectors, the topo sort, unit formatting, the
  capability matrix, the workbook codec, and the error-path → field binding.
- **Integration against a running `ql-backend`** for the protocol itself:
  exact numbers, progress frames, cancellation, grid sweeps, batches, implied
  volatility, two sessions on one socket, and the quanto-lookback refusal.
- **Playwright E2E** against a real `./build/ql-backend --port 9111`: open,
  price the reference, run a batched Monte Carlo to completion, compare two
  sessions, reload and confirm the workbook survived. Skipped, not passed, when
  the daemon is absent.

### Two things planned here were never built, and should not be

**Contract fixtures.** The plan was to capture real `ClientFrame`/`ServerFrame`
pairs from a `smoke_v2.py` run into `test/fixtures/` and unit-test every
request builder against them. What replaced it is the integration layer talking
to the daemon directly: the same assertion with no capture step, and no second
copy of the truth to drift. A fixture records what the backend did *once*; the
thing actually worth guarding is what it can do *now*, and that is
`drift.integration.test.ts` comparing the capability tables against the
handshake (§8) — a check no captured frame could have performed.

**A mock socket server in Node**, for the progress, cancel, reconnect and
`WORKER_DIED` paths "that are hard to provoke live". Three of the four turned
out to be cheaper against real things. Progress and cancel are integration
tests against the daemon, because a Monte Carlo long enough to interrupt is a
parameter rather than a mock. Reconnect is Playwright's `page.routeWebSocket`,
which passes through to the real service and then cuts the connection — the
obvious `context.setOffline(true)` does not drop a loopback socket, which is
what sent us looking for it.

The fourth has no test. `WORKER_DIED` still reaches the client through
`classifyError`'s `default`, landing in the `infrastructure` class by omission
rather than by decision. It is the one path that genuinely needs a hostile
server, and it is the honest gap in this section.

### Three invariants worth naming

All three were shipped defects rather than hypotheticals.

- Every E2E check asserts the page reported **no console errors**, which is
  where unmemoised selectors announce themselves — the suite found a third one
  on its first run. Tests that need an exception declare it per-test through
  `allowedConsoleErrors`, so the default stays strict.
- Every E2E check asserts the **window itself does not scroll**: the panes
  scroll, the frame does not, and when that broke every control moved out from
  under the pointer mid-interaction.
- `prose.test.ts` asserts that **no rendered string contains an
  identifier-shaped word**. Twice a word-boundary rename walked out of the code
  and into a label — "matches HANDLERS.md" became "isReference HANDLERS.md".
  Neither `tsc` nor eslint can see that, and both survived a browser pass.

## 11. Risks

| Risk | Mitigation |
| --- | --- |
| Capability matrix drifts from the build | ask for the handshake (§8.1); until then, an E2E test that asserts every "supported" combo actually prices |
| ~~Generic renderer feels generic on the hot path~~ | closed: bespoke-first was followed so far that the renderer was never reached, tail included (§6) |
| Slider latency on FD/MC | adaptive repricing (§7.6), one request in flight per trade, coalesce |
| Session lost mid-work | workbook is client-owned and persisted; replay is a first-class code path tested in CI, not an afterthought |
| Proto submodule moves under us | pin the commit, regenerate in `prepare`, and fail the build on a descriptor diff that touches a field the UI binds |
| Scope: the schema is far larger than the build | ship M0–M3 against the vanilla path before touching swaps |
