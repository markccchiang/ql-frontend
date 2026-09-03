import {fromJson, toJson} from "@bufbuild/protobuf";

import {type PriceRequest, PriceRequestSchema} from "@/gen/quantlib/v2/envelope_pb";
import {type MarketObject, MarketObjectSchema} from "@/gen/quantlib/v2/market_pb";

/** The workbook on disk.
 *
 *  Canonical Protobuf JSON, so the file is the wire format with a label on it:
 *  what is exported is exactly what would be sent, and a round trip through
 *  this cannot quietly change a request. That is the whole reason the store
 *  holds messages rather than a parallel UI model.
 */
export interface WorkbookFile {
    version: 1;
    label: string;
    evaluationDate: string;
    market: unknown[];
    trade: unknown;
}

export interface DecodedWorkbook {
    label: string;
    evaluationDate: string;
    market: MarketObject[];
    trade: PriceRequest;
}

export const WORKBOOK_VERSION = 1;

export function encodeWorkbook(workbook: DecodedWorkbook): WorkbookFile {
    return {
        version: WORKBOOK_VERSION,
        label: workbook.label,
        evaluationDate: workbook.evaluationDate,
        market: workbook.market.map(object => toJson(MarketObjectSchema, object)),
        trade: toJson(PriceRequestSchema, workbook.trade)
    };
}

/** Rejects rather than repairs.
 *
 *  A half-decoded workbook is worse than none: it would open a session against
 *  a market the user did not write. Anything unreadable throws and the caller
 *  keeps what it had.
 */
export function decodeWorkbook(raw: unknown): DecodedWorkbook {
    if (typeof raw !== "object" || raw === null) throw new Error("not a workbook");
    const file = raw as Partial<WorkbookFile>;
    if (file.version !== WORKBOOK_VERSION) {
        throw new Error(`unsupported workbook version ${String(file.version)}; this build reads version ${WORKBOOK_VERSION}`);
    }
    if (!Array.isArray(file.market)) throw new Error("a workbook needs a market");
    if (typeof file.evaluationDate !== "string" || !file.evaluationDate) throw new Error("a workbook needs an evaluation date");

    return {
        label: typeof file.label === "string" ? file.label : "Imported workbook",
        evaluationDate: file.evaluationDate,
        market: file.market.map(object => fromJson(MarketObjectSchema, object as never)),
        trade: fromJson(PriceRequestSchema, (file.trade ?? {}) as never)
    };
}
