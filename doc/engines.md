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

## Lattice trees

Seven trees compile for a vanilla: Cox-Ross-Rubinstein, Jarrow-Rudd, additive
equiprobabilities, Trigeorgis, Tian, Leisen-Reimer and Joshi4. A **barrier
takes Cox-Ross-Rubinstein only.**

Two of them — Leisen-Reimer and Joshi4 — are strike-aware and force an odd
number of steps, which is what makes their convergence smooth rather than
oscillating. If you are stepping the step count to watch a price settle, those
two settle first. Again, {doc}`maths/american` has the parameterisations.

## Finite difference

The grid is **time steps × asset steps**:

| Preset | Grid |
| --- | --- |
| coarse | 100 × 100 |
| standard | 400 × 200 |
| fine | 2000 × 800 |

A custom grid names both dimensions explicitly. There is no default: two grids
are two different prices for the same trade, so a request with neither is
refused.

:::{warning}
The custom block also carries **damping steps** and a **scheme**, and this
build of the service reads neither: every FD price runs QuantLib's default
Douglas scheme with no damping steps, whatever those two controls say. They are
the one place in this application where a control does not do what it appears
to do.
:::

Under quanto the grid must be one of the three presets. The wrapper builds its
inner engine from a process alone, so each grid is a separate compiled type and
an arbitrary pair has nowhere to go. It is refused loudly rather than rounded
to the nearest preset.

## Monte Carlo

- **The seed must be non-zero.** QuantLib otherwise seeds from the clock, and
  the same inputs would price differently on every request.
- Give **samples**; this build requires a positive sample count and does not
  serve the absolute-tolerance form the schema carries.
- **Steps per year** matters for anything path-dependent (a barrier, an Asian);
  a European payoff only needs the terminal value.
- Setting **progress every N paths** switches to the batched path. That is what
  emits progress frames, what draws the convergence trace, and what lets a
  cancel stop the work rather than only the waiting.

Batching **changes the answer**, because independent batches with derived seeds
draw from the random number stream differently from one run of the same total.
Measured on the reference trade: 9.288545 single-shot against 9.307731 batched,
same seed and same sample count, with the analytic value at 9.297476. Neither
is wrong; they are different estimators. Reproducibility keys on the triple
(seed, samples, batch size), which is why the result echoes the whole engine
block back.
