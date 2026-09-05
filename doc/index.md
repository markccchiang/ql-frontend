# qlservice

A workbench for pricing options and swaps against a **live QuantLib object
graph**. The graph lives in a C++ service (`ql-backend`); this app is the
browser front end that authors a market, authors a trade, and asks for prices
over a binary WebSocket.

The thing that makes it different from a calculator is the word *live*. A
session on the service holds the built graph between requests, so moving a
quote reprices only what depends on that quote — no rebuild, no re-parse, one
round trip. Everything in the interface follows from that one fact, and so does
most of this guide.

```{toctree}
:maxdepth: 2
:caption: Using it

getting-started
interface
market
trades
engines
results
studies
troubleshooting
```

```{toctree}
:maxdepth: 2
:caption: The mathematics

maths/index
maths/black-scholes
maths/greeks
maths/american
maths/exotics
maths/quanto
maths/rates
maths/numerics
```

## What this build prices

Six option styles — vanilla, barrier, double barrier, Asian, lookback and
forward start — over eight payoffs and three exercise types, with quanto
composing over four of the styles, plus an *n*-leg fixed-against-Ibor swap.
Behind them are 39 distinct compiled engines across six methods: analytic,
lattice, finite difference, Monte Carlo, integral and discounting.

That list is not a promise this guide makes on the service's behalf. The
service publishes it: the client asks `Hello` on connect and the answer is a
`Capabilities` frame naming every style, payoff, tree, preset and result kind
this build actually dispatches. The interface greys out everything outside it
and says why, and a badge appears in the status bar if the two ever disagree.

## Where the other documents are

This guide is for someone *using* the workbench. Four other documents sit
behind it and are worth knowing about:

| Document | What it is for |
| --- | --- |
| `UI.md` | The short version of {doc}`interface`, in the repository root |
| `ql-backend/HANDLERS.md` | Every frame and field the service accepts, with the rules |
| `ql-backend/DESIGN.md` | Why the service is shaped the way it is, cited to QuantLib |
| `PLAN.md` | The design record for this client, including what was not built |

Where this guide states a rule of the pricing service, `HANDLERS.md` is the
authority; where it states a formula, the citation is to QuantLib's own source,
which is vendored in the backend checkout at `third_party/QuantLib` and pinned
at **v1.43**.
