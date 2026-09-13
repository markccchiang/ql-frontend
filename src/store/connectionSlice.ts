import {createSlice, type PayloadAction} from "@reduxjs/toolkit";

import type {ConnectionStatus} from "@/protocol/client";
import {resolveSocketUrl} from "@/protocol/socketUrl";

/** Why the socket is not up, when the browser will not say.
 *
 *  A failed WebSocket handshake reports nothing to script — no status, no
 *  reason, by design. So "the service is not running" and "the service is
 *  running and refused this page" look identical from here, and since the
 *  gateway started checking the browser's Origin the second is a real way to
 *  end up stuck. Asking /healthz over plain HTTP tells them apart. */
export type ConnectionDiagnosis = "unreachable" | "refused" | null;

interface ConnectionState {
    status: ConnectionStatus;
    url: string;
    detail: string | null;
    diagnosis: ConnectionDiagnosis;
    lastRoundTripMs: number | null;
}

const initialState: ConnectionState = {
    status: "disconnected",
    url: resolveSocketUrl(import.meta.env.VITE_WS_URL),
    detail: null,
    diagnosis: null,
    lastRoundTripMs: null
};

export const connectionSlice = createSlice({
    name: "connection",
    initialState,
    reducers: {
        statusChanged(state, action: PayloadAction<{status: ConnectionStatus; detail?: string}>) {
            state.status = action.payload.status;
            state.detail = action.payload.detail ?? null;
            // A fresh answer is owed for a fresh status; the old one described
            // a different attempt.
            state.diagnosis = null;
        },
        diagnosed(state, action: PayloadAction<ConnectionDiagnosis>) {
            state.diagnosis = action.payload;
        },
        roundTripObserved(state, action: PayloadAction<number>) {
            state.lastRoundTripMs = action.payload;
        }
    }
});

export const {statusChanged, diagnosed, roundTripObserved} = connectionSlice.actions;
