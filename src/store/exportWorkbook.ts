import {encodeWorkbook} from "./workbookCodec";
import type {WorkbookState} from "./workbookSlice";

/** Saves the workbook as a file, the way the Export button does.
 *
 *  Its own module so the error boundary can offer it too: when a render has
 *  failed, the workbook bar may be what failed, and a copy on disk is the one
 *  way out that cannot be undone by the next crash.
 */
export function downloadWorkbook(workbook: Pick<WorkbookState, "label" | "evaluationDate" | "market" | "trade" | "book">): void {
    const file = encodeWorkbook({label: workbook.label, evaluationDate: workbook.evaluationDate, market: workbook.market, trade: workbook.trade, book: workbook.book});
    const blob = new Blob([JSON.stringify(file, null, 2)], {type: "application/json"});
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = `${workbook.label.replace(/[^a-z0-9]+/gi, "-").toLowerCase() || "workbook"}.qlwb.json`;
    anchor.click();
    // Deferred: revoking synchronously after click() cancels the download
    // in some browsers, which have not yet started reading the URL.
    setTimeout(() => URL.revokeObjectURL(url), 0);
}
