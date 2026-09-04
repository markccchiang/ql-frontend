import {describe, expect, it} from "vitest";

import {resultsSlice} from "./resultsSlice";
import {sessionActions, sessionSlice} from "./sessionSlice";
import {tabsSlice} from "./tabsSlice";
import {workbookSlice} from "./workbookSlice";

/** A parked tab holding a session that is live at the moment of the drop. */
function withParkedTab() {
    const live = {...sessionSlice.getInitialState(), status: "live" as const, sessionId: "s-7"};
    const snapshot = {workbook: workbookSlice.getInitialState(), session: live, results: resultsSlice.getInitialState()};
    const state = tabsSlice.reducer(undefined, tabsSlice.actions.opened({id: "tab-2", label: "Workbook 2"}));
    return tabsSlice.reducer(state, tabsSlice.actions.captured({id: "tab-1", snapshot}));
}

describe("a socket that dies", () => {
    it("takes the parked tabs' sessions with it, not only the visible one", () => {
        // One socket carries every tab's session (DESIGN §9.4), so a drop that
        // marked only the tab in front left the others showing a healthy
        // session id that had stopped existing — and pricing into nothing.
        const before = withParkedTab();
        expect(before.byId["tab-1"]?.snapshot?.session.status).toBe("live");

        const after = tabsSlice.reducer(before, sessionActions.lost());
        expect(after.byId["tab-1"]?.snapshot?.session.status).toBe("lost");
        expect(after.byId["tab-1"]?.snapshot?.session.sessionId).toBeNull();
    });

    it("leaves the active tab alone, because its state is not a snapshot", () => {
        // The active tab lives in the slices themselves; sessionSlice already
        // handles the same action. Marking it here as well would be a second
        // copy of the truth.
        const after = tabsSlice.reducer(withParkedTab(), sessionActions.lost());
        expect(after.byId["tab-2"]?.snapshot).toBeNull();
    });
});
