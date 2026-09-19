import {configureStore} from "@reduxjs/toolkit";
import {afterEach, beforeEach, describe, expect, it, vi} from "vitest";

import {WireClient} from "@/protocol/client";
import {FakeSocket} from "@/protocol/fakeSocket";
import {wireMiddleware} from "@/protocol/middleware";
import {rootReducer} from "@/store/rootReducer";
import {sessionActions} from "@/store/sessionSlice";
import {workbookActions} from "@/store/workbookSlice";

import {closeTab, openTab, switchTab} from "./tabs";

describe("closing a tab", () => {
    beforeEach(() => {
        FakeSocket.instances = [];
        vi.stubGlobal("WebSocket", FakeSocket);
    });
    afterEach(() => vi.unstubAllGlobals());

    it("acts on the tabs as they are when the close comes back, not as they were when it went out", async () => {
        const client = new WireClient({url: "ws://test", autoReconnect: false});
        const store = configureStore({
            reducer: rootReducer,
            middleware: getDefault => getDefault({thunk: {extraArgument: {client}}, serializableCheck: false, immutableCheck: false}).concat(wireMiddleware(client))
        });
        const attempt = client.connect();
        const socket = FakeSocket.instances.at(-1)!;
        socket.open();
        await attempt;

        // Three tabs with documents of their own, the first in front with a session.
        store.dispatch(workbookActions.labelSet("first"));
        store.dispatch(sessionActions.opened({sessionId: "s-1", bootstrapSeconds: 0, marketIds: []}));
        store.dispatch(openTab());
        store.dispatch(workbookActions.labelSet("second"));
        store.dispatch(openTab());
        store.dispatch(workbookActions.labelSet("third"));
        store.dispatch(switchTab("tab-1"));

        // Close the first, and switch to the third while the close is in flight.
        const closing = store.dispatch(closeTab("tab-1"));
        store.dispatch(switchTab("tab-3"));
        const close = socket.sent.at(-1)!;
        socket.reply({requestId: close.requestId, sessionId: "s-1", terminal: true, payload: {case: "ack", value: {}}});
        await closing;

        const state = store.getState();
        expect(state.tabs.order).toEqual(["tab-2", "tab-3"]);
        expect(state.tabs.activeId).toBe("tab-3");
        expect(state.workbook.label).toBe("third");
        expect(state.tabs.byId["tab-2"]!.snapshot!.workbook.label).toBe("second");
    });
});
