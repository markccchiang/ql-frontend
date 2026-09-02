import {describe, expect, it} from "vitest";

import {Engine_Method} from "@/gen/quantlib/v2/engine_pb";
import type {PriceRequest} from "@/gen/quantlib/v2/envelope_pb";
import {Flag} from "@/gen/quantlib/v2/market_pb";
import {ResultKind} from "@/gen/quantlib/v2/results_pb";
import {swapExampleMarket, swapExampleTrade} from "@/market/swapExample";

import {validateTrade} from "./validation";

const market = swapExampleMarket();
const errors = (trade: PriceRequest) =>
    validateTrade(trade, market)
        .filter(issue => issue.severity === "error")
        .map(issue => issue.path);

function swapOf(trade: PriceRequest) {
    if (trade.instrument?.kind.case !== "swap") throw new Error("not a swap");
    return trade.instrument.kind.value;
}

describe("the worked swap", () => {
    it("validates as it stands", () => {
        // It also prices to a par NPV against the running backend, with a fair
        // rate equal to the 5Y pillar the curve was stripped from.
        expect(errors(swapExampleTrade())).toEqual([]);
    });
});

describe("validateTrade, swaps", () => {
    it("needs at least two legs", () => {
        const trade = swapExampleTrade();
        swapOf(trade).legs = [swapOf(trade).legs[0]!];
        expect(errors(trade)).toContain("instrument.swap.legs");
    });

    it("refuses a portfolio dressed as a swap", () => {
        // "every leg of this swap has the same direction; that is a portfolio,
        // not a swap" — session.cpp:1929.
        const trade = swapExampleTrade();
        swapOf(trade).legs[1]!.pays = Flag.TRUE;
        expect(errors(trade)).toContain("instrument.swap.legs");
    });

    it("requires an explicit direction on every leg", () => {
        const trade = swapExampleTrade();
        swapOf(trade).legs[0]!.pays = Flag.UNSPECIFIED;
        expect(errors(trade)).toContain("instrument.swap.legs[0].pays");
    });

    it("requires a forwarding curve on a floating leg's index", () => {
        // "pricing off an index with an empty handle fails at the first
        // forecast" — session.cpp:1866.
        const stripped = market.map(object => (object.id === "IDX" && object.kind.case === "index" ? {...object, kind: {...object.kind, value: {...object.kind.value, forwardingCurveId: ""}}} : object));
        const issues = validateTrade(swapExampleTrade(), stripped).filter(issue => issue.severity === "error");
        expect(issues.map(issue => issue.path)).toContain("instrument.swap.legs[1].index_id");
    });

    it("refuses a fair rate off the wrong leg order", () => {
        // The formula assumes fixed first, floating second, and would return a
        // wrong number silently for any other arrangement.
        const trade = swapExampleTrade();
        swapOf(trade).legs.reverse();
        expect(errors(trade)).toContain("instrument.swap.legs");
    });

    it("allows the other results with the legs the wrong way round", () => {
        const trade = swapExampleTrade();
        swapOf(trade).legs.reverse();
        trade.results = [ResultKind.NPV, ResultKind.LEG_NPV];
        expect(errors(trade)).toEqual([]);
    });

    it("takes discounting and nothing else", () => {
        const trade = swapExampleTrade();
        trade.engine!.method = Engine_Method.ANALYTIC;
        expect(errors(trade)).toContain("engine.method");
    });

    it("names the unset engine specially, because v1 never read the field", () => {
        const trade = swapExampleTrade();
        trade.engine!.method = Engine_Method.UNSPECIFIED;
        const issue = validateTrade(trade, market).find(candidate => candidate.path === "engine.method");
        expect(issue?.message).toMatch(/priced silently/);
    });

    it("requires a rate on a fixed leg and an index on a floating one", () => {
        const trade = swapExampleTrade();
        swapOf(trade).legs[0]!.rateQuoteId = "";
        swapOf(trade).legs[1]!.indexId = "";
        const paths = errors(trade);
        expect(paths).toContain("instrument.swap.legs[0].rate_quote_id");
        expect(paths).toContain("instrument.swap.legs[1].index_id");
    });

    it("requires a maturity after the start", () => {
        const trade = swapExampleTrade();
        swapOf(trade).legs[0]!.schedule!.maturity = {$typeName: "quantlib.v1.Date", form: {case: "iso", value: "2020-01-01"}};
        expect(errors(trade)).toContain("instrument.swap.legs[0].schedule.maturity");
    });
});
