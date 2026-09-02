# ql-frontend

The TypeScript frontend for [`qlservice`](https://github.com/markccchiang/ql-backend):
React and Redux over a binary WebSocket, Protobuf `quantlib.v2` frames, talking
to a `ql-backend` that keeps a live QuantLib object graph per session.

`PLAN.md` is the design document — the constraints the protocol imposes on the
UI, the stack decisions and why they beat the alternatives, the gap analysis
against the backend, and the milestones. Read `ql-backend/HANDLERS.md` beside
it: it is the list of what the service actually prices, and it is narrower than
the schema.

**Status: M0.** The plumbing is done and checked against a number. The app
opens the worked session from `HANDLERS.md`, bumps spot 100 → 105 on the live
graph, prices the European call analytically and gets **12.459717** — the value
`HANDLERS.md` records — with delta, gamma and vega beside it. Every frame in
both directions is in the inspector. There is no trade builder yet; that is M2.

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
| `src/market/handlersSession.ts` | The `HANDLERS.md` session as data — the M0 acceptance case |
| `src/session/handlersCheck.ts` | The four-step script and the NPV assertion |
| `src/devtools/FrameInspector.tsx` | Both directions as canonical Protobuf JSON |

## Two things the protocol decides for you

**A session dies with its socket** (DESIGN §9.4), so the client owns the market
definition and a reconnect is a *replay*, not a resume. The workbook document
that makes that work is M1; today the seed market is a literal.

**`UpdateMarket` writes quotes and nothing else.** A curve shape or the
evaluation date is a new session. The UI has to make the two speeds visible
rather than rebuilding silently — see `PLAN.md` §7.1.
