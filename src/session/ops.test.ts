import {create} from "@bufbuild/protobuf";
import {configureStore} from "@reduxjs/toolkit";
import {describe, expect, it} from "vitest";

import {type ClientFrame, Error_Code, type ServerFrame, ServerFrameSchema} from "@/gen/quantlib/v2/envelope_pb";
import type {ClientPayloadInit, SentRequest, WireClient} from "@/protocol/client";
import {WireError} from "@/protocol/errors";
import {rootReducer} from "@/store/rootReducer";
import {sessionActions} from "@/store/sessionSlice";

import {cancelRequest, openSession} from "./ops";

/** The client as the thunks see it, answering each frame from a script.
 *
 *  No socket: what is under test is the order of frames a thunk sends and
 *  what it does when one of them is refused, which the integration tests
 *  cannot arrange because a live service never refuses a close.
 */
function scriptedClient(answer: (payload: ClientPayloadInit, sessionId: string) => ServerFrame | Error) {
    const sent: {kind: NonNullable<ClientFrame["payload"]["case"]>; sessionId: string}[] = [];
    let nextId = 1n;
    const client = {
        connectionStatus: "connected" as const,
        connect: () => Promise.resolve(),
        send(payload: ClientPayloadInit, sessionId = ""): SentRequest {
            const requestId = nextId++;
            sent.push({kind: payload.case!, sessionId});
            const reply = answer(payload, sessionId);
            return {requestId, done: reply instanceof Error ? Promise.reject(reply) : Promise.resolve(reply)};
        }
    };
    return {client: client as unknown as WireClient, sent};
}

const opened = (sessionId: string) => create(ServerFrameSchema, {terminal: true, sessionId, payload: {case: "sessionOpened", value: {sessionId, bootstrapSeconds: 0.001}}});
const notFound = (sessionId: string) => new WireError({$typeName: "quantlib.v2.Error", code: Error_Code.SESSION_NOT_FOUND, message: `no session '${sessionId}' on this connection`, fieldPath: "", knownIds: []}, 0n);

function storeWith(client: WireClient) {
    return configureStore({
        reducer: rootReducer,
        middleware: getDefault => getDefault({thunk: {extraArgument: {client}}, serializableCheck: false})
    });
}

describe("opening after a lost session", () => {
    it("does not send a CloseSession the gateway would refuse, and opens anyway", async () => {
        // The replay after a refused resume: the old id is still on the slice
        // so that a resume was possible, but the socket that owned it is gone
        // and the gateway answers SESSION_NOT_FOUND to anything naming it.
        const {client, sent} = scriptedClient((payload, sessionId) => {
            if (payload.case === "closeSession") return notFound(sessionId);
            if (payload.case === "openSession") return opened("s-2");
            throw new Error(`unexpected ${payload.case}`);
        });
        const store = storeWith(client);
        store.dispatch(sessionActions.opened({sessionId: "s-1", bootstrapSeconds: 0.001, marketIds: [], resumeToken: "t"}));
        store.dispatch(sessionActions.lost());

        await store.dispatch(openSession());

        expect(sent.map(frame => frame.kind)).toEqual(["openSession"]);
    });

    it("still closes a live session before opening another", async () => {
        const {client, sent} = scriptedClient((payload, sessionId) => {
            if (payload.case === "closeSession") return create(ServerFrameSchema, {terminal: true, sessionId, payload: {case: "ack", value: {}}});
            if (payload.case === "openSession") return opened("s-2");
            throw new Error(`unexpected ${payload.case}`);
        });
        const store = storeWith(client);
        store.dispatch(sessionActions.opened({sessionId: "s-1", bootstrapSeconds: 0.001, marketIds: []}));

        await store.dispatch(openSession());

        expect(sent.map(frame => [frame.kind, frame.sessionId])).toEqual([
            ["closeSession", "s-1"],
            ["openSession", ""]
        ]);
    });

    it("a refused close is not a reason to keep the old session", async () => {
        // A live session whose close is refused -- the service was restarted
        // between the last price and now -- must not block the open either.
        const {client, sent} = scriptedClient((payload, sessionId) => {
            if (payload.case === "closeSession") return notFound(sessionId);
            if (payload.case === "openSession") return opened("s-2");
            throw new Error(`unexpected ${payload.case}`);
        });
        const store = storeWith(client);
        store.dispatch(sessionActions.opened({sessionId: "s-1", bootstrapSeconds: 0.001, marketIds: []}));

        await store.dispatch(openSession());

        expect(sent.map(frame => frame.kind)).toEqual(["closeSession", "openSession"]);
    });
});

describe("cancelling", () => {
    it("settles quietly when the cancel cannot be sent or is refused", async () => {
        // Every caller is a button's `void dispatch(...)`. A socket that is down
        // throws from send, and a cancel the service refuses rejects; either
        // was an unhandled rejection with nothing on screen to say so.
        const down = {
            cancel: () => {
                throw new Error("not connected");
            }
        } as unknown as WireClient;
        const store = storeWith(down);
        store.dispatch(sessionActions.opened({sessionId: "s-1", bootstrapSeconds: 0, marketIds: []}));
        await expect(store.dispatch(cancelRequest("7"))).resolves.toBeUndefined();

        const refusing = {
            cancel: (_target: bigint, sessionId: string): SentRequest => ({requestId: 1n, done: Promise.reject(notFound(sessionId))})
        } as unknown as WireClient;
        const refused = storeWith(refusing);
        refused.dispatch(sessionActions.opened({sessionId: "s-1", bootstrapSeconds: 0, marketIds: []}));
        await expect(refused.dispatch(cancelRequest("7"))).resolves.toBeUndefined();
    });
});
