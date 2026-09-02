import {create} from "@bufbuild/protobuf";

import {type MarketObject, MarketObjectSchema, type Quote, Quote_Unit, type VolatilitySurface, type YieldCurve} from "@/gen/quantlib/v2/market_pb";

/** The workbook holds real messages, not init shapes.
 *
 *  protobuf-es v2 messages are plain objects, so they live in Redux and update
 *  under Immer like anything else — and every field is present and typed,
 *  which an init shape cannot promise. It also means the market goes onto the
 *  wire untouched: there is no second representation to drift.
 */

export type MarketKind = NonNullable<MarketObject["kind"]["case"]>;

/** What M1 can author. The rest of the schema arrives with the generic
 *  renderer in M5; until then an unknown kind renders read-only. */
export const AUTHORABLE_KINDS = ["quote", "yieldCurve", "volatility"] as const;
export type AuthorableKind = (typeof AUTHORABLE_KINDS)[number];

export const KIND_LABEL: Record<string, string> = {
    quote: "quote",
    yieldCurve: "yield curve",
    volatility: "volatility",
    index: "index",
    fixings: "fixings",
    defaultCurve: "default curve",
    inflationCurve: "inflation curve",
    correlation: "correlation"
};

export function asQuote(object: MarketObject): Quote | null {
    return object.kind.case === "quote" ? object.kind.value : null;
}

export function asYieldCurve(object: MarketObject): YieldCurve | null {
    return object.kind.case === "yieldCurve" ? object.kind.value : null;
}

export function asVolatility(object: MarketObject): VolatilitySurface | null {
    return object.kind.case === "volatility" ? object.kind.value : null;
}

export function newQuote(id: string, value = 0, unit = Quote_Unit.ABSOLUTE): MarketObject {
    return create(MarketObjectSchema, {id, kind: {case: "quote", value: {value, unit}}});
}

/** FlatForward on a live quote. The rate is a quote_id rather than a literal so
 *  that writing the quote reprices off the same curve object; `fixed` is the
 *  other arm and says out loud that the number can never move. */
export function newFlatCurve(id: string, rateQuoteId = ""): MarketObject {
    return create(MarketObjectSchema, {
        id,
        kind: {
            case: "yieldCurve",
            value: {
                // Conventions deliberately left unset. Zero is *_UNSPECIFIED and the
                // registry rejects it; pre-filling ACT/360 here would be exactly the
                // silent default the schema exists to prevent, and the user would
                // never see the choice being made.
                shape: {
                    case: "flat",
                    value: {rate: {source: {case: "quoteId", value: rateQuoteId}}}
                }
            }
        }
    });
}

export function newConstantVol(id: string, volQuoteId = ""): MarketObject {
    return create(MarketObjectSchema, {
        id,
        kind: {
            case: "volatility",
            value: {
                shape: {
                    case: "constant",
                    value: {volatility: {source: {case: "quoteId", value: volQuoteId}}}
                }
            }
        }
    });
}

/** A default slider range per unit. The wire is decimal throughout. */
export function defaultRange(unit: Quote_Unit, value: number): {min: number; max: number; step: number} {
    switch (unit) {
        case Quote_Unit.RATE:
            return {min: -0.02, max: 0.2, step: 0.0001};
        case Quote_Unit.VOLATILITY:
            return {min: 0.01, max: 1.5, step: 0.001};
        case Quote_Unit.BASIS_POINT:
            return {min: 0, max: 0.01, step: 0.00001};
        case Quote_Unit.CORRELATION:
            return {min: -1, max: 1, step: 0.01};
        default: {
            const span = Math.abs(value) > 0 ? Math.abs(value) : 100;
            return {min: Math.max(0, value - span), max: value + span, step: span / 500};
        }
    }
}
