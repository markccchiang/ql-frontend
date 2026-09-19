import {configureStore} from "@reduxjs/toolkit";
import {afterEach, beforeEach, describe, expect, it, vi} from "vitest";

import {WireClient} from "@/protocol/client";
import {FakeSocket} from "@/protocol/fakeSocket";
import {wireMiddleware} from "@/protocol/middleware";
import {rootReducer} from "@/store/rootReducer";
import {sessionActions} from "@/store/sessionSlice";

import {bumpQuote} from "./repricer";
import {openTab} from "./tabs";

/** Answers every frame the client has sent and nobody has answered, until it
 *  stops sending: an Ack for a write, a price for a price. */
async function answerAll(socket: FakeSocket, answered: Set<bigint>) {
    for (let round = 0; round < 20; ++round) {
        await new Promise(resolve => setTimeout(resolve, 0));
        const open = socket.sent.filter(frame => !answered.has(frame.requestId));
        if (open.length === 0) return;
        for (const frame of open) {
            answered.add(frame.requestId);
            const base = {requestId: frame.requestId, sessionId: frame.sessionId, terminal: true};
            if (frame.payload.case === "price") socket.reply({...base, payload: {case: "priceResult", value: {npv: 1}}});
            else socket.reply({...base, payload: {case: "ack", value: {}}});
        }
    }
}

describe("the slider queue", () => {
    beforeEach(() => {
        FakeSocket.instances = [];
        vi.stubGlobal("WebSocket", FakeSocket);
    });
    afterEach(() => vi.unstubAllGlobals());

    it("delivers a quote moved in a tab switched to while another tab's write was in flight", async () => {
        const client = new WireClient({url: "ws://test", autoReconnect: false});
        const store = configureStore({
            reducer: rootReducer,
            middleware: getDefault => getDefault({thunk: {extraArgument: {client}}, serializableCheck: false, immutableCheck: false}).concat(wireMiddleware(client))
        });
        const attempt = client.connect();
        const socket = FakeSocket.instances.at(-1)!;
        socket.open();
        await attempt;
        const answered = new Set<bigint>();

        // A drag in the first tab, its write still out...
        store.dispatch(sessionActions.opened({sessionId: "s-1", bootstrapSeconds: 0, marketIds: []}));
        const first = store.dispatch(bumpQuote("S", 101));

        // ...while the user moves to a second tab with a session of its own
        // and drags there. The first round trip is still running, so this one
        // waits in the queue.
        store.dispatch(openTab());
        store.dispatch(sessionActions.opened({sessionId: "s-2", bootstrapSeconds: 0, marketIds: []}));
        const second = store.dispatch(bumpQuote("S", 55));

        await answerAll(socket, answered);
        await Promise.all([first, second]);
        await answerAll(socket, answered);

        const writes = socket.sent.filter(frame => frame.payload.case === "updateMarket");
        const toSecond = writes.filter(frame => frame.sessionId === "s-2");
        expect(toSecond.map(frame => (frame.payload.case === "updateMarket" ? frame.payload.value.quotes.map(q => [q.quoteId, q.value]) : []))).toEqual([[["S", 55]]]);
        // And nothing of the first tab's reached the second's graph.
        expect(writes.filter(frame => frame.sessionId === "s-1")).toHaveLength(1);
    });
});
