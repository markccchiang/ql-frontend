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
front. The tab you are looking at deals with it as soon as the socket is back;
the others are dealt with when you switch to them, at the moment you actually
want them rather than all at once for documents nobody is reading.

A session outlives its socket by a grace window — a minute, by default. Inside
it the app takes the session back rather than rebuilding it: the same id, the
same graph, and a calculation that was running when the connection went is
still running, so its result arrives rather than being lost. The status bar
says **socket lost — session held** while that is true, and marks the session
**resumed** when it comes back.

```{figure} images/session-resumed.png
:alt: The status bar after a dropped socket: the session badge reads SESSION S-2, with a RESUMED badge beside it.
:width: 100%

The same session, after the socket was cut and the app took it back. The id is
the one it had; the session pane still reports the bootstrap that session cost
when it was *opened*, because a resume builds nothing.
```

Outside the window — a long drop, or a service that has been restarted — the
client owns the market definition and replays it: the workbook is opened as a
new session and the trade repriced. The workbook also survives a refresh, and
**export** writes it as canonical Protobuf JSON — the file is what would go
over the wire, so a pricing case can be sent to someone else and reopened
exactly.

There are two caps, and they are the service's rather than the browser's: **32
sockets** at once, and **16 sessions on one socket**. Past the second one,
opening a session is refused as overloaded and the remedy is to close a tab
rather than to retry. A session is a live graph holding a worker seat, which is
why the limit is counted in sessions and not in tabs.

## What is kept, and where

Two halves, and knowing which is which explains every way this application
recovers — or does not.

**The service owns the graph.** The curves, the volatility, the index, the
instruments: built once when the session opens, held on a worker while the
session lives, and never written to a disk anywhere. There is no database
behind this.

**The browser owns the document.** The market you authored, the trade, the
book: this app's own copy, saved in browser storage and rebuilt into a session
whenever it has to be. That is why a market can be exported, sent to someone
else, and opened exactly.

| What | Where it lives | What it survives |
| --- | --- | --- |
| The live graph | The service, in memory | Your requests; a dropped socket, for a minute |
| The session id and its token | The service and this app, both in memory | The socket, for the same minute |
| Your workbook — market, trade, book | This app, in browser storage | A refresh, a restart of the service, a new session |
| Prices, greeks, pinned baselines | This app, in memory | Nothing: a refresh clears them, and the same trade prices again |

So, in the order you are likely to meet them:

| What happens | What you get |
| --- | --- |
| **You refresh the page** | The workbook comes back; the session does not — the socket died with the page, so the app opens a new one |
| **The connection blinks** | The session comes back with the same id, and a calculation that was running still delivers |
| **The connection is out for a while** | A new session, replayed from your workbook, and the calculation that was running is lost |
| **The service is restarted** | The same: it remembers nothing, so the workbook is replayed |
| **You close a tab** | Its session is closed on purpose, which is final — there is nothing to come back to |
| **You clear browser data** | The workbook is gone, and the app starts from its seed. This is the only loss nothing recovers |

`ql-backend/DESIGN.md` §1.2 is the same split from the service's side, with what
each failure leaves standing.

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
