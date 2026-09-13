import {create} from "@bufbuild/protobuf";

import {Compounding, DayCounter_Family, Frequency} from "@/gen/quantlib/v1/conventions_pb";
import {Engine_Method} from "@/gen/quantlib/v2/engine_pb";
import {type PriceRequest, PriceRequestSchema} from "@/gen/quantlib/v2/envelope_pb";
import {Exercise_Type, Payoff_OptionType, Underlying_Process} from "@/gen/quantlib/v2/instrument_pb";
import {type MarketObject, MarketObjectSchema, Quote_Unit} from "@/gen/quantlib/v2/market_pb";
import {ResultKind} from "@/gen/quantlib/v2/results_pb";

/** The worked session from ql-backend/doc/HANDLERS.md, as the seed workbook.
 *
 *  It is the one request whose answer is written down (12.459717 after the
 *  spot bump), so it doubles as the reference check: the whole stack is
 *  measured against a number rather than against "no exception was thrown".
 *  Authored in dependency order here for readability only — the market is
 *  topologically sorted on the way out regardless.
 */

const act360 = {family: DayCounter_Family.ACTUAL_360} as const;

function quote(id: string, value: number, unit: Quote_Unit, displayName: string): MarketObject {
    return create(MarketObjectSchema, {id, displayName, kind: {case: "quote", value: {value, unit}}});
}

function flatCurve(id: string, rateQuoteId: string, displayName: string): MarketObject {
    return create(MarketObjectSchema, {
        id,
        displayName,
        kind: {
            case: "yieldCurve",
            value: {
                dayCounter: act360,
                shape: {
                    case: "flat",
                    value: {
                        rate: {source: {case: "quoteId", value: rateQuoteId}},
                        compounding: Compounding.CONTINUOUS,
                        frequency: Frequency.ANNUAL
                    }
                }
            }
        }
    });
}

export const HANDLERS_EVALUATION_DATE = "2026-09-01";
export const HANDLERS_EXPIRY = "2027-09-01";

export function seedMarket(): MarketObject[] {
    return [
        quote("S", 100.0, Quote_Unit.ABSOLUTE, "Spot"),
        quote("R", 0.05, Quote_Unit.RATE, "Risk-free rate"),
        quote("Q", 0.02, Quote_Unit.RATE, "Dividend yield"),
        quote("V", 0.2, Quote_Unit.VOLATILITY, "Volatility"),
        flatCurve("RC", "R", "Discount curve"),
        flatCurve("QC", "Q", "Dividend curve"),
        create(MarketObjectSchema, {
            id: "VOL",
            displayName: "Black volatility",
            kind: {
                case: "volatility",
                value: {
                    dayCounter: act360,
                    shape: {case: "constant", value: {volatility: {source: {case: "quoteId", value: "V"}}}}
                }
            }
        })
    ];
}

/** payoff x exercise x underlying x style, priced analytically.
 *  Fixed in M1; the trade builder that edits it is M2. */
export function seedTrade(): PriceRequest {
    return create(PriceRequestSchema, {
        instrument: {
            kind: {
                case: "option",
                value: {
                    underlyings: [
                        {
                            spotQuoteId: "S",
                            volatilityId: "VOL",
                            discountCurveId: "RC",
                            dividendCurveId: "QC",
                            process: Underlying_Process.BLACK_SCHOLES_MERTON
                        }
                    ],
                    payoff: {type: Payoff_OptionType.CALL, kind: {case: "plain", value: {strike: 100.0}}},
                    exercise: {
                        type: Exercise_Type.EUROPEAN,
                        dates: [{form: {case: "iso", value: HANDLERS_EXPIRY}}]
                    },
                    style: {case: "vanilla", value: {}}
                }
            }
        },
        engine: {method: Engine_Method.ANALYTIC},
        results: [ResultKind.NPV, ResultKind.DELTA, ResultKind.GAMMA, ResultKind.VEGA]
    });
}

/** HANDLERS.md, "A session, end to end": spot 100 to 105, then price. */
export const REFERENCE_SPOT = 105.0;
export const REFERENCE_NPV = 12.459717;
export const REFERENCE_TOLERANCE = 1e-6;
