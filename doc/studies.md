# Sweeps, books and long runs

Everything on the bottom strip asks the *same* live graph a bigger question.
None of it rebuilds anything, and all of it can be called off.

## Sweeps

Right-click a quote — or open the sweep panel — and N prices come back off one
graph in one frame, drawn as a ladder with the quote's live value marked. Points
come three ways, exactly one of:

| Form | Meaning |
| --- | --- |
| explicit | the values themselves |
| linear | begin, end and a step count |
| relative | multipliers of the quote's current value |

**A sweep is a question, not an edit.** Every swept quote is put back
afterwards, on the way out of a failure as well as a success. Clicking a point
on the ladder is the deliberate act that writes it: that sends a real market
write, with the value that was actually priced rather than an interpolation off
the chart.

## Grids

Press **add axis** and the sweep prices the *product* — spot at 21 points
against volatility at 5 is 105 prices, one request, one progress bar, one
cancel. The panel says so as you build it: `S × V = 27 prices, one request`.

Three rules the second axis adds, each of which the interface enforces before
the round trip:

- **A quote may appear on one axis only.** The later write would win at every
  point, and the earlier axis would move nothing — which reads as a flat
  dimension rather than as a mistake.
- **The product must fit the service's ceiling.** A grid multiplies, so a step
  count one digit too long is a session-length request rather than a slow one.
  The ceiling is advertised in the capabilities handshake, so the app can
  refuse it locally.
- **Two axes at most.** A third would price perfectly well and draw nothing.

A grid draws as a line per value of the second axis rather than as a heat map,
because a price read off a colour is a guess.

## Monte Carlo progress

Set a progress interval and a long run reports as it goes: a progress bar, a
convergence trace, and a cancel that stops work *between batches*. Measured on
the reference trade, ten progress frames for a 200,000-path run settling at
$9.307731 \pm 0.031144$ against an analytic $9.297476$.

Remember that batching changes the estimate ({doc}`engines`), and that the
error estimate is the standard error of the mean, not a bound
({doc}`maths/numerics`).

## The book

Press **add to book** and the trade is set aside beside the live one; press
**price the book** and all of them price against one graph in a single request.
They share this workbook's market by construction, which is what makes the
total a total rather than a coincidence.

**One bad trade costs one row.** A trade that cannot price shows the rejection
it would have been sent on its own, on its own row, with the rest keeping their
numbers. Rows are named from the trades themselves — nobody is asked to name
forty of them.

## Compare

The compare panel prices the same trade in a *second session on the same
socket*, without disturbing the one in front of you. That is the cleanest way
to answer "what would this be worth with three months less time value" — the
second session has its own evaluation date and its own graph, and closing it
leaves the first untouched.

## Cancelling, and what it costs

Every request can be cancelled. What differs is the price of doing it, and the
status bar tooltip says which one you are getting.

| Where the request is | What a cancel does | What it costs |
| --- | --- | --- |
| between Monte Carlo batches | the loop sees the stop flag and returns what it has | nothing; the graph stays warm |
| between sweep points | the ladder stops and keeps the points it priced | nothing |
| between book entries | the book stops and keeps the prices it managed | nothing |
| anywhere else, inside one engine call | the request is ended for you after a 250 ms grace and the session is rebuilt behind you | one bootstrap |

A cancelled sweep comes back as a *result*, not an error: "cancelled after 229
of 1500 scenario points", with the ladder trimmed to what actually priced and
the quote restored. A cancelled batched Monte Carlo says "cancelled after
200000 of 20000000 paths".

The last row is the one to be honest about: QuantLib cannot be interrupted
inside an engine call. The service gives you your session back in a quarter of
a second and rebuilds it, but the abandoned calculation keeps running on a
thread nobody is listening to until it finishes on its own. Cancelling is still
worth doing there — it is a promise about your session, not about the CPU.
