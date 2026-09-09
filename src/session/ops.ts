import type {PriceResult} from "@/gen/quantlib/v2/results_pb";
import {topoSort} from "@/market/graph";
import {hasErrors, validateMarket} from "@/market/validation";
import {describeDrift, findDrift} from "@/protocol/drift";
import {capabilitiesActions} from "@/store/capabilitiesSlice";
import {diagnosed} from "@/store/connectionSlice";
import {selectInFlight} from "@/store/requestsSlice";
import {sessionActions} from "@/store/sessionSlice";
import type {AppThunk} from "@/store/types";

/** Opens (or reopens) the session from the workbook.
 *
 *  The market is topologically sorted on the way out, so the user authors in
 *  whatever order suits them and the frame still arrives in dependency order.
 *  The sent order is recorded because the backend indexes its rejections by
 *  position in that frame.
 */
export const openSession =
    (): AppThunk<Promise<void>> =>
    async (dispatch, getState, {client}) => {
        const {workbook, session} = getState();

        const issues = validateMarket(workbook.market);
        if (hasErrors(issues)) {
            const first = issues.find(issue => issue.severity === "error")!;
            throw new Error(`${first.objectId}: ${first.message}`);
        }
        const {sorted, cycle} = topoSort(workbook.market);
        if (cycle.length > 0) throw new Error(`circular dependency: ${cycle.join(", ")}`);

        await client.connect();
        if (session.sessionId) await dispatch(closeSession());

        dispatch(
            sessionActions.opening({
                sentOrder: sorted.map(object => object.id),
                revision: workbook.structureRevision
            })
        );

        const {done} = client.send({
            case: "openSession",
            value: {
                evaluationDate: {form: {case: "iso", value: workbook.evaluationDate}},
                market: sorted,
                clientLabel: workbook.label
            }
        });
        const frame = await done;
        if (frame.payload.case !== "sessionOpened") {
            throw new Error(`expected SessionOpened, got ${frame.payload.case}`);
        }
        // sessionActions.opened is dispatched by the middleware, off the frame.
    };

/** Takes a dropped session back, rather than opening another one.
 *
 *  The service holds a session, its worker seat and whatever was running in it
 *  for a grace window after the socket dies (DESIGN §9.4). Inside that window
 *  this is the cheap path *and* the correct one: the same graph, the same id,
 *  and the terminal frame of a calculation that was running is delivered on
 *  the way back in. Outside it — a service restarted, a window expired, a
 *  token that no longer matches — the answer is SESSION_NOT_FOUND and the
 *  caller replays, which is what this client did for every drop until now.
 *
 *  Resolves true when the session came back.
 */
export const resumeSession =
    (): AppThunk<Promise<boolean>> =>
    async (_dispatch, getState, {client}) => {
        const {sessionId, resumeToken} = getState().session;
        if (!sessionId || !resumeToken) return false;

        await client.connect();
        try {
            const frame = await client.send({
                case: "resumeSession",
                value: {sessionId, resumeToken}
            }).done;
            // sessionActions.opened is dispatched by the middleware, off the
            // frame, exactly as it is for an open.
            return frame.payload.case === "sessionOpened";
        } catch {
            return false;
        }
    };

/** Fails whatever is still waiting on a session that is not coming back.
 *
 *  The client holds requests through a dead socket, because the service holds
 *  the session and may still answer them (client.ts). Once a resume has been
 *  refused, nothing will: the new session has never heard of those request
 *  ids, and a promise nobody settles is worse than a rejection.
 */
export const failHeldRequests =
    (): AppThunk<void> =>
    (_dispatch, _getState, {client}) => {
        client.failPending("resume refused");
    };

/** Closes the session, and forgets it either way.
 *
 *  A session that is "lost" is not closed here: its id and token were kept so
 *  a resume could take it back, but the gateway no longer routes it to this
 *  socket, and a CloseSession for it comes back SESSION_NOT_FOUND. That
 *  rejection used to escape into openSession -- which closes any session it
 *  finds before opening -- and stop the replay that follows a refused resume
 *  on its first attempt, the one time the replay has to work. A refusal of
 *  the close is not a reason to keep the session either: whatever the service
 *  says, this client is done with it.
 */
export const closeSession =
    (): AppThunk<Promise<void>> =>
    async (dispatch, getState, {client}) => {
        const {sessionId, status} = getState().session;
        if (!sessionId || status === "lost" || client.connectionStatus !== "connected") {
            dispatch(sessionActions.reset());
            return;
        }
        try {
            await client.send({case: "closeSession", value: {}}, sessionId).done;
        } catch {
            // Already gone on the service side, or a socket that went while we
            // were asking. There is nothing to close either way.
        } finally {
            dispatch(sessionActions.reset());
        }
    };

export const priceCurrentTrade =
    (): AppThunk<Promise<PriceResult>> =>
    async (_dispatch, getState, {client}) => {
        const {session, workbook} = getState();
        if (!session.sessionId) throw new Error("no session");
        const {done} = client.send({case: "price", value: workbook.trade}, session.sessionId);
        const frame = await done;
        if (frame.payload.case !== "priceResult") {
            throw new Error(`expected PriceResult, got ${frame.payload.case}`);
        }
        return frame.payload.value;
    };

/** One fixing series as the wire carries it: an index, and the rows to add.
 *  A row already held is overwritten -- Session::applyFixings passes
 *  forceOverwrite -- so re-sending a changed value is how it changes. */
export interface FixingsWrite {
    indexId: string;
    rows: {date: string; value: number}[];
}

/** The one edit a live graph can take without a rebuild, in both of its
 *  forms: quote writes, and past fixings. Both travel in one UpdateMarket so
 *  the graph recalculates once. */
export const writeMarket =
    (writes: {quoteId: string; value: number}[], fixings: FixingsWrite[] = []): AppThunk<Promise<void>> =>
    async (_dispatch, getState, {client}) => {
        const {sessionId} = getState().session;
        if (!sessionId || (writes.length === 0 && fixings.length === 0)) return;
        await client.send(
            {
                case: "updateMarket",
                value: {
                    quotes: writes,
                    fixings: fixings.map(series => ({
                        indexId: series.indexId,
                        fixings: series.rows.map(row => ({date: {form: {case: "iso" as const, value: row.date}}, value: row.value}))
                    }))
                }
            },
            sessionId
        ).done;
    };

export const writeQuotes = (writes: {quoteId: string; value: number}[]): AppThunk<Promise<void>> => writeMarket(writes);

/** Cancels one in-flight request by id.
 *
 *  Always worth doing, and worth being honest about what it buys. A batched
 *  Monte Carlo, a sweep and a book each take the stop at their next seam and
 *  keep what they have already computed. Anywhere else the service cannot
 *  interrupt the engine call: it lets the worker go after a quarter of a
 *  second, terminates the request and rebuilds the session behind you, so what
 *  comes back is the session rather than the processor.
 */
export const cancelRequest =
    (requestId: string): AppThunk<Promise<void>> =>
    async (_dispatch, getState, {client}) => {
        const entry = getState().requests.byId[requestId];
        // Its own session, not the visible one: a comparison prices in a second
        // session on the same socket, and a cancel addressed to the wrong graph
        // is answered with SESSION_NOT_FOUND.
        const sessionId = entry?.sessionId || getState().session.sessionId;
        if (!sessionId) return;
        await client.cancel(BigInt(requestId), sessionId).done;
    };

/** Asks why the socket will not open, when the browser refuses to say.
 *
 *  A failed WebSocket handshake surfaces no status code to script, so a service
 *  that is down and a service that refused this page's origin are the same
 *  event here. `/healthz` is plain HTTP and answers either way: if it replies,
 *  the service is up and the refusal was about this page, which since the
 *  gateway started checking Origin is a real way to be stuck with no clue.
 */
export const diagnoseConnection = (): AppThunk<Promise<void>> => async (dispatch, getState) => {
    const {url} = getState().connection;
    const health = url.replace(/^ws/, "http").replace(/\/*$/, "") + "/healthz";
    try {
        const response = await fetch(health, {mode: "no-cors"});
        // A no-cors fetch is opaque: no status, no body. That it resolved
        // at all is the whole signal, and it is the only one available
        // without asking the service to allow this page to read it.
        void response;
        dispatch(diagnosed("refused"));
    } catch {
        dispatch(diagnosed("unreachable"));
    }
};

/** Cancels everything still running.
 *
 *  The panels that own a long calculation offer their own cancel; this is for
 *  the requests that have no panel — a single price on a slow engine, a curve
 *  sample, a comparison — which is most of them, and which had no way to be
 *  called off at all.
 */
export const cancelEverything = (): AppThunk<Promise<void>> => async (dispatch, getState) => {
    const running = selectInFlight(getState());
    await Promise.all(running.map(entry => dispatch(cancelRequest(entry.id))));
};

/** Asks the service what it can price, and compares it with what this client
 *  offers.
 *
 *  Sent on connect. The tables in protocol/capabilities.ts are a second copy
 *  of a fact the backend owns, and this is the check that the copy is still
 *  right — drift used to be discoverable only by a user hitting it.
 */
export const askCapabilities =
    (): AppThunk<Promise<void>> =>
    async (dispatch, _getState, {client}) => {
        const frame = await client.send({case: "hello", value: {}}).done;
        if (frame.payload.case !== "capabilities") return;
        const reported = frame.payload.value;
        const drift = describeDrift(findDrift(reported));
        if (drift.length > 0) {
            // Loud, because the alternative is a user meeting it as an
            // unexplained rejection.
            console.warn(`[capabilities] this client and ${reported.build} disagree:\n  ${drift.join("\n  ")}`);
        }
        dispatch(capabilitiesActions.received({reported, drift}));
    };
