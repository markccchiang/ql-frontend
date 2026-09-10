# Getting started

## Run the backend and frontend

The workbench is a browser app talking to a pricing service. Both have to be
running, and the service comes first.

```bash
# 1. the pricing service, from the ql-backend checkout
./build/ql-backend --port 9111

# 2. this app
npm install          # also generates the Protobuf bindings
npm run dev          # http://localhost:5173
```

`npm install` generates `src/gen/` from the `proto/` submodule. Those bindings
are deliberately not committed — one source of truth, no stale copies — so a
fresh clone must run it before the app will build.

`VITE_WS_URL` overrides the service address if it is not on
`ws://127.0.0.1:9111`; `.env.example` carries the default.

## Prove the chain works

Press **run reference check** at the top of the centre column. It opens a
session on the market from `HANDLERS.md`, prices the option that document
prices, and shows the answer:

$$\text{NPV} = 12.459717$$

If that number comes back, the whole chain is working — socket, schema, market
construction, engine dispatch and the result mapping. If it does not, the
problem is below the interface, and {doc}`troubleshooting` is the page for it.

Two further things are worth doing in the first five minutes, because they are
what the application is *for*:

1. **Drag a quote slider** in the bar along the bottom. The price follows and
   nothing is rebuilt — writes coalesce so only one round trip is ever in
   flight. This is the live graph doing its job.
2. **Stop the service and start it again.** The socket reconnects, the workbook
   replays into a new session, and the trade reprices — the client owns the
   market definition, which is what makes that possible. Cut the connection
   without stopping the service and you get the other path: the session is
   held for a minute, and the app takes it back with the same id and the same
   graph.

## Keep this open beside it

The **guide** button at the right-hand end of the status bar opens this
document in a tab of its own — a tab of its own on purpose, because navigating
away drops the socket, and a session only outlives that for a minute.

```{figure} images/guide-in-the-app.jpg
:alt: The guide's front page, opened from the workbench's status bar: the sidebar with both tables of contents, the search box, the English/Chinese switch, and the three-layer figure.
:width: 100%

What the button opens. It points at `doc/_build/html/index.html`, which is
where `npm run docs` writes this guide and which the dev server serves from the
project root; a deployment that serves it elsewhere sets `VITE_DOCS_URL`.
```

If the button gives you a 404, the guide has not been built yet — `npm run
docs` is the whole of the fix.

## The door

The service checks the browser's `Origin` on the WebSocket upgrade. This is not
belt-and-braces: a WebSocket upgrade is **not** subject to the same-origin
policy, so binding the service to loopback is no protection against a page —
any tab could otherwise open `ws://127.0.0.1:9111` and spend the machine's CPU
on it.

The defaults already include the Vite dev and preview origins
(`localhost` and `127.0.0.1` on ports 5173 and 4173). Serve this app from
anywhere else and start the service with `--allow-origin <that origin>`, or the
socket is refused with `403` before the app can say anything about it. A client
that sends no `Origin` header at all — a script, a proxy that already checked —
is unaffected, which is why the command-line tools keep working.

## The token, on a machine you share

The origin check bets that whoever might abuse the service is a page rather
than a process. On your own machine that is the right bet. Where other people
have accounts on the same box it is the wrong one, because any of their
processes can open the port directly and no proxy in front of the service
changes that: a proxy stands beside it, not in front of its loopback socket.

`--token-file PATH` is the answer to exactly that. The service reads the secret
from the file, or mints one at first use and writes it with owner-only
permissions, and after that every client presents it or is refused with `401`
before a socket exists. This app sends it when `VITE_WS_TOKEN` is set:

```bash
./build/ql-backend --port 9111 --token-file ~/.ql-backend-token
VITE_WS_TOKEN=$(cat ~/.ql-backend-token) npm run dev
```

Two things follow from where that secret ends up. A token this app can send is
a token in the bundle it serves, so it keeps out another user's process rather
than one running as you, and `.env` is ignored by git for the same reason.
{doc}`limits` is where that boundary is written down in full.

An address that is not loopback and no token is refused at startup rather than
served, because a pricing engine answering the network with no authentication
is an accident far more often than it is a decision.

## The vocabulary

Four words are used precisely throughout this guide and throughout the
interface.

Session
: One live QuantLib object graph on the service, holding a worker seat. It is
  opened with a market, it survives between requests, and it outlives its
  socket by a grace window — a minute by default — so a client that drops can
  take it back rather than rebuild it. Each browser tab holds its own.

Workbook
: The document *this app* owns: the market definition, the trade, and the
  panel state. It survives a refresh, exports as canonical Protobuf JSON, and
  is what gets replayed into a new session when a dropped one cannot be taken
  back. {doc}`interface` sets out the whole split of what is kept where.

Structural edit
: A change to the shape of the graph — a curve, an index, the evaluation date.
  It cannot be written into a running session, so it needs a rebuild.

Live edit
: A quote write. The only edit the service can carry into a graph that is
  already built, and therefore the only free one.
