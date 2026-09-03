import {type DecodedWorkbook, decodeWorkbook, encodeWorkbook, type WorkbookFile} from "./workbookCodec";

const KEY = "ql-frontend.workbook.v1";

/** The workbook survives a refresh, and nothing else does.
 *
 *  A session cannot be persisted — it dies with its socket — and a price is
 *  only meaningful against a live graph. What is worth keeping is the document
 *  the client owns, which is also exactly what a reconnect replays.
 *
 *  Every path here is guarded: storage is absent under test, disabled in
 *  private windows, and full often enough to matter. Losing the saved copy is
 *  a nuisance; throwing on boot because of it is not acceptable.
 */
export function saveWorkbook(workbook: DecodedWorkbook): void {
    try {
        localStorage.setItem(KEY, JSON.stringify(encodeWorkbook(workbook)));
    } catch {
        // Full, disabled, or absent. The workbook is still in memory.
    }
}

export function loadWorkbook(): DecodedWorkbook | null {
    try {
        const raw = localStorage.getItem(KEY);
        if (!raw) return null;
        return decodeWorkbook(JSON.parse(raw) as WorkbookFile);
    } catch {
        // A stored workbook this build cannot read is dropped rather than
        // half-applied: opening a session against a market the user did not
        // write is worse than starting from the seed.
        return null;
    }
}

export function clearWorkbook(): void {
    try {
        localStorage.removeItem(KEY);
    } catch {
        // Nothing to do.
    }
}
