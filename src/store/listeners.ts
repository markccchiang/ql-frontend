import {createListenerMiddleware} from "@reduxjs/toolkit";

import {openSession, priceCurrentTrade} from "@/session/ops";

import {statusChanged} from "./connectionSlice";
import {saveWorkbook} from "./persistence";
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
listenerMiddleware.startListening({
    actionCreator: statusChanged,
    effect: async (action, api) => {
        if (action.payload.status !== "connected") return;
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
            const {label, evaluationDate, market, trade} = api.getState().workbook;
            saveWorkbook({label, evaluationDate, market, trade});
        }, 400);
    }
});
