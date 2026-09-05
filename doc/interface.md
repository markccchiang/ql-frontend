# The interface

## The layout

```{figure} images/workbench.jpg
:alt: The workbench: a status bar, a workbook tab, the market, session and trade columns, the result, and the quote bar along the bottom.
:width: 100%

The reference check, just after it ran: one live session (`s-9`), the trade it
priced, and **12.459717** with the greeks that came back beside it.
```

Four full-width bands, and three columns between them:

**The status bar** carries everything about the connection in one line: the
service and the QuantLib it linked, the socket address, the session id, the
round trip of the last request, and — while something is running — the cancel.
The buttons on its right open the panels — sweep, Monte Carlo, compare,
curve, cash flows, book and the frame inspector — and **guide**, which opens
this document in a tab of its own.

**The tab bar.** One workbook per tab, each with its own session on the same
socket. `+` opens another.

**The workbook bar** names the document and exports or imports it as canonical
Protobuf JSON — the file is what would go over the wire, so a pricing case can
be sent to someone else and reopened exactly.

**The market column** is the market as objects: the evaluation date, then the
quotes, curves, volatility, index and fixings that everything else names.

**The centre column** is the session above the trade — open, rebuild, and the
two worked examples — then the trade itself as payoff, exercise, underlying,
style and engine.

**The result column** is the price, the results you asked for, the engine as it
actually ran, and a Δ against a pinned baseline once you pin one.

**The panels** open between the columns and the quote bar, carrying their own
strip of tabs — sweep, Monte Carlo, compare, curve, cash flows, book — so a
ladder or a cash-flow table is beside the trade that produced it rather than on
a page of its own. {doc}`studies` is what they are for.

**The quote bar** along the bottom is the point of the whole application. A
quote write is the only edit the service can carry into a graph that is already
built, so it is the only edit that is free: drag, and the price follows.

## Two speeds of editing

`UpdateMarket` writes quotes and nothing else. Anything that changes the shape
of the graph — a curve, an index, the evaluation date — is a new session.

- **Move a slider.** The price follows. Nothing is rebuilt.
- **Change anything else in the market.** An amber bar appears saying the
  structure changed, with the cost of the last rebuild measured in
  milliseconds, and a button to do it. Nothing rebuilds behind your back.

Editing the **trade** is neither: an instrument is a property of the request,
not of the graph, so it costs a price and never a rebuild. That is why you can
switch from a European vanilla to an American barrier without paying for a
bootstrap.

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
  You cannot author a request the service will refuse.
- **Rejections land on the field.** A service error carries a dotted proto path
  and the control at that path turns red with the message. Three kinds read
  differently: *fill this in*, *this value cannot work*, and *this build does
  not price it*.
- **A result that did not arrive says so.** Ask an engine for a greek it does
  not publish and the row reads "not supplied" rather than being absent, which
  is not the same as zero. See {doc}`results`.

## Gestures

| Gesture | What it does |
| --- | --- |
| Right-click a quote | Sweeps it ±20% off the live graph and draws the ladder |
| Click a point on a ladder | Writes that value to the market — the value that was priced, not an interpolation |
| Pin (⚲) on a result | Every later price carries a Δ against it, engine echo included |
| `+` on the tab bar | A second workbook with its own session on the same socket |
| **add axis** in the sweep panel | The sweep becomes a grid, priced as a product in one request |
| **add to book** on a trade | Sets it aside beside the live one; **price the book** sends them all in one frame |
| **from last price** on the implied-volatility card | Fills in the NPV that came back last |
| **cancel** in the status bar | Stops whatever is running, and the tooltip says what that costs |

## Sessions and tabs

One socket carries several sessions. Each tab holds its own workbook and its
own session, and a tab you are not looking at keeps its session open — coming
back costs nothing and its graph is still warm.

A dropped socket takes **every** tab's session with it, not only the one in
front. The tab you are looking at reopens itself as soon as the socket is back;
the others are reopened when you switch to them, which costs one bootstrap at
the moment you actually want it rather than several at once for documents
nobody is reading.

A session dies with its socket and cannot be resumed, so the client owns the
market definition: if the connection drops, the workbook is replayed into a new
session and the trade repriced. The workbook also survives a refresh, and
**export** writes it as canonical Protobuf JSON — the file is what would go
over the wire, so a pricing case can be sent to someone else and reopened
exactly.

There are two caps, and they are the service's rather than the browser's: **32
sockets** at once, and **16 sessions on one socket**. Past the second one,
opening a session is refused as overloaded and the remedy is to close a tab
rather than to retry. A session is a live graph holding a worker seat, which is
why the limit is counted in sessions and not in tabs.

## Reading a price

Every result shows the engine **as it ran**, echoed by the service rather than
assumed by the client. Two numbers are only comparable if you can see which
engine produced each, which is why the echo is on the face of the result and
why pinning a baseline carries it along. It matters more than it sounds: the
same trade at the same seed and sample count prices differently batched and
unbatched (see {doc}`maths/numerics`), and the echo is what tells you which one
you are looking at.

## Keyboard and contrast

Tabs are reachable and operable from the keyboard and every control has an
accessible name. The interface is checked against WCAG 2 AA for serious and
critical violations on every end-to-end run. Differences are marked with ▲ and
▼ as well as colour, so a red/green diff survives colour-blindness.
