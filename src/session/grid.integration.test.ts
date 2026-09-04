import {create} from "@bufbuild/protobuf";
import {describe, expect, it} from "vitest";

import type {PriceRequest} from "@/gen/quantlib/v2/envelope_pb";
import {Error_Code, ScenarioSchema} from "@/gen/quantlib/v2/envelope_pb";
import {ResultKind} from "@/gen/quantlib/v2/results_pb";
import {HANDLERS_EVALUATION_DATE, seedMarket, seedTrade} from "@/market/handlersSession";
import {WireClient} from "@/protocol/client";
import {WireError} from "@/protocol/errors";
import {scenarioSlice} from "@/store/scenarioSlice";

import {readOutcome} from "./scenario";

/** A sweep in two dimensions, end to end.
 *
 *  The claim being checked is the one the panel is drawn from: prices arrive
 *  row-major with the last axis varying fastest, so a line is every nth value
 *  and not a contiguous slice. A unit test can only assert that against a
 *  fixture it wrote itself; this asks the service.
 */
const URL = process.env.QL_BACKEND ?? "ws://127.0.0.1:9111";
const SPEC = scenarioSlice.reducer(undefined, {type: "@@init"}).spec;

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
    console.warn(`[grid] no backend at ${URL}; skipped, not passed`);
}

async function sweep(request: PriceRequest) {
    const client = new WireClient({url: URL});
    await client.connect();
    const opened = await client.send({
        case: "openSession",
        value: {evaluationDate: {form: {case: "iso", value: HANDLERS_EVALUATION_DATE}}, market: seedMarket(), clientLabel: "grid"}
    }).done;
    if (opened.payload.case !== "sessionOpened") throw new Error("no session");

    const outcome = await client.send({case: "price", value: request}, opened.payload.value.sessionId).done.then(
        frame => ({frame, error: null as unknown}),
        (error: unknown) => ({frame: null, error})
    );
    client.close();
    return outcome;
}

/** Spot at three points against vol at two: the smallest thing that can tell
 *  row-major from column-major. */
function grid(): PriceRequest {
    return {
        ...seedTrade(),
        scenarios: [create(ScenarioSchema, {quoteId: "S", points: {case: "explicit", value: {values: [90, 100, 110]}}, plot: ResultKind.NPV}), create(ScenarioSchema, {quoteId: "V", points: {case: "explicit", value: {values: [0.1, 0.3]}}})]
    };
}

describe.skipIf(!isBackendUp)("a two-axis sweep", () => {
    it("comes back row-major, and reads as a line per value of the second axis", async () => {
        const {frame, error} = await sweep(grid());
        expect(error).toBeNull();
        if (frame?.payload.case !== "scenarioResult") throw new Error("expected a ScenarioResult");

        const result = frame.payload.value;
        expect(result.prices).toHaveLength(6);
        expect(result.axes.map(axis => axis.quoteId)).toEqual(["S", "V"]);
        expect(result.surface?.rows).toBe(3);
        expect(result.surface?.columns).toBe(2);

        const outcome = readOutcome(result, SPEC);
        console.info(`[grid] ${outcome.lines.map(line => `${line.label}: ${line.y.map(value => (value ?? Number.NaN).toFixed(4)).join(" ")}`).join(" | ")}`);

        // Each line is one vol across all three spots, so each rises with spot;
        // and the higher vol is above the lower at every spot. Read the wrong
        // way round the first line would be spot 90 at two vols and the second
        // spot 100, which is monotone too — hence checking both directions.
        expect(outcome.x).toEqual([90, 100, 110]);
        for (const line of outcome.lines) {
            expect(line.y[0]!).toBeLessThan(line.y[1]!);
            expect(line.y[1]!).toBeLessThan(line.y[2]!);
        }
        for (let at = 0; at < 3; at += 1) {
            expect(outcome.lines[0]!.y[at]!).toBeLessThan(outcome.lines[1]!.y[at]!);
        }
    }, 30_000);

    it("puts both quotes back, not only the one written last", async () => {
        const before = await sweep(seedTrade());
        if (before.frame?.payload.case !== "priceResult") throw new Error("expected a price");

        // Same session would be a stronger check, but each sweep here opens its
        // own; what this catches is a restore loop that stops after one axis and
        // leaves the market it rebuilt from wrong.
        const {frame} = await sweep(grid());
        if (frame?.payload.case !== "scenarioResult") throw new Error("expected a ScenarioResult");

        const after = await sweep(seedTrade());
        if (after.frame?.payload.case !== "priceResult") throw new Error("expected a price");
        expect(after.frame.payload.value.npv).toBeCloseTo(before.frame.payload.value.npv, 12);
    }, 30_000);

    it("refuses the same quote on two axes rather than silently flattening one", async () => {
        const request: PriceRequest = {
            ...seedTrade(),
            scenarios: [create(ScenarioSchema, {quoteId: "S", points: {case: "explicit", value: {values: [95, 105]}}}), create(ScenarioSchema, {quoteId: "S", points: {case: "explicit", value: {values: [98, 102]}}})]
        };
        const {error} = await sweep(request);
        expect(error).toBeInstanceOf(WireError);
        const failure = error as WireError;
        console.info(`[grid] ${failure.message} (${failure.fieldPath})`);
        expect(failure.code).toBe(Error_Code.INVALID_ARGUMENT);
        expect(failure.fieldPath).toBe("scenarios[1].quote_id");
    }, 30_000);
});
