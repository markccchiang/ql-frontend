# Reading results

The NPV always comes back. Everything else is asked for by name: tick the
result kinds you want and the answer is a map keyed by those names.

## The nineteen kinds

| Kind | Meaning |
| --- | --- |
| NPV | The price |
| delta, gamma | First and second derivative in spot |
| theta, theta per day | Time decay; per-day is the annual figure over 365 |
| vega | Sensitivity to volatility |
| rho, dividend rho | Sensitivity to the risk-free and dividend curves |
| delta forward | Derivative in the *forward* rather than the spot |
| elasticity | Delta scaled by spot over price — the option's leverage |
| strike sensitivity | Derivative in the strike |
| ITM cash probability | Risk-neutral probability of finishing in the money |
| implied volatility | The volatility that reproduces a price you supply |
| qrho, qvega, qlambda | Quanto: the foreign rate, the FX volatility, the correlation |
| fair rate | The rate that makes a two-leg swap worth zero |
| leg NPV, leg BPS | Per-leg present value, and value of a basis point |

The formulas are in {doc}`maths/greeks`.

```{figure} images/results-kinds.png
:alt: The results control: pills reading NPV, delta, gamma, vega, theta per day, elasticity, ITM cash probability and rho, under a description saying one an engine cannot supply comes back named as not supplied rather than as a missing key, and a checkbox below for the engine's own additional results.
:width: 100%

Asked for by name, one pill each; the NPV comes whether or not it is there. The
line under the control is the promise the next section is about, and the
checkbox at the foot is what adds the engine's own extras.
```

## "Not supplied" is not zero

Engines publish different things. QuantLib's analytic European engine has a
vega; the binomial engine does not; the American approximations publish almost
no greeks at all. Asked for something it cannot supply, the service **names the
absence**: the kind comes back in a list of unavailable results and the price
comes back with it.

This matters because a client that asked for vega and got a map without it
cannot tell that from a vega of zero. The results grid reads "not supplied" on
that row. Refusing the whole request instead would cost the price as well —
which is why the service does not do it.

```{figure} images/results-absent.png
:alt: The result pane after a lattice price: NPV 9.287603, delta and gamma with numbers, then VEGA, THETA_PER_DAY, ELASTICITY, ITM_CASH_PROBABILITY and RHO each reading "not supplied" in amber, above an engine line reading lattice, cox ross rubinstein, 200 steps.
:width: 360px

Eight kinds asked of a Cox-Ross-Rubinstein lattice. Delta and gamma the tree
publishes; the other five it does not, and each one is named rather than
dropped. The price came back all the same, which is the whole design of this
list.
```

The same list carries a kind that does not apply to the instrument at all: a
fair rate asked of an option, a greek asked of a swap.

And it carries one case that is not about what the engine publishes but about
what it publishes *badly*. Both cliquet closed forms set gamma to a literal
`0.0` rather than computing it — and the performance one does the same to
delta — which would arrive here as a number rather than as an absence. Those
kinds are named absent for the cliquet instead, because a zero nobody computed
is the one answer this list exists to prevent.

A **basket** puts five kinds on the list at once, and for a plainer reason: a
multi-asset option in QuantLib does not declare them. Theta per day, delta
forward, elasticity, strike sensitivity and ITM cash probability all belong to
the single-asset instrument; a basket stops at delta, gamma, theta, vega, rho
and dividend rho. Ask for one of the five and it comes back named absent, the
same as any other greek an engine does not publish.

## Implied volatility

This is the one result that takes an input of its own. It is a root find, not a
published quantity, so the request must carry **the price to invert** and,
optionally, the bracket and tolerance to search in. Left empty, the request is
refused rather than answered — inverting the price the request is about to
compute would hand back the volatility you sent.

The **From Last Price** button fills in the NPV that came back last, which is
the usual question: what volatility does *this* price imply.

```{figure} images/results-impliedvol.png
:alt: The implied volatility card: a target price of 12.459717 with a "From Last Price" button beside it, and accuracy, min volatility and max volatility all zero, each noting that zero leaves QuantLib's own.
:width: 100%

The card appears only when the kind is asked for, because it is the only
request that carries an input of its own. **From Last Price** has just filled
the target with the NPV that came back a moment ago; the three search fields
left at zero leave QuantLib's own defaults in place.
```

QuantLib can invert a vanilla, a barrier and a double barrier. Asked of any
other style, the kind comes back named absent like any other unsupplied result.

## Additional results

Ask for them and the engine's own published extras come back as well. Every
value at this layer is a **scalar** — the vector and matrix forms are not
filled — and the Monte Carlo error estimate is populated whenever the engine
has one.

## Cash flows

Served for cash-flow instruments, which today means swaps. Each row carries its
payment date, the amount, the discount factor the engine used, and their
product, so **the present-value column sums to the NPV**. That property is what
makes the table worth showing rather than decorating, and the service's own
smoke test checks it.

Coupons add their accrual dates, notional and rate; floating coupons add the
fixing date, the spread and the gearing, and say whether the fixing came from
the fixing history or is still a forecast. Rows already paid are left out.

```{figure} images/results-cashflows.png
:alt: The cash-flow table for the five-year swap: columns for leg, payment date, notional, rate, fixing, amount, discount and present value. The fixed leg's rows carry 2.7000 per cent and no fixing; the floating rows carry a rate and a fixing-date badge, the first highlighted in green and the second in grey.
:width: 100%

Both legs in one table, and the present-value column adds up to the NPV. The
badge in the fixing column is the distinction that matters when a leg is mid
period: green for a fixing taken from the history you supplied, grey for one
the curve is still forecasting.
```

Asked of an option it is refused: an empty table would read as an instrument
that happens to have no cash flows rather than one that was never going to have
any.

## Curve samples

The curve panel draws the term structure **sampled from the very handle the
engine priced against**, which is the point of it. The alternative — shipping
the curve and re-implementing QuantLib's interpolation in the browser — is how
a front end ends up drawing a curve the service did not price with.

Four quantities are served:

| Quantity | On | Needs |
| --- | --- | --- |
| zero rate | a yield curve | compounding, frequency, and a day counter when sampling by date |
| forward rate | a yield curve | the same |
| discount factor | a yield curve | nothing; a compounding set beside it is rejected rather than ignored |
| Black volatility | a volatility surface | exactly one strike |

Sample by dates or by times, one of the two. Sampling a surface across several
strikes is refused because it would be a matrix rather than a series.

```{figure} images/results-curve.png
:alt: The curve panel: quantity set to discount factor, curve set to BC — Bootstrapped curve, five years across sixty points, and a chart titled BC.discountFactor against years falling from 1 to about 0.87.
:width: 100%

Sixty points off the bootstrapped curve, which come back with the next price
rather than from anything rebuilt on this side. A discount factor needs no
compounding or frequency, so the panel does not ask for any — pick a zero rate
instead and it does.
```

## The engine echo, and the pin

Every result carries the engine **as it ran**. Pin one and every later price
shows a Δ against it, engine echo included, so a comparison always says what it
is comparing. Differences are marked with ▲ and ▼ as well as colour.

```{figure} images/results-pin.png
:alt: The result pane with a baseline pinned: NPV 16.030340 with a green up-triangle and 6.732864 beside it, delta, gamma and vega each with their own signed difference, an engine line reading analytic, and a final line reading against baseline 9.297476, analytic.
:width: 360px

The same trade after the spot moved, against a pinned baseline. Every row
carries its own difference, and the last line names what is being compared: the
baseline's price *and* the engine that produced it, so a comparison across two
engines can never be mistaken for one across two markets.
```
