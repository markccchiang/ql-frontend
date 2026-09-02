import {describe, expect, it} from "vitest";

import {AnalyticParameters_Approximation, Engine_Method, LatticeParameters_Tree} from "@/gen/quantlib/v2/engine_pb";

import {workbookActions, workbookSlice} from "./workbookSlice";

const initial = workbookSlice.reducer(undefined, {type: "@@init"});
const reduce = workbookSlice.reducer;

describe("engine parameters", () => {
    it("creates the analytic block on first edit", () => {
        // The seed trade is analytic and carries no AnalyticParameters, so a
        // setter that only wrote into an existing block dropped the first edit
        // and left the field looking "required" after the user had answered it.
        expect(initial.trade.engine?.parameters.case).toBeUndefined();

        const next = reduce(initial, workbookActions.approximationSet(AnalyticParameters_Approximation.BARONE_ADESI_WHALEY));
        expect(next.trade.engine?.parameters).toMatchObject({
            case: "analytic",
            value: {approximation: AnalyticParameters_Approximation.BARONE_ADESI_WHALEY}
        });
    });

    it("creates the lattice block on first edit", () => {
        const next = reduce(initial, workbookActions.latticeStepsSet(500));
        expect(next.trade.engine?.parameters).toMatchObject({case: "lattice", value: {steps: 500}});
    });

    it("swaps the block when the method changes, so no field survives that does not apply", () => {
        const lattice = reduce(reduce(initial, workbookActions.engineMethodSet(Engine_Method.LATTICE)), workbookActions.latticeTreeSet(LatticeParameters_Tree.JOSHI4));
        expect(lattice.trade.engine?.parameters.case).toBe("lattice");

        const fd = reduce(lattice, workbookActions.engineMethodSet(Engine_Method.FINITE_DIFFERENCE));
        expect(fd.trade.engine?.parameters.case).toBe("fd");
    });
});

describe("structural revision", () => {
    it("does not move for a quote write — UpdateMarket carries those", () => {
        const next = reduce(initial, workbookActions.quoteValueSet({id: "S", value: 105}));
        expect(next.structureRevision).toBe(initial.structureRevision);
    });

    it("does not move for a trade edit — the instrument is not the graph", () => {
        const next = reduce(initial, workbookActions.engineMethodSet(Engine_Method.LATTICE));
        expect(next.structureRevision).toBe(initial.structureRevision);
    });

    it("moves for a market edit — that needs a new session", () => {
        const next = reduce(initial, workbookActions.evaluationDateSet("2026-09-02"));
        expect(next.structureRevision).toBe(initial.structureRevision + 1);
    });
});

describe("renaming", () => {
    it("rewrites the references, so a rename cannot dangle", () => {
        const next = reduce(initial, workbookActions.objectRenamed({from: "R", to: "RATE"}));
        const curve = next.market.find(object => object.id === "RC");
        if (curve?.kind.case !== "yieldCurve" || curve.kind.value.shape.case !== "flat") throw new Error("shape");
        expect(curve.kind.value.shape.value.rate?.source).toEqual({case: "quoteId", value: "RATE"});
    });
});
