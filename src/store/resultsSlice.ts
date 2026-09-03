import {createSlice, type PayloadAction} from "@reduxjs/toolkit";

/** A display model, not the message.
 *
 *  PriceResult carries uint64s (the MC seed, the sample count) that protobuf-es
 *  maps to bigint, and bigint has no place in a Redux store. The projection
 *  happens once, in the middleware, against the real message.
 */
export interface ResultValue {
    key: string;
    /** null when the engine published something that is not a scalar. */
    scalar: number | null;
    shape: string;
}

/** One row of a leg's cash-flow table. Dates are kept as they arrived. */
export interface CashFlowRow {
    leg: number;
    paymentDate: string;
    amount: number;
    discount: number;
    presentValue: number;
    accrualStart: string;
    accrualEnd: string;
    notional: number;
    rate: number;
    fixingDate: string;
    indexFixing: number;
    isPastFixing: boolean;
}

export interface PriceSummary {
    requestId: string;
    /** The session this price came off. A rebuild makes a new graph, and a price
     *  from the old one is not a price of what is on screen now. */
    sessionId: string;
    at: number;
    npv: number;
    currency: string;
    values: ResultValue[];
    /** Kinds the service named as unsupplied, in its own words.
     *
     *  This used to be inferred here by diffing what was asked for against
     *  what came back, because the absence was silent on the wire. It is named
     *  now, so the guess is gone. */
    unavailable: string[];
    /** Empty unless the request asked for them, and only ever for a swap. */
    cashflows: CashFlowRow[];
    /** The engine as it actually ran, echoed by the backend (DESIGN §4). */
    engine: string;
    calculationSeconds: number;
    standardError: number | null;
    samples: string | null;
}

export interface ResultsState {
    latest: PriceSummary | null;
    /** A pinned earlier price, to diff against. The engine echo travels with it,
     *  so the comparison says which engine produced which number. */
    baseline: PriceSummary | null;
}

const initialState: ResultsState = {latest: null, baseline: null};

export const resultsSlice = createSlice({
    name: "results",
    initialState,
    reducers: {
        priced(state, action: PayloadAction<PriceSummary>) {
            state.latest = action.payload;
        },
        restored(_state, action: PayloadAction<ResultsState>) {
            return action.payload;
        },
        cleared(state) {
            state.latest = null;
        },
        pinned(state) {
            state.baseline = state.latest;
        },
        unpinned(state) {
            state.baseline = null;
        }
    }
});

export const resultsActions = resultsSlice.actions;
