# When something goes wrong

## The socket will not open

The browser tells a page nothing about a failed WebSocket handshake — no
status, no reason — so the app asks the service over plain HTTP instead and
reports what it finds.

**Nothing answering.** The service is not running, or is not where this app is
looking. Start it, or set `VITE_WS_URL`.

**Running, but refusing this page.** The service is up and turned this page
away, which is almost always the origin allowlist. Start it with
`--allow-origin <the origin this app is served from>`. See {doc}`getting-started`.

You can ask the same question by hand:

```bash
curl -s http://127.0.0.1:9111/healthz
```

It answers JSON carrying the QuantLib version the binary linked, its uptime,
and how many connections and sessions are open. A reply proves the service's
loop is turning; it says nothing about whether a particular graph is healthy,
which is the honest scope of a liveness check.

## "Overloaded" when opening a session

A socket may hold only so many sessions — sixteen — and the service serves 32
sockets at once. Past the limit, opening a session is refused as overloaded,
and the remedy is to **close a tab**, not to retry: a session is a live
QuantLib graph holding a worker seat, so retrying is not what frees one.

## A field turned red

Rejections land on the control that produced them, and three kinds read
differently:

| Reads as | Code | What to do |
| --- | --- | --- |
| *fill this in* | unspecified enum | A required convention was left empty. Nothing defaults silently, on purpose |
| *this value cannot work* | invalid argument | The field is set to something the maths or the schema refuses — an expiry before the evaluation date, a lower barrier above the upper |
| *this build does not price it* | unsupported | The request is well-formed and this build refuses to price it on a substitute |
| *unknown id* | unknown id | A quote, curve or index id that is not in this session — usually an object renamed after something else named it |

`BOOTSTRAP_FAILED` means the curve did not strip: check the pillars for a
crossing or an impossible quote. `CALCULATION_FAILED` carries no field, because
it is not a field's fault — the maths failed on inputs that were each
individually legal.

## The price did not move when I dragged a slider

Two known reasons, both of which the interface marks:

- **The quote is a fixed leg's rate**, drawn in amber with its slider disabled.
  QuantLib's fixed-rate leg takes a value rather than a handle, so the rate is
  read once at construction. Price the trade again.
- **The edit was structural, not live.** A curve shape or the evaluation date
  cannot be written into a running graph. The amber bar at the top of the
  market pane says the structure changed and offers the rebuild, with the last
  bootstrap's cost in milliseconds.

## A result row says "not supplied"

The engine that ran does not publish that quantity — the American
approximations publish almost no greeks, and the binomial engine has no vega.
It is not zero, and the service names the absence rather than leaving a hole.
Price it on an analytic engine if you need that greek, and remember that the
two numbers are then from different engines, which is what the engine echo on
the face of the result is for.

## The same trade gives two different Monte Carlo prices

Expected, and the reason is in {doc}`engines`: batching draws from the random
number stream differently from one run of the same total. Reproducibility keys
on the triple (seed, samples, batch size). Compare like with like by reading
the engine echo on each result.

## A capability badge appeared in the status bar

The service's `Capabilities` answer disagrees with the tables this build of the
app gates its controls on. That means one side has moved — usually a service
rebuilt with a new style or result kind. The app keeps working against what it
knows; the badge is there so a stale capability is not something you discover
by meeting an unexplained rejection.

## A finite-difference price wobbles as I refine the grid

Two usual causes. If the trade is a barrier, the barrier is probably falling
between grid lines — move the asset steps until it lands on one. Otherwise it
is the oscillation a Crank-Nicolson-family scheme shows against the kink in the
payoff, and a few **damping steps** are the fix: they take the first few time
steps fully implicit. See {doc}`engines`.
