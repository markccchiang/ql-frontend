import {createSlice, type PayloadAction} from "@reduxjs/toolkit";

import type {ResultKind} from "@/gen/quantlib/v2/results_pb";

export type PointForm = "relative" | "linear" | "explicit";

/** One axis of a sweep: a quote, and the values it will take. */
export interface AxisSpec {
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
    /** Off, and it stays off unless asked for: a sweep is a question, not an
     *  edit, and proto3 defaults it to false so the default has to be the safe
     *  one. Per axis, so a grid can leave spot where it ended and put vol back. */
    keepFinalValue: boolean;
}

/** What the user asked for. Held so a sweep can be re-run against a moved
 *  market without retyping it. */
export interface ScenarioSpec {
    /** Outermost first. The first axis is the one drawn along x; a second one
     *  becomes a line per value, which is why the panel stops at two. */
    axes: AxisSpec[];
    /** A property of the sweep rather than of an axis — the backend refuses it
     *  on any axis but the first, because reading it off whichever axis set one
     *  would plot something nobody asked for. */
    plot: ResultKind;
}

export interface ScenarioPoint {
    x: number;
    npv: number;
    /** Every result the request asked for, at this point. */
    results: Record<string, number>;
}

/** One drawn line: the whole sweep when there is one axis, one value of the
 *  second axis when there are two. */
export interface ScenarioLine {
    label: string;
    /** null where the engine published nothing at that point: a gap in the line
     *  rather than a shifted one. */
    y: (number | null)[];
}

export interface ScenarioOutcome {
    /** As the service reported them, outermost first. */
    axes: {quoteId: string; values: number[]}[];
    plot: ResultKind;
    /** The name the backend gave the plotted result. */
    seriesName: string;
    /** The first axis' values: what the lines are drawn against. */
    x: number[];
    lines: ScenarioLine[];
    points: ScenarioPoint[];
    /** How many points were priced before a cancel stopped the sweep; zero when
     *  the whole ladder ran. A cancelled sweep keeps what it computed, so this
     *  is what says the ladder is a prefix rather than the answer. */
    abandonedAfter: number;
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

export function newAxis(quoteId: string): AxisSpec {
    return {quoteId, form: "relative", factors: [0.9, 1.0, 1.1], begin: 80, end: 120, steps: 21, explicit: [], keepFinalValue: false};
}

const initialState: ScenarioState = {
    spec: {
        axes: [
            {
                quoteId: "S",
                form: "relative",
                factors: [0.8, 0.85, 0.9, 0.95, 1.0, 1.05, 1.1, 1.15, 1.2],
                begin: 80,
                end: 120,
                steps: 21,
                explicit: [],
                keepFinalValue: false
            }
        ],
        plot: 1 // NPV
    },
    outcome: null,
    runningRequestId: null,
    error: null
};

export const scenarioSlice = createSlice({
    name: "scenario",
    initialState,
    reducers: {
        specChanged(state, action: PayloadAction<Partial<Omit<ScenarioSpec, "axes">>>) {
            state.spec = {...state.spec, ...action.payload};
        },
        axisChanged(state, action: PayloadAction<{at: number; change: Partial<AxisSpec>}>) {
            const axis = state.spec.axes[action.payload.at];
            if (axis) state.spec.axes[action.payload.at] = {...axis, ...action.payload.change};
        },
        axisAdded(state, action: PayloadAction<string>) {
            state.spec.axes.push(newAxis(action.payload));
        },
        axisRemoved(state, action: PayloadAction<number>) {
            // Never the last one: a sweep with no axis is not a sweep.
            if (state.spec.axes.length > 1) state.spec.axes.splice(action.payload, 1);
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
