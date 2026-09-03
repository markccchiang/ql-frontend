import {createSlice, type PayloadAction} from "@reduxjs/toolkit";

import type {ResultKind} from "@/gen/quantlib/v2/results_pb";

export type PointForm = "relative" | "linear" | "explicit";

/** What the user asked for. Held so a sweep can be re-run against a moved
 *  market without retyping it. */
export interface ScenarioSpec {
    quoteId: string;
    form: PointForm;
    /** relative: multipliers of the quote's current value. */
    factors: number[];
    /** linear: begin/end/steps. Named begin/end because `from` is a keyword in
     *  Python and the field would be unreachable there. */
    begin: number;
    end: number;
    steps: number;
    explicit: number[];
    plot: ResultKind;
    /** Off, and it stays off unless asked for: a sweep is a question, not an
     *  edit, and proto3 defaults it to false so the default has to be the safe
     *  one. */
    keepFinalValue: boolean;
}

export interface ScenarioPoint {
    x: number;
    npv: number;
    /** Every result the request asked for, at this point. */
    results: Record<string, number>;
}

export interface ScenarioOutcome {
    quoteId: string;
    plot: ResultKind;
    /** The name the backend gave the plotted series. */
    seriesName: string;
    x: number[];
    /** null where the engine published nothing at that point: a gap in the line
     *  rather than a shifted one. */
    y: (number | null)[];
    points: ScenarioPoint[];
    at: number;
}

interface ScenarioState {
    spec: ScenarioSpec;
    outcome: ScenarioOutcome | null;
    /** The in-flight sweep, so it can be cancelled. A sweep checks the stop flag
     *  between points, which makes it one of the two things this service can
     *  actually interrupt. */
    runningRequestId: string | null;
    error: string | null;
}

const initialState: ScenarioState = {
    spec: {
        quoteId: "S",
        form: "relative",
        factors: [0.8, 0.85, 0.9, 0.95, 1.0, 1.05, 1.1, 1.15, 1.2],
        begin: 80,
        end: 120,
        steps: 21,
        explicit: [],
        plot: 1, // NPV
        keepFinalValue: false
    },
    outcome: null,
    runningRequestId: null,
    error: null
};

export const scenarioSlice = createSlice({
    name: "scenario",
    initialState,
    reducers: {
        specChanged(state, action: PayloadAction<Partial<ScenarioSpec>>) {
            state.spec = {...state.spec, ...action.payload};
        },
        started(state, action: PayloadAction<string>) {
            state.runningRequestId = action.payload;
            state.error = null;
        },
        finished(state, action: PayloadAction<ScenarioOutcome>) {
            state.outcome = action.payload;
            state.runningRequestId = null;
            state.error = null;
        },
        failed(state, action: PayloadAction<string>) {
            state.runningRequestId = null;
            state.error = action.payload;
        },
        failedCleared(state) {
            state.error = null;
        }
    }
});

export const scenarioActions = scenarioSlice.actions;
