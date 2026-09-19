import {createSlice, isAnyOf, type PayloadAction} from "@reduxjs/toolkit";

import {workbookActions} from "./workbookSlice";

/** One row of a priced book: a number, or the reason there is not one. */
export interface BookRow {
    label: string;
    npv: number | null;
    currency: string;
    /** The rejection this trade would have been sent on its own, with the row
     *  it came from already stripped off the path. */
    error: string | null;
    fieldPath: string | null;
    engine: string;
}

export interface BookOutcome {
    rows: BookRow[];
    /** How many trades were attempted before a dirty graph or a cancel stopped
     *  the book; zero when the whole of it priced. */
    abandonedAfter: number;
    at: number;
}

interface BookState {
    outcome: BookOutcome | null;
    /** The in-flight batch, so it can be cancelled. A batch checks the stop flag
     *  between trades, which makes it interruptible at row boundaries. */
    runningRequestId: string | null;
    error: string | null;
}

const initialState: BookState = {outcome: null, runningRequestId: null, error: null};

export const bookSlice = createSlice({
    name: "book",
    initialState,
    reducers: {
        started(state, action: PayloadAction<string>) {
            state.runningRequestId = action.payload;
            state.error = null;
        },
        finished(state, action: PayloadAction<BookOutcome>) {
            state.outcome = action.payload;
            state.runningRequestId = null;
            state.error = null;
        },
        failed(state, action: PayloadAction<string>) {
            state.runningRequestId = null;
            state.error = action.payload;
        },
        /** A priced book is about the trades that were in it. Editing the book
         *  makes the last result a description of something else. */
        cleared(state) {
            state.outcome = null;
            state.error = null;
        }
    },
    extraReducers: builder => {
        /** A priced book describes the book of the document it was priced
         *  from. Rows are matched to trades by position and the staleness
         *  check only compares counts, so an imported workbook with as many
         *  trades showed the old book's prices beside its own trades, with
         *  nothing to say so. Any document replaced -- imported, reset, the
         *  swap example, another tab switched in -- takes the outcome with it. */
        builder.addMatcher(isAnyOf(workbookActions.workbookLoaded, workbookActions.reset, workbookActions.swapExampleLoaded, workbookActions.restored), state => {
            state.outcome = null;
            state.error = null;
        });
    }
});

export const bookActions = bookSlice.actions;
