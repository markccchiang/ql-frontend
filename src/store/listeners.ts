import {createListenerMiddleware} from "@reduxjs/toolkit";

import {askCapabilities, diagnoseConnection, failHeldRequests, openSession, priceCurrentTrade, resumeSession} from "@/session/ops";

import {statusChanged} from "./connectionSlice";
import {saveTabs, tabsToSave} from "./persistence";
import {tabsActions, tabsSlice} from "./tabsSlice";
import type {AppDispatch, RootState, ThunkExtra} from "./types";
import {workbookSlice} from "./workbookSlice";

export const listenerMiddleware = createListenerMiddleware<RootState, AppDispatch, ThunkExtra>();

/** Reconnect means resume, and replay when that is refused.
 *
 *  The service holds a session, its worker seat and whatever was running in it
 *  for a grace window after the socket dies (DESIGN §9.4), so the first thing
 *  a returning client should do is ask for it back: the graph is the one it
 *  had, and a calculation that was in flight delivers its result rather than
 *  being lost. Replay is what happens when that is refused — a service that
 *  restarted, a window that expired — and it has to keep working, because it
 *  is the only path that does not depend on the service remembering anything.
 */
/** A socket that will not open, explained.
 *
 *  The browser tells script nothing about a failed WebSocket handshake, so this
 *  asks the service over plain HTTP instead. Only on the way down, and only
 *  once per status change: it is a diagnosis, not a heartbeat.
 */
listenerMiddleware.startListening({
    actionCreator: statusChanged,
    effect: async (action, api) => {
        if (action.payload.status !== "disconnected") return;
        await api.dispatch(diagnoseConnection()).catch(() => undefined);
    }
});

listenerMiddleware.startListening({
    actionCreator: statusChanged,
    effect: async (action, api) => {
        if (action.payload.status !== "connected") return;

        // What the service can price is asked once per connection, before
        // anything is offered to the user off a table that may be stale.
        await api.dispatch(askCapabilities()).catch(() => undefined);
        const state = api.getState();
        if (state.session.status !== "lost") return;

        // The session first. If it comes back, so does everything it was
        // doing, and there is nothing else to do here: no bootstrap, no
        // reprice, and the requests that were in flight settle themselves off
        // the frames the service held.
        const didResume = await api.dispatch(resumeSession()).catch(() => false);
        if (didResume) return;

        // Whatever was still waiting was waiting on the session we have just
        // been refused; a new session will never answer it. Failing them here
        // is what turns a held request into the honest "the socket went and
        // took this with it" the user already understands.
        api.dispatch(failHeldRequests());

        try {
            await api.dispatch(openSession());
            await api.dispatch(priceCurrentTrade());
        } catch {
            // Left on the session slice; the pane offers a manual rebuild.
        }
    }
});

/** Saves the document, debounced, whenever it changes.
 *
 *  Debounced because a slider drag is a workbook edit per frame and storage is
 *  synchronous; the value written is always the latest either way.
 */
let saveTimer: ReturnType<typeof setTimeout> | null = null;

listenerMiddleware.startListening({
    // Tab actions too: opening, closing and switching change which workbooks
    // there are and which is in front, with no workbook edit to say so.
    predicate: action => action.type.startsWith(`${workbookSlice.name}/`) || action.type.startsWith(`${tabsSlice.name}/`),
    effect: (_action, api) => {
        if (saveTimer) clearTimeout(saveTimer);
        saveTimer = setTimeout(() => saveTabs(tabsToSave(api.getState())), 400);
    }
});

listenerMiddleware.startListening({
    predicate: action => action.type.startsWith(`${workbookSlice.name}/`),
    effect: (_action, api) => {
        const {tabs, workbook} = api.getState();
        if (tabs.byId[tabs.activeId]?.label !== workbook.label) {
            api.dispatch(tabsActions.relabelled({id: tabs.activeId, label: workbook.label}));
        }
    }
});
