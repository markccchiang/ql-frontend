# The exotic styles

All five exotic styles this build prices have closed forms inside the same
Black-Scholes model — that is why they are analytic engines rather than grids.
Each one is a different set of boundary conditions on the same equation.

Throughout: $b = r - q$, $v = \sigma\sqrt{T}$, and

$$\mu = \frac{b - \tfrac{1}{2}\sigma^2}{\sigma^2},
\qquad
\lambda = \sqrt{\mu^2 + \frac{2r}{\sigma^2}}.$$

## Barrier

A barrier option is a vanilla that is switched on (*in*) or off (*out*) if the
spot touches $H$ before expiry. The closed form is Merton (1973) and
Reiner-Rubinstein (1991), and it is assembled from six terms. With
$\phi = \pm 1$ for call/put and $\eta = \pm 1$ for down/up:

$$x_1 = \frac{\ln(S/K)}{v} + (1+\mu)v, \qquad
x_2 = \frac{\ln(S/H)}{v} + (1+\mu)v,$$

$$y_1 = \frac{\ln\!\big(H^2/(SK)\big)}{v} + (1+\mu)v, \qquad
y_2 = \frac{\ln(H/S)}{v} + (1+\mu)v, \qquad
z = \frac{\ln(H/S)}{v} + \lambda v,$$

$$\begin{aligned}
A &= \phi S D_q N(\phi x_1) - \phi K D_r N(\phi x_1 - \phi v),\\
B &= \phi S D_q N(\phi x_2) - \phi K D_r N(\phi x_2 - \phi v),\\
C &= \phi S D_q (H/S)^{2(\mu+1)} N(\eta y_1) - \phi K D_r (H/S)^{2\mu} N(\eta y_1 - \eta v),\\
D &= \phi S D_q (H/S)^{2(\mu+1)} N(\eta y_2) - \phi K D_r (H/S)^{2\mu} N(\eta y_2 - \eta v),\\
E &= R\,D_r\big[N(\eta x_2 - \eta v) - (H/S)^{2\mu} N(\eta y_2 - \eta v)\big],\\
F &= R\big[(H/S)^{\mu+\lambda} N(\eta z) + (H/S)^{\mu-\lambda} N(\eta z - 2\eta\lambda v)\big],
\end{aligned}$$

where $R$ is the rebate. Each of the eight barrier types is a signed sum of
these: a down-and-in call with $K > H$ is $C + E$; a down-and-out call with
$K > H$ is $A - C + F$; and so on. $E$ is the rebate paid *at expiry*, $F$ the
rebate paid *at hit*.

Two properties are worth using as checks, and the service's own test suite
uses both:

$$V_{\text{in}} + V_{\text{out}} = V_{\text{vanilla}} \quad (R = 0),$$

and an unreachable barrier degrades to the vanilla price exactly.

**What is not built:** discrete monitoring and partial-time (window) barriers.
The formula above assumes the barrier is monitored *continuously*, which is
worth remembering when comparing against a contract that is monitored daily —
continuous monitoring is worth strictly more knock-out protection, so the
prices differ systematically rather than randomly.

## Double barrier

Two barriers, $0 < L < U$, both monitored continuously. The closed form is
Ikeda-Kunitomo (1992): repeated reflection between the two levels produces an
**infinite series of image terms**, each one a normal probability, converging
geometrically. QuantLib truncates it; the truncation error is far below the
tolerance you would price to.

There is no finite-difference route for this style in the build, because
QuantLib's only FD double-barrier engine is a Heston engine and takes a
calibrated model rather than a process.

## Asian

An Asian option pays off against the **average** of the underlying rather than
its terminal value. Whether there is a closed form depends entirely on which
average.

**Geometric, continuous.** The geometric average of a geometric Brownian motion
is itself lognormal, so the option is a Black-Scholes option with adjusted
parameters. QuantLib prices it as a Black formula with

$$\sigma_G = \frac{\sigma}{\sqrt{3}},
\qquad
q_G = \frac{1}{2}\left(r + q + \frac{\sigma^2}{6}\right),$$

the second being an effective dividend yield
(`ql/pricingengines/asian/analytic_cont_geom_av_price.cpp`). The
$1/\sqrt{3}$ is the whole story of an Asian: averaging over the life of the
option cuts the variance of the terminal quantity to a third, so an Asian is
always worth less than the corresponding vanilla.

**Geometric, discrete.** With fixing dates the average is over a finite set,
and $\ln G$ is again normal — with mean and variance computed from the fixing
times rather than from the closed-form limit. Same Black formula, different
moments.

**Arithmetic.** The sum of lognormals is not lognormal and there is no exact
closed form, so this is the one style in the build that *must* go to Monte
Carlo. QuantLib's engine can use the geometric average as a **control
variate** — it is highly correlated with the arithmetic average and its value
is known exactly, so subtracting its simulation error removes most of the
noise. Turn it on when you have one; it is worth far more than the same time
spent on extra paths.

## Lookback

A lookback pays off against the running extremum of the path, which must be
supplied: an option already part-way through its life whose extremum is dropped
would price as though it had just started.

- **Floating strike:** a call pays $S_T - m$, where $m$ is the running minimum.
- **Fixed strike:** a call pays $\max(M - K, 0)$, where $M$ is the running
  maximum.

Both have closed forms under continuous monitoring — Goldman-Sosin-Gatto (1979)
for the floating case, Conze-Viswanathan (1991) for the fixed. The floating
call is

$$c = S D_q N(a_1) - m D_r N(a_2)
 + S D_r \frac{\sigma^2}{2b}\left[\left(\frac{S}{m}\right)^{-2b/\sigma^2} N\!\left(-a_1 + \frac{2b\sqrt{T}}{\sigma}\right) - e^{bT}N(-a_1)\right],$$

$$a_1 = \frac{\ln(S/m) + (b + \tfrac{1}{2}\sigma^2)T}{\sigma\sqrt{T}},
\qquad a_2 = a_1 - \sigma\sqrt{T}.$$

The third term is the value of the *option to have done better* — the part that
distinguishes a lookback from a vanilla struck at the extremum. Note it is
singular as $b \to 0$; the engine handles that limit, but it is why a lookback
is unusually sensitive to the carry.

Continuous monitoring again: a lookback priced against a daily-observed
contract is an upper bound.

## Forward start

The strike is not known yet. It is set at the reset date $t_1$ to a multiple of
the spot then, $K = m\,S_{t_1}$, so the option's *moneyness* is fixed but its
strike is not — which is why the trade carries no strike and a struck payoff
would be silently overwritten.

Because the Black-Scholes price is homogeneous of degree one in $(S, K)$, the
value at $t_1$ is $S_{t_1}$ times the value of a unit-spot option struck at
$m$ over the remaining life $\tau = T - t_1$. Discounting that back:

$$V_0 = D_q(t_1)\; S_0 \; V_{\text{BS}}\big(1,\ m,\ \tau\big).$$

QuantLib composes this literally: the forward engine prices the inner vanilla
and multiplies by the dividend discount to the reset date
(`ql/pricingengines/forward/forwardengine.hpp`).

The **performance** variant pays the *return* rather than the amount — it
settles $\max(S_T/S_{t_1} - m, 0)$ — so the payoff is already unit-scaled and
the discount to the reset date is the risk-free one instead:

$$V_0^{\text{perf}} = D_r(t_1)\; V_{\text{BS}}\big(1,\ m,\ \tau\big).$$

Same trade description, different price. The switch is on the style card.

## One-touch digitals

A binary payoff on an *American* exercise is a one-touch: it pays as soon as
the level is reached rather than at expiry, and it goes to QuantLib's digital
American engine. Its value is exactly the $F$ term of the barrier formula
above — a rebate paid at hit — which is the cleanest way to remember what a
one-touch is: the rebate of a knock-out, sold on its own.
