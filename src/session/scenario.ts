import {create} from "@bufbuild/protobuf";

import {type PriceRequest, ScenarioSchema} from "@/gen/quantlib/v2/envelope_pb";
import type {ScenarioResult} from "@/gen/quantlib/v2/results_pb";
import {ResultKind} from "@/gen/quantlib/v2/results_pb";
import {WireError} from "@/protocol/errors";
import {type AxisSpec, scenarioActions, type ScenarioLine, type ScenarioOutcome, type ScenarioPoint, type ScenarioSpec} from "@/store/scenarioSlice";
import type {AppThunk} from "@/store/types";
import {uiActions} from "@/store/uiSlice";

/** One frame, one graph, N lazy recomputes of only what each write invalidated.
 *
 *  This is what holding a session open is for: the spot ladder costs one round
 *  trip rather than N. A second axis makes it a grid, and the saving is the
 *  same argument one level up — spot against five vols used to be five sweeps
 *  against a graph none of them changed.
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
            scenarios: spec.axes.map((axis, at) =>
                create(ScenarioSchema, {
                    quoteId: axis.quoteId,
                    points: pointsFor(axis),
                    // Only the first axis may carry it; the service refuses it
                    // on any other, and it means the same thing here.
                    plot: at === 0 ? spec.plot : ResultKind.UNSPECIFIED,
                    keepFinalValue: axis.keepFinalValue
                })
            )
        };

        const {requestId, done} = client.send({case: "price", value: request}, session.sessionId);
        dispatch(scenarioActions.started(requestId.toString()));
        // Shown, not toggled: the run button lives in this panel, and
        // bottomPanelSet is the top strip's toggle — dispatching it here closed
        // the panel the sweep was about to draw into.
        dispatch(uiActions.bottomPanelShown("sweep"));

        try {
            const frame = await done;
            if (frame.payload.case !== "scenarioResult") {
                throw new Error(`expected ScenarioResult, got ${frame.payload.case}`);
            }
            dispatch(scenarioActions.finished({...readOutcome(frame.payload.value, spec), at: Date.now()}));
        } catch (error) {
            dispatch(scenarioActions.failed(error instanceof WireError ? `${error.message}${error.fieldPath ? ` (${error.fieldPath})` : ""}` : error instanceof Error ? error.message : String(error)));
            throw error;
        }
    };

/** The reply, as the panel draws it.
 *
 *  Row-major over the axes with the last varying fastest, so with two axes the
 *  first axis is x and each value of the second is its own line — a family of
 *  ladders rather than a heat map, because reading a price off a colour is
 *  guessing and reading it off a line is not.
 */
export function readOutcome(result: ScenarioResult, spec: ScenarioSpec): Omit<ScenarioOutcome, "at"> {
    const axes = result.axes.map(axis => ({quoteId: axis.quoteId, values: [...axis.values]}));
    const seriesName = result.series?.name || ResultKind[spec.plot] || "value";
    const x = axes[0]?.values ?? [];

    const points: ScenarioPoint[] = result.prices.map((price, at) => ({
        // The coordinate on the first axis: what this price is drawn against.
        x: x[Math.floor(at / Math.max(1, columnCount(axes)))] ?? Number.NaN,
        npv: price.npv,
        results: Object.fromEntries(
            Object.entries(price.results)
                .filter(([, value]) => value.v.case === "scalar")
                .map(([key, value]) => [key, value.v.value as number])
        )
    }));

    // NaN is how the service marks a point its engine could not supply; null is
    // what a plotting library renders as a gap.
    const gap = (value: number | undefined) => (value !== undefined && Number.isFinite(value) ? value : null);

    if (axes.length < 2) {
        const y = result.series ? [...result.series.y] : result.prices.map(price => price.npv);
        return {axes, plot: spec.plot, seriesName, x, lines: [{label: seriesName, y: y.map(gap)}], points, abandonedAfter: result.abandonedAfter};
    }

    // A surface arrives row-major with the axis values as its labels, so a
    // column is one value of the second axis across the whole first one.
    const columns = columnCount(axes);
    const surface = result.surface;
    const values = surface ? [...surface.values] : result.prices.map(price => price.npv);
    const lines: ScenarioLine[] = (axes[1]?.values ?? []).map((value, column) => ({
        label: `${axes[1]?.quoteId ?? ""} ${format(value)}`,
        y: x.map((_, row) => gap(values[row * columns + column]))
    }));
    return {axes, plot: spec.plot, seriesName, x, lines, points, abandonedAfter: result.abandonedAfter};
}

function columnCount(axes: {values: number[]}[]): number {
    return axes.length < 2 ? 1 : (axes[1]?.values.length ?? 1);
}

/** Short enough to sit in a legend, exact enough to tell 0.19 from 0.2. */
function format(value: number): string {
    return Number.isInteger(value) ? String(value) : String(Number(value.toPrecision(4)));
}

/** How many prices a spec asks for: the product of its axes. A grid multiplies,
 *  and the service refuses one over the ceiling it advertises. */
export function pointCount(spec: ScenarioSpec): number {
    return spec.axes.reduce((total, axis) => total * axisLength(axis), 1);
}

export function axisLength(axis: AxisSpec): number {
    switch (axis.form) {
        case "relative":
            return axis.factors.length;
        case "linear":
            return Math.max(0, axis.steps);
        case "explicit":
            return axis.explicit.length;
    }
}

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
export function pointsFor(axis: AxisSpec) {
    switch (axis.form) {
        case "relative":
            return {case: "relative" as const, value: {factors: axis.factors}};
        case "linear":
            return {case: "linear" as const, value: {begin: axis.begin, end: axis.end, steps: axis.steps}};
        case "explicit":
            return {case: "explicit" as const, value: {values: axis.explicit}};
    }
}
