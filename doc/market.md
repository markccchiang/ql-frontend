# The market pane

The market is an ordered, id-addressed namespace. Every object has an id that
is unique within the session, and instruments name those ids rather than
carrying numbers of their own. That indirection is what makes a quote write
reprice a trade: the trade holds a *handle* to the quote, not a copy of it.

## The five kinds this build serves

| Kind | What it is | Live? |
| --- | --- | --- |
| **quote** | A single number — spot, a rate, a volatility, a correlation. The concrete object everything else observes | yes, always |
| **yield curve** | A discount curve: flat, interpolated zero, interpolated discount, or bootstrapped from instruments | flat and bootstrap only |
| **volatility** | Constant, a variance curve by expiry, or a variance surface over expiries × strikes | constant only |
| **index** | An Ibor or overnight index, built from the conventions you send | — |
| **fixings** | Past fixings for an index, which a leg mid-period cannot price without | yes |

Default curves, inflation curves and correlation surfaces are in the schema and
are not built.

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

## Which curves take live quotes

This is the rule most worth internalising, because it decides which edits are
free:

| Shape | Nodes may be quotes? |
| --- | --- |
| `flat` | **yes** — the rate can be a quote id |
| `bootstrap` | **yes** — the helper quotes are live, so bumping a pillar re-bootstraps |
| `zero` | no — nodes must be fixed numbers |
| `discount` | no — nodes must be fixed numbers |

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

## Fixings

Past fixings are graph *input*, not graph *structure*, so they may arrive
either when the session is opened or in a later live update. A floating leg
that has already fixed for the current period needs its fixing before it can
price, and supplying it does not cost a rebuild.

## Two traps the interface calls out

**A fixed leg's rate is frozen.** QuantLib's `FixedRateLeg` takes a value
rather than a handle, so the rate is read once when the leg is built. The quote
is drawn in amber in the quote bar and its slider is disabled: price the trade
again to move it. This is the one place the handle discipline is knowingly not
kept, and the interface says so rather than letting you drag a slider that does
nothing.

**No dividend curve means zero, not the risk-free curve.** Omitting the
dividend curve gives a flat zero dividend yield, which is a different price
from the one you get by defaulting it to the risk-free curve. The underlying
card says so rather than leaving the field blank.
