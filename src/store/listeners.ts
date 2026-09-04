import {createListenerMiddleware} from "@reduxjs/toolkit";

import {askCapabilities, diagnoseConnection, openSession, priceCurrentTrade} from "@/session/ops";

import {statusChanged} from "./connectionSlice";
import {saveWorkbook} from "./persistence";
import {tabsActions} from "./tabsSlice";
import type {AppDispatch, RootState, ThunkExtra} from "./types";
import {workbookSlice} from "./workbookSlice";

export const listenerMiddleware = createListenerMiddleware<RootState, AppDispatch, ThunkExtra>();

/** Reconnect means replay.
 *
 *  A session cannot be resumed: it died with the socket, and the backend keeps
 *  no log for an absent client (DESIGN §9.4). The workbook is what makes that
 *  survivable — reopening from it costs one bootstrap, which SessionOpened
 *  measures and the UI reports.
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
    predicate: action => action.type.startsWith(`${workbookSlice.name}/`),
    effect: (_action, api) => {
        if (saveTimer) clearTimeout(saveTimer);
        saveTimer = setTimeout(() => {
            const {label, evaluationDate, market, trade, book} = api.getState().workbook;
            saveWorkbook({label, evaluationDate, market, trade, book});
        }, 400);
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
