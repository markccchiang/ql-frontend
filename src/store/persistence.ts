import {FIRST_TAB_ID, type TabsState} from "./tabsSlice";
import {type DecodedWorkbook, decodeWorkbook, encodeWorkbook, type WorkbookFile} from "./workbookCodec";
import type {WorkbookState} from "./workbookSlice";

/** Every tab's workbook, in tab order, with which one was in front. */
const TABS_KEY = "ql-frontend.tabs.v1";

/** The single workbook the builds before this one saved. Read once, as a set
 *  of one tab, and removed by the first save of the new kind. */
const LEGACY_KEY = "ql-frontend.workbook.v1";

/** The workbooks survive a refresh, and nothing else does.
 *
 *  A session cannot be persisted — it outlives a socket, not a page — and a price is
 *  only meaningful against a live graph. What is worth keeping is the document
 *  the client owns, which is also exactly what a reconnect replays. Every
 *  tab's, not only the one in front: saving that one alone lost the others on
 *  the next refresh, and the one in front after a switch was the one kept.
 *
 *  Every path here is guarded: storage is absent under test, disabled in
 *  private windows, and full often enough to matter. Losing the saved copy is
 *  a nuisance; throwing on boot because of it is not acceptable.
 */
export interface SavedTab {
    id: string;
    workbook: DecodedWorkbook;
}

export interface SavedTabs {
    activeId: string;
    tabs: SavedTab[];
}

interface TabsFile {
    version: 1;
    activeId: string;
    tabs: {id: string; workbook: WorkbookFile}[];
}

/** Why the saved copy could not be read on this load, once. */
let loadProblem: string | null = null;

function documentOf(workbook: DecodedWorkbook): DecodedWorkbook {
    return {label: workbook.label, evaluationDate: workbook.evaluationDate, market: workbook.market, trade: workbook.trade, book: workbook.book};
}

/** The tabs as they stand: the one in front from the slices, the rest from
 *  their parked snapshots. */
export function tabsToSave(state: {workbook: WorkbookState; tabs: TabsState}): SavedTabs {
    const tabs = state.tabs.order.flatMap(id => {
        const workbook = id === state.tabs.activeId ? state.workbook : state.tabs.byId[id]?.snapshot?.workbook;
        return workbook ? [{id, workbook: documentOf(workbook)}] : [];
    });
    return {activeId: state.tabs.activeId, tabs};
}

export function saveTabs(saved: SavedTabs): void {
    try {
        const file: TabsFile = {version: 1, activeId: saved.activeId, tabs: saved.tabs.map(tab => ({id: tab.id, workbook: encodeWorkbook(tab.workbook)}))};
        localStorage.setItem(TABS_KEY, JSON.stringify(file));
        localStorage.removeItem(LEGACY_KEY);
    } catch {
        // Full, disabled, or absent. The workbooks are still in memory.
    }
}

export function loadTabs(): SavedTabs | null {
    let key = TABS_KEY;
    let raw: string | null = null;
    try {
        raw = localStorage.getItem(TABS_KEY);
        if (raw) return readTabs(JSON.parse(raw) as TabsFile);

        key = LEGACY_KEY;
        raw = localStorage.getItem(LEGACY_KEY);
        if (!raw) return null;
        return {activeId: FIRST_TAB_ID, tabs: [{id: FIRST_TAB_ID, workbook: decodeWorkbook(JSON.parse(raw) as WorkbookFile)}]};
    } catch (error) {
        // Dropped rather than half-applied -- opening a session against a
        // market the user did not write is worse than starting from the seed --
        // but not lost: the next save would write over the only copy, so it is
        // set aside first. A schema change, or a rollback to an older build, is
        // all it takes to make a good workbook unreadable here.
        if (raw) keepAside(key, raw, error);
        return null;
    }
}

function readTabs(file: TabsFile): SavedTabs {
    if (file.version !== 1 || !Array.isArray(file.tabs) || file.tabs.length === 0) {
        throw new Error(`not a set of tabs this build can read (version ${String(file.version)})`);
    }
    const tabs = file.tabs.map(tab => ({id: String(tab.id), workbook: decodeWorkbook(tab.workbook)}));
    const activeId = tabs.some(tab => tab.id === file.activeId) ? file.activeId : tabs[0]!.id;
    return {activeId, tabs};
}

function keepAside(key: string, raw: string, error: unknown): void {
    const aside = `${key}.unreadable`;
    try {
        localStorage.setItem(aside, raw);
    } catch {
        // Full: the copy cannot be kept, and the message says so.
    }
    const reason = error instanceof Error ? error.message : String(error);
    loadProblem = `${reason}. The saved copy is kept in this browser's storage under "${aside}", and this session starts from the seed.`;
}

/** Why the saved workbooks could not be restored, the first time it is asked
 *  and never again, so a notice is shown once. */
export function takeLoadProblem(): string | null {
    const problem = loadProblem;
    loadProblem = null;
    return problem;
}

export function clearWorkbook(): void {
    try {
        localStorage.removeItem(TABS_KEY);
        localStorage.removeItem(LEGACY_KEY);
    } catch {
        // Nothing to do.
    }
}
