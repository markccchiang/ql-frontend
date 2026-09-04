import {describe, expect, it} from "vitest";

import {seedMarket, seedTrade} from "@/market/handlersSession";
import {swapExampleMarket, swapExampleTrade} from "@/market/swapExample";

import {decodeWorkbook, encodeWorkbook} from "./workbookCodec";

const option = {label: "HANDLERS", evaluationDate: "2026-09-01", market: seedMarket(), trade: seedTrade(), book: []};
const swap = {label: "Swap", evaluationDate: "2026-09-01", market: swapExampleMarket(), trade: swapExampleTrade(), book: [seedTrade()]};

describe("workbook round trip", () => {
    it("preserves the option workbook exactly", () => {
        const back = decodeWorkbook(JSON.parse(JSON.stringify(encodeWorkbook(option))));
        expect(back.market).toEqual(option.market);
        expect(back.trade).toEqual(option.trade);
        expect(back.evaluationDate).toBe(option.evaluationDate);
    });

    it("preserves the swap workbook, indices and pillars included", () => {
        // The shape with the most convention nesting, and the one whose
        // forward reference a lossy codec would break.
        const back = decodeWorkbook(JSON.parse(JSON.stringify(encodeWorkbook(swap))));
        expect(back.market).toEqual(swap.market);
        expect(back.trade).toEqual(swap.trade);
    });

    it("refuses a file from a version it does not read", () => {
        expect(() => decodeWorkbook({...encodeWorkbook(option), version: 2})).toThrow(/unsupported workbook version/);
    });

    it("refuses a file that is not a workbook", () => {
        expect(() => decodeWorkbook({hello: "world"})).toThrow();
        expect(() => decodeWorkbook(null)).toThrow(/not a workbook/);
        expect(() => decodeWorkbook({version: 1, evaluationDate: "2026-09-01"})).toThrow(/needs a market/);
    });
});
