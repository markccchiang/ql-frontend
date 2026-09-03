import {create} from "@bufbuild/protobuf";
import {describe, expect, it} from "vitest";

import {Engine_Method, EngineSchema} from "@/gen/quantlib/v2/engine_pb";
import type {PriceRequest} from "@/gen/quantlib/v2/envelope_pb";
import {Error_Code} from "@/gen/quantlib/v2/envelope_pb";
import {OptionSchema} from "@/gen/quantlib/v2/instrument_pb";
import {HANDLERS_EVALUATION_DATE, seedMarket, seedTrade} from "@/market/handlersSession";
import {WireClient} from "@/protocol/client";
import {WireError} from "@/protocol/errors";

/** A quanto lookback must be refused by name.
 *
 *  It used to be priced as a plain lookback: the lookback arm builds its
 *  engines on the bare process and nothing on that path consulted
 *  graph.quanto, so the adjustment was dropped and a number came back for a
 *  different trade. HANDLERS.md said quanto was unavailable there all along;
 *  the code now agrees. This is the check that it stays that way.
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
    console.warn(`[quantoLookback] no backend at ${URL}; skipped, not passed`);
}

/** A fixed-strike lookback, with and without the FX leg. The seed market has
 *  two curves, a vol surface and a correlation-shaped quote, which is all a
 *  quanto needs to be well formed. */
function lookback(hasQuanto: boolean): PriceRequest {
    const trade = seedTrade();
    if (trade.instrument?.kind.case !== "option") throw new Error("expected an option");
    const option = create(OptionSchema, {
        ...trade.instrument.kind.value,
        // Spread into create() means these are read as built messages.
        style: {case: "lookback", value: {$typeName: "quantlib.v2.Lookback", runningExtremum: 100, level: 0}},
        ...(hasQuanto ? {quanto: {$typeName: "quantlib.v2.Quanto" as const, fxRiskFreeCurveId: "QC", fxVolatilityId: "VOL", correlationId: "Q"}} : {})
    });
    return {
        ...trade,
        instrument: {$typeName: "quantlib.v2.Instrument", kind: {case: "option", value: option}},
        engine: create(EngineSchema, {method: Engine_Method.ANALYTIC})
    };
}

async function priceIt(request: PriceRequest) {
    const client = new WireClient({url: URL});
    await client.connect();
    const opened = await client.send({
        case: "openSession",
        value: {evaluationDate: {form: {case: "iso", value: HANDLERS_EVALUATION_DATE}}, market: seedMarket(), clientLabel: "quanto lookback"}
    }).done;
    if (opened.payload.case !== "sessionOpened") throw new Error("no session");

    const outcome = await client.send({case: "price", value: request}, opened.payload.value.sessionId).done.then(
        frame => ({frame, error: null as unknown}),
        (error: unknown) => ({frame: null, error})
    );
    client.close();
    return outcome;
}

describe.skipIf(!isBackendUp)("a quanto lookback", () => {
    it("is refused by name rather than priced as a plain one", async () => {
        const {error} = await priceIt(lookback(true));
        expect(error).toBeInstanceOf(WireError);
        const failure = error as WireError;
        console.info(`[quantoLookback] ${failure.message} (${failure.fieldPath})`);
        expect(failure.code).toBe(Error_Code.UNSUPPORTED);
        expect(failure.fieldPath).toBe("instrument.option.quanto");
    }, 30_000);

    it("still prices without the FX leg", async () => {
        // The rejection must be about the quanto, not about lookbacks.
        const {frame, error} = await priceIt(lookback(false));
        expect(error).toBeNull();
        expect(frame?.payload.case).toBe("priceResult");
    }, 30_000);
});

describe.skipIf(!isBackendUp)("an unsupplied result", () => {
    it("is named rather than left out", async () => {
        // seedTrade asks for delta, gamma and vega; an American
        // Barone-Adesi price publishes none of them, and the point of the
        // field is that a client can tell that from three zeroes.
        const trade = seedTrade();
        if (trade.instrument?.kind.case !== "option") throw new Error("expected an option");
        const option = create(OptionSchema, {
            ...trade.instrument.kind.value,
            exercise: {$typeName: "quantlib.v2.Exercise", type: 2, dates: trade.instrument.kind.value.exercise!.dates, payoffAtExpiry: 1, earliestDate: undefined}
        });
        const request: PriceRequest = {
            ...trade,
            instrument: {$typeName: "quantlib.v2.Instrument", kind: {case: "option", value: option}},
            engine: create(EngineSchema, {method: Engine_Method.ANALYTIC, parameters: {case: "analytic", value: {approximation: 1}}})
        };

        const {frame, error} = await priceIt(request);
        expect(error).toBeNull();
        if (frame?.payload.case !== "priceResult") throw new Error("expected a price");

        const result = frame.payload.value;
        console.info(`[unavailable] npv ${result.npv.toFixed(6)}, named absent: ${result.unavailableResults.join(",")}`);
        expect(result.npv).toBeGreaterThan(0);
        // Nothing silently missing: everything asked for is answered or named.
        expect(Object.keys(result.results).length + result.unavailableResults.length).toBeGreaterThanOrEqual(3);
        expect(result.unavailableResults.length).toBeGreaterThan(0);
    }, 30_000);
});
