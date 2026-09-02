import {createSlice, type PayloadAction} from "@reduxjs/toolkit";

import type {ConnectionStatus} from "@/protocol/client";

interface ConnectionState {
    status: ConnectionStatus;
    url: string;
    detail: string | null;
    lastRoundTripMs: number | null;
}

const initialState: ConnectionState = {
    status: "disconnected",
    url: import.meta.env.VITE_WS_URL ?? "ws://127.0.0.1:9111",
    detail: null,
    lastRoundTripMs: null
};

export const connectionSlice = createSlice({
    name: "connection",
    initialState,
    reducers: {
        statusChanged(state, action: PayloadAction<{status: ConnectionStatus; detail?: string}>) {
            state.status = action.payload.status;
            state.detail = action.payload.detail ?? null;
        },
        roundTripObserved(state, action: PayloadAction<number>) {
            state.lastRoundTripMs = action.payload;
        }
    }
});

export const {statusChanged, roundTripObserved} = connectionSlice.actions;
