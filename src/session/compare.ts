import {topoSort} from "@/market/graph";
import {asQuote} from "@/market/model";
import {WireError} from "@/protocol/errors";
import {compareActions} from "@/store/compareSlice";
import type {AppThunk} from "@/store/types";

/** Parses "S=110, V=0.25" into quote writes. Silently drops anything that is
 *  not a pair, because this is a scratch field and a half-typed override
 *  should not be an error while it is being typed. */
export function parseOverrides(text: string): {quoteId: string; value: number}[] {
    return text
        .split(/[,\n]+/)
        .map(part => part.split("="))
        .filter(parts => parts.length === 2 && parts[0]!.trim() && Number.isFinite(Number(parts[1])))
        .map(parts => ({quoteId: parts[0]!.trim(), value: Number(parts[1])}));
}

/** Prices the same trade in a second session on the same socket.
 *
 *  This is the capability the gateway advertises and nothing else here uses:
 *  one connection can hold several sessions, so a what-if against a different
 *  evaluation date or a different market does not disturb the one in front of
 *  the user. The variant session is opened, priced and closed; the primary is
 *  never touched.
 */
export const runComparison =
    (): AppThunk<Promise<void>> =>
    async (dispatch, getState, {client}) => {
        const {workbook, session, compare} = getState();
        if (!session.sessionId) throw new Error("open the primary session first");

        dispatch(compareActions.started());
        let variantSessionId = "";
        try {
            // Price the base first, in the session the user already has, so
            // both numbers come from the same trade at the same moment.
            const basePrice = client.send({case: "price", value: workbook.trade}, session.sessionId);
            const baseFrame = await basePrice.done;
            if (baseFrame.payload.case !== "priceResult") throw new Error("the base did not price");

            const overrides = new Map(parseOverrides(compare.overrides).map(write => [write.quoteId, write.value]));
            const market = topoSort(workbook.market).sorted.map(object => {
                const quote = asQuote(object);
                const override = quote ? overrides.get(object.id) : undefined;
                return override === undefined ? object : {...object, kind: {case: "quote" as const, value: {...quote!, value: override}}};
            });

            const open = client.send({
                case: "openSession",
                value: {
                    evaluationDate: {form: {case: "iso", value: compare.evaluationDate || workbook.evaluationDate}},
                    market,
                    clientLabel: `${workbook.label} — variant`
                }
            });
            dispatch(compareActions.backgroundRequest(open.requestId.toString()));
            const openedFrame = await open.done;
            if (openedFrame.payload.case !== "sessionOpened") throw new Error("the variant session did not open");
            variantSessionId = openedFrame.payload.value.sessionId;

            const variantPrice = client.send({case: "price", value: workbook.trade}, variantSessionId);
            dispatch(compareActions.backgroundRequest(variantPrice.requestId.toString()));
            const variantFrame = await variantPrice.done;
            if (variantFrame.payload.case !== "priceResult") throw new Error("the variant did not price");

            dispatch(
                compareActions.finished({
                    label: compare.evaluationDate && compare.evaluationDate !== workbook.evaluationDate ? `evaluation date ${compare.evaluationDate}` : compare.overrides || "same market",
                    baseNpv: baseFrame.payload.value.npv,
                    variantNpv: variantFrame.payload.value.npv,
                    baseSessionId: session.sessionId,
                    variantSessionId,
                    at: Date.now()
                })
            );
        } catch (error) {
            dispatch(compareActions.failed(error instanceof WireError ? `${error.message}${error.fieldPath ? ` (${error.fieldPath})` : ""}` : error instanceof Error ? error.message : String(error)));
            throw error;
        } finally {
            // The variant is a question, not a workspace: it is closed whether
            // it priced or not, so the socket is not left holding graphs
            // nobody is looking at.
            if (variantSessionId) {
                const close = client.send({case: "closeSession", value: {}}, variantSessionId);
                dispatch(compareActions.backgroundRequest(close.requestId.toString()));
                await close.done.catch(() => undefined);
            }
        }
    };
