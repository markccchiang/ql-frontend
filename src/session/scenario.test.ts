import {create} from "@bufbuild/protobuf";
import {describe, expect, it} from "vitest";

import {PriceResultSchema, ScenarioResultSchema} from "@/gen/quantlib/v2/results_pb";
import {scenarioSlice} from "@/store/scenarioSlice";

import {pointCount, pointsFor, readOutcome} from "./scenario";

const state = scenarioSlice.reducer(undefined, {type: "@@init"});
const spec = state.spec;
const axis = spec.axes[0]!;

describe("pointsFor", () => {
    it("sends relative factors as multipliers of the live value", () => {
        // The backend multiplies these by the quote's current value, so the
        // frontend must not pre-multiply them.
        expect(pointsFor({...axis, form: "relative", factors: [0.9, 1, 1.1]})).toEqual({
            case: "relative",
            value: {factors: [0.9, 1, 1.1]}
        });
    });

    it("sends begin/end/steps for a linear sweep", () => {
        // Named begin/end rather than from/to: `from` is a keyword in Python and
        // the field would be unreachable in the generated client there.
        expect(pointsFor({...axis, form: "linear", begin: 80, end: 120, steps: 21})).toEqual({
            case: "linear",
            value: {begin: 80, end: 120, steps: 21}
        });
    });

    it("sends explicit values as themselves", () => {
        expect(pointsFor({...axis, form: "explicit", explicit: [95, 100, 105]})).toEqual({
            case: "explicit",
            value: {values: [95, 100, 105]}
        });
    });
});

describe("the default sweep", () => {
    it("does not keep the last swept value", () => {
        // proto3 defaults the field to false and the default has to be the safe
        // one: a sweep is a question, not an edit.
        expect(axis.keepFinalValue).toBe(false);
    });

    it("needs at least two steps to be linear", () => {
        // session/worker.cpp rejects fewer, naming scenarios[0].linear.steps.
        expect(axis.steps).toBeGreaterThanOrEqual(2);
    });

    it("starts as one axis", () => {
        expect(spec.axes).toHaveLength(1);
        expect(pointCount(spec)).toBe(axis.factors.length);
    });
});

describe("the point count", () => {
    it("multiplies, which is the whole reason the service caps it", () => {
        // Two axes that each look harmless are their product, and the panel says
        // so before the round trip rather than after it.
        const grid = {
            ...spec,
            axes: [
                {...axis, form: "linear" as const, steps: 200},
                {...axis, quoteId: "V", form: "linear" as const, steps: 200}
            ]
        };
        expect(pointCount(grid)).toBe(40000);
    });
});

/** Row-major with the last axis varying fastest is the contract the surface is
 *  read with, so it is worth a check that does not merely restate the code. */
describe("reading a grid", () => {
    const result = create(ScenarioResultSchema, {
        axes: [
            {quoteId: "S", values: [90, 100, 110]},
            {quoteId: "V", values: [0.1, 0.2]}
        ],
        // 3 x 2, row-major: spot 90 at both vols, then spot 100, then 110.
        prices: [1, 2, 3, 4, 5, 6].map(npv => create(PriceResultSchema, {npv})),
        surface: {rows: 3, columns: 2, values: [1, 2, 3, 4, 5, 6], rowLabels: [90, 100, 110], columnLabels: [0.1, 0.2]}
    });

    const outcome = readOutcome(result, spec);

    it("draws one line per value of the second axis", () => {
        expect(outcome.lines.map(line => line.label)).toEqual(["V 0.1", "V 0.2"]);
        expect(outcome.x).toEqual([90, 100, 110]);
    });

    it("takes a column, not a row, for each line", () => {
        // The trap: prices are row-major, so a line is every `columns`-th value
        // and not a contiguous slice. Getting it wrong plots vol along spot.
        expect(outcome.lines[0]?.y).toEqual([1, 3, 5]);
        expect(outcome.lines[1]?.y).toEqual([2, 4, 6]);
    });

    it("keeps a single axis a single line", () => {
        const line = readOutcome(create(ScenarioResultSchema, {axes: [{quoteId: "S", values: [90, 100]}], prices: [7, 8].map(npv => create(PriceResultSchema, {npv}))}), spec);
        expect(line.lines).toHaveLength(1);
        expect(line.lines[0]?.y).toEqual([7, 8]);
    });
});
