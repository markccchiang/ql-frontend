import {create} from "@bufbuild/protobuf";

import {Compounding, Frequency} from "@/gen/quantlib/v1/conventions_pb";
import {CurveSample_Quantity, CurveSampleSchema, type PriceRequest} from "@/gen/quantlib/v2/envelope_pb";
import {WireError} from "@/protocol/errors";
import {curveActions, type CurveLine} from "@/store/curveSlice";
import type {AppThunk} from "@/store/types";

/** Rate quantities have to say what a rate means; a discount factor must not,
 *  and a compounding set beside one is rejected rather than ignored. */
export function isRateQuantity(quantity: CurveSample_Quantity): boolean {
    return quantity === CurveSample_Quantity.ZERO_RATE || quantity === CurveSample_Quantity.FORWARD_RATE;
}

export function isVolatilityQuantity(quantity: CurveSample_Quantity): boolean {
    return quantity === CurveSample_Quantity.BLACK_VOLATILITY;
}

/** Asks for the curve the engine priced with, alongside a price.
 *
 *  Sampled by the backend off the handle it just used, rather than shipped
 *  here and interpolated again: a curve drawn from a second implementation is
 *  a curve nothing was priced with.
 */
export const sampleCurve =
    (): AppThunk<Promise<void>> =>
    async (dispatch, getState, {client}) => {
        const {session, workbook, curve} = getState();
        if (!session.sessionId) throw new Error("no session");
        if (!curve.marketId) {
            dispatch(curveActions.failed("Pick a curve or surface to sample."));
            return;
        }

        const step = curve.years / Math.max(1, curve.points - 1);
        const times = Array.from({length: curve.points}, (_, at) => Number((step * (at + 1)).toFixed(6)));

        const request: PriceRequest = {
            ...workbook.trade,
            curveSamples: [
                // Times rather than dates: a term structure reads naturally
                // against years, and it saves the client inventing a calendar
                // the backend would only have to resolve again.
                create(CurveSampleSchema, {
                    marketId: curve.marketId,
                    quantity: curve.quantity,
                    times,
                    ...(isVolatilityQuantity(curve.quantity) ? {strikes: [curve.strike]} : {}),
                    ...(isRateQuantity(curve.quantity) ? {compounding: Compounding.CONTINUOUS, frequency: Frequency.ANNUAL} : {})
                })
            ]
        };

        try {
            const frame = await client.send({case: "price", value: request}, session.sessionId).done;
            if (frame.payload.case !== "priceResult") throw new Error(`expected a price, got ${frame.payload.case}`);
            const lines: CurveLine[] = frame.payload.value.series.map(series => ({
                name: series.name,
                x: [...series.x],
                y: [...series.y]
            }));
            dispatch(curveActions.sampled(lines));
        } catch (error) {
            dispatch(curveActions.failed(error instanceof WireError ? `${error.message}${error.fieldPath ? ` (${error.fieldPath})` : ""}` : error instanceof Error ? error.message : String(error)));
            throw error;
        }
    };
