import {createSelector, createSlice, type PayloadAction} from "@reduxjs/toolkit";

import type {RequestKind} from "@/protocol/client";

export type RequestStatus = "in-flight" | "stalled" | "ok" | "error";

export interface ProgressState {
    completed: string;
    total: string;
    runningNpv: number;
    runningStandardError: number;
    scenarioPoint: number;
}

/** One reported point of a long calculation. Kept as a series because a
 *  convergence trace is the only way to see whether a Monte Carlo has settled
 *  or is still wandering. */
export interface TracePoint {
    completed: number;
    npv: number;
}

export interface RequestEntry {
    /** request_id as a decimal string: bigint does not belong in a Redux store. */
    id: string;
    kind: RequestKind;
    sessionId: string;
    /** The tab that sent it. Its answer is that tab's, whichever tab is in
     *  front when it arrives. */
    tabId: string;
    startedAt: number;
    elapsedMs: number | null;
    status: RequestStatus;
    progress: ProgressState | null;
    trace: TracePoint[];
    error: string | null;
}

interface RequestsState {
    byId: Record<string, RequestEntry>;
    order: string[];
}

const LIMIT = 200;
const TRACE_LIMIT = 2000;

const initialState: RequestsState = {byId: {}, order: []};

export const requestsSlice = createSlice({
    name: "requests",
    initialState,
    reducers: {
        started(state, action: PayloadAction<{id: string; kind: RequestKind; sessionId: string; tabId: string}>) {
            const {id, kind, sessionId, tabId} = action.payload;
            state.byId[id] = {
                id,
                kind,
                sessionId,
                tabId,
                startedAt: Date.now(),
                elapsedMs: null,
                status: "in-flight",
                progress: null,
                trace: [],
                error: null
            };
            state.order.unshift(id);
            for (const dropped of state.order.splice(LIMIT)) delete state.byId[dropped];
        },
        progressed(state, action: PayloadAction<{id: string; progress: ProgressState}>) {
            const entry = state.byId[action.payload.id];
            if (!entry) return;
            entry.progress = action.payload.progress;
            entry.status = "in-flight";
            const completed = Number(action.payload.progress.completed);
            // A sweep reports per point and a batched Monte Carlo per batch;
            // both are bounded by what the user asked for, so the series is
            // capped rather than trusted.
            if (entry.trace.length < TRACE_LIMIT) {
                entry.trace.push({completed, npv: action.payload.progress.runningNpv});
            }
        },
        stalled(state, action: PayloadAction<string>) {
            const entry = state.byId[action.payload];
            if (entry) entry.status = "stalled";
        },
        settled(state, action: PayloadAction<{id: string; elapsedMs: number; error?: string}>) {
            const entry = state.byId[action.payload.id];
            if (!entry) return;
            entry.elapsedMs = action.payload.elapsedMs;
            entry.status = action.payload.error ? "error" : "ok";
            entry.error = action.payload.error ?? null;
        }
    }
});

export const requestsActions = requestsSlice.actions;

type WithRequests = {requests: RequestsState};

export const selectInFlight = createSelector([(state: WithRequests) => state.requests.order, (state: WithRequests) => state.requests.byId], (order, byId): RequestEntry[] =>
    order.map(id => byId[id]).filter((entry): entry is RequestEntry => !!entry && entry.status !== "ok" && entry.status !== "error")
);
