import {combineReducers} from "@reduxjs/toolkit";

import {compareSlice} from "./compareSlice";
import {connectionSlice} from "./connectionSlice";
import {requestsSlice} from "./requestsSlice";
import {resultsSlice} from "./resultsSlice";
import {scenarioSlice} from "./scenarioSlice";
import {sessionSlice} from "./sessionSlice";
import {uiSlice} from "./uiSlice";
import {wireSlice} from "./wireSlice";
import {workbookSlice} from "./workbookSlice";

/** Kept apart from the store so RootState can be derived from the reducers
 *  rather than from the configured store. The listener middleware needs the
 *  state type, and the store needs the listener middleware; deriving from the
 *  store instance makes that a circular type. */
export const rootReducer = combineReducers({
    compare: compareSlice.reducer,
    connection: connectionSlice.reducer,
    session: sessionSlice.reducer,
    requests: requestsSlice.reducer,
    results: resultsSlice.reducer,
    scenario: scenarioSlice.reducer,
    ui: uiSlice.reducer,
    wire: wireSlice.reducer,
    workbook: workbookSlice.reducer
});
