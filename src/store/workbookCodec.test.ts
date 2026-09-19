import {readFileSync} from "node:fs";
import {describe, expect, it} from "vitest";

import {seedMarket, seedTrade} from "@/market/handlersSession";
import {swapExampleMarket, swapExampleTrade} from "@/market/swapExample";

import {decodeWorkbook, encodeWorkbook} from "./workbookCodec";

const option = {label: "HANDLERS", evaluationDate: "2026-09-01", market: seedMarket(), trade: seedTrade(), book: []};
const swap = {label: "Swap", evaluationDate: "2026-09-01", market: swapExampleMarket(), trade: swapExampleTrade(), book: [seedTrade()]};

describe("workbook round trip", () => {
    it("preserves the option workbook exactly", () => {
        const back = decodeWorkbook(JSON.parse(JSON.stringify(encodeWorkbook(option))));
        expect(back.label).toBe(option.label);
        expect(back.market).toEqual(option.market);
        expect(back.trade).toEqual(option.trade);
        expect(back.book).toEqual([]);
        expect(back.evaluationDate).toBe(option.evaluationDate);
    });

    it("preserves the swap workbook, indices and pillars included", () => {
        // The shape with the most convention nesting, and the one whose
        // forward reference a lossy codec would break.
        const back = decodeWorkbook(JSON.parse(JSON.stringify(encodeWorkbook(swap))));
        expect(back.market).toEqual(swap.market);
        expect(back.trade).toEqual(swap.trade);
        // The book was set up and never looked at: a codec that dropped it
        // passed.
        expect(back.book).toHaveLength(1);
        expect(back.book).toEqual(swap.book);
    });

    it("refuses a file from a version it does not read", () => {
        expect(() => decodeWorkbook({...encodeWorkbook(option), version: 2})).toThrow(/unsupported workbook version/);
    });

    it("refuses a file that is not a workbook", () => {
        expect(() => decodeWorkbook({hello: "world"})).toThrow(/unsupported workbook version/);
        expect(() => decodeWorkbook(null)).toThrow(/not a workbook/);
        expect(() => decodeWorkbook({version: 1, evaluationDate: "2026-09-01"})).toThrow(/needs a market/);
    });
});

/** The guide prints a workbook file. This is what stops it going stale.
 *
 *  `doc/interface.md` shows an example so a reader knows what export writes.
 *  A schema change would leave that example describing a format this build no
 *  longer produces, and nothing else would notice — so the example is read out
 *  of the page and required to be exactly what `encodeWorkbook` writes today,
 *  not merely something `decodeWorkbook` will accept.
 */
describe("the workbook example in the guide", () => {
    const page = readFileSync("doc/interface.md", "utf8");
    const block = /```json\n([\s\S]*?)\n```/.exec(page);

    it("is there at all", () => {
        expect(block, "no ```json block in doc/interface.md").not.toBeNull();
    });

    it("is exactly what this build would export", () => {
        const raw = JSON.parse(block![1]!) as Record<string, unknown>;
        expect(encodeWorkbook(decodeWorkbook(raw))).toEqual(raw);
    });
});
