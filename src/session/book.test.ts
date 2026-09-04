import {create} from "@bufbuild/protobuf";
import {describe, expect, it} from "vitest";

import {BatchResultSchema, Error_Code} from "@/gen/quantlib/v2/envelope_pb";
import {PriceResultSchema} from "@/gen/quantlib/v2/results_pb";
import {seedTrade} from "@/market/handlersSession";
import {swapExampleTrade} from "@/market/swapExample";
import {describeTrade} from "@/trade/describe";

import {readBatch} from "./book";

describe("reading a batch", () => {
    const result = create(BatchResultSchema, {
        entries: [
            {outcome: {case: "price", value: create(PriceResultSchema, {npv: 8.5, currency: "USD"})}},
            {outcome: {case: "error", value: {code: Error_Code.UNKNOWN_ID, message: "no market object 'NOPE'", fieldPath: "batch.requests[1].instrument.option.underlyings[0].spot_quote_id"}}},
            {outcome: {case: "price", value: create(PriceResultSchema, {npv: 1.5, currency: "USD"})}}
        ]
    });

    const outcome = readBatch(result, ["first", "second", "third"]);

    it("keeps the prices around a failing row", () => {
        // The whole point of the shape: one bad trade costs its own row and not
        // the two that priced correctly.
        expect(outcome.rows.map(row => row.npv)).toEqual([8.5, null, 1.5]);
    });

    it("puts the rejection on the row it belongs to", () => {
        expect(outcome.rows[1]?.error).toBe("no market object 'NOPE'");
        // The service prefixes the path with the row so it is unambiguous across
        // forty trades; the row is already known here, so showing the prefix
        // again would be noise.
        expect(outcome.rows[1]?.fieldPath).toBe("instrument.option.underlyings[0].spot_quote_id");
    });

    it("zips the labels back on by position, because the wire carries no ids", () => {
        expect(outcome.rows.map(row => row.label)).toEqual(["first", "second", "third"]);
    });

    it("reports an abandoned book rather than a short one", () => {
        // Every entry is present either way; abandoned_after is what says the
        // later errors are consequences rather than diagnoses.
        const abandoned = readBatch(create(BatchResultSchema, {entries: result.entries, abandonedAfter: 2}), ["a", "b", "c"]);
        expect(abandoned.rows).toHaveLength(3);
        expect(abandoned.abandonedAfter).toBe(2);
    });
});

describe("naming a trade", () => {
    it("reads the name off the trade, since the wire carries none", () => {
        expect(describeTrade(seedTrade())).toBe("call 100 · european · analytic");
    });

    it("says what a swap is without pretending it is an option", () => {
        expect(describeTrade(swapExampleTrade())).toMatch(/^swap · 2 legs · /);
    });
});
