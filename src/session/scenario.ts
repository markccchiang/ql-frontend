import {create} from "@bufbuild/protobuf";

import {type PriceRequest, ScenarioSchema} from "@/gen/quantlib/v2/envelope_pb";
import {ResultKind} from "@/gen/quantlib/v2/results_pb";
import {WireError} from "@/protocol/errors";
import {scenarioActions, type ScenarioPoint, type ScenarioSpec} from "@/store/scenarioSlice";
import type {AppThunk} from "@/store/types";
import {uiActions} from "@/store/uiSlice";

/** One frame, one graph, N lazy recomputes of only what the quote invalidated.
 *
 *  This is what holding a session open is for: the spot ladder costs one round
 *  trip rather than N, and the graph is never rebuilt.
 */
export const runScenario =
    (): AppThunk<Promise<void>> =>
    async (dispatch, getState, {client}) => {
        const {session, workbook, scenario} = getState();
        if (!session.sessionId) throw new Error("no session");

        const spec = scenario.spec;
        // The trade priced as it stands, with a sweep attached: the instrument is
        // unchanged, only the question is.
        const request: PriceRequest = {
            ...workbook.trade,
            scenario: create(ScenarioSchema, {
                quoteId: spec.quoteId,
                points: pointsFor(spec),
                plot: spec.plot,
                keepFinalValue: spec.keepFinalValue
            })
        };

        const {requestId, done} = client.send({case: "price", value: request}, session.sessionId);
        dispatch(scenarioActions.started(requestId.toString()));
        dispatch(uiActions.bottomPanelSet("sweep"));

        try {
            const frame = await done;
            if (frame.payload.case !== "scenarioResult") {
                throw new Error(`expected ScenarioResult, got ${frame.payload.case}`);
            }
            const result = frame.payload.value;
            const points: ScenarioPoint[] = result.prices.map((price, at) => ({
                x: result.values[at] ?? Number.NaN,
                npv: price.npv,
                results: Object.fromEntries(
                    Object.entries(price.results)
                        .filter(([, value]) => value.v.case === "scalar")
                        .map(([key, value]) => [key, value.v.value as number])
                )
            }));

            dispatch(
                scenarioActions.finished({
                    quoteId: result.quoteId,
                    plot: spec.plot,
                    seriesName: result.series?.name ?? ResultKind[spec.plot] ?? "value",
                    x: [...(result.series?.x ?? result.values)],
                    // NaN is how the backend marks a point its engine could not supply;
                    // null is what a plotting library renders as a gap.
                    y: [...(result.series?.y ?? result.prices.map(price => price.npv))].map(value => (Number.isFinite(value) ? value : null)),
                    points,
                    at: Date.now()
                })
            );
        } catch (error) {
            dispatch(scenarioActions.failed(error instanceof WireError ? `${error.message}${error.fieldPath ? ` (${error.fieldPath})` : ""}` : error instanceof Error ? error.message : String(error)));
            throw error;
        }
    };

/** Cancels a running sweep. The worker checks the stop flag between points, so
 *  this actually stops work rather than only stopping the waiting. */
export const cancelScenario =
    (): AppThunk<Promise<void>> =>
    async (_dispatch, getState, {client}) => {
        const {scenario, session} = getState();
        if (!scenario.runningRequestId || !session.sessionId) return;
        await client.cancel(BigInt(scenario.runningRequestId), session.sessionId).done;
    };

/** Exactly one form. */
export function pointsFor(spec: ScenarioSpec) {
    switch (spec.form) {
        case "relative":
            return {case: "relative" as const, value: {factors: spec.factors}};
        case "linear":
            return {case: "linear" as const, value: {begin: spec.begin, end: spec.end, steps: spec.steps}};
        case "explicit":
            return {case: "explicit" as const, value: {values: spec.explicit}};
    }
}
