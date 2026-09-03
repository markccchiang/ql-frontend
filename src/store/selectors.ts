import {createSelector} from "@reduxjs/toolkit";

import {Leg_Kind} from "@/gen/quantlib/v2/instrument_pb";
import {asQuote} from "@/market/model";
import {validateMarket} from "@/market/validation";
import {validateTrade} from "@/trade/validation";

import type {RootState} from "./types";

export const selectIssues = createSelector([(state: RootState) => state.workbook.market], market => validateMarket(market));

export const selectQuotes = createSelector([(state: RootState) => state.workbook.market], market => market.filter(object => asQuote(object) !== null));

/** A structural edit against a live session.
 *
 *  Not an error: UpdateMarket writes quotes and nothing else, so a new curve
 *  shape or a new evaluation date is a new session. The UI shows the cost —
 *  SessionOpened.bootstrap_seconds measured it last time — rather than
 *  rebuilding behind the user's back.
 */
export const selectIsStale = (state: RootState): boolean => state.session.status === "live" && state.session.openedRevision !== state.workbook.structureRevision;

export const selectTradeIssues = createSelector([(state: RootState) => state.workbook.trade, (state: RootState) => state.workbook.market, (state: RootState) => state.workbook.evaluationDate], (trade, market, evaluationDate) =>
    validateTrade(trade, market, evaluationDate)
);

/** Quotes a fixed leg reads once at construction.
 *
 *  FixedRateLeg takes a value, not a handle, so writing one of these moves
 *  nothing until the trade is priced again. It is the one place the Handle
 *  discipline of DESIGN §5 is knowingly not kept, and the quote bar has to say
 *  so rather than offer a slider that does nothing.
 */
export const selectFrozenQuoteIds = createSelector([(state: RootState) => state.workbook.trade], (trade): ReadonlySet<string> => {
    const kind = trade.instrument?.kind;
    if (kind?.case !== "swap") return new Set();
    return new Set(kind.value.legs.filter(leg => leg.kind === Leg_Kind.FIXED && leg.rateQuoteId).map(leg => leg.rateQuoteId));
});

/** The most recent priced request that reported progress.
 *
 *  Derived rather than tracked: a batched Monte Carlo is identifiable by
 *  having a trace at all, so no extra state has to be kept in step with the
 *  request registry.
 */
export const selectLatestMonteCarlo = createSelector([(state: RootState) => state.requests.order, (state: RootState) => state.requests.byId], (order, byId) => {
    for (const id of order) {
        const entry = byId[id];
        if (entry && entry.kind === "price" && entry.trace.length > 0) return entry;
    }
    return null;
});
