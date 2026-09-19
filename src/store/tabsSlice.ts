import {createSlice, type PayloadAction, type UnknownAction} from "@reduxjs/toolkit";

import {resultsSlice, type ResultsState} from "./resultsSlice";
import {sessionActions, sessionSlice, type SessionState} from "./sessionSlice";
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

export interface TabsState {
    order: string[];
    activeId: string;
    byId: Record<string, TabEntry>;
}

export const FIRST_TAB_ID = "tab-1";
const FIRST = FIRST_TAB_ID;

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
        },
        /** An answer that belongs to a parked tab: its session opened, or
         *  failed to, or a price came back. Applied to the snapshot, so the
         *  tab has it when it is next in front -- rather than to the tab that
         *  happens to be in front now, or to nobody, which left a tab that was
         *  switched away from mid-open saying "opening" for good. */
        parkedSettled(state, action: PayloadAction<{tabId: string; session?: UnknownAction; results?: UnknownAction}>) {
            const entry = state.byId[action.payload.tabId];
            if (!entry?.snapshot) return;
            const {session, results} = action.payload;
            if (session) entry.snapshot.session = sessionSlice.reducer(entry.snapshot.session, session);
            if (results) entry.snapshot.results = resultsSlice.reducer(entry.snapshot.results, results);
        }
    },
    extraReducers: builder => {
        /** A socket carries every tab's session, so it takes every tab's
         *  session down with it (DESIGN §9.4).
         *
         *  The parked tabs were being left holding a session id that had
         *  stopped existing, and a status that still said live. Switching to
         *  one showed a healthy session and then priced into nothing. Handled
         *  here rather than dispatched separately because the two facts are one
         *  event: the socket died. */
        builder.addCase(sessionActions.lost, state => {
            for (const entry of Object.values(state.byId)) {
                if (entry.snapshot) entry.snapshot = {...entry.snapshot, session: sessionSlice.reducer(entry.snapshot.session, sessionActions.lost())};
            }
        });
    }
});

export const tabsActions = tabsSlice.actions;

/** A tab id nothing holds yet. The counter starts afresh on every load while
 *  the tabs come back from storage with their ids, so the ones in use are
 *  skipped rather than handed out twice. */
export function nextTabId(inUse: readonly string[]): string {
    const taken = new Set(inUse);
    do counter += 1;
    while (taken.has(`tab-${counter}`));
    return `tab-${counter}`;
}
