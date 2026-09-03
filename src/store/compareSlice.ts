import {createSlice, type PayloadAction} from "@reduxjs/toolkit";

export interface CompareOutcome {
    label: string;
    baseNpv: number;
    variantNpv: number;
    baseSessionId: string;
    variantSessionId: string;
    at: number;
}

interface CompareState {
    /** Requests whose replies must not touch the primary session or the result
     *  pane. The middleware mirrors every frame into the store by default, and
     *  a second session opened for a comparison would otherwise look like the
     *  session the user is working in. */
    backgroundIds: string[];
    isRunning: boolean;
    evaluationDate: string;
    /** "S=110, V=0.25" — quote writes applied to the variant only. */
    overrides: string;
    outcome: CompareOutcome | null;
    error: string | null;
}

const initialState: CompareState = {
    backgroundIds: [],
    isRunning: false,
    evaluationDate: "",
    overrides: "",
    outcome: null,
    error: null
};

export const compareSlice = createSlice({
    name: "compare",
    initialState,
    reducers: {
        variantChanged(state, action: PayloadAction<{evaluationDate?: string; overrides?: string}>) {
            if (action.payload.evaluationDate !== undefined) state.evaluationDate = action.payload.evaluationDate;
            if (action.payload.overrides !== undefined) state.overrides = action.payload.overrides;
        },
        backgroundRequest(state, action: PayloadAction<string>) {
            state.backgroundIds.push(action.payload);
            if (state.backgroundIds.length > 50) state.backgroundIds.shift();
        },
        started(state) {
            state.isRunning = true;
            state.error = null;
        },
        finished(state, action: PayloadAction<CompareOutcome>) {
            state.isRunning = false;
            state.outcome = action.payload;
            state.error = null;
        },
        failed(state, action: PayloadAction<string>) {
            state.isRunning = false;
            state.error = action.payload;
        }
    }
});

export const compareActions = compareSlice.actions;
