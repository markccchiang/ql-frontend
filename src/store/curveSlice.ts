import {createSlice, type PayloadAction} from "@reduxjs/toolkit";

import {CurveSample_Quantity} from "@/gen/quantlib/v2/envelope_pb";

export interface CurveLine {
    name: string;
    x: number[];
    y: number[];
}

interface CurveState {
    marketId: string;
    quantity: CurveSample_Quantity;
    /** Years out to sample to, and how many points. */
    years: number;
    points: number;
    /** Volatility surfaces only. */
    strike: number;
    lines: CurveLine[];
    error: string | null;
}

const initialState: CurveState = {
    marketId: "",
    quantity: CurveSample_Quantity.DISCOUNT_FACTOR,
    years: 5,
    points: 60,
    strike: 100,
    lines: [],
    error: null
};

export const curveSlice = createSlice({
    name: "curve",
    initialState,
    reducers: {
        changed(state, action: PayloadAction<Partial<CurveState>>) {
            Object.assign(state, action.payload);
        },
        sampled(state, action: PayloadAction<CurveLine[]>) {
            state.lines = action.payload;
            state.error = null;
        },
        failed(state, action: PayloadAction<string>) {
            state.error = action.payload;
            state.lines = [];
        }
    }
});

export const curveActions = curveSlice.actions;
