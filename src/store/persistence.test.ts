import {beforeEach, describe, expect, it} from "vitest";

import {seedMarket, seedTrade} from "@/market/handlersSession";

import {clearWorkbook, loadTabs, saveTabs, takeLoadProblem} from "./persistence";
import {encodeWorkbook} from "./workbookCodec";

/** A Map behind the Storage interface: the tests run under Node, which has no
 *  localStorage of its own. */
function installStorage(): Map<string, string> {
    const items = new Map<string, string>();
    Object.assign(globalThis, {
        localStorage: {
            getItem: (key: string) => items.get(key) ?? null,
            setItem: (key: string, value: string) => void items.set(key, value),
            removeItem: (key: string) => void items.delete(key),
            clear: () => items.clear()
        }
    });
    return items;
}

const workbook = (label: string) => ({label, evaluationDate: "2026-09-01", market: seedMarket(), trade: seedTrade(), book: []});

describe("saved tabs", () => {
    let items: Map<string, string>;
    beforeEach(() => {
        items = installStorage();
        takeLoadProblem();
    });

    it("come back in order, with the one in front still in front", () => {
        saveTabs({
            activeId: "tab-3",
            tabs: [
                {id: "tab-1", workbook: workbook("first")},
                {id: "tab-3", workbook: workbook("second")}
            ]
        });
        const back = loadTabs()!;
        expect(back.activeId).toBe("tab-3");
        expect(back.tabs.map(tab => [tab.id, tab.workbook.label])).toEqual([
            ["tab-1", "first"],
            ["tab-3", "second"]
        ]);
        expect(back.tabs[0]!.workbook.market).toEqual(seedMarket());
    });

    it("read the single workbook an older build saved as one tab, and replace it on the next save", () => {
        items.set("ql-frontend.workbook.v1", JSON.stringify(encodeWorkbook(workbook("from before tabs"))));
        const back = loadTabs()!;
        expect(back.tabs.map(tab => tab.workbook.label)).toEqual(["from before tabs"]);

        saveTabs(back);
        expect(items.has("ql-frontend.workbook.v1")).toBe(false);
        expect(loadTabs()!.tabs[0]!.workbook.label).toBe("from before tabs");
    });

    it("that cannot be read are kept aside rather than overwritten, and the reason is given once", () => {
        const unreadable = JSON.stringify({version: 1, activeId: "tab-1", tabs: [{id: "tab-1", workbook: {version: 1, label: "x", evaluationDate: "2026-09-01", market: [{id: "S", noSuchField: 1}], trade: {}}}]});
        items.set("ql-frontend.tabs.v1", unreadable);

        expect(loadTabs()).toBeNull();
        expect(items.get("ql-frontend.tabs.v1.unreadable")).toBe(unreadable);
        expect(takeLoadProblem()).toMatch(/ql-frontend\.tabs\.v1\.unreadable/);
        expect(takeLoadProblem()).toBeNull();

        // The next save writes the main key; the copy set aside stays.
        saveTabs({activeId: "tab-1", tabs: [{id: "tab-1", workbook: workbook("seed")}]});
        expect(items.get("ql-frontend.tabs.v1.unreadable")).toBe(unreadable);
    });

    it("are forgotten, old and new, by a reset", () => {
        saveTabs({activeId: "tab-1", tabs: [{id: "tab-1", workbook: workbook("x")}]});
        items.set("ql-frontend.workbook.v1", "{}");
        clearWorkbook();
        expect(loadTabs()).toBeNull();
    });
});
