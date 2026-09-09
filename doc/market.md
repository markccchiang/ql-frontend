# The market pane

The market is an ordered, id-addressed namespace. Every object has an id that
is unique within the session, and instruments name those ids rather than
carrying numbers of their own. That indirection is what makes a quote write
reprice a trade: the trade holds a *handle* to the quote, not a copy of it.

## The six kinds this build serves

| Kind | What it is | Live? |
| --- | --- | --- |
| **quote** | A single number — spot, a rate, a volatility, a correlation. The concrete object everything else observes | yes, always |
| **yield curve** | A discount curve: flat, interpolated zero, interpolated discount, or bootstrapped from instruments | flat and bootstrap only |
| **volatility** | Constant, a variance curve by expiry, or a variance surface over expiries × strikes | constant only |
| **index** | An Ibor or overnight index, built from the conventions you send | — |
| **fixings** | Past fixings for an index, which a leg mid-period cannot price without | yes |
| **correlation** | A square matrix over labelled assets, which a basket names | off-diagonals only |

Default curves and inflation curves are in the schema and are not built.

```{figure} images/market-add-menu.png
:alt: The market pane with the add menu open, listing quote, flat yield curve, bootstrapped yield curve, constant volatility, index, fixings and correlation matrix. Behind it the pane lists the seven objects of the default workbook, each with its id and its kind.
:width: 440px

What the pane will make, which is a shorter list than the table above and
deliberately so: the two curve shapes that can take a live quote, the one
volatility that can, and nothing that exists only in the schema. Nothing this
build would refuse can be created here by accident.
```

## Correlation matrices

A basket is the only thing that names one. The **labels** are its rows and
columns, and an underlying finds its row by label rather than by position —
a matrix outlives the trade that names it, and reordering the assets should
not silently repair or break it.

The editor gives you the upper triangle. Writing a cell writes its mirror,
because a correlation matrix is symmetric and one that disagrees with itself is
one the service refuses; the diagonal is not editable at all. Each off-diagonal
can be a literal or a **quote id**, and a quote id is what makes a correlation
draggable in the quote bar and sweepable like any other number — the service
reads the matrix afresh on every request, which is the only reason a moved
correlation reaches the price at all.

```{figure} images/correlation-grid.png
:alt: A three-label correlation matrix in the market editor: a grid with a fixed diagonal of 1, the lower triangle read-only, and the upper triangle editable — one cell naming a quote RHO_AB and two carrying literals.
:width: 420px

Three assets, so three numbers. `A` against `B` is live off a quote and the
other two are literals; the mirrored halves and the diagonal are not editable,
because a matrix that disagrees with itself is one the service refuses.
```

Four things are checked, and all four are checked again on every request that
uses the matrix, because the entries are quotes and a legal matrix can be
dragged into an illegal one: unit diagonal, symmetry, every entry in
$[-1, 1]$, and **positive semi-definiteness**. That last one is the reason this
object is validated at all. Three pairwise correlations can each be legal and
jointly impossible — 0.9, 0.9 and −0.9 is the standard example — and QuantLib
would not complain. `StochasticProcessArray` factorises with spectral
salvaging, which *repairs* an impossible matrix by zeroing its negative
eigenvalues. The price you would get back is correct, for a market that is not
the one you described.

## Dependency order, and the one exception

Objects are resolved against the session's maps as they arrive, so **they must
be sent in dependency order**. The app sorts them topologically on the way out;
you never order them by hand.

One edge is allowed to point forwards: an index may name a forwarding curve
defined later in the same market. That is not a convenience, it is a necessity
— a bootstrapped curve's pillars name the index for their conventions, and the
index names the curve it forecasts off. The index is built on a relinkable
handle and wired up when its curve appears. A curve that never appears is an
`UNKNOWN_ID` error on the index.

The **load swap example** button builds exactly this shape: a five-year
fixed-against-Euribor-6M swap, an index, the curve bootstrapped from live
pillars, and the fixings.

```{figure} images/market-swap-list.png
:alt: The market pane after loading the swap example: four rate quotes D6M, S2Y, S5Y and S10Y, the fixed-rate quote FIX, then IDX the index, BC the bootstrapped yield curve, and FIXINGS.
:width: 420px

The shape it builds, in the order it is sent. `IDX` goes out before `BC` and
names it — the one edge allowed to point forwards — and `BC`'s pillars name
`IDX` back for their conventions. Neither could be sent first without the
other, which is why the app sorts the market instead of asking you to.
```

## Which curves take live quotes

This is the rule most worth internalising, because it decides which edits are
free:

| Shape | Nodes may be quotes? |
| --- | --- |
| `flat` | **yes** — the rate can be a quote id |
| `bootstrap` | **yes** — the helper quotes are live, so bumping a pillar re-bootstraps |
| `zero` | no — nodes must be fixed numbers |
| `discount` | no — nodes must be fixed numbers |

```{figure} images/market-flat-curve.png
:alt: The editor for RC, a flat yield curve: id, display name, day counter, then a rate row with a two-way switch reading live quote or fixed, set to live quote and naming R — Risk-free rate, then compounding and frequency.
:width: 420px

A flat curve, live. That switch is the whole of the rule: **live quote** names
a quote id and every write to it reaches this curve; **fixed** takes a number
that will not move again. An interpolated curve is offered no such switch,
because there would be nothing honest to put behind it.
```

The two interpolated shapes refuse a quote id rather than accepting one and
quietly never observing it: QuantLib's interpolated curves **copy** their nodes
at construction, so a handle there would look live and be dead. Their first
node must also equal the session's evaluation date, because the curve takes
`dates[0]` as its reference date.

Volatility follows the same pattern: a constant surface may be driven by a
quote; a variance curve or surface is built and frozen.

## Bootstrapping

A bootstrapped curve is `PiecewiseYieldCurve<Traits, Interpolator>`, and both
parameters are compile-time types. This build compiles three of each:

| traits | interpolator |
| --- | --- |
| discount, zero yield, forward rate | linear, log-linear, cubic |

Nine combinations, and that is the whole menu — each pair is a distinct C++
type that has to be named in source, so the enum is a list of what was
compiled in rather than a description of what QuantLib can do. The mathematics
is in {doc}`maths/rates`.

Deposit helpers take their tenor from the pillar and their conventions from the
named index, so one index can back pillars of several tenors.

```{figure} images/market-bootstrap.png
:alt: The editor for BC, a bootstrapped curve: day counter, traits set to discount, interpolator set to log linear, then pillar 1 with kind deposit, tenor 6M, quote D6M, and index IDX under the note that conventions come from here.
:width: 420px

The pair at the top is the compiled type — `discount` × `log linear` is one of
the nine — and the pillars below it each name a quote for their level and an
index for their conventions. The quote is what makes a bump re-bootstrap; the
index is what makes one convention set serve a deposit at 6M and a swap at ten
years.
```

## Fixings

Past fixings are graph *input*, not graph *structure*, so they may arrive
either when the session is opened or in a later live update. A floating leg
that has already fixed for the current period needs its fixing before it can
price, and supplying it does not cost a rebuild. Taking one away does: a
fixing cannot be un-added from a live index, so removing a line is the one
edit in this box that raises the rebuild bar.

```{figure} images/market-fixings.png
:alt: The fixings editor: id FIXINGS, display name Euribor fixings, the index the fixings belong to, and a box holding one fixing per line as an ISO date and a decimal rate, under a note that adding or changing a fixing reaches the live session as an update and that removing one needs a rebuild.
:width: 420px

One per line, and the sentence under the box is the whole distinction: adding
or changing a fixing reaches the live session as an ordinary update, with no
rebuild bar, while removing one is structural. Each keystroke that leaves a
parseable line is sent, so the graph is never a fixing behind the box.
```

## Two traps the interface calls out

**A fixed leg's rate is frozen.** QuantLib's `FixedRateLeg` takes a value
rather than a handle, so the rate is read once when the leg is built. The quote
is drawn in amber in the quote bar and its slider is disabled: price the trade
again to move it. This is the one place the handle discipline is knowingly not
kept, and the interface says so rather than letting you drag a slider that does
nothing.

```{figure} images/market-fixed-rate.png
:alt: The quote bar with a live session: D6M, S2Y, S5Y and S10Y each with a value and a green slider carrying a handle, and FIX at the right in amber with a grey slider that has no handle at all.
:width: 100%

Four rates that reach the price by moving, and one that does not. `FIX` is the
fixed leg's rate — amber, and its slider deliberately dead, because
`FixedRateLeg` read the number once when the leg was built. Everything else on
this bar is a handle the graph is still watching.
```

**No dividend curve means zero, not the risk-free curve.** Omitting the
dividend curve gives a flat zero dividend yield, which is a different price
from the one you get by defaulting it to the risk-free curve. The underlying
card says so rather than leaving the field blank.
