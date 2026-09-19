import {describe, expect, it} from "vitest";

import {requestsActions} from "./requestsSlice";
import {type PriceSummary, resultsActions} from "./resultsSlice";
import {rootReducer} from "./rootReducer";
import {selectMonteCarloFinal} from "./selectors";
import type {RootState} from "./types";

const price = (requestId: string, npv: number): PriceSummary => ({
    requestId,
    sessionId: "s-1",
    at: 0,
    npv,
    currency: "",
    values: [],
    unavailable: [],
    cashflows: [],
    engine: "",
    calculationSeconds: 0,
    standardError: null,
    samples: null
});

describe("the Monte Carlo panel's final value", () => {
    it("is the run's own price, and none once a later price replaces it", () => {
        let state = rootReducer(undefined, {type: "@@init"}) as RootState;
        state = rootReducer(state, requestsActions.started({id: "5", kind: "price", sessionId: "s-1", tabId: "tab-1"})) as RootState;
        state = rootReducer(state, requestsActions.progressed({id: "5", progress: {completed: "1", total: "2", runningNpv: 10.1, runningStandardError: null, scenarioPoint: null}})) as RootState;
        state = rootReducer(state, resultsActions.priced(price("5", 10.2))) as RootState;
        expect(selectMonteCarloFinal(state)?.npv).toBe(10.2);

        // An analytic price after it. The panel used to show 9.9 as the run's
        // final value, beside the run's own trace and error band.
        state = rootReducer(state, requestsActions.started({id: "6", kind: "price", sessionId: "s-1", tabId: "tab-1"})) as RootState;
        state = rootReducer(state, resultsActions.priced(price("6", 9.9))) as RootState;
        expect(selectMonteCarloFinal(state)).toBeNull();
    });
});
