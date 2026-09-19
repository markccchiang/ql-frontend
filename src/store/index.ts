import {configureStore, isPlain} from "@reduxjs/toolkit";

import {WireClient} from "@/protocol/client";
import {wireMiddleware} from "@/protocol/middleware";
import {resolveSocketUrl} from "@/protocol/socketUrl";

import {listenerMiddleware} from "./listeners";
import {loadTabs, saveTabs, tabsToSave} from "./persistence";
import {resultsSlice} from "./resultsSlice";
import {rootReducer} from "./rootReducer";
import {sessionSlice} from "./sessionSlice";
import {FIRST_TAB_ID, type TabsState} from "./tabsSlice";
import type {DecodedWorkbook} from "./workbookCodec";
import {workbookSlice, type WorkbookState} from "./workbookSlice";

const defaultIsSerializable = (value: unknown): boolean => isPlain(value);

export const client = new WireClient({
    url: resolveSocketUrl(import.meta.env.VITE_WS_URL),
    // Set only when the service was started with --token-file. Absent is the
    // single-machine default, where the origin check is the whole door.
    token: import.meta.env.VITE_WS_TOKEN || undefined,
    autoReconnect: true
});

/** Every saved tab back, the one that was in front into the slices and the
 *  rest parked. Their sessions do not come back -- a session outlives a
 *  socket, not a page -- so each starts idle. With nothing saved, the one seed
 *  tab, named after its document rather than "Workbook 1". */
function restoredState(): {workbook: WorkbookState; tabs: TabsState} {
    const initial = workbookSlice.getInitialState();
    const asState = (document: DecodedWorkbook): WorkbookState => ({...initial, label: document.label, evaluationDate: document.evaluationDate, market: document.market, trade: document.trade, book: document.book});

    const saved = loadTabs() ?? {activeId: FIRST_TAB_ID, tabs: [{id: FIRST_TAB_ID, workbook: initial}]};
    const active = saved.tabs.find(tab => tab.id === saved.activeId) ?? saved.tabs[0]!;
    const byId: TabsState["byId"] = {};
    for (const tab of saved.tabs) {
        byId[tab.id] = {
            id: tab.id,
            label: tab.workbook.label,
            snapshot: tab.id === active.id ? null : {workbook: asState(tab.workbook), session: sessionSlice.getInitialState(), results: resultsSlice.getInitialState()}
        };
    }
    return {workbook: asState(active.workbook), tabs: {order: saved.tabs.map(tab => tab.id), activeId: active.id, byId}};
}

export const store = configureStore({
    reducer: rootReducer,
    preloadedState: restoredState(),
    middleware: getDefault =>
        getDefault({
            thunk: {extraArgument: {client}},
            // A Monte Carlo seed and sample count are uint64, which protobuf-es maps
            // to bigint. The store holds real messages, so bigint is expected here
            // and is as serialisable as anything else once it reaches the wire.
            serializableCheck: {
                isSerializable: (value: unknown) => typeof value === "bigint" || defaultIsSerializable(value)
            }
        })
            .prepend(listenerMiddleware.middleware)
            .concat(wireMiddleware(client))
});

export type {AppDispatch, AppThunk, RootState, ThunkExtra} from "./types";

// The save is debounced, so a reload immediately after an edit would lose it.
// Navigating away is the one moment the latest state must reach storage.
if (typeof window !== "undefined") {
    window.addEventListener("pagehide", () => saveTabs(tabsToSave(store.getState())));
}
