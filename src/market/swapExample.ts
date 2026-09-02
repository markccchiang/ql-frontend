import {create} from "@bufbuild/protobuf";

import {BusinessDayConvention, Calendar_Name, DayCounter_Family, Frequency} from "@/gen/quantlib/v1/conventions_pb";
import {Engine_Method} from "@/gen/quantlib/v2/engine_pb";
import {type PriceRequest, PriceRequestSchema} from "@/gen/quantlib/v2/envelope_pb";
import {Leg_Kind, Schedule_DateGeneration} from "@/gen/quantlib/v2/instrument_pb";
import {BootstrappedCurve_Traits, Flag, Index_Family, Interpolator, type MarketObject, MarketObjectSchema, Pillar_Kind, Quote_Unit} from "@/gen/quantlib/v2/market_pb";
import {ResultKind} from "@/gen/quantlib/v2/results_pb";

/** A five-year fixed-for-floating swap, and the market it needs.
 *
 *  Worth having as data rather than as instructions: a swap is the first trade
 *  here that cannot be assembled in a few clicks, because it needs an index,
 *  a curve bootstrapped from live pillars that name that index, past fixings,
 *  and two legs with their own schedules. It is also the shape that exercises
 *  the forward reference the schema allows — the index names the curve, the
 *  curve's pillars name the index — which nothing before M5 could produce.
 */

export const SWAP_EVALUATION_DATE = "2026-09-01";
const START = "2026-09-03";
const MATURITY = "2031-09-03";
const NOTIONAL = 10_000_000;

const target = {$typeName: "quantlib.v1.Calendar" as const, name: Calendar_Name.TARGET, unitedStatesMarket: 0, unitedKingdomMarket: 0, joint: []};
const act360 = {$typeName: "quantlib.v1.DayCounter" as const, family: DayCounter_Family.ACTUAL_360, thirty360: 0, actualActual: 0};
const act365 = {$typeName: "quantlib.v1.DayCounter" as const, family: DayCounter_Family.ACTUAL_365_FIXED, thirty360: 0, actualActual: 0};

const quote = (id: string, value: number, displayName: string): MarketObject => create(MarketObjectSchema, {id, displayName, kind: {case: "quote", value: {value, unit: Quote_Unit.RATE}}});

export function swapExampleMarket(): MarketObject[] {
    return [
        quote("D6M", 0.021, "6M deposit"),
        quote("S2Y", 0.024, "2Y swap"),
        quote("S5Y", 0.027, "5Y swap"),
        quote("S10Y", 0.03, "10Y swap"),
        quote("FIX", 0.027, "Fixed leg rate"),

        // The index names a curve that does not exist yet. That forward
        // reference is legal for this one field, and it has to be: the curve
        // below is bootstrapped from pillars that name this index.
        create(MarketObjectSchema, {
            id: "IDX",
            displayName: "Euribor 6M",
            kind: {
                case: "index",
                value: {
                    family: Index_Family.IBOR,
                    name: "Euribor",
                    tenor: "6M",
                    fixingDays: 2,
                    fixingCalendar: target,
                    convention: BusinessDayConvention.MODIFIED_FOLLOWING,
                    dayCounter: act360,
                    endOfMonth: Flag.FALSE,
                    forwardingCurveId: "BC"
                }
            }
        }),

        create(MarketObjectSchema, {
            id: "BC",
            displayName: "Bootstrapped curve",
            kind: {
                case: "yieldCurve",
                value: {
                    dayCounter: act365,
                    calendar: target,
                    shape: {
                        case: "bootstrap",
                        value: {
                            traits: BootstrappedCurve_Traits.DISCOUNT,
                            interpolator: Interpolator.LOG_LINEAR,
                            pillars: [
                                {quoteId: "D6M", tenor: "6M", kind: Pillar_Kind.DEPOSIT, indexId: "IDX"},
                                {quoteId: "S2Y", tenor: "2Y", kind: Pillar_Kind.SWAP, indexId: "IDX", calendar: target, fixedFrequency: Frequency.ANNUAL, fixedConvention: BusinessDayConvention.MODIFIED_FOLLOWING, fixedDayCounter: act365},
                                {quoteId: "S5Y", tenor: "5Y", kind: Pillar_Kind.SWAP, indexId: "IDX", calendar: target, fixedFrequency: Frequency.ANNUAL, fixedConvention: BusinessDayConvention.MODIFIED_FOLLOWING, fixedDayCounter: act365},
                                {quoteId: "S10Y", tenor: "10Y", kind: Pillar_Kind.SWAP, indexId: "IDX", calendar: target, fixedFrequency: Frequency.ANNUAL, fixedConvention: BusinessDayConvention.MODIFIED_FOLLOWING, fixedDayCounter: act365}
                            ]
                        }
                    }
                }
            }
        }),

        // The first period fixes on the evaluation date, and a leg cannot
        // price without the fixing that has already happened.
        create(MarketObjectSchema, {
            id: "FIXINGS",
            displayName: "Euribor fixings",
            kind: {
                case: "fixings",
                value: {indexId: "IDX", fixings: [{date: {form: {case: "iso", value: SWAP_EVALUATION_DATE}}, value: 0.021}]}
            }
        })
    ];
}

const schedule = (frequency: Frequency) => ({
    start: {form: {case: "iso" as const, value: START}},
    maturity: {form: {case: "iso" as const, value: MATURITY}},
    frequency,
    calendar: target,
    convention: BusinessDayConvention.MODIFIED_FOLLOWING,
    terminationConvention: BusinessDayConvention.MODIFIED_FOLLOWING,
    dateGeneration: Schedule_DateGeneration.BACKWARD,
    endOfMonth: Flag.FALSE
});

/** Fixed annual against Euribor 6M, paying fixed. */
export function swapExampleTrade(): PriceRequest {
    return create(PriceRequestSchema, {
        instrument: {
            kind: {
                case: "swap",
                value: {
                    discountCurveId: "BC",
                    legs: [
                        {
                            kind: Leg_Kind.FIXED,
                            schedule: schedule(Frequency.ANNUAL),
                            dayCounter: act365,
                            notionals: [NOTIONAL],
                            rateQuoteId: "FIX",
                            pays: Flag.TRUE
                        },
                        {
                            kind: Leg_Kind.IBOR,
                            schedule: schedule(Frequency.SEMIANNUAL),
                            dayCounter: act360,
                            notionals: [NOTIONAL],
                            indexId: "IDX",
                            fixingDays: 2,
                            inArrears: Flag.FALSE,
                            pays: Flag.FALSE
                        }
                    ]
                }
            }
        },
        engine: {method: Engine_Method.DISCOUNTING},
        results: [ResultKind.NPV, ResultKind.LEG_NPV, ResultKind.LEG_BPS, ResultKind.FAIR_RATE]
    });
}
