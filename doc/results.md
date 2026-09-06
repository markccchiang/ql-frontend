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

The same list carries a kind that does not apply to the instrument at all: a
fair rate asked of an option, a greek asked of a swap.

And it carries one case that is not about what the engine publishes but about
what it publishes *badly*. Both cliquet closed forms set gamma to a literal
`0.0` rather than computing it — and the performance one does the same to
delta — which would arrive here as a number rather than as an absence. Those
kinds are named absent for the cliquet instead, because a zero nobody computed
is the one answer this list exists to prevent.

## Implied volatility

This is the one result that takes an input of its own. It is a root find, not a
published quantity, so the request must carry **the price to invert** and,
optionally, the bracket and tolerance to search in. Left empty, the request is
refused rather than answered — inverting the price the request is about to
compute would hand back the volatility you sent.

The **from last price** button fills in the NPV that came back last, which is
the usual question: what volatility does *this* price imply.

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

## The engine echo, and the pin

Every result carries the engine **as it ran**. Pin one and every later price
shows a Δ against it, engine echo included, so a comparison always says what it
is comparing. Differences are marked with ▲ and ▼ as well as colour.
