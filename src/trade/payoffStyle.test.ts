import {describe, expect, it} from "vitest";

import {workbookActions, workbookSlice} from "@/store/workbookSlice";

import {validateTrade} from "./validation";

const initial = workbookSlice.reducer(undefined, {type: "@@init"});
const reduce = workbookSlice.reducer;
const payoffIssues = (state: typeof initial) => validateTrade(state.trade, state.market, state.evaluationDate).filter(issue => issue.path === "instrument.option.payoff");

describe("a payoff the style does not take", () => {
    it("is refused here rather than by the service", () => {
        // A floating strike left behind when the style moves off lookback.
        const lookback = reduce(reduce(initial, workbookActions.styleSet("lookback")), workbookActions.payoffKindSet("floating"));
        const moved = reduce(lookback, workbookActions.styleSet("vanilla"));
        expect(payoffIssues(moved).map(issue => issue.severity)).toEqual(["error"]);
    });

    it("is not flagged where the style takes it", () => {
        const lookback = reduce(reduce(initial, workbookActions.styleSet("lookback")), workbookActions.payoffKindSet("floating"));
        expect(payoffIssues(lookback)).toEqual([]);
    });
});
