import {configureStore} from "@reduxjs/toolkit";
import {afterEach, beforeEach, describe, expect, it, vi} from "vitest";

import {cancelScenario} from "@/session/scenario";
import {openTab} from "@/session/tabs";
import {rootReducer} from "@/store/rootReducer";
import {scenarioActions} from "@/store/scenarioSlice";
import {sessionActions} from "@/store/sessionSlice";

import {WireClient} from "./client";
import {FakeSocket} from "./fakeSocket";
import {wireMiddleware} from "./middleware";

/** The store as the app builds it, less the listeners, over a socket the test
 *  answers by hand. */
async function setUp() {
    const client = new WireClient({url: "ws://test", autoReconnect: false});
    const store = configureStore({
        reducer: rootReducer,
        middleware: getDefault => getDefault({thunk: {extraArgument: {client}}, serializableCheck: false, immutableCheck: false}).concat(wireMiddleware(client))
    });
    const attempt = client.connect();
    FakeSocket.instances.at(-1)!.open();
    await attempt;
    return {client, store, socket: FakeSocket.instances.at(-1)!};
}

const live = (sessionId: string) => sessionActions.opened({sessionId, bootstrapSeconds: 0, marketIds: []});

describe("an answer for a tab that is no longer in front", () => {
    beforeEach(() => {
        FakeSocket.instances = [];
        vi.stubGlobal("WebSocket", FakeSocket);
    });
    afterEach(() => vi.unstubAllGlobals());

    it("goes to that tab's snapshot, not to the pane of the tab just opened", async () => {
        const {client, store, socket} = await setUp();
        store.dispatch(live("s-1"));
        const price = client.send({case: "price", value: {}}, "s-1");

        // A new tab has no session, which used to count as "every reply is mine".
        store.dispatch(openTab());
        socket.reply({requestId: price.requestId, sessionId: "s-1", terminal: true, payload: {case: "priceResult", value: {npv: 12.5}}});
        await price.done;

        expect(store.getState().results.latest).toBeNull();
        expect(store.getState().tabs.byId["tab-1"]!.snapshot!.results.latest?.npv).toBe(12.5);
    });

    it("opens that tab's session, which would otherwise say opening for good", async () => {
        const {client, store, socket} = await setUp();
        const open = client.send({case: "openSession", value: {}});

        store.dispatch(openTab());
        socket.reply({requestId: open.requestId, sessionId: "s-9", terminal: true, payload: {case: "sessionOpened", value: {sessionId: "s-9"}}});
        await open.done;

        expect(store.getState().session.sessionId).toBeNull();
        const parked = store.getState().tabs.byId["tab-1"]!.snapshot!.session;
        expect([parked.status, parked.sessionId]).toEqual(["live", "s-9"]);
    });
});

describe("a sweep's cancel", () => {
    beforeEach(() => {
        FakeSocket.instances = [];
        vi.stubGlobal("WebSocket", FakeSocket);
    });
    afterEach(() => vi.unstubAllGlobals());

    it("goes to the session the sweep runs in, not the one in front", async () => {
        const {client, store, socket} = await setUp();
        store.dispatch(live("s-1"));
        const sweep = client.send({case: "price", value: {}}, "s-1");
        store.dispatch(scenarioActions.started(sweep.requestId.toString()));

        // The sweep panel is not per tab: it still offers Cancel from here.
        store.dispatch(openTab());
        store.dispatch(live("s-2"));
        void store.dispatch(cancelScenario());

        const cancel = socket.sent.at(-1)!;
        expect(cancel.payload.case).toBe("cancel");
        expect(cancel.sessionId).toBe("s-1");
    });
});
