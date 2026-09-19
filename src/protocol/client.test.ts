import {afterEach, beforeEach, describe, expect, it, vi} from "vitest";

import {WireClient} from "./client";
import {DisconnectedError} from "./errors";
import {FakeSocket} from "./fakeSocket";

async function connected(client: WireClient): Promise<FakeSocket> {
    const attempt = client.connect();
    FakeSocket.instances.at(-1)!.open();
    await attempt;
    return FakeSocket.instances.at(-1)!;
}

describe("requests held through a dropped socket", () => {
    beforeEach(() => {
        FakeSocket.instances = [];
        vi.stubGlobal("WebSocket", FakeSocket);
        vi.useFakeTimers();
    });
    afterEach(() => {
        vi.unstubAllGlobals();
        vi.useRealTimers();
    });

    it("fail at once when they belong to no session, since nothing can be resumed under one", async () => {
        const client = new WireClient({url: "ws://test", autoReconnect: false});
        const socket = await connected(client);
        const {done} = client.send({case: "hello", value: {}});
        socket.close(1006, "dropped");
        await expect(done).rejects.toBeInstanceOf(DisconnectedError);
    });

    it("stay held through a reconnect, and fail when the hold runs out if nobody resumed them", async () => {
        const client = new WireClient({url: "ws://test", autoReconnect: false, holdPendingMs: 1000});
        const first = await connected(client);
        const outcome = client.send({case: "price", value: {}}, "s-1").done.then(
            () => "answered",
            () => "failed"
        );
        first.close(1006, "dropped");

        // A new socket is not a resume. Clearing the hold here left a parked
        // tab's request, or a comparison's, waiting for ever.
        await connected(client);
        vi.advanceTimersByTime(1000);
        expect(await outcome).toBe("failed");
    });

    it("are released for a resumed session and failed for a refused one, each alone", async () => {
        const client = new WireClient({url: "ws://test", autoReconnect: false, holdPendingMs: 1000});
        const first = await connected(client);
        const resumed = client.send({case: "price", value: {}}, "s-1");
        const refused = client.send({case: "price", value: {}}, "s-2").done.then(
            () => "answered",
            () => "failed"
        );
        first.close(1006, "dropped");

        const second = await connected(client);
        client.release("s-1");
        client.failPending("resume refused", "s-2");
        expect(await refused).toBe("failed");

        // Released, s-1 waits for its answer rather than for the timer.
        vi.advanceTimersByTime(5000);
        second.reply({requestId: resumed.requestId, sessionId: "s-1", terminal: true, payload: {case: "priceResult", value: {npv: 1}}});
        expect((await resumed.done).payload.case).toBe("priceResult");
    });
});

describe("connect()", () => {
    beforeEach(() => {
        FakeSocket.instances = [];
        vi.stubGlobal("WebSocket", FakeSocket);
        vi.useFakeTimers();
    });
    afterEach(() => {
        vi.unstubAllGlobals();
        vi.useRealTimers();
    });

    it("joins a connect that is still in its handshake rather than opening a second socket", async () => {
        const client = new WireClient({url: "ws://test", autoReconnect: false});
        const first = client.connect();
        const second = client.connect();

        expect(FakeSocket.instances).toHaveLength(1);
        FakeSocket.instances[0]!.open();
        await Promise.all([first, second]);
        expect(client.connectionStatus).toBe("connected");
    });

    it("ignores the close of a socket it has already replaced", async () => {
        const statuses: string[] = [];
        const client = new WireClient({url: "ws://test", autoReconnect: true});
        client.listen({onStatus: status => statuses.push(status)});

        const attempt = client.connect();
        FakeSocket.instances[0]!.close(1006, "dropped");
        await attempt.catch(() => undefined);

        // The automatic reconnect opens a second socket.
        vi.advanceTimersByTime(250);
        expect(FakeSocket.instances).toHaveLength(2);
        FakeSocket.instances[1]!.open();
        await Promise.resolve();
        expect(client.connectionStatus).toBe("connected");

        // A late close on the first socket must not tear down the second.
        FakeSocket.instances[0]!.close(1006, "late");
        expect(client.connectionStatus).toBe("connected");
        expect(statuses.at(-1)).toBe("connected");
    });

    it("keeps one reconnect timer, not one per close", async () => {
        const client = new WireClient({url: "ws://test", autoReconnect: true});
        const attempt = client.connect();
        const socket = FakeSocket.instances[0]!;
        socket.close(1006, "dropped");
        socket.close(1006, "dropped again");
        await attempt.catch(() => undefined);

        vi.advanceTimersByTime(10_000);
        expect(FakeSocket.instances).toHaveLength(2);
    });
});

describe("the token", () => {
    beforeEach(() => {
        FakeSocket.instances = [];
        vi.stubGlobal("WebSocket", FakeSocket);
    });
    afterEach(() => vi.unstubAllGlobals());

    it("rides the subprotocol list, which is the only part of a handshake a page can set", () => {
        const client = new WireClient({url: "ws://test", token: "abc", autoReconnect: false});
        void client.connect();

        // The protocol name goes with it: a browser fails a handshake in
        // which it offered protocols and the server selected none.
        expect(FakeSocket.instances[0]!.protocols).toEqual(["qlservice.v2", "token.abc"]);
    });

    it("offers no protocol at all when the service was started without one", () => {
        const client = new WireClient({url: "ws://test", autoReconnect: false});
        void client.connect();

        expect(FakeSocket.instances[0]!.protocols).toBeUndefined();
    });
});

describe("a socket that cannot be constructed", () => {
    afterEach(() => {
        vi.unstubAllGlobals();
    });

    it("rejects the connect and says disconnected, rather than connecting forever", async () => {
        // `new WebSocket` throws synchronously on a malformed URL or a token
        // with characters a subprotocol cannot carry. No socket, so no close
        // event would ever have moved the status on.
        vi.stubGlobal(
            "WebSocket",
            class {
                constructor() {
                    throw new SyntaxError("The subprotocol 'token.a b' is invalid.");
                }
            }
        );
        const client = new WireClient({url: "ws://test", token: "a b", autoReconnect: true});
        await expect(client.connect()).rejects.toThrow(/subprotocol/);
        expect(client.connectionStatus).toBe("disconnected");
    });
});
