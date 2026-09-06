# What it can not do

Two kinds of limit, and both are worth knowing: one before you judge a number
this application gives you, one before you run it anywhere but your own
machine. None of them is a bug, and none of them is silent — where the service
will not price something it refuses by name and says why, rather than
answering on an assumption nobody made.

## What options it can not price

**One model.** Everything prices in the Black-Scholes world with one volatility
per expiry and strike. Heston, Bates and local volatility are in the schema and
are not built, so an exotic price here is a Black-Scholes price and should be
read as one. That is also why the Fourier method is never offered: the models
it exists for are not there. {doc}`maths/black-scholes` sets out the
assumptions you are buying, and where they stop.

**Ten of twelve styles**, and the two that are closed are both a repetition
in the schema rather than an engine that is missing. `spread` is a `basket`
with `KIND_SPREAD` — QuantLib 1.43 prices it through the basket engines,
`KirkEngine` is a `BasketOption::engine`, and the standalone `SpreadOption`
is a deprecated empty stub — and `digital` is a `barrier` carrying a binary
payoff, which is what a knock digital *is*. Both trades price. Only the
extra arm is closed, and each closed entry names the arm to use instead;
{doc}`trades` is where to author either one.

**A European basket.** The closed forms are two-asset — Stulz for a minimum or
a maximum, Kirk for a spread — so a third asset, or an average, leaves Monte
Carlo as the only method. An American basket is Longstaff-Schwartz, which needs
a basis-function choice the schema does not carry, so it is refused rather than
priced on a default nobody chose. The mathematics is in {doc}`maths/exotics`.

**A cliquet with no caps.** The four cap and floor fields reach no engine —
`CliquetOption` never copies them into its arguments — so they are refused by
name rather than accepted and dropped. An uncapped ratchet is a real trade; a
capped one described here would have been an uncapped one wearing a misleading
label.

**Continuous monitoring.** The barrier and lookback closed forms assume the
level is watched continuously, which is worth more than a contract watched
daily. Nothing in the interface applies a discrete-monitoring correction, so a
daily-fixing barrier priced here is priced as the continuous one.

What it *does* price is checked rather than asserted. The service prices **369
rows of QuantLib's published reference values** over the wire on every run,
each within the tolerance QuantLib's own test uses, and the rows are extracted
from its test suite rather than typed in.

## What the software mechanisms can not do

**A single machine, and no authentication.** The service listens on loopback,
checks the browser's origin, and caps sockets and sessions. That is a door, not
a security model: it is a bet that the attacker is a page rather than a
process, which is right on your own machine and wrong anywhere else.
{doc}`getting-started` explains why loopback alone is not the boundary it
looks like.

**A session outlives its socket by a minute, and not by more.** Lose the
connection and the service holds the session — and whatever was running in it —
for its grace window; come back later, or to a service that has been restarted,
and the client replays the market into a new session instead. The document
lives in the browser either way, which is what makes the fallback work.
{doc}`interface` has the whole table of what survives what.

**Nothing is written down.** No database, no file, no journal: the service
holds every session in memory, and this application holds the document in the
browser's storage. Restart the service and the workbook is replayed into a new
session; clear the browser's storage and there is nothing left to replay from.
That is the one loss nothing here recovers.

**A cancel does not always stop the work.** Three shapes have an outer loop
this service wrote and can take the stop at its next seam, keeping what they
have already computed: a batched Monte Carlo, a sweep, and a book. Everything
else is one engine call with nowhere to check a flag, so the request is
terminated and the session rebuilt behind you — and because workers are threads
in the service process rather than processes of their own, the abandoned
calculation keeps a core busy until it finishes on its own. {doc}`studies` is
what a cancel costs in each case.

**One question at a time per session.** A graph cannot serve two prices at
once — not even two nominally read-only ones, because computing an NPV writes
to the lazy cache as it goes — so a fan-out is several sessions rather than one
session working in parallel. The compare panel is that in the small: a second
session on the same socket, priced without disturbing the one in front of you.

{doc}`architecture` is the developer's version of this second half, with the
code that makes each one true. {doc}`troubleshooting` is the page for a symptom
rather than a limit.
