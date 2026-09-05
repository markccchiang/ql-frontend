# Numerical methods, and what their errors look like

Three of the six methods are approximations with an error you can control by
spending time. Knowing the shape of each error is the difference between
choosing a step count and guessing one.

## Finite difference

The engine discretises the Black-Scholes equation on a grid in
$x = \ln S$ and $t$, applies the payoff as the terminal condition, and steps
backwards, applying the early-exercise constraint at each step where the option
allows it. The grid is **time steps × asset steps**:

| Preset | Grid |
| --- | --- |
| coarse | 100 × 100 |
| standard | 400 × 200 |
| fine | 2000 × 800 |

The error has two parts — truncation in time and in space — and they do not
shrink together. Doubling the asset steps without the time steps buys little;
the presets move both. A price that changes in the third decimal between
*standard* and *fine* is telling you the grid is not converged, not that the
trade is worth something in between.

QuantLib's default scheme for these engines is **Douglas**, which is
Crank-Nicolson-like: second-order accurate in time, and prone to oscillation
near a payoff kink or a barrier unless the first few steps are damped
(the Rannacher trick).

:::{warning}
The schema carries a **scheme** and a **damping steps** field on the custom
grid, and this build of the service reads neither: every FD price runs the
Douglas scheme with no damping steps. Only the two grid dimensions are honoured.
:::

For a barrier, put the barrier *on* a grid line if you can — the standard
failure mode of an FD barrier price is a barrier that falls between two nodes,
and it shows up as a price that jumps as the grid is refined rather than
settling.

## Monte Carlo

The estimator is the discounted sample mean of the payoff:

$$\hat V = e^{-rT}\,\frac{1}{N}\sum_{i=1}^{N}\text{payoff}\big(S^{(i)}\big),
\qquad
S_T^{(i)} = S_0 \exp\!\left(\left(r - q - \tfrac{\sigma^2}{2}\right)T + \sigma\sqrt{T}\,Z_i\right).$$

Its standard error is

$$\text{s.e.} = \frac{s}{\sqrt{N}},$$

where $s$ is the sample standard deviation of the discounted payoffs. That is
what the **error estimate** on the result is, and the two things to remember
about it are that it is a *standard error, not a bound* — the true value is
outside $\pm 1$ s.e. about a third of the time — and that it shrinks as
$1/\sqrt{N}$, so a decimal place costs a hundredfold in paths.

**Path dependence needs steps.** A European payoff only needs the terminal
value, so one step is enough and the simulation is exact. A barrier or an Asian
needs the path, and then the *steps per year* setting introduces a second
error: a discretely monitored simulation misses barrier crossings between
steps, which biases a knock-out price upwards. More steps, or a control
variate, is the answer; more paths is not.

**Control variates.** The arithmetic Asian engine can subtract the simulation
error of the *geometric* Asian, whose value is known in closed form
({doc}`exotics`). The two averages are highly correlated, so the variance of
the difference is far smaller than the variance of either. It is the single
best-value option on that panel.

### Reproducibility, and why batching changes the number

The seed must be non-zero — QuantLib otherwise seeds from the clock, and the
same request would price differently every time.

Asking for progress switches the engine to a **batched** path: the run is split
into batches with seeds derived per batch, and the results accumulated on the
service's side. That draws from the random number stream in a different order
from one run of the same total, so the answer differs. Measured on the
reference trade at one seed and sample count:

| Run | Price |
| --- | --- |
| single shot | 9.288545 |
| batched | 9.307731 ± 0.031144 |
| analytic | 9.297476 |

Both simulations are within a standard error of the analytic value; neither is
wrong. Reproducibility therefore keys on the **triple** (seed, samples, batch
size), which is why the result echoes the whole engine block back and why the
engine echo is on the face of every price.

## Trees

Covered in {doc}`american`. In summary: the first five trees converge as
$O(1/n)$ with oscillation; Leisen-Reimer and Joshi4 converge smoothly and about
an order faster, at the cost of needing the strike and an odd step count.

## The implied-volatility root find

Inverting a price is a one-dimensional root find on

$$g(\sigma) = V(\sigma) - V^{\ast} = 0,$$

solved by Brent's method inside a bracket. Three things go wrong with it in
practice:

- **No root.** A target price outside the no-arbitrage bounds — below intrinsic,
  above the underlying — has no solution and the search fails rather than
  returning the nearest boundary.
- **A flat objective.** Deep in or out of the money, vega is tiny, so a wide
  range of volatilities reproduces the price to within tolerance. The answer is
  then genuinely ill-conditioned, and tightening the tolerance does not help.
- **Cost.** Each iteration is a full engine call. On an analytic vanilla that
  is nothing; on a barrier it is not, which is why the bracket and the
  tolerance are exposed on the card.

QuantLib can invert a vanilla, a barrier and a double barrier. Any other style
returns the kind as unavailable.

## A closing note on comparing engines

Two engines on the same trade will not agree exactly, and the differences above
are why. A sensible discipline:

1. Price analytically where a closed form exists — that is the reference.
2. Use a lattice with many steps, or a fine grid, as the reference where none
   does.
3. Treat a Monte Carlo number as a distribution, and read its error estimate
   before its digits.
4. Always read the engine echo. Two prices are only comparable when you know
   what produced each, which is why this application puts it on the face of
   every result.
