# The interface

What each part of the app is for, and why it behaves the way it does.

`PLAN.md` §7 is the design rationale; this is the working guide. Where the two
touch, the reason is usually a constraint from `ql-backend/DESIGN.md` rather
than a preference.

## The layout

```
┌──────────────────────────────────────────────────────────────────────┐
│ qlservice ● ws://…   s-3   cancel 1 in flight   4 ms   frames        │  status
├──────────────────────────────────────────────────────────────────────┤
│ ● Workbook 1   ● Shocked +1d   +                                     │  tabs
├──────────────────────────────────────────────────────────────────────┤
│ workbook [ HANDLERS.md session ]        export  import  reset        │  document
├────────────────┬───────────────────────────────┬─────────────────────┤
│ MARKET         │ SESSION + TRADE               │ RESULT              │
│ quotes, curves │ reference check, rebuild      │ NPV, greeks,        │
│ vol, indices,  │ payoff × exercise ×           │ the engine as it    │
│ fixings        │ underlying × style, engine    │ ran, Δ vs baseline  │
│                │ and what to ask for           │                     │
├────────────────┴───────────────────────────────┴─────────────────────┤
│ sweep │ monte carlo │ compare │ curve │ cash flows │ book            │  strip
├──────────────────────────────────────────────────────────────────────┤
│ S ├───●────┤ 105.00   R ├──●───┤ 5.00%   V ├───●──┤ 20.0%            │  quotes
└──────────────────────────────────────────────────────────────────────┘
```

The **quote bar** at the bottom is the point of the whole application. A quote
write is the only edit the backend can carry to a graph that is already built,
so it is the only edit that is free.

## Two speeds of editing

`UpdateMarket` writes quotes and nothing else. Anything that changes the shape
of the graph — a curve, an index, the evaluation date — is a new session.

- **Move a slider.** The price follows. Nothing is rebuilt.
- **Change anything else in the market.** An amber bar appears saying the
  structure changed, with the cost of the last rebuild measured in
  milliseconds, and a button to do it. Nothing rebuilds behind your back.

Editing the **trade** is neither: an instrument is a property of the request,
not of the graph, so it costs a price and never a rebuild.

## What the controls promise

- **Nothing defaults silently.** Proto3 cannot tell an unset enum from its
  first value, so a control that quietly picked one would be a mispricing with
  no error. Every convention starts empty and blocks the price until it is
  answered. Pay-or-receive, end-of-month and payoff-at-expiry are three-state:
  neither answer is a default.
- **A closed control says why it is closed.** Choosing a style narrows the
  exercises, the payoffs, the engines and the trees to what this build will
  actually dispatch, and each greyed option carries the reason — "the integral
  engine is European only", "the barrier lattice is Cox-Ross-Rubinstein only".
  You cannot author a request the backend will refuse.
- **Rejections land on the field.** A backend error carries a dotted proto
  path, and the control at that path turns red with the message. Three kinds
  read differently: *fill this in*, *this value cannot work*, and *this build
  does not price it*.
- **A result that did not arrive says so.** Ask an engine for a greek it does
  not publish and the row reads "not supplied" rather than being absent, which
  is not the same as zero.

## Gestures

| | |
| --- | --- |
| Right-click a quote | Sweeps it ±20% off the live graph and draws the ladder |
| Click a point on a ladder | Writes that value to the market — the value that was priced, not an interpolation |
| Pin (⚲) on a result | Every later price carries a Δ against it, engine echo included |
| `+` on the tab bar | A second workbook with its own session on the same socket |
| **add axis** in the sweep panel | The sweep becomes a grid, priced as a product in the same one request |
| **add to book** on a trade | Sets it aside beside the live one; **price the book** sends them all in one frame |
| **from last price** on the implied-volatility card | Fills in the NPV that came back last, which is the question that card exists for |
| **cancel** in the status bar | Stops whatever is running, and the tooltip says what that costs |
| **guide** in the status bar | Opens the user's guide (`doc/`) in a tab of its own |

## Things the interface tells you that the schema does not

- **A fixed leg's rate is frozen.** `FixedRateLeg` takes a value rather than a
  handle, so the rate is read once when the leg is built. That quote is drawn
  in amber and its slider is disabled: price the trade again to move it.
- **No dividend curve means zero, not the risk-free curve.** The underlying
  card says so rather than leaving the field blank.
- **Monte Carlo batching changes the price.** Reporting progress runs
  independent batches with derived seeds, which draws from the RNG stream
  differently from one run of the same total. The control says so, and
  reproducibility keys on the seed, the samples and the batch size together.
- **A sweep is a question, not an edit.** The swept quote is put back
  afterwards. Writing a value to the market is a separate, deliberate act.
- **Anything running can be called off, and the button says what that buys.**
  A sweep, a book and a batched Monte Carlo stop at their next step and keep
  what they already computed — a ladder cancelled at 883 of 1200 points comes
  back with 883 points, not with nothing. Anywhere else the service cannot
  interrupt the engine call: it lets the worker go after a quarter of a second
  and rebuilds the session behind you, so what a cancel returns there is the
  session rather than the processor. Both are worth having and they are not the
  same promise, which is why the status bar says which one you are getting.
- **A book prices in one frame, and one bad trade costs one row.** Press “add to
  book” and the trade is set aside beside the live one; press “price the book”
  and all of them price against one graph in a single request. They share this
  workbook’s market by construction, which is what makes the total a total
  rather than a coincidence. A trade that cannot price shows the rejection it
  would have been sent on its own, on its own row, and the rest keep their
  numbers. Rows are named from the trades themselves — nobody is asked to name
  forty of them.
- **A second axis makes the sweep a grid, and it is still one request.** Add an
  axis and the panel prices the product — `S × V = 27 prices, one request` — off
  the same warm graph, with one progress bar and one cancel. It draws as a line
  per value of the second axis rather than as a heat map, because a price read
  off a colour is a guess. The panel stops at two axes: a third would price
  perfectly well and draw nothing. It also refuses, before the round trip, a
  grid larger than the ceiling the service advertised — a product multiplies,
  and a step count one digit too long is a session-length request.
- **An implied volatility asks for a price, and takes the last one on a click.**
  It is the only result computed from something the request carries rather than
  something the market holds. Tick it and a card appears wanting the price to
  invert; the "from last price" button fills in the NPV that came back last,
  which is the usual question — what volatility does *this* price imply. Left
  empty the request is refused rather than answered, because inverting the price
  the request is about to compute would return the volatility you sent. QuantLib
  can invert a vanilla, a barrier and a double barrier; on any other style the
  card says so and the result comes back named absent.
- **A quanto lookback is refused.** QuantLib has no engine for one. It used to
  be priced as a plain lookback with no error at all; the backend refuses it by
  name now, and the switch is disabled so you do not spend a round trip finding
  out.

## Sessions and tabs

One socket carries several sessions. Each tab holds its own workbook and its
own session, and a tab you are not looking at keeps its session open — coming
back costs nothing and its graph is still warm.

- **A socket that will not open says whether anything is there.** The browser
  tells a page nothing about a failed WebSocket handshake — no status, no
  reason — so the app asks the service over plain HTTP instead. **Nothing
  answering** means the service is not running, or not where this app is
  looking. **Running, but refusing this page** means it is up and turned this
  page away, which is almost always its allowed origins: start it with
  `--allow-origin` for wherever this app is served from.
- **A socket may hold only so many sessions.** One per tab, up to the service's
  limit; past it, opening a session is refused as overloaded and the remedy
  says to close a tab rather than to retry, because retrying is not what fixes
  it. A session is a live QuantLib graph holding a worker seat, which is why the
  limit is counted in sessions and not in tabs.

A dropped socket takes **every** tab's session with it, not only the one in
front. The tab you are looking at reopens itself as soon as the socket is back;
the others are reopened when you switch to them, which costs one bootstrap at
the moment you actually want it rather than several at once for documents
nobody is reading. The pane reports that bootstrap like any other.

A session dies with the socket and cannot be resumed, so the client owns the
market definition: if the connection drops, the workbook is replayed into a new
session and the trade repriced. The workbook also survives a refresh, and
**export** writes it as canonical Protobuf JSON — the file is what would go
over the wire, so a pricing case can be sent to someone else and reopened
exactly.

## Reading a price

Every result shows the engine **as it ran**, echoed by the backend rather than
assumed. Two numbers are only comparable if you can see which engine produced
each, which is why the echo is on the face of the result and why pinning a
baseline carries it along.

## Keyboard and contrast

Tabs are reachable and operable from the keyboard; every control has an
accessible name; the interface is checked against WCAG 2 AA for serious and
critical violations on every end-to-end run (`e2e/a11y.spec.ts`). Differences
are marked with ▲ and ▼ as well as colour, so a red/green diff survives
colour-blindness.
