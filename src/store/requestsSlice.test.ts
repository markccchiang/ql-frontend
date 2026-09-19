import {describe, expect, it} from "vitest";

import {requestsActions, requestsSlice} from "./requestsSlice";

const reduce = requestsSlice.reducer;
const initial = reduce(undefined, requestsActions.started({id: "7", kind: "batch", sessionId: "s", tabId: "t"}));

const progress = (completed: number, runningNpv: number | null) => ({
    completed: String(completed),
    total: "4",
    runningNpv,
    runningStandardError: null,
    scenarioPoint: null
});

describe("progress", () => {
    it("traces only the points that carried a number", () => {
        // A batch entry that failed reports no running NPV. It used to read
        // 0.0, and drew a price of zero into the trace.
        let state = initial;
        state = reduce(state, requestsActions.progressed({id: "7", progress: progress(1, 12.5)}));
        state = reduce(state, requestsActions.progressed({id: "7", progress: progress(2, null)}));
        state = reduce(state, requestsActions.progressed({id: "7", progress: progress(3, 0)}));

        expect(state.byId["7"]?.trace).toEqual([
            {completed: 1, npv: 12.5},
            {completed: 3, npv: 0}
        ]);
        expect(state.byId["7"]?.progress?.completed).toBe("3");
    });
});
