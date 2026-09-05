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

Cliquet, digital, compound, chooser, basket and spread are in the schema and
are not built. The interface never offers them.

## The rules worth knowing before you author one

**Barrier.** The analytic engine is European only; an American barrier goes to
the lattice or the FD grid. The barrier lattice is **Cox-Ross-Rubinstein only**
(with the Derman-Kani correction), because the engine takes a second template
argument for the discretisation and a full menu would be trees ×
discretisations. Discrete and partial-time barriers — monitoring dates, a
window start — are not built.

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

**Vanilla.** A binary payoff on an American exercise is a one-touch and goes to
the digital American engine. An American analytic price **must** name an
approximation — see {doc}`engines`.

## Payoffs

Eight build: plain, percentage strike, asset-or-nothing, cash-or-nothing, gap,
super-fund, super-share, and floating. Floating is valid on a lookback only,
which is a combination rule rather than a payoff rule, so the interface closes
it elsewhere rather than the service refusing it later.

## Exercise

European, American and Bermudan all build. European and American carry one
date; Bermudan carries every exercise date in order, the last of which is the
expiry. **Payoff at expiry** is read on American and Bermudan only and has no
default: with it set, the payoff is settled at expiry rather than on exercise,
which changes the price rather than the convention.

## The underlying

Three processes build: Black-Scholes-Merton (the default), Black-Scholes and
Black. Exactly one underlying — a second is an error on the underlyings field,
not a silently ignored extra.

Black-Scholes **rejects** a dividend curve rather than ignoring it, since the
whole point of that process is $q = 0$. Omitting the dividend curve on
Black-Scholes-Merton means a flat zero yield, not the risk-free curve.

## Quanto

Quanto is not a product; it wraps the *engine*. It therefore composes over any
style whose engine can be built from a process alone, which is what keeps the
schema free of quanto-specific messages.

It needs all three of an FX risk-free curve, an FX volatility and a
correlation. Under quanto an FD request takes one of the three grid presets and
not an explicit size, because the wrapper constructs its inner engine from a
process alone and leaves no seam for grid dimensions.

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

The worked example prices a par five-year swap to an NPV of $-0.000002$ with a
fair rate of $0.027000$ — exactly the 5Y pillar its curve was stripped from,
which is the whole chain agreeing with itself: bootstrap, index, fixings, both
legs and discounting.
