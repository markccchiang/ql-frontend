import {describe, expect, it} from "vitest";

import type {PriceRequest} from "@/gen/quantlib/v2/envelope_pb";
import {HANDLERS_EVALUATION_DATE, seedMarket, seedTrade} from "@/market/handlersSession";
import {WireClient} from "@/protocol/client";

import {readBatch} from "./book";

/** A book of trades in one frame, against the running service.
 *
 *  The claim worth checking end to end is the one that shaped the message: a
 *  trade that cannot price costs its own row and nothing else. A unit test can
 *  only assert that against a fixture it wrote; this asks the backend.
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
    console.warn(`[batch] no backend at ${URL}; skipped, not passed`);
}

/** The seed trade at a given strike, so a book has trades that differ. */
function at(strike: number): PriceRequest {
    const trade = seedTrade();
    if (trade.instrument?.kind.case !== "option") throw new Error("expected an option");
    const payoff = trade.instrument.kind.value.payoff;
    if (payoff?.kind.case !== "plain") throw new Error("expected a plain payoff");
    payoff.kind.value.strike = strike;
    return trade;
}

/** The seed trade pointing at a quote that is not in the market. */
function broken(): PriceRequest {
    const trade = at(100);
    if (trade.instrument?.kind.case !== "option") throw new Error("expected an option");
    trade.instrument.kind.value.underlyings[0]!.spotQuoteId = "NOPE";
    return trade;
}

async function priceBook(requests: PriceRequest[]) {
    const client = new WireClient({url: URL});
    await client.connect();
    const opened = await client.send({
        case: "openSession",
        value: {evaluationDate: {form: {case: "iso", value: HANDLERS_EVALUATION_DATE}}, market: seedMarket(), clientLabel: "book"}
    }).done;
    if (opened.payload.case !== "sessionOpened") throw new Error("no session");

    const frame = await client.send({case: "batch", value: {requests}}, opened.payload.value.sessionId).done;
    client.close();
    if (frame.payload.case !== "batchResult") throw new Error(`expected a BatchResult, got ${frame.payload.case}`);
    return frame.payload.value;
}

describe.skipIf(!isBackendUp)("a book priced in one frame", () => {
    it("answers one entry per trade, in the order they were sent", async () => {
        const result = await priceBook([at(90), at(100), at(110)]);
        const outcome = readBatch(result, ["ninety", "hundred", "hundred and ten"]);
        console.info(`[batch] ${outcome.rows.map(row => `${row.label} ${row.npv?.toFixed(4)}`).join(" | ")}`);

        expect(outcome.rows).toHaveLength(3);
        // A call is worth less as the strike rises, so the order proves the
        // entries came back matched to the trades rather than merely counted.
        expect(outcome.rows[0]!.npv!).toBeGreaterThan(outcome.rows[1]!.npv!);
        expect(outcome.rows[1]!.npv!).toBeGreaterThan(outcome.rows[2]!.npv!);
        expect(outcome.abandonedAfter).toBe(0);
    }, 30_000);

    it("costs a failing trade its own row and nothing else", async () => {
        const result = await priceBook([at(90), broken(), at(110)]);
        const outcome = readBatch(result, ["ninety", "broken", "hundred and ten"]);
        console.info(`[batch] row 2: ${outcome.rows[1]!.error} (${outcome.rows[1]!.fieldPath})`);

        expect(outcome.rows.map(row => row.npv !== null)).toEqual([true, false, true]);
        expect(outcome.rows[1]!.fieldPath).toBe("instrument.option.underlyings[0].spot_quote_id");
        // Not abandoned: an unknown id is a bad request, not a broken graph.
        expect(outcome.abandonedAfter).toBe(0);
    }, 30_000);

    it("prices each trade exactly as the same trade sent alone", async () => {
        // The batch has to be a saving in frames and nothing else. If a batched
        // price differed from a single one, the panel's total would be a number
        // that exists nowhere else.
        const client = new WireClient({url: URL});
        await client.connect();
        const opened = await client.send({
            case: "openSession",
            value: {evaluationDate: {form: {case: "iso", value: HANDLERS_EVALUATION_DATE}}, market: seedMarket(), clientLabel: "book"}
        }).done;
        if (opened.payload.case !== "sessionOpened") throw new Error("no session");
        const sessionId = opened.payload.value.sessionId;

        const alone: number[] = [];
        for (const strike of [90, 100, 110]) {
            const frame = await client.send({case: "price", value: at(strike)}, sessionId).done;
            if (frame.payload.case !== "priceResult") throw new Error("expected a price");
            alone.push(frame.payload.value.npv);
        }

        const frame = await client.send({case: "batch", value: {requests: [at(90), at(100), at(110)]}}, sessionId).done;
        client.close();
        if (frame.payload.case !== "batchResult") throw new Error("expected a BatchResult");

        const batched = readBatch(frame.payload.value, ["a", "b", "c"]).rows.map(row => row.npv);
        expect(batched).toEqual(alone);
    }, 30_000);
});
