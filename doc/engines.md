# Choosing an engine

The engine block is part of the *request*, not part of the graph, so changing
it costs a price and never a rebuild. Pick the method and the interface shows
the parameter block that belongs to it — a field that does not apply cannot be
set, rather than being set and dropped.

| Method | Parameters | Notes |
| --- | --- | --- |
| **analytic** | approximation | required for an American vanilla |
| **lattice** | tree, steps | both required; steps must be non-zero |
| **finite difference** | preset or custom grid | see below |
| **Monte Carlo** | seed, samples, steps/year, progress | seed must be non-zero |
| **integral** | — | European vanilla only |
| **discounting** | — | swaps |

Fourier is in the schema; the models it exists for (Heston, Bates) are not
built, so it is never offered.

```{figure} images/engine-method-picker.png
:alt: The engine card with the method picker open and scrolled to its foot, on an American vanilla. Lattice and finite difference are white and selectable; Monte Carlo, Fourier and discounting are greyed out, each with a sentence underneath saying it is not priced by this build and why.
:width: 360px

The foot of the method picker, on an American vanilla. A method this trade
cannot take stays in the list and carries its own reason — the two
European-only engines say which engine class is the limit, and Fourier says it
is not wired up rather than quietly vanishing. What the list offers comes from
this client's tables, and the drift check holds those against the service's own
list on every run.
```

## American approximations

QuantLib has three closed-form American approximations and **they disagree in
the third decimal**, so the client names one rather than inheriting a default.
Omitting it is an error on the approximation field, not a silent choice.

| Approximation | Character |
| --- | --- |
| Barone-Adesi-Whaley | The classic quadratic approximation; fast, least accurate near the boundary |
| Bjerksund-Stensland | Flat-boundary approximation; generally the better of the two originals |
| Ju-Zhong quadratic | A correction to the quadratic method, usually closest to a fine lattice |

The mathematics is in {doc}`maths/american`. If you need a number you can
defend rather than a fast one, price the same trade on a lattice with several
thousand steps and compare.

```{figure} images/engine-approximation.png
:alt: The engine card on an American vanilla with method analytic. The approximation select shows the placeholder "required" in red, under a message that an American analytic price needs an explicit approximation because QuantLib has three and they disagree in the third decimal.
:width: 340px

Nothing is chosen for you. The field starts empty and says why, rather than
defaulting to Barone-Adesi/Whaley and letting a number that could have been
one of three arrive looking settled.
```

## Lattice trees

Seven trees compile for a vanilla: Cox-Ross-Rubinstein, Jarrow-Rudd, additive
equiprobabilities, Trigeorgis, Tian, Leisen-Reimer and Joshi4. A **barrier
takes Cox-Ross-Rubinstein only.**

Two of them — Leisen-Reimer and Joshi4 — are strike-aware and force an odd
number of steps, which is what makes their convergence smooth rather than
oscillating. If you are stepping the step count to watch a price settle, those
two settle first. Again, {doc}`maths/american` has the parameterisations.

```{figure} images/engine-tree-picker.png
:alt: The engine card with method lattice on a barrier and the tree picker open. Cox-Ross-Rubinstein is white and selectable; Jarrow-Rudd and additive equiprobabilities are greyed out, each saying QuantLib's barrier lattice is Cox-Ross-Rubinstein only, with the Derman-Kani correction.
:width: 360px

The tree picker on a **barrier**, where six of the seven close and all six give
the same reason. On a vanilla every one of them is open, and the picker looks
like the list above.
```

## Finite difference

The grid is **time steps × asset steps**:

| Preset | Grid |
| --- | --- |
| coarse | 100 × 100 |
| standard | 400 × 200 |
| fine | 2000 × 800 |

A custom grid names both dimensions explicitly, plus the **scheme** and the
**damping steps**. None of the four has a default: two grids, or two schemes,
are two different prices for the same trade, so a request that leaves one out
is refused rather than answered on a choice nobody made. The three presets are
Douglas with no damping.

```{figure} images/engine-fd-grid.png
:alt: The engine card with method finite difference and the grid switch set to explicit rather than preset: time steps 400, asset steps 200, damping steps 20, and a scheme select showing Crank-Nicolson under the note that two schemes are two prices for one trade.
:width: 340px

The grid switch is preset or explicit, and explicit means all four fields. The
damping steps are taken before the 400 rather than out of them, so any number
of them is a grid.
```

### The schemes

| Scheme | What it is here |
| --- | --- |
| Douglas | QuantLib's own default, second order. What to pick with no opinion |
| Crank-Nicolson | Douglas to within a bit — in one dimension they coincide |
| Craig-Sneyd | *Exactly* Douglas here: it alternates directions and there is one |
| Hundsdorfer | A different weighting; differs from Douglas in the seventh digit |
| implicit Euler | First order, unconditionally stable; differs in the third digit |
| explicit Euler | Closed — see below |

Explicit Euler is refused, and the reason is worth knowing rather than working
around: it is stable only while the time step is small against the *square* of
the asset step, and the asset step belongs to a grid QuantLib builds inside the
engine rather than to anything you can see on this panel. An unstable run does
not fail — measured on this build, a half-year vanilla at 100 × 200 came back
as 2.4e140 and at 400 × 200 as a NaN. Implicit Euler is first order too, with
no such condition.

### Damping steps

Rannacher damping takes a few fully implicit steps first, which kills the
oscillation a Crank-Nicolson-family scheme shows against a kinked payoff or a
barrier. They are **added to** the time steps rather than taken out of them —
QuantLib runs both — so any number of them is a grid, up to the same limit as
the time steps.

Reach for them when a price wobbles as you step the grid — particularly on a
barrier, and particularly near the barrier.

Under quanto the grid must be one of the three presets. The wrapper builds its
inner engine from a process alone, so each grid is a separate compiled type and
an arbitrary pair has nowhere to go. It is refused loudly rather than rounded
to the nearest preset.

## Monte Carlo

- **The seed must be non-zero.** QuantLib otherwise seeds from the clock, and
  the same inputs would price differently on every request.
- Give **samples**; this build requires a positive sample count and does not
  serve the absolute-tolerance form the schema carries.
- **Steps per year** matters for anything path-dependent (a barrier, an Asian,
  a cliquet); a European payoff only needs the terminal value, and leaving it
  at zero gives it one step to expiry.
- The **control variate** is offered on an Asian alone, the one engine here
  that takes it. Set anywhere else it would be refused, so the box stays on
  screen only to be cleared.
- Monte Carlo is not offered for every style, and where it is closed the
  control says why. A cliquet is the sharpest case: QuantLib's only sampled
  cliquet engine prices the **performance** form, so the ratchet takes analytic
  and nothing else. A **basket** is the other direction — past two assets, or
  on a weighted average, Monte Carlo is the only method left, because the
  closed forms are two-asset and kind-specific.
- Setting **progress every N paths** switches to the batched path. That is what
  emits progress frames, what draws the convergence trace, and what lets a
  cancel stop the work rather than only the waiting.

```{figure} images/engine-monte-carlo.png
:alt: The engine card with method Monte Carlo: seed 42, samples 100000, pseudo-random rng, twelve time steps a year, and report progress every 20000 paths, followed by a yellow note saying batching is what emits progress and makes a cancel possible, and that it changes the price.
:width: 340px

The whole block, batched. The warning is yellow rather than grey because this
is the one control on the card that changes the answer as well as what you see
while it runs — and the seed, the sample count and this number all echo back on
the result, so a price can be reproduced from what it reports.
```

Batching **changes the answer**, because independent batches with derived seeds
draw from the random number stream differently from one run of the same total.
Measured on the reference trade: 9.288545 single-shot against 9.307731 batched,
same seed and same sample count, with the analytic value at 9.297476. Neither
is wrong; they are different estimators. Reproducibility keys on the triple
(seed, samples, batch size), which is why the result echoes the whole engine
block back.
