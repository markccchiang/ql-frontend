# The trade builder

An option is authored as four independent choices — **payoff × exercise ×
underlying × style** — with quanto composing over all four rather than
multiplying into products of its own. A swap is authored as *n* legs with a
schedule each.

## Styles, and what each one accepts

| Style | Exercise | Methods | Quanto |
| --- | --- | --- | --- |
| **vanilla** | European, American, Bermudan | analytic, lattice, finite difference; integral and Monte Carlo are European only | analytic or FD, European |
| **barrier** | European; American via lattice or FD | analytic (European only), lattice, FD, Monte Carlo | analytic or FD, European |
| **double barrier** | European | analytic | yes, analytic |
| **forward start** | European | analytic | yes |
| **Asian** | European | analytic (geometric), Monte Carlo (arithmetic) | no engine exists |
| **lookback** | European | analytic | no engine exists |
| **compound** | European, on both legs | analytic | no engine exists |
| **chooser** | European, on both legs | analytic | no engine exists |
| **cliquet** | European | analytic; Monte Carlo for the performance form | no engine exists |
| **basket** | European, **two or more assets** | analytic on two assets; Monte Carlo on any number | no engine exists |

Two arms are closed, and neither is a missing engine. **Spread** is a basket
with the spread accumulation: QuantLib 1.43 prices it through the basket
engines — `KirkEngine` is a `BasketOption::engine` — and the standalone
`SpreadOption` is a deprecated empty stub. **Digital** is a barrier carrying a
binary payoff — see below. Both trades price; it is the extra arm that is
closed in each case, and the interface never offers either.

```{figure} images/style-picker.png
:alt: The foot of the style picker: compound, chooser and basket in white, and spread greyed out with a sentence underneath saying QuantLib prices a spread through the basket engines and to choose basket instead.
:width: 340px

The foot of the style picker. A closed style stays in the list and carries its
own sentence, because hiding it would leave you wondering whether the service
cannot do it or whether you cannot find it. Neither of the two that are closed
says "not built": **spread** and **digital** both name the trade to send
instead, because in both cases that trade prices.
```

## The rules worth knowing before you author one

**Barrier.** The analytic engine is European only; an American barrier goes to
the lattice or the FD grid. The barrier lattice is **Cox-Ross-Rubinstein only**
(with the Derman-Kani correction), because the engine takes a second template
argument for the discretisation and a full menu would be trees ×
discretisations. Discrete and partial-time barriers — monitoring dates, a
window start — are not built.

**Knock digital.** Choose **barrier**, then a cash-or-nothing or
asset-or-nothing payoff. QuantLib has no digital-knock instrument — that shape
*is* the product, and the schema's `digital` style re-declares the barrier type,
the level and the cash payoff it already carries. It prices analytically on an
American exercise settled at expiry, and it takes **no rebate**: the engine
never reads one, so a rebate would be taken and dropped rather than refused.

**Double barrier.** Needs $0 < H_{\text{lower}} < H_{\text{upper}}$, and
analytic only: QuantLib's sole FD double-barrier engine is Heston, which takes
a calibrated model rather than a process.

**Forward start.** Send no strike. The strike is *moneyness* × the spot at the
reset date, filled in by the engine, and a struck payoff would be silently
overwritten. The **performance** flag pays the return rather than the amount —
a different price for the same trade description ({doc}`maths/exotics`).

**Asian.** No fixing dates means continuously averaged, which has a closed form
for the **geometric** average only. With fixing dates, geometric goes to the
analytic engine and arithmetic to Monte Carlo.

**Lookback.** Continuous only. The running extremum is required and must be
positive: an option already running whose extremum is dropped would price as if
it had just started. A floating payoff selects the floating-strike instrument.

**Compound.** An option on an option, and the only trade here with a second
payoff and exercise inside it. The compound's own — the *mother* — are the
trade's payoff and exercise, authored where every other style takes them; the
style block holds only the option written on. The schema's
`Compound.mother_payoff` and `mother_exercise` are those same two fields a
second time, and the service refuses them by name rather than choosing which
copy wins. Both legs are plain and European, and the compound has to expire on
or before the option it is written on.

```{figure} images/style-card-chooser.png
:alt: The style card with chooser selected: a choice date, a note that the strike and expiry are the trade's own and that there is no call or put, a shared-or-its-own put-leg switch set to its own, and a put strike and put expiry.
:width: 380px

A chooser with a put leg of its own, which is what makes it the *complex* one.
The card carries the two rules a field list cannot: the strike and expiry are
the trade's own, and there is no call or put to set.
```

**Chooser.** The right to decide later whether this is a call or a put, and
`choice date` is when. There is no call or put to author: both chooser
instruments build their own plain payoff and overwrite the type, so the payoff
type is left unset and the service refuses one that is set. The strike and the
expiry are the trade's own payoff and exercise, for the same reason the
compound's mother is; `Chooser.call_strike` and `call_expiry` in the schema are
those fields a second time and are refused by name.

The **put leg** control is what picks the instrument. Shared is the *simple*
chooser — one strike and one expiry for both sides. Its own is the *complex*
one, a different instrument and a different engine.

Three rules come from the engines rather than the product. All three curves
must count days the same way: the simple engine requires it, and the complex
one assumes it without checking. The exercise must be European, and neither
engine looks — an American one would price as European with the early exercise
dropped. And each complex leg has to expire more than **twice** the choice date
out, because the engine solves for the critical spot at (expiry − 2 × choice
time) and below that asks the volatility surface for a negative time.

**Cliquet.** A series of forward starts, each struck at a fraction of the spot
when its own period opens — a ratchet. It takes a percentage strike payoff for
the same reason a forward start does, plus the **reset dates**: in order,
distinct, each on or after today and before the expiry.

**Performance** picks the engine, exactly as it does on a forward start. The
ratchet pays the amount and prices analytically; the performance form pays the
return of each period and is the only one with a Monte Carlo engine, so a
sampled ratchet is refused rather than quietly given the wrong path pricer.

**Caps and floors are not offered**, and the reason is worth stating because it
is not the usual one. The four fields exist in the schema, but `CliquetOption`
never copies them to an engine — the comment in QuantLib's own source lists them
and the line below it does not — so a capped cliquet would price as the uncapped
ratchet and report nothing amiss. The service refuses them by name.

For the same reason, the gamma both closed forms publish is a placeholder `0.0`
rather than a computed number, so it comes back named absent. Asking for it and
getting nothing is the honest answer; getting a zero would not be.

```{figure} images/style-card.png
:alt: The style card with cliquet selected: the style picker, a reset-dates box, a ratchet-or-performance switch with no default, and a paragraph explaining that caps and floors are not offered.
:width: 380px

Picking a style swaps the block under the picker — a barrier gets a level and a
rebate, a chooser a choice date and a put leg, this one its reset dates.
**Performance** is a Flag with no default because it chooses the engine rather
than scaling the price, and the sentence at the bottom stands where the cap and
floor fields would have been.
```

**Basket.** The only style that takes more than one asset, and the only one
that names a **correlation matrix** in the market. Each asset gets its own
underlying card — spot, curves, volatility, process — plus a **label**, which
is what the matrix indexes on. Position is deliberately not the index: a
correlation matrix outlives the trade that names it, and reordering the assets
should not silently repair or break it.

How the assets are accumulated is what picks the engine, not a flavour of one
engine. A **minimum** or a **maximum** of two assets is Stulz; a **spread** is
Kirk, which is a formula on futures, so those reference rows send the Black
process. A **weighted average** has no closed form here at all, and neither
does any basket of three or more — both take Monte Carlo. **Weights** are read
by the average and by nothing else, so the field appears only there.

Finite difference is not offered: `Fd2dBlackScholesVanillaEngine` would price
two assets, but it wants two space grids where the engine block describes one,
and picking the second here would be the default nobody chose that every other
grid in this service refuses. An American basket is not offered either — that
is Longstaff-Schwartz, which needs a basis-function choice the schema cannot
carry.

The five greeks a multi-asset option does not have — theta per day, delta
forward, elasticity, strike sensitivity, ITM cash probability — come back named
absent, for the same reason any other engine's missing greek does.

**Vanilla.** A binary payoff on an American exercise is a one-touch and goes to
the digital American engine. An American analytic price **must** name an
approximation — see {doc}`engines`.

## Payoffs

Eight build: plain, percentage strike, asset-or-nothing, cash-or-nothing, gap,
super-fund, super-share, and floating. The two binary ones select an engine
rather than a formula: on a vanilla with an American exercise they give a
one-touch, and on a barrier a knock digital. Floating is valid on a lookback
only, which is a combination rule rather than a payoff rule, so the interface
closes
it elsewhere rather than the service refusing it later.

```{figure} images/trade-payoff.png
:alt: The payoff card with the kind picker open and scrolled to its foot: percentage strike, asset or nothing, cash or nothing, gap, super fund and super share in white, then floating strike greyed out with a sentence saying it is valid on a lookback only because it is struck at the realised extremum.
:width: 360px

Call or put and the kind are separate choices, and the second one can pick an
engine: a binary kind on the right exercise is a one-touch or a knock digital
rather than a different formula. **Floating strike** is closed here rather than
in the service — it is a valid payoff, on a lookback and nowhere else, so the
combination is closed where the choice is made.
```

## Exercise

European, American and Bermudan all build. European and American carry one
date; Bermudan carries every exercise date in order, the last of which is the
expiry. **Payoff at expiry** is read on American and Bermudan only and has no
default: with it set, the payoff is settled at expiry rather than on exercise,
which changes the price rather than the convention.

```{figure} images/trade-exercise.png
:alt: The exercise card with type Bermudan: a box holding three ISO dates one per line, and a payoff-at-expiry switch offering false and true with neither selected, under a red line saying it is required on an American or Bermudan exercise because it changes the price, not the wording.
:width: 340px

Bermudan, so the box takes every exercise date and the last of them is the
expiry. **Payoff at expiry** is a Flag with no default, and the card says why
it will not choose one for you: settling at expiry rather than on exercise is a
different price, not a different word for the same one.
```

## The underlying

Three processes build: Black-Scholes-Merton (the default), Black-Scholes and
Black. Exactly one underlying — a second is an error on the underlyings field,
not a silently ignored extra.

Black-Scholes **rejects** a dividend curve rather than ignoring it, since the
whole point of that process is $q = 0$. Omitting the dividend curve on
Black-Scholes-Merton means a flat zero yield, not the risk-free curve.

```{figure} images/trade-underlying.png
:alt: The underlying card with the process set to Black-Scholes, no dividend yield. The dividend curve select is disabled and outlined in red under a message saying PROCESS_BLACK_SCHOLES has no dividend yield, and to use Black-Scholes-Merton to give it one or to clear the curve.
:width: 340px

Black-Scholes chosen with a dividend curve still attached. The field is refused
rather than dropped, and the message names both ways out — a process whose
whole definition is $q = 0$ accepting a dividend curve quietly would be the
expensive kind of silence.
```

## Quanto

Quanto is not a product; it wraps the *engine*. It therefore composes over any
style whose engine can be built from a process alone, which is what keeps the
schema free of quanto-specific messages.

It needs all three of an FX risk-free curve, an FX volatility and a
correlation. Under quanto an FD request takes one of the three grid presets and
not an explicit size, because the wrapper constructs its inner engine from a
process alone and leaves no seam for grid dimensions.

```{figure} images/trade-quanto.png
:alt: The quanto card switched on, with FXC as the FX risk-free curve, FXV as the FX volatility and RHO as the correlation. The correlation field notes that it takes a quote in minus one to one, because the backend checks and QuantoTermStructure does not.
:width: 340px

All three or none, which is why the card asks for them together. The note under
the correlation is the division of labour: the service checks the range,
because `QuantoTermStructure` will take whatever number it is handed.
```

A **quanto lookback is refused by name**. QuantLib has no engine for one; this
build used to price it as a plain lookback and report no error at all. The
interface disables the switch so you do not spend a round trip finding out.

## Swaps

A general *n*-leg swap with two leg kinds — fixed and Ibor — priced by
discounting.

- **Pay or receive** is required on every leg. There is no default.
- **The fair rate needs exactly two legs, fixed first, then Ibor.** Any other
  arrangement is refused rather than answered with a fair rate computed off the
  wrong leg.
- Per-leg caps, floors, discount curve and currency are not built.
- A fixed leg freezes its rate at construction (see {doc}`market`).

```{figure} images/trade-leg.png
:alt: The fixed leg of the swap example: kind fixed, direction pays, start and maturity dates, frequency, business-day and termination conventions, calendar, end of month, day counter, a notional of ten million, a rate quote FIX, and an amber note that FixedRateLeg takes a value rather than a handle so the rate is read once at construction.
:width: 320px

One leg, whole. **Direction** has no default because a swap authored with the
wrong sign prices perfectly and answers a different question. The amber line at
the foot is the one place a market handle stops being live, and {doc}`market`
has what that costs.
```

The worked example prices a par five-year swap to an NPV of $-0.000002$ with a
fair rate of $0.027000$ — exactly the 5Y pillar its curve was stripped from,
which is the whole chain agreeing with itself: bootstrap, index, fixings, both
legs and discounting.
