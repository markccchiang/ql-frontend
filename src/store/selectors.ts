import {createSelector} from "@reduxjs/toolkit";

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
    validateTrade(trade, new Set(market.map(object => object.id)), evaluationDate)
);
