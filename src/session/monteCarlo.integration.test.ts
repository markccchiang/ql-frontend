import {create} from "@bufbuild/protobuf";
import {describe, expect, it} from "vitest";

import {Engine_Method, EngineSchema} from "@/gen/quantlib/v2/engine_pb";
import type {PriceRequest} from "@/gen/quantlib/v2/envelope_pb";
import {HANDLERS_EVALUATION_DATE, seedMarket, seedTrade} from "@/market/handlersSession";
import {WireClient} from "@/protocol/client";
import {WireError} from "@/protocol/errors";

/** The batched Monte Carlo path, against a running ql-backend.
 *
 *  This is the one part of the app that cannot be checked by reading: progress
 *  frames arrive over time, the cancel has to land between two batches, and
 *  the number that comes back is deliberately not the single-shot number.
 *  Skipped, loudly, when the daemon is not up.
 */
const URL = process.env.QL_BACKEND ?? "ws://127.0.0.1:9111";

/** Probed at collection time so the run is reported as skipped rather than
 *  passing vacuously: a test that quietly returns when its dependency is
 *  missing is indistinguishable from one that checked something. */
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
    console.warn(`[monteCarlo] no backend at ${URL}; the integration checks are skipped, not passed`);
}

/** seedTrade is a European vanilla, which is the only shape priceInBatches
 *  serves. */
function monteCarloTrade(samples: bigint, progressEveryPaths: bigint): PriceRequest {
    // Spreading a message into create() would hand it an init shape it treats
    // as already built, so the engine is created on its own and assigned.
    const trade = seedTrade();
    return {
        ...trade,
        engine: create(EngineSchema, {
            method: Engine_Method.MONTE_CARLO,
            parameters: {case: "mc", value: {seed: 42n, stopping: {case: "samples", value: samples}, timeStepsPerYear: 1, progressEveryPaths}}
        })
    };
}

async function openSession(client: WireClient): Promise<string> {
    const {done} = client.send({
        case: "openSession",
        value: {evaluationDate: {form: {case: "iso", value: HANDLERS_EVALUATION_DATE}}, market: seedMarket(), clientLabel: "mc integration"}
    });
    const frame = await done;
    if (frame.payload.case !== "sessionOpened") throw new Error("no session");
    return frame.payload.value.sessionId;
}

describe.skipIf(!isBackendUp)("batched Monte Carlo", () => {
    it("reports progress and settles with an error estimate", async () => {
        const client = new WireClient({url: URL});
        const points: {completed: number; npv: number}[] = [];
        client.listen({
            onProgress(_frame, progress) {
                points.push({completed: Number(progress.completed), npv: progress.runningNpv});
            }
        });

        await client.connect();
        const sessionId = await openSession(client);
        const {done} = client.send({case: "price", value: monteCarloTrade(200_000n, 20_000n)}, sessionId);
        const frame = await done;
        client.close();

        expect(frame.payload.case).toBe("priceResult");
        if (frame.payload.case !== "priceResult") return;

        // Ten batches of twenty thousand.
        console.info(`[monteCarlo] ${points.length} progress frames, terminal NPV ${frame.payload.value.npv.toFixed(6)}, s.e. ${frame.payload.value.errorEstimate?.standardError?.toFixed(6)}`);
        expect(points.length).toBe(10);
        expect(points.at(-1)?.completed).toBe(200_000);
        expect(points.map(point => point.completed)).toEqual([...points.map(point => point.completed)].sort((a, b) => a - b));

        // A European call struck at the money with these conventions is
        // worth about nine; the point is that the trace lands near the
        // terminal number rather than the exact value.
        const npv = frame.payload.value.npv;
        expect(npv).toBeGreaterThan(8);
        expect(npv).toBeLessThan(11);
        expect(Math.abs((points.at(-1)?.npv ?? 0) - npv)).toBeLessThan(1e-9);

        // Independent batches, so the batch errors add in quadrature.
        expect(frame.payload.value.errorEstimate?.standardError).toBeGreaterThan(0);
    }, 60_000);

    it("stops between batches when cancelled", async () => {
        const client = new WireClient({url: URL});
        await client.connect();
        const sessionId = await openSession(client);

        const cancelWhenSeen = new Promise<void>(resolve => {
            const stop = client.listen({
                onProgress() {
                    stop();
                    resolve();
                }
            });
        });

        const run = client.send({case: "price", value: monteCarloTrade(20_000_000n, 100_000n)}, sessionId);
        await cancelWhenSeen;
        await client.cancel(run.requestId, sessionId).done;

        const failure = await run.done.then(
            () => null,
            (error: unknown) => error
        );
        client.close();

        console.info(`[monteCarlo] cancel returned: ${(failure as Error)?.message}`);
        expect(failure).toBeInstanceOf(WireError);
        expect((failure as WireError).message).toMatch(/cancelled after/);
    }, 60_000);

    it("does not agree with the single-shot run at the same seed", async () => {
        // The documented surprise, worth pinning: QuantLib cannot resume
        // an engine, so batching runs independent simulations with derived
        // seeds and averages them. Two requests differing only in whether
        // the user watched a progress bar return different numbers, which
        // is why reproducibility keys on all three of seed, samples and
        // the batch size, and why PriceResult echoes the whole engine.
        const client = new WireClient({url: URL});
        await client.connect();
        const sessionId = await openSession(client);

        const once = await client.send({case: "price", value: monteCarloTrade(200_000n, 0n)}, sessionId).done;
        const batched = await client.send({case: "price", value: monteCarloTrade(200_000n, 20_000n)}, sessionId).done;
        client.close();

        if (once.payload.case !== "priceResult" || batched.payload.case !== "priceResult") throw new Error("expected prices");
        console.info(`[monteCarlo] single-shot ${once.payload.value.npv.toFixed(6)} vs batched ${batched.payload.value.npv.toFixed(6)}`);

        expect(once.payload.value.npv).not.toBe(batched.payload.value.npv);
        // Both are estimates of the same quantity, so they agree to within
        // a few standard errors even though they are not the same number.
        expect(Math.abs(once.payload.value.npv - batched.payload.value.npv)).toBeLessThan(0.5);
    }, 60_000);
});
