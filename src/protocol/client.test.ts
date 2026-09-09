import {afterEach, beforeEach, describe, expect, it, vi} from "vitest";

import {WireClient} from "./client";

/** A WebSocket the test opens and closes by hand. */
class FakeSocket {
    static instances: FakeSocket[] = [];
    binaryType = "";
    onopen: (() => void) | null = null;
    onclose: ((event: {code: number; reason: string}) => void) | null = null;
    onerror: (() => void) | null = null;
    onmessage: ((event: MessageEvent<ArrayBuffer>) => void) | null = null;
    constructor(readonly url: string) {
        FakeSocket.instances.push(this);
    }
    open() {
        this.onopen?.();
    }
    close(code = 1000, reason = "") {
        this.onclose?.({code, reason});
    }
    send() {}
}

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
