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

/** The price the latest Monte Carlo run settled on, while it is still the
 *  price held. A later price -- the analytic one the user switched back to --
 *  replaces it, and is not this run's final value however it is labelled. */
export const selectMonteCarloFinal = createSelector([selectLatestMonteCarlo, (state: RootState) => state.results.latest], (run, latest) => (run && latest && latest.requestId === run.id ? latest : null));

/** The leg kinds of the swap under edit, in order.
 *
 *  Memoised because both branches build a new array — the map and the empty
 *  literal alike — and an unmemoised one re-renders the trade builder on every
 *  unrelated action.
 */
export const selectLegKinds = createSelector([(state: RootState) => state.workbook.trade.instrument], (instrument): Leg_Kind[] => (instrument?.kind.case === "swap" ? instrument.kind.value.legs.map(leg => leg.kind) : []));

/** The ids of the quotes in the market, for pickers that only need the names.
 *
 *  Memoised on the market array, which is what an inline `filter().map()` in
 *  a component was not: that returned a new array on every call, so React
 *  Redux's stability check reported it and every unrelated action re-rendered
 *  the component holding it. */
export const selectQuoteIds = createSelector([(state: RootState) => state.workbook.market], (market): string[] => market.filter(object => object.kind.case === "quote").map(object => object.id));

/** The ids of the correlation matrices in the market. Memoised for the same
 *  reason as selectQuoteIds. */
export const selectCorrelationIds = createSelector([(state: RootState) => state.workbook.market], (market): string[] => market.filter(object => object.kind.case === "correlation").map(object => object.id));

const NO_LABELS: readonly string[] = [];

/** The labels of the option's underlyings, in order, for the controls that
 *  name an asset. Empty, and the same empty array every time, when the trade
 *  is not an option. Memoised on the instrument for the same reason as
 *  selectQuoteIds. */
export const selectUnderlyingLabels = createSelector([(state: RootState) => state.workbook.trade.instrument], (instrument): readonly string[] =>
    instrument?.kind.case === "option" ? instrument.kind.value.underlyings.map(underlying => underlying.label) : NO_LABELS
);
