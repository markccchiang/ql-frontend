# The interface

What each part of the app is for, and why it behaves the way it does.

`PLAN.md` §7 is the design rationale; this is the working guide. Where the two
touch, the reason is usually a constraint from `ql-backend/DESIGN.md` rather
than a preference.

## The layout

```
┌──────────────────────────────────────────────────────────────────────┐
│ qlservice ● ws://…    session s-3   4 ms   sweep  monte carlo  frames │  status
├──────────────────────────────────────────────────────────────────────┤
│ ● Workbook 1   ● Shocked +1d   +                                     │  tabs
├──────────────────────────────────────────────────────────────────────┤
│ workbook [ HANDLERS.md session ]        export  import  reset        │  document
├────────────────┬───────────────────────────────┬────────────────────┤
│ MARKET         │ TRADE                         │ RESULT             │
│ quotes, curves │ payoff × exercise ×           │ NPV, greeks,       │
│ vol, indices,  │ underlying × style, engine    │ the engine as it   │
│ fixings        │ and what to ask for           │ ran, Δ vs baseline │
├────────────────┴───────────────────────────────┴────────────────────┤
│ sweep │ monte carlo │ compare │ curve │ cash flows                   │  strip
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
- **A quanto lookback is refused.** QuantLib has no engine for one. It used to
  be priced as a plain lookback with no error at all; the backend refuses it by
  name now, and the switch is disabled so you do not spend a round trip finding
  out.

## Sessions and tabs

One socket carries several sessions. Each tab holds its own workbook and its
own session, and a tab you are not looking at keeps its session open — coming
back costs nothing and its graph is still warm.

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
