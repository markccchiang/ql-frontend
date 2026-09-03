import {describe, expect, it} from "vitest";

import {WireClient} from "@/protocol/client";

import {describeDrift, findDrift} from "./drift";

/** The capability tables in this client against what the service advertises.
 *
 *  This is the check the handshake exists for. The tables are a second copy of
 *  a fact the backend owns, and before there was anything to compare them
 *  with, drift was discoverable only by a user meeting an unexplained
 *  rejection. Now it fails here.
 */
const URL = process.env.QL_BACKEND ?? "ws://127.0.0.1:9111";

const isBackendUp = await new Promise<boolean>(resolve => {
    try {
        const socket = new WebSocket(URL);
        const timer = setTimeout(() => {
            socket.close();
            resolve(false);
        }, 2000);
        socket.onopen = () => {
            clearTimeout(timer);
            socket.close();
            resolve(true);
        };
        socket.onerror = () => {
            clearTimeout(timer);
            resolve(false);
        };
    } catch {
        resolve(false);
    }
});

if (!isBackendUp) {
    console.warn(`[drift] no backend at ${URL}; skipped, not passed`);
}

describe.skipIf(!isBackendUp)("the capability handshake", () => {
    it("answers Hello with a terminal Capabilities frame", async () => {
        const client = new WireClient({url: URL});
        await client.connect();
        const frame = await client.send({case: "hello", value: {}}).done;
        client.close();

        expect(frame.terminal).toBe(true);
        expect(frame.payload.case).toBe("capabilities");
        if (frame.payload.case !== "capabilities") return;
        const reported = frame.payload.value;

        console.info(`[drift] ${reported.build} on QuantLib ${reported.quantlibVersion}: ${reported.optionStyles.length} styles, ${reported.resultKinds.length} result kinds`);
        expect(reported.build).not.toBe("");
        expect(reported.optionStyles.length).toBeGreaterThan(0);
        expect(reported.instruments).toContain("option");
    }, 30_000);

    it("agrees with the tables this client gates on", async () => {
        const client = new WireClient({url: URL});
        await client.connect();
        const frame = await client.send({case: "hello", value: {}}).done;
        client.close();
        if (frame.payload.case !== "capabilities") throw new Error("no capabilities");

        // Anything here is a real disagreement: either this client offers
        // something that will be refused, or the service has grown
        // something this client hides.
        expect(describeDrift(findDrift(frame.payload.value))).toEqual([]);
    }, 30_000);
});
