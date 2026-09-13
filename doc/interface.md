# The interface

## The layout

```{figure} images/workbench.jpg
:alt: The workbench: a status bar, a workbook tab, the market, session and trade columns, the result, and the quote bar along the bottom.
:width: 100%

The reference check, just after it ran: one live session (`s-2`), the trade it
priced, and **12.459717** with the greeks that came back beside it.
```

Four full-width bands, and three columns between them:

**The status bar** carries everything about the connection in one line: the
service and the QuantLib it linked, the socket address, the session id, the
round trip of the last request, and — while something is running — the cancel.
The buttons on its right open the panels — Sweep, Monte Carlo, Compare,
Curve, Cash Flows, Book and the frame inspector — and **Guide**, which opens
this document in a tab of its own.

```{figure} images/interface-statusbar.png
:alt: The status bar: the name ql-backend with a green dot, the socket address ws://127.0.0.1:9111, the words ql-backend and QuantLib 1.43, then a session badge reading SESSION S-1, "4 ms round trip", and the panel buttons — Sweep, Monte Carlo, Compare, Curve, Cash Flows, Book, Frames (8) — ending in Guide.
:width: 100%

The whole of the connection in one line: which service, which QuantLib it
linked against, which socket, which session, and what the last request cost.
`Frames (8)` is the inspector, and it counts what has crossed the wire.
```

**The tab bar.** One workbook per tab, each with its own session on the same
socket. `+` opens another.

**The workbook bar** names the document and exports or imports it as canonical
Protobuf JSON — the file is what would go over the wire, so a pricing case can
be sent to someone else and reopened exactly.

**The market column** is the market as objects: the evaluation date, then the
quotes, curves, volatility, index, fixings and correlation matrices that
everything else names.

**The centre column** is the session above the trade — open, rebuild, and the
two worked examples — then the trade itself as payoff, exercise, underlying,
style and engine.

**The result column** is the price, the results you asked for, the engine as it
actually ran, and a Δ against a pinned baseline once you pin one.

**The panels** open between the columns and the quote bar, carrying their own
strip of tabs — Sweep, Monte Carlo, Compare, Curve, Cash Flows, Book — so a
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

```{figure} images/interface-rebuild.png
:alt: The session pane after a structural edit: a yellow alert reading "Structure changed. UpdateMarket writes quotes and nothing else, so this needs a new session — the last bootstrap took 0.28 ms", with a rebuild button beside it, and below it the session still live as s-1, its bootstrap time and seven objects built.
:width: 100%

The second speed, as the pane puts it. The session below the bar is still live
and still priceable — nothing was rebuilt behind you — and the bar names both
what needs a new session and what the last one cost to build, so spending it
again is a decision rather than a surprise.
```

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
  You cannot author a request the service will refuse. One style goes further
  and takes a control away: a chooser has no call or put until its choice date,
  so the payoff card replaces that switch with the reason rather than offering
  a side the instrument would overwrite.
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

```{figure} images/interface-tabs.png
:alt: The status bar above the tab bar: a badge reading SESSION S-4 with a 6 ms round trip, and two workbook tabs — "European call, 1Y" and "Same trade, 3M on" — each carrying a green dot, the second selected, followed by a plus button.
:width: 100%

Two workbooks on one socket. The dot on a tab is its *session*, not the tab
itself: both are live here, and the status bar names the one you are looking
at. The other keeps its graph warm and costs nothing until you switch back.
```

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
:alt: The status bar after a dropped socket: the session badge reads SESSION S-5, with a RESUMED badge beside it.
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

`ql-backend/doc/DESIGN.md` §1.2 is the same split from the service's side, with what
each failure leaves standing.

## The workbook file

**Export** writes the document as canonical Protobuf JSON. Four fields wrap it
— `version`, `label`, `evaluationDate` and `book` — and everything inside them
is the wire format itself: `market` is an array of `MarketObject`, `trade` is a
`PriceRequest`. What you export is what would go over the socket, so a round
trip through a file cannot quietly change a request.

```{figure} images/interface-workbookbar.png
:alt: The workbook bar: the word workbook beside a name field reading "Barrier study, 2027 expiry", then export, import and reset.
:width: 100%

The document's own line, and the name here is the one that appears on the tab.
**Reset** goes back to the seed workbook; **import** takes a file written by
the button beside it, from this machine or anybody else's.
```

Here is a complete one. It is the workbook the **run reference check** button
prices:

```json
{
  "version": 1,
  "label": "HANDLERS.md session",
  "evaluationDate": "2026-09-01",
  "market": [
    {"id": "S", "displayName": "Spot", "quote": {"value": 100, "unit": "UNIT_ABSOLUTE"}},
    {"id": "R", "displayName": "Risk-free rate", "quote": {"value": 0.05, "unit": "UNIT_RATE"}},
    {"id": "Q", "displayName": "Dividend yield", "quote": {"value": 0.02, "unit": "UNIT_RATE"}},
    {"id": "V", "displayName": "Volatility", "quote": {"value": 0.2, "unit": "UNIT_VOLATILITY"}},
    {
      "id": "RC", "displayName": "Discount curve",
      "yieldCurve": {
        "dayCounter": {"family": "ACTUAL_360"},
        "flat": {"rate": {"quoteId": "R"}, "compounding": "CONTINUOUS", "frequency": "ANNUAL"}
      }
    },
    {
      "id": "QC", "displayName": "Dividend curve",
      "yieldCurve": {
        "dayCounter": {"family": "ACTUAL_360"},
        "flat": {"rate": {"quoteId": "Q"}, "compounding": "CONTINUOUS", "frequency": "ANNUAL"}
      }
    },
    {
      "id": "VOL", "displayName": "Black volatility",
      "volatility": {
        "dayCounter": {"family": "ACTUAL_360"},
        "constant": {"volatility": {"quoteId": "V"}}
      }
    }
  ],
  "trade": {
    "instrument": {
      "option": {
        "payoff": {"type": "OPTION_TYPE_CALL", "plain": {"strike": 100}},
        "exercise": {"type": "TYPE_EUROPEAN", "dates": [{"iso": "2027-09-01"}]},
        "underlyings": [
          {
            "spotQuoteId": "S", "discountCurveId": "RC", "dividendCurveId": "QC",
            "volatilityId": "VOL", "process": "PROCESS_BLACK_SCHOLES_MERTON"
          }
        ],
        "vanilla": {}
      }
    },
    "engine": {"method": "METHOD_ANALYTIC"},
    "results": ["RESULT_KIND_NPV", "RESULT_KIND_DELTA", "RESULT_KIND_GAMMA", "RESULT_KIND_VEGA"]
  },
  "book": []
}
```

Three things in it are worth pointing at, because each is a decision rather
than a formatting choice.

**No number appears twice.** The discount curve says `"rate": {"quoteId": "R"}`
rather than `0.05`, and the trade names `"discountCurveId": "RC"` rather than
carrying a curve. That indirection in the file is the same indirection that
makes dragging a slider reprice without a rebuild — it is the market pane's
model written down.

**`"vanilla": {}` is not noise.** The style is a `oneof`, so the empty object is
what selects the arm. A basket would read
`"basket": {"kind": "KIND_MIN", "correlationId": "CORRM"}` in the same place,
with two entries in `underlyings`, each carrying a `label`.

**Enums are written as names.** `"METHOD_ANALYTIC"`, not `1`. A diff between two
workbooks is readable, and a renumbering of the schema cannot silently change
what an old file means.

**Import rejects rather than repairs.** A `version` this build does not read, a
missing market or a missing evaluation date throws, and the app keeps the
workbook it had — a half-decoded one would open a session against a market
nobody wrote. `book` is the single exception: it is absent from files written
before the book panel existed and reads back as empty, which is why adding it
needed no version bump.

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
