import {describe, expect, it} from "vitest";

import {bookActions} from "./bookSlice";
import {rootReducer} from "./rootReducer";
import {workbookActions} from "./workbookSlice";

const priced = rootReducer(undefined, bookActions.finished({rows: [{label: "call 100", npv: 1, currency: "", error: null, fieldPath: null, engine: "analytic"}], abandonedAfter: 0, at: 0}));

describe("a priced book", () => {
    it("goes with the document it was priced from", () => {
        // Rows are matched to trades by position, so a result left behind
        // describes whatever trades now happen to share those positions.
        expect(priced.book.outcome).not.toBeNull();
        for (const replaced of [
            workbookActions.workbookLoaded({label: "imported", evaluationDate: "2026-09-01", market: priced.workbook.market, trade: priced.workbook.trade, book: []}),
            workbookActions.reset(),
            workbookActions.swapExampleLoaded(),
            workbookActions.restored(priced.workbook)
        ]) {
            expect(rootReducer(priced, replaced).book.outcome, replaced.type).toBeNull();
        }
    });

    it("survives an edit to the document it belongs to", () => {
        expect(rootReducer(priced, workbookActions.labelSet("renamed")).book.outcome).not.toBeNull();
    });
});
