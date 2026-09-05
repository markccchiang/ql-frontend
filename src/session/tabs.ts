import {HANDLERS_EVALUATION_DATE, seedMarket, seedTrade} from "@/market/handlersSession";
import {openSession} from "@/session/ops";
import {resultsActions, resultsSlice} from "@/store/resultsSlice";
import {sessionActions, sessionSlice} from "@/store/sessionSlice";
import {nextTabId, tabsActions, type TabSnapshot} from "@/store/tabsSlice";
import type {AppThunk} from "@/store/types";
import {workbookActions, workbookSlice} from "@/store/workbookSlice";

/** Everything a tab owns, taken out of the slices it lives in. */
function capture(state: {workbook: TabSnapshot["workbook"]; session: TabSnapshot["session"]; results: TabSnapshot["results"]}): TabSnapshot {
    return {workbook: state.workbook, session: state.session, results: state.results};
}

function apply(snapshot: TabSnapshot): AppThunk {
    return dispatch => {
        dispatch(workbookActions.restored(snapshot.workbook));
        dispatch(sessionActions.restored(snapshot.session));
        dispatch(resultsActions.restored(snapshot.results));
    };
}

/** Switches tabs, parking the one being left.
 *
 *  The backend session of the parked tab stays open, which is the whole point:
 *  one socket holds several sessions, so coming back costs nothing and the
 *  graph is still warm.
 */
export const switchTab =
    (id: string): AppThunk =>
    (dispatch, getState) => {
        const state = getState();
        if (state.tabs.activeId === id) return;
        const target = state.tabs.byId[id];
        if (!target?.snapshot) return;

        // The tab bookkeeping goes first, and the order is load-bearing: a
        // workbook action relabels whichever tab is active (listeners.ts), so
        // swapping the document in while the outgoing tab is still active
        // renames it after the document arriving.
        const snapshot = target.snapshot;
        dispatch(tabsActions.captured({id: state.tabs.activeId, snapshot: capture(state)}));
        dispatch(tabsActions.activated(id));
        dispatch(apply(snapshot));

        // A tab whose session died with the socket is reopened on the way in
        // rather than on the way out of the drop. Reopening every tab at once
        // would spend a bootstrap on each of them, most for a document nobody
        // is about to look at; this spends one, when it is wanted, and the
        // pane reports it like any other.
        if (getState().session.status === "lost") void dispatch(openSession());
    };

/** Opens a tab on a fresh workbook, with no session of its own yet. */
export const openTab = (): AppThunk => (dispatch, getState) => {
    const state = getState();
    dispatch(tabsActions.captured({id: state.tabs.activeId, snapshot: capture(state)}));

    const id = nextTabId();
    const label = `Workbook ${state.tabs.order.length + 1}`;
    // Opened before the workbook is applied, for the reason in switchTab: the
    // new document's label would otherwise be written onto the tab being left.
    dispatch(tabsActions.opened({id, label}));
    dispatch(
        apply({
            workbook: {...workbookSlice.getInitialState(), label, evaluationDate: HANDLERS_EVALUATION_DATE, market: seedMarket(), trade: seedTrade()},
            session: sessionSlice.getInitialState(),
            results: resultsSlice.getInitialState()
        })
    );
};

/** Closes a tab and the session it holds.
 *
 *  The session is closed explicitly rather than left to the socket: a tab
 *  nobody is looking at should not keep a graph alive in the backend.
 */
export const closeTab =
    (id: string): AppThunk<Promise<void>> =>
    async (dispatch, getState, {client}) => {
        const state = getState();
        if (state.tabs.order.length <= 1) return;

        const isActive = state.tabs.activeId === id;
        const sessionId = isActive ? state.session.sessionId : (state.tabs.byId[id]?.snapshot?.session.sessionId ?? null);

        if (sessionId && client.connectionStatus === "connected") {
            await client.send({case: "closeSession", value: {}}, sessionId).done.catch(() => undefined);
        }

        if (isActive) {
            const next = state.tabs.order.find(other => other !== id);
            const snapshot = next ? state.tabs.byId[next]?.snapshot : null;
            if (snapshot) dispatch(apply(snapshot));
        }
        dispatch(tabsActions.closed(id));
    };
