import type {BatchResult} from "@/gen/quantlib/v2/envelope_pb";
import {WireError} from "@/protocol/errors";
import {describeEngine} from "@/protocol/middleware";
import {bookActions, type BookOutcome, type BookRow} from "@/store/bookSlice";
import type {AppThunk} from "@/store/types";
import {uiActions} from "@/store/uiSlice";
import {describeTrade} from "@/trade/describe";

/** A book of trades, priced against one graph in one frame.
 *
 *  Forty trades used to be forty requests serialised on the one worker this
 *  session owns. They share a market by construction — that is what makes them
 *  a book rather than forty tabs — so the graph is built once and warm for all
 *  of them.
 */
export const priceBook =
    (): AppThunk<Promise<void>> =>
    async (dispatch, getState, {client}) => {
        const {session, workbook} = getState();
        if (!session.sessionId) throw new Error("no session");
        if (workbook.book.length === 0) return;

        const {requestId, done} = client.send({case: "batch", value: {requests: workbook.book}}, session.sessionId);
        dispatch(bookActions.started(requestId.toString()));
        dispatch(uiActions.bottomPanelShown("book"));

        try {
            const frame = await done;
            if (frame.payload.case !== "batchResult") {
                throw new Error(`expected BatchResult, got ${frame.payload.case}`);
            }
            dispatch(bookActions.finished({...readBatch(frame.payload.value, workbook.book.map(describeTrade)), at: Date.now()}));
        } catch (error) {
            dispatch(bookActions.failed(error instanceof WireError ? `${error.message}${error.fieldPath ? ` (${error.fieldPath})` : ""}` : error instanceof Error ? error.message : String(error)));
            throw error;
        }
    };

/** One row per entry, in the order they were sent.
 *
 *  The service answers positionally and carries no ids, so the labels are
 *  zipped back on here rather than round-tripped. An entry that failed keeps
 *  its rejection: the whole point of the batch shape is that one bad trade
 *  costs its own row and not the other thirty-nine.
 */
export function readBatch(result: BatchResult, labels: string[]): Omit<BookOutcome, "at"> {
    const rows: BookRow[] = result.entries.map((entry, at) => {
        const label = labels[at] ?? `trade ${at + 1}`;
        if (entry.outcome.case === "price") {
            return {label, npv: entry.outcome.value.npv, currency: entry.outcome.value.currency, error: null, fieldPath: null, engine: entry.outcome.value.engine ? describeEngine(entry.outcome.value.engine) : "not echoed"};
        }
        const failure = entry.outcome.case === "error" ? entry.outcome.value : null;
        return {
            label,
            npv: null,
            currency: "",
            error: failure?.message ?? "no answer for this trade",
            // The service prefixes the path with the row it came from, which is
            // what makes it unambiguous across forty trades; the row is already
            // known here, so the prefix is dropped rather than shown twice.
            fieldPath: withoutRowPrefix(failure?.fieldPath ?? ""),
            engine: ""
        };
    });
    return {rows, abandonedAfter: result.abandonedAfter};
}

function withoutRowPrefix(path: string): string | null {
    const stripped = path.replace(/^batch\.requests\[\d+]\.?/, "");
    return stripped || null;
}

/** Cancels a running book. The worker checks the stop flag between trades, so
 *  this stops work rather than only stopping the waiting. */
export const cancelBook =
    (): AppThunk<Promise<void>> =>
    async (_dispatch, getState, {client}) => {
        const {book, session} = getState();
        if (!book.runningRequestId || !session.sessionId) return;
        await client.cancel(BigInt(book.runningRequestId), session.sessionId).done;
    };
