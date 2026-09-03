import {create} from "@bufbuild/protobuf";
import {describe, expect, it} from "vitest";

import type {PriceRequest} from "@/gen/quantlib/v2/envelope_pb";
import {Error_Code, ImpliedVolatilitySchema} from "@/gen/quantlib/v2/envelope_pb";
import {ResultKind} from "@/gen/quantlib/v2/results_pb";
import {HANDLERS_EVALUATION_DATE, seedMarket, seedTrade} from "@/market/handlersSession";
import {RESULT_KEYS} from "@/protocol/capabilities";
import {WireClient} from "@/protocol/client";
import {WireError} from "@/protocol/errors";

/** An implied volatility is the one result that reads an input off the request.
 *
 *  The seed market holds a 0.2 volatility quote, so the round trip is closed:
 *  price the option, hand that price back as the target, and the volatility
 *  that comes out has to be the one the price was made with. Without a target
 *  the service refuses rather than inverting the price it is about to compute,
 *  which would answer with the volatility that was sent in.
 */
const URL = process.env.QL_BACKEND ?? "ws://127.0.0.1:9111";
const SEED_VOLATILITY = 0.2;

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
    console.warn(`[impliedVolatility] no backend at ${URL}; skipped, not passed`);
}

async function priceIt(request: PriceRequest) {
    const client = new WireClient({url: URL});
    await client.connect();
    const opened = await client.send({
        case: "openSession",
        value: {evaluationDate: {form: {case: "iso", value: HANDLERS_EVALUATION_DATE}}, market: seedMarket(), clientLabel: "implied volatility"}
    }).done;
    if (opened.payload.case !== "sessionOpened") throw new Error("no session");

    const outcome = await client.send({case: "price", value: request}, opened.payload.value.sessionId).done.then(
        frame => ({frame, error: null as unknown}),
        (error: unknown) => ({frame: null, error})
    );
    client.close();
    return outcome;
}

describe.skipIf(!isBackendUp)("an implied volatility", () => {
    it("inverts back to the quote the price was made with", async () => {
        const priced = await priceIt(seedTrade());
        if (priced.frame?.payload.case !== "priceResult") throw new Error("expected a price");
        const target = priced.frame.payload.value.npv;

        const request: PriceRequest = {
            ...seedTrade(),
            results: [ResultKind.NPV, ResultKind.IMPLIED_VOLATILITY],
            impliedVolatility: create(ImpliedVolatilitySchema, {targetPrice: target})
        };
        const {frame, error} = await priceIt(request);
        expect(error).toBeNull();
        if (frame?.payload.case !== "priceResult") throw new Error("expected a price");

        const implied = frame.payload.value.results[RESULT_KEYS[ResultKind.IMPLIED_VOLATILITY]!];
        console.info(`[impliedVolatility] target ${target.toFixed(6)} implies ${implied?.v.case === "scalar" ? implied.v.value.toFixed(6) : "nothing"}`);
        expect(implied?.v.case).toBe("scalar");
        expect(implied?.v.value as number).toBeCloseTo(SEED_VOLATILITY, 4);
    }, 30_000);

    it("is refused when there is no price to invert", async () => {
        const request: PriceRequest = {...seedTrade(), results: [ResultKind.NPV, ResultKind.IMPLIED_VOLATILITY]};
        const {error} = await priceIt(request);
        expect(error).toBeInstanceOf(WireError);
        const failure = error as WireError;
        console.info(`[impliedVolatility] ${failure.message} (${failure.fieldPath})`);
        expect(failure.code).toBe(Error_Code.INVALID_ARGUMENT);
        expect(failure.fieldPath).toBe("implied_volatility.target_price");
    }, 30_000);
});
