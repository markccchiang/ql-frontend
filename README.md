# ql-frontend

The TypeScript frontend for [`qlservice`](https://github.com/markccchiang/ql-backend):
React and Redux over a binary WebSocket, Protobuf `quantlib.v2` frames, talking
to a `ql-backend` that keeps a live QuantLib object graph per session.

`PLAN.md` is the design document — the constraints the protocol imposes on the
UI, the stack decisions and why they beat the alternatives, the gap analysis
against the backend, and the milestones. Read `ql-backend/HANDLERS.md` beside
it: it is the list of what the service actually prices, and it is narrower than
the schema.

**Status: M1.** The market is editable and the graph is live. Quotes, flat
curves and constant volatility can be added, bound and renamed; the market is
topologically sorted on the way out so nobody orders it by hand; validation
catches client-side what the backend would reject; and the quote bar at the
bottom writes to the running graph and reprices as you drag. The reference
check still holds: the `HANDLERS.md` session prices to **12.459717**.

Two things are worth trying. Drag a slider — the price follows, and the writes
coalesce so only one round trip is ever in flight. Then stop the backend and
start it again: the socket reconnects, the workbook replays into a new session,
and the trade reprices, because the *client* owns the market definition
(DESIGN §9.4).

There is no trade builder yet; the instrument is fixed and that is M2.

## Running it

```bash
# 1. the backend, from its own checkout
./build/ql-backend --port 9111

# 2. this
npm install          # also generates the Protobuf bindings
npm run dev          # http://localhost:5173
```

Then press **Run** in the acceptance panel. `VITE_WS_URL` overrides the
backend address; see `.env.example`.

The `proto/` submodule is pinned to a commit, as any schema consumer should be:
a schema change that compiles is not necessarily one that stays wire
compatible. `npm run gen` regenerates `src/gen/`, which is **not committed** —
one source of truth, no stale bindings, which is `ql-protobuf`'s own rule.

## What is where

| Path | What it holds |
| --- | --- |
| `src/protocol/client.ts` | The socket: request_id allocation, the pending registry, the stall watchdog, reconnection |
| `src/protocol/errors.ts` | `WireError`, and the classification that decides how a rejection is presented |
| `src/protocol/middleware.ts` | Mirrors every frame into the store; owns none of the protocol |
| `src/store/` | `connection`, `session`, `requests`, `results`, `wire` |
| `src/store/workbookSlice.ts` | The document the client owns, and the structural/live edit split |
| `src/market/graph.ts` | Dependencies and the topological sort |
| `src/market/validation.ts` | What the backend would reject, caught before the round trip |
| `src/session/ops.ts` | open, close, price, write — the operations the UI drives |
| `src/session/repricer.ts` | Slider coalescing: one write-and-price in flight |
| `src/market/handlersSession.ts` | The `HANDLERS.md` session as the seed workbook |
| `src/devtools/FrameInspector.tsx` | Both directions as canonical Protobuf JSON |

## Two things the protocol decides for you

**A session dies with its socket** (DESIGN §9.4), so the client owns the market
definition and a reconnect is a *replay*, not a resume. `workbookSlice` is that
definition; `store/listeners.ts` is the replay.

**`UpdateMarket` writes quotes and nothing else.** A curve shape or the
evaluation date is a new session, so `workbook.structureRevision` counts
structural edits and the session goes stale against it. The pane says what a
rebuild costs — `SessionOpened.bootstrap_seconds` measured the last one — and
nothing rebuilds silently.

## Tests

`npm test`. The pure logic — dependency extraction, the topological sort,
validation, and mapping a backend `market[i]` path back to the object the user
authored — is covered; the protocol layer is exercised against a real daemon
rather than a mock, which is what the reference check is.
