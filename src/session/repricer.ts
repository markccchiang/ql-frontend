import type {AppThunk} from "@/store/types";
import {workbookActions} from "@/store/workbookSlice";

import {type FixingsWrite, priceCurrentTrade, writeMarket} from "./ops";

/** Coalesces slider traffic into one write-and-price at a time.
 *
 *  A drag emits far more values than the backend can price, and every one of
 *  them is superseded by the next. So: the workbook takes the value
 *  immediately (the slider must not lag the finger), and the wire gets the
 *  latest value once the previous round trip has finished. One request in
 *  flight, never a queue of stale ones.
 *
 *  Fixings ride the same queue. They are the other thing UpdateMarket can
 *  carry to a live graph, and an edit to them is a keystroke at a time in the
 *  same way a drag is a pixel at a time.
 *
 *  Module state rather than store state on purpose — this is transport
 *  scheduling, and putting it in Redux would make every keystroke an action
 *  with no reader.
 */
const queuedQuotes = new Map<string, number>();
const queuedFixings = new Map<string, FixingsWrite["rows"]>();
let isBusy = false;

/** How long a price may take before the sliders stop repricing continuously.
 *  An FD FINE grid or a Monte Carlo is not a slider (doc/PLAN.md §7.6). */
export const LIVE_REPRICE_BUDGET_MS = 150;

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

/** Drains the queue against the session that was live when it started.
 *
 *  The session is read once. A tab switch swaps the session slice underneath
 *  a loop that is mid-await, and continuing would send the old tab's quote
 *  ids to the new tab's graph: an UNKNOWN_ID at best, and at worst a write
 *  into the wrong session's "S". Whatever is still queued belongs to a
 *  session nobody is looking at, so it is dropped rather than misdelivered.
 */
const pump = (): AppThunk<Promise<void>> => async (dispatch, getState) => {
    if (isBusy) return;
    const started = getState().session;
    if (started.status !== "live" || !started.sessionId) return;

    isBusy = true;
    try {
        while (queuedQuotes.size > 0 || queuedFixings.size > 0) {
            const writes = [...queuedQuotes.entries()].map(([quoteId, value]) => ({quoteId, value}));
            const fixings = [...queuedFixings.entries()].map(([indexId, rows]) => ({indexId, rows}));
            queuedQuotes.clear();
            queuedFixings.clear();
            const {session} = getState();
            if (session.status !== "live" || session.sessionId !== started.sessionId) break;
            await dispatch(writeMarket(writes, fixings));
            await dispatch(priceCurrentTrade());
        }
    } catch {
        // The failure is already in the request log and on the session; dropping
        // it here keeps a dead session from throwing on every slider tick.
        queuedQuotes.clear();
        queuedFixings.clear();
    } finally {
        isBusy = false;
    }
};

export const bumpQuote =
    (id: string, value: number): AppThunk<Promise<void>> =>
    async (dispatch, getState) => {
        dispatch(workbookActions.quoteValueSet({id, value}));

        const {session} = getState();
        if (session.status !== "live" || !session.sessionId) return;

        queuedQuotes.set(id, value);
        await dispatch(pump());
    };

/** Sends a fixings object's complete rows to the live graph.
 *
 *  Only rows that parse are sent -- the editor fires per keystroke, and a
 *  half-typed date is not a fixing yet. A removed row cannot be sent at all,
 *  which is why the reducer marks that case structural rather than this
 *  pretending to carry it.
 */
export const bumpFixings =
    (id: string): AppThunk<Promise<void>> =>
    async (dispatch, getState) => {
        const {session, workbook} = getState();
        if (session.status !== "live" || !session.sessionId) return;

        const object = workbook.market.find(entry => entry.id === id);
        if (object?.kind.case !== "fixings" || !object.kind.value.indexId) return;
        const rows = object.kind.value.fixings.map(row => ({date: row.date?.form.case === "iso" ? row.date.form.value : "", value: row.value})).filter(row => ISO_DATE.test(row.date) && Number.isFinite(row.value));
        if (rows.length === 0) return;

        queuedFixings.set(object.kind.value.indexId, rows);
        await dispatch(pump());
    };

/** True while sliders may reprice on every movement rather than on release. */
export function repricesLive(lastRoundTripMs: number | null): boolean {
    return lastRoundTripMs === null || lastRoundTripMs <= LIVE_REPRICE_BUDGET_MS;
}
