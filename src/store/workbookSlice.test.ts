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

describe("the two edits that used to miss the graph", () => {
    it("a fixed correlation entry is structural: the service reads it once, at construction", () => {
        const withMatrix = reduce(initial, workbookActions.objectAdded("correlation"));
        const before = withMatrix.structureRevision;
        const next = reduce(withMatrix, workbookActions.correlationEntrySet({id: "CORR", row: 0, column: 1, value: 0.9}));
        expect(next.structureRevision).toBe(before + 1);
    });

    it("adding or changing a fixing is live — UpdateMarket carries it", () => {
        const withFixings = reduce(initial, workbookActions.objectAdded("fixings"));
        const before = withFixings.structureRevision;
        const added = reduce(withFixings, workbookActions.fixingsRowsSet({id: "FIX", rows: [{date: "2026-09-01", value: 0.021}]}));
        expect(added.structureRevision).toBe(before);
        const changed = reduce(added, workbookActions.fixingsRowsSet({id: "FIX", rows: [{date: "2026-09-01", value: 0.022}]}));
        expect(changed.structureRevision).toBe(before);
    });

    it("removing a fixing is structural — a fixing cannot be un-added", () => {
        const withFixings = reduce(initial, workbookActions.objectAdded("fixings"));
        const two = reduce(
            withFixings,
            workbookActions.fixingsRowsSet({
                id: "FIX",
                rows: [
                    {date: "2026-09-01", value: 0.021},
                    {date: "2026-09-02", value: 0.022}
                ]
            })
        );
        const one = reduce(two, workbookActions.fixingsRowsSet({id: "FIX", rows: [{date: "2026-09-01", value: 0.021}]}));
        expect(one.structureRevision).toBe(two.structureRevision + 1);
    });
});

describe("renaming, everywhere an id is named", () => {
    it("rewrites the trade's own references", () => {
        const next = reduce(initial, workbookActions.objectRenamed({from: "S", to: "SPOT"}));
        const kind = next.trade.instrument?.kind;
        if (kind?.case !== "option") throw new Error("shape");
        expect(kind.value.underlyings[0]?.spotQuoteId).toBe("SPOT");
        expect(next.market.some(object => object.id === "SPOT")).toBe(true);
        expect(next.market.some(object => object.id === "S")).toBe(false);
    });

    it("rewrites the book, pillars, the index's curve, and fixings", () => {
        const swapped = reduce(initial, workbookActions.swapExampleLoaded());
        const booked = reduce(swapped, workbookActions.bookAdded());
        const next = reduce(booked, workbookActions.objectRenamed({from: "IDX", to: "EURIBOR6M"}));

        const curve = next.market.find(object => object.id === "BC");
        if (curve?.kind.case !== "yieldCurve" || curve.kind.value.shape.case !== "bootstrap") throw new Error("shape");
        expect(curve.kind.value.shape.value.pillars.every(pillar => pillar.indexId === "EURIBOR6M")).toBe(true);

        const fixings = next.market.find(object => object.id === "FIXINGS");
        expect(fixings?.kind.case === "fixings" && fixings.kind.value.indexId).toBe("EURIBOR6M");

        for (const trade of [next.trade, ...next.book]) {
            const kind = trade.instrument?.kind;
            if (kind?.case !== "swap") throw new Error("shape");
            expect(kind.value.legs[1]?.indexId).toBe("EURIBOR6M");
        }
    });

    it("refuses a rename onto an id that is already taken", () => {
        const next = reduce(initial, workbookActions.objectRenamed({from: "S", to: "R"}));
        expect(next).toBe(initial);
    });
});
