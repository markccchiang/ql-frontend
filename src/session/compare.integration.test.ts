import {describe, expect, it} from "vitest";

import {HANDLERS_EVALUATION_DATE, seedMarket, seedTrade} from "@/market/handlersSession";
import {WireClient} from "@/protocol/client";

/** Two sessions on one socket, which is the capability the gateway advertises
 *  and nothing in the app used before M6. */
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
    console.warn(`[compare] no backend at ${URL}; the integration checks are skipped, not passed`);
}

async function open(client: WireClient, evaluationDate: string): Promise<string> {
    const {done} = client.send({
        case: "openSession",
        value: {evaluationDate: {form: {case: "iso", value: evaluationDate}}, market: seedMarket(), clientLabel: `compare ${evaluationDate}`}
    });
    const frame = await done;
    if (frame.payload.case !== "sessionOpened") throw new Error("no session");
    return frame.payload.value.sessionId;
}

async function price(client: WireClient, sessionId: string): Promise<number> {
    const frame = await client.send({case: "price", value: seedTrade()}, sessionId).done;
    if (frame.payload.case !== "priceResult") throw new Error("no price");
    return frame.payload.value.npv;
}

describe.skipIf(!isBackendUp)("two sessions on one socket", () => {
    it("prices the same trade against two evaluation dates without either disturbing the other", async () => {
        const client = new WireClient({url: URL});
        await client.connect();

        const base = await open(client, HANDLERS_EVALUATION_DATE);
        const variant = await open(client, "2026-12-01");
        expect(variant).not.toBe(base);

        const baseNpv = await price(client, base);
        const variantNpv = await price(client, variant);

        // Three months less time value on the same option, so the later
        // evaluation date is worth less. The point of the check is that
        // both sessions answered from their own graph.
        console.info(`[compare] base ${baseNpv.toFixed(6)} vs variant ${variantNpv.toFixed(6)} (sessions ${base} and ${variant})`);
        expect(baseNpv).toBeGreaterThan(variantNpv);

        // Closing the variant must leave the base alive and pricing.
        await client.send({case: "closeSession", value: {}}, variant).done;
        expect(await price(client, base)).toBeCloseTo(baseNpv, 12);

        client.close();
    }, 60_000);
});
