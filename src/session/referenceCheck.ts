import {REFERENCE_NPV, REFERENCE_SPOT, REFERENCE_TOLERANCE} from "@/market/handlersSession";
import type {AppThunk} from "@/store/types";
import {workbookActions} from "@/store/workbookSlice";

import {openSession, priceCurrentTrade, writeQuotes} from "./ops";

export interface ReferenceOutcome {
    npv: number;
    matches: boolean;
}

/** The HANDLERS.md session, end to end, against the value that page records.
 *
 *  Runs through the same operations the UI uses, so it checks the code that
 *  ships rather than a parallel path: open from the workbook, bump spot to 105
 *  on the live graph, price, compare.
 */
export const runReferenceCheck = (): AppThunk<Promise<ReferenceOutcome>> => async dispatch => {
    await dispatch(openSession());
    dispatch(workbookActions.quoteValueSet({id: "S", value: REFERENCE_SPOT}));
    await dispatch(writeQuotes([{quoteId: "S", value: REFERENCE_SPOT}]));
    const result = await dispatch(priceCurrentTrade());
    return {
        npv: result.npv,
        matches: Math.abs(result.npv - REFERENCE_NPV) < REFERENCE_TOLERANCE
    };
};
