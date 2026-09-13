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

```{figure} images/studies-sweep.png
:alt: The sweep panel: an axis card naming the quote S — Spot with its points form set to linear, and a ladder of twenty-one prices, npv against S from 80 to 120, with a dashed vertical line at the live value of 100. Above the chart, a badge reading 21 points and the note "isLive: 100.00 · click a point to write it to the market".
:width: 100%

Twenty-one prices off one graph in one request. The dashed line is where the
quote actually is, and the note beside it is exactly the distinction above: the
ladder is a question until you click a point, which is the act that turns one
of them into a write.
```

**Anything that is a quote can be swept**, which now includes a **correlation**.
An off-diagonal of a correlation matrix can be a quote id rather than a literal,
and the sweep machinery does not know or care what the number means. Sweeping
the correlation of a two-asset minimum basket from 0.1 to 0.9 in five steps
gives 4.4125, 5.5304, 6.8433, 8.4825 and 10.8974 — which are five consecutive
rows of the reference table this build is checked against, produced in one
request. That works only because the service rereads the matrix on every
request rather than holding the factorised copy ({doc}`market`).

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

```{figure} images/studies-grid.png
:alt: The sweep panel with two axis cards side by side — axis 1, drawn along x, 21 points, quote S — Spot, linear; axis 2, one line per value, 5 points, quote V — Volatility, relative. The chart reads NPV against S and V with a badge of 105 points, and draws five coloured lines with a legend naming V 0.16 through V 0.24.
:width: 100%

Twenty-one spots against five volatilities: 105 prices, one request, one warm
graph. Each card says what its axis does — the first is drawn along x, the
second is one line per value — and the legend names the five volatilities,
which is what a colour scale could not have done.
```

## Monte Carlo progress

Set a progress interval and a long run reports as it goes: a progress bar, a
convergence trace, and a cancel that stops work *between batches*. Measured on
the reference trade, ten progress frames for a 200,000-path run settling at
$9.307731 \pm 0.031144$ against an analytic $9.297476$.

```{figure} images/studies-monte-carlo.png
:alt: The Monte Carlo panel mid-run: an in-flight badge beside a Cancel button, a progress bar about a sixth of the way across, the counter 33,500,000 of 200,000,000 paths, a running NPV of 9.300080, and a convergence trace of running NPV against paths settling towards 9.30.
:width: 100%

A run in flight. The bar and the counter come from the progress frames; the
trace is drawn from the running NPV each frame carries, which is what shows
whether the number has settled or is still wandering.
```

Remember that batching changes the estimate ({doc}`engines`), and that the
error estimate is the standard error of the mean, not a bound
({doc}`maths/numerics`).

A long run also survives a dropped connection now. The service holds the
session and keeps the calculation going for its grace window, so a network
blink costs you the progress frames from that period and not the run: the
result is delivered when the app takes the session back ({doc}`interface`).

## The book

Press **Add to Book** and the trade is set aside beside the live one; press
**Price the Book** and all of them price against one graph in a single request.
They share this workbook's market by construction, which is what makes the
total a total rather than a coincidence.

**One bad trade costs one row.** A trade that cannot price shows the rejection
it would have been sent on its own, on its own row, with the rest keeping their
numbers. Rows are named from the trades themselves — nobody is asked to name
forty of them.

**A book has a ceiling, like a sweep.** Every row runs to completion on the
seat the request started on, so one frame can commit a great deal of work, and
the service says how many rows it will take in the same handshake that carries
the sweep ceiling. Past it the button closes and says the number rather than
letting the request go and come back refused.

```{figure} images/studies-book.png
:alt: The book panel: three trades, one request, total 28.137020. Row one, a call at 100 on the analytic engine, prices to 9.297476; row two, a put at 120, to 18.839544; row three, the same put on an American exercise, carries a red rejection naming instrument.option.exercise.payoff_at_expiry where its price would be.
:width: 100%

Three trades, one request, one total. The third could not price — an American
exercise with `payoff_at_expiry` unanswered — and it says so on its own row and
by field path, while the other two keep their numbers and the total stands for
what actually priced.
```

## Compare

The compare panel prices the same trade in a *second session on the same
socket*, without disturbing the one in front of you. That is the cleanest way
to answer "what would this be worth with three months less time value" — the
second session has its own evaluation date and its own graph, and closing it
leaves the first untouched.

```{figure} images/studies-compare.png
:alt: The compare panel: a variant evaluation date of 2026-12-01 against a base of 2026-09-01, a badge reading S-8 versus S-9, and three numbers — base 9.297476, variant 7.939163, and the difference −1.358313 in red.
:width: 100%

Three months of time value, priced in a session of its own. The badge names
both sessions, which is the whole of the claim above: `S-9` was opened on the
same socket, priced and closed, and `S-8` — the one in front of you — never
moved.
```

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

```{figure} images/studies-cancelled.png
:alt: The Monte Carlo panel after a cancel: the badge reads error, the counter reads 13,500,000 of 200,000,000 paths at 2204 ms round trip, a red box says "cancelled after 13500000 of 200000000 paths", and the partial convergence trace is still drawn beside it.
:width: 100%

The cheap kind of cancel, two seconds into a two-hundred-million-path run. The
batch boundary was the seam it stopped at, the trace it had already drawn is
kept, and the session stayed live — the next request went out on the same warm
graph.
```

The last row is the one to be honest about: QuantLib cannot be interrupted
inside an engine call. The service gives you your session back in a quarter of
a second and rebuilds it, but the abandoned calculation keeps running on a
thread nobody is listening to until it finishes on its own. Cancelling is still
worth doing there — it is a promise about your session, not about the CPU.
