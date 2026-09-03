import {createSlice, type PayloadAction} from "@reduxjs/toolkit";

import type {ResultsState} from "./resultsSlice";
import type {SessionState} from "./sessionSlice";
import type {WorkbookState} from "./workbookSlice";

/** One tab's worth of state, when it is not the tab you are looking at.
 *
 *  The active tab lives in the workbook, session and results slices as it
 *  always has; the others live here as snapshots, swapped in and out on a
 *  switch. Keying those three slices by a tab id instead would have meant
 *  rewriting every reducer and every selector in the app to read an active id,
 *  which is a large change to make for a feature that only needs the state to
 *  be somewhere while you are not using it.
 *
 *  The backend sessions of inactive tabs stay open on the socket. That is the
 *  point: one connection holds several sessions, so switching tabs costs
 *  nothing and the graph you left is still warm when you come back.
 */
export interface TabSnapshot {
    workbook: WorkbookState;
    session: SessionState;
    results: ResultsState;
}

export interface TabEntry {
    id: string;
    /** Taken from the workbook's label, so a tab is named by its document. */
    label: string;
    /** Null for the active tab, whose real state is in the slices. */
    snapshot: TabSnapshot | null;
}

interface TabsState {
    order: string[];
    activeId: string;
    byId: Record<string, TabEntry>;
}

const FIRST = "tab-1";

const initialState: TabsState = {
    order: [FIRST],
    activeId: FIRST,
    byId: {[FIRST]: {id: FIRST, label: "Workbook 1", snapshot: null}}
};

let counter = 1;

export const tabsSlice = createSlice({
    name: "tabs",
    initialState,
    reducers: {
        /** Parks the active tab's state before another is swapped in. */
        captured(state, action: PayloadAction<{id: string; snapshot: TabSnapshot}>) {
            const entry = state.byId[action.payload.id];
            if (!entry) return;
            entry.snapshot = action.payload.snapshot;
            entry.label = action.payload.snapshot.workbook.label;
        },
        activated(state, action: PayloadAction<string>) {
            if (!state.byId[action.payload]) return;
            state.activeId = action.payload;
            const entry = state.byId[action.payload];
            if (entry) entry.snapshot = null;
        },
        opened(state, action: PayloadAction<{id: string; label: string}>) {
            state.byId[action.payload.id] = {id: action.payload.id, label: action.payload.label, snapshot: null};
            state.order.push(action.payload.id);
            state.activeId = action.payload.id;
        },
        closed(state, action: PayloadAction<string>) {
            if (state.order.length <= 1) return;
            state.order = state.order.filter(id => id !== action.payload);
            delete state.byId[action.payload];
            if (state.activeId === action.payload) {
                state.activeId = state.order[0]!;
                const entry = state.byId[state.activeId];
                if (entry) entry.snapshot = null;
            }
        },
        /** Keeps the tab named after its document. */
        relabelled(state, action: PayloadAction<{id: string; label: string}>) {
            const entry = state.byId[action.payload.id];
            if (entry) entry.label = action.payload.label;
        }
    }
});

export const tabsActions = tabsSlice.actions;

export function nextTabId(): string {
    counter += 1;
    return `tab-${counter}`;
}
