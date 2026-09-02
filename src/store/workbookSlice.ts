import {createSlice, type PayloadAction} from "@reduxjs/toolkit";

import type {BusinessDayConvention, Calendar, Compounding, DayCounter, Frequency} from "@/gen/quantlib/v1/conventions_pb";
import type {AnalyticParameters_Approximation, Engine_Method, FdParameters_Explicit_Scheme, FdParameters_Preset, LatticeParameters_Tree} from "@/gen/quantlib/v2/engine_pb";
import type {PriceRequest} from "@/gen/quantlib/v2/envelope_pb";
import type {Asian_Averaging, Barrier_Type, DoubleBarrier_Type, Exercise_Type, Leg_Kind, Option, Payoff_OptionType, Schedule_DateGeneration, Swap, Underlying_Process} from "@/gen/quantlib/v2/instrument_pb";
import type {BootstrappedCurve_Traits, Flag, Index_Family, Interpolator, MarketObject, Pillar_Kind, Quote_Unit} from "@/gen/quantlib/v2/market_pb";
import type {ResultKind} from "@/gen/quantlib/v2/results_pb";
import {HANDLERS_EVALUATION_DATE, seedMarket, seedTrade} from "@/market/handlersSession";
import {asQuote, asVolatility, asYieldCurve, type AuthorableKind, newBootstrapCurve, newConstantVol, newFixings, newFlatCurve, newIndex, newQuote} from "@/market/model";
import {SWAP_EVALUATION_DATE, swapExampleMarket, swapExampleTrade} from "@/market/swapExample";
import type {PayoffCase, StyleCase} from "@/protocol/capabilities";

/** The document the client owns.
 *
 *  A session dies with its socket (DESIGN §9.4), so the workbook — not the
 *  backend — is the source of truth for the market. A reconnect is a replay of
 *  this, not a resume of that.
 *
 *  `structureRevision` is the whole two-speed edit model in one number. Quote
 *  writes leave it alone because UpdateMarket can carry them to a live graph;
 *  anything that changes graph *structure* bumps it, and the session is stale
 *  until it is rebuilt. Nothing rebuilds silently.
 */
interface WorkbookState {
    label: string;
    evaluationDate: string;
    market: MarketObject[];
    trade: PriceRequest;
    structureRevision: number;
    selectedId: string | null;
}

const initialState: WorkbookState = {
    label: "HANDLERS.md session",
    evaluationDate: HANDLERS_EVALUATION_DATE,
    market: seedMarket(),
    trade: seedTrade(),
    structureRevision: 1,
    selectedId: null
};

function find(state: WorkbookState, id: string): MarketObject | undefined {
    return state.market.find(object => object.id === id);
}

/** The option under edit. Trade edits never touch structureRevision: the
 *  instrument is a property of the request, not of the graph, so changing it
 *  costs a price and not a rebuild. */
function swap(state: WorkbookState): Swap | undefined {
    const kind = state.trade.instrument?.kind;
    return kind?.case === "swap" ? kind.value : undefined;
}

function leg(state: WorkbookState, at: number) {
    return swap(state)?.legs[at];
}

function option(state: WorkbookState): Option | undefined {
    const kind = state.trade.instrument?.kind;
    return kind?.case === "option" ? kind.value : undefined;
}

/** Carries the strike across a payoff change where both arms have one, so
 *  switching to a gap payoff does not silently zero it. */
function currentStrike(state: WorkbookState): number {
    const payoff = option(state)?.payoff;
    switch (payoff?.kind.case) {
        case "plain":
        case "assetOrNothing":
        case "cashOrNothing":
        case "gap":
        case "superFund":
        case "superShare":
            return payoff.kind.value.strike;
        default:
            return 0;
    }
}

/** The parameter block for the current method, created if the engine does not
 *  carry one yet.
 *
 *  A method can be set without its block ever having been built — the seed
 *  trade is analytic and carries no AnalyticParameters — so a setter that only
 *  wrote into an existing block would silently drop the first edit.
 */
function analyticParameters(state: WorkbookState) {
    const engine = state.trade.engine;
    if (!engine) return null;
    if (engine.parameters.case !== "analytic") {
        engine.parameters = {case: "analytic", value: {$typeName: "quantlib.v2.AnalyticParameters", approximation: 0}};
    }
    return engine.parameters.case === "analytic" ? engine.parameters.value : null;
}

function latticeParameters(state: WorkbookState) {
    const engine = state.trade.engine;
    if (!engine) return null;
    if (engine.parameters.case !== "lattice") {
        engine.parameters = {case: "lattice", value: {$typeName: "quantlib.v2.LatticeParameters", tree: 0, steps: 0}};
    }
    return engine.parameters.case === "lattice" ? engine.parameters.value : null;
}

function fdParameters(state: WorkbookState) {
    const engine = state.trade.engine;
    if (!engine) return null;
    if (engine.parameters.case !== "fd") {
        engine.parameters = {case: "fd", value: {$typeName: "quantlib.v2.FdParameters", grid: {case: "preset", value: 0}}};
    }
    return engine.parameters.case === "fd" ? engine.parameters.value : null;
}

function mcParameters(state: WorkbookState) {
    const engine = state.trade.engine;
    if (!engine) return null;
    if (engine.parameters.case !== "mc") {
        engine.parameters = {
            case: "mc",
            value: {
                $typeName: "quantlib.v2.McParameters",
                seed: 0n,
                stopping: {case: "samples", value: 0n},
                rng: 0,
                timeStepsPerYear: 0,
                antitheticVariate: false,
                controlVariate: false,
                brownianBridge: false,
                progressEveryPaths: 0n
            }
        };
    }
    return engine.parameters.case === "mc" ? engine.parameters.value : null;
}

function uniqueId(state: WorkbookState, stem: string): string {
    if (!find(state, stem)) return stem;
    for (let n = 2; ; n += 1) {
        const candidate = `${stem}${n}`;
        if (!find(state, candidate)) return candidate;
    }
}

export const workbookSlice = createSlice({
    name: "workbook",
    initialState,
    reducers: {
        // ---- structural: the graph has to be rebuilt -------------------------
        evaluationDateSet(state, action: PayloadAction<string>) {
            state.evaluationDate = action.payload;
            state.structureRevision += 1;
        },
        objectAdded(state, action: PayloadAction<AuthorableKind>) {
            const kind = action.payload;
            const object =
                kind === "quote"
                    ? newQuote(uniqueId(state, "Q"))
                    : kind === "flatCurve"
                      ? newFlatCurve(uniqueId(state, "C"))
                      : kind === "bootstrapCurve"
                        ? newBootstrapCurve(uniqueId(state, "C"))
                        : kind === "volatility"
                          ? newConstantVol(uniqueId(state, "VOL"))
                          : kind === "index"
                            ? newIndex(uniqueId(state, "IDX"))
                            : newFixings(uniqueId(state, "FIX"));
            state.market.push(object);
            state.selectedId = object.id;
            state.structureRevision += 1;
        },
        objectRemoved(state, action: PayloadAction<string>) {
            state.market = state.market.filter(object => object.id !== action.payload);
            if (state.selectedId === action.payload) state.selectedId = null;
            state.structureRevision += 1;
        },
        /** Renames and rewrites every reference to the old id, because a rename
         *  that leaves dangling references is a rename that breaks the session. */
        objectRenamed(state, action: PayloadAction<{from: string; to: string}>) {
            const {from, to} = action.payload;
            const object = find(state, from);
            if (!object) return;
            object.id = to;
            for (const other of state.market) {
                const curve = asYieldCurve(other);
                if (curve?.shape.case === "flat" && curve.shape.value.rate?.source.case === "quoteId" && curve.shape.value.rate.source.value === from) {
                    curve.shape.value.rate.source.value = to;
                }
                const surface = asVolatility(other);
                if (surface?.shape.case === "constant" && surface.shape.value.volatility?.source.case === "quoteId" && surface.shape.value.volatility.source.value === from) {
                    surface.shape.value.volatility.source.value = to;
                }
            }
            if (state.selectedId === from) state.selectedId = to;
            state.structureRevision += 1;
        },
        dayCounterSet(state, action: PayloadAction<{id: string; dayCounter: DayCounter}>) {
            const object = find(state, action.payload.id);
            if (!object) return;
            const target = asYieldCurve(object) ?? asVolatility(object);
            if (target) {
                target.dayCounter = action.payload.dayCounter;
            } else if (object.kind.case === "index") {
                object.kind.value.dayCounter = action.payload.dayCounter;
            }
            state.structureRevision += 1;
        },
        calendarSet(state, action: PayloadAction<{id: string; calendar: Calendar}>) {
            const object = find(state, action.payload.id);
            if (!object) return;
            if (object.kind.case === "index") {
                object.kind.value.fixingCalendar = action.payload.calendar;
            } else {
                const curve = asYieldCurve(object);
                if (curve) curve.calendar = action.payload.calendar;
            }
            state.structureRevision += 1;
        },

        // ---- index -----------------------------------------------------------
        indexFamilySet(state, action: PayloadAction<{id: string; family: Index_Family}>) {
            const object = find(state, action.payload.id);
            if (object?.kind.case === "index") object.kind.value.family = action.payload.family;
            state.structureRevision += 1;
        },
        indexTextSet(state, action: PayloadAction<{id: string; field: "name" | "tenor" | "forwardingCurveId"; value: string}>) {
            const object = find(state, action.payload.id);
            if (object?.kind.case === "index") object.kind.value[action.payload.field] = action.payload.value;
            state.structureRevision += 1;
        },
        indexFixingDaysSet(state, action: PayloadAction<{id: string; value: number}>) {
            const object = find(state, action.payload.id);
            if (object?.kind.case === "index") object.kind.value.fixingDays = action.payload.value;
            state.structureRevision += 1;
        },
        indexConventionSet(state, action: PayloadAction<{id: string; convention: BusinessDayConvention}>) {
            const object = find(state, action.payload.id);
            if (object?.kind.case === "index") object.kind.value.convention = action.payload.convention;
            state.structureRevision += 1;
        },
        indexEndOfMonthSet(state, action: PayloadAction<{id: string; flag: Flag}>) {
            const object = find(state, action.payload.id);
            if (object?.kind.case === "index") object.kind.value.endOfMonth = action.payload.flag;
            state.structureRevision += 1;
        },

        // ---- fixings ---------------------------------------------------------
        fixingsIndexSet(state, action: PayloadAction<{id: string; indexId: string}>) {
            const object = find(state, action.payload.id);
            if (object?.kind.case === "fixings") object.kind.value.indexId = action.payload.indexId;
            state.structureRevision += 1;
        },
        /** Past fixings are graph input rather than graph structure, so this
         *  does not bump the revision: UpdateMarket can carry them. */
        fixingsRowsSet(state, action: PayloadAction<{id: string; rows: {date: string; value: number}[]}>) {
            const object = find(state, action.payload.id);
            if (object?.kind.case !== "fixings") return;
            object.kind.value.fixings = action.payload.rows.map(row => ({
                $typeName: "quantlib.v2.FixingSeries.Fixing" as const,
                date: {$typeName: "quantlib.v1.Date" as const, form: {case: "iso" as const, value: row.date}},
                value: row.value
            }));
        },

        // ---- bootstrapped curves ---------------------------------------------
        bootstrapTraitsSet(state, action: PayloadAction<{id: string; traits: BootstrappedCurve_Traits}>) {
            const curve = asYieldCurve(find(state, action.payload.id) ?? ({} as MarketObject));
            if (curve?.shape.case === "bootstrap") curve.shape.value.traits = action.payload.traits;
            state.structureRevision += 1;
        },
        bootstrapInterpolatorSet(state, action: PayloadAction<{id: string; interpolator: Interpolator}>) {
            const curve = asYieldCurve(find(state, action.payload.id) ?? ({} as MarketObject));
            if (curve?.shape.case === "bootstrap") curve.shape.value.interpolator = action.payload.interpolator;
            state.structureRevision += 1;
        },
        pillarAdded(state, action: PayloadAction<string>) {
            const curve = asYieldCurve(find(state, action.payload) ?? ({} as MarketObject));
            if (curve?.shape.case !== "bootstrap") return;
            curve.shape.value.pillars.push({
                $typeName: "quantlib.v2.Pillar",
                quoteId: "",
                tenor: "",
                kind: 0,
                indexId: "",
                fixedFrequency: 0,
                fixedConvention: 0,
                discountCurveId: ""
            });
            state.structureRevision += 1;
        },
        pillarRemoved(state, action: PayloadAction<{id: string; at: number}>) {
            const curve = asYieldCurve(find(state, action.payload.id) ?? ({} as MarketObject));
            if (curve?.shape.case !== "bootstrap") return;
            curve.shape.value.pillars.splice(action.payload.at, 1);
            state.structureRevision += 1;
        },
        pillarTextSet(state, action: PayloadAction<{id: string; at: number; field: "quoteId" | "tenor" | "indexId" | "discountCurveId"; value: string}>) {
            const curve = asYieldCurve(find(state, action.payload.id) ?? ({} as MarketObject));
            const pillar = curve?.shape.case === "bootstrap" ? curve.shape.value.pillars[action.payload.at] : undefined;
            if (pillar) pillar[action.payload.field] = action.payload.value;
            state.structureRevision += 1;
        },
        pillarKindSet(state, action: PayloadAction<{id: string; at: number; kind: Pillar_Kind}>) {
            const curve = asYieldCurve(find(state, action.payload.id) ?? ({} as MarketObject));
            const pillar = curve?.shape.case === "bootstrap" ? curve.shape.value.pillars[action.payload.at] : undefined;
            if (pillar) pillar.kind = action.payload.kind;
            state.structureRevision += 1;
        },
        pillarFixedSet(state, action: PayloadAction<{id: string; at: number; frequency?: Frequency; convention?: BusinessDayConvention; calendar?: Calendar; dayCounter?: DayCounter}>) {
            const curve = asYieldCurve(find(state, action.payload.id) ?? ({} as MarketObject));
            const pillar = curve?.shape.case === "bootstrap" ? curve.shape.value.pillars[action.payload.at] : undefined;
            if (!pillar) return;
            if (action.payload.frequency !== undefined) pillar.fixedFrequency = action.payload.frequency;
            if (action.payload.convention !== undefined) pillar.fixedConvention = action.payload.convention;
            if (action.payload.calendar !== undefined) pillar.calendar = action.payload.calendar;
            if (action.payload.dayCounter !== undefined) pillar.fixedDayCounter = action.payload.dayCounter;
            state.structureRevision += 1;
        },
        flatRateSet(state, action: PayloadAction<{id: string; source: {case: "quoteId"; value: string} | {case: "fixed"; value: number}}>) {
            const curve = asYieldCurve(find(state, action.payload.id) ?? ({} as MarketObject));
            if (curve?.shape.case !== "flat" || !curve.shape.value.rate) return;
            curve.shape.value.rate.source = action.payload.source;
            state.structureRevision += 1;
        },
        compoundingSet(state, action: PayloadAction<{id: string; compounding: Compounding}>) {
            const curve = asYieldCurve(find(state, action.payload.id) ?? ({} as MarketObject));
            if (curve?.shape.case !== "flat") return;
            curve.shape.value.compounding = action.payload.compounding;
            state.structureRevision += 1;
        },
        frequencySet(state, action: PayloadAction<{id: string; frequency: Frequency}>) {
            const curve = asYieldCurve(find(state, action.payload.id) ?? ({} as MarketObject));
            if (curve?.shape.case !== "flat") return;
            curve.shape.value.frequency = action.payload.frequency;
            state.structureRevision += 1;
        },
        volatilitySourceSet(state, action: PayloadAction<{id: string; source: {case: "quoteId"; value: string} | {case: "fixed"; value: number}}>) {
            const surface = asVolatility(find(state, action.payload.id) ?? ({} as MarketObject));
            if (surface?.shape.case !== "constant" || !surface.shape.value.volatility) return;
            surface.shape.value.volatility.source = action.payload.source;
            state.structureRevision += 1;
        },

        // ---- live: UpdateMarket carries these to the running graph -----------
        /** The only edit the backend can take without a rebuild. */
        quoteValueSet(state, action: PayloadAction<{id: string; value: number}>) {
            const quote = asQuote(find(state, action.payload.id) ?? ({} as MarketObject));
            if (quote) quote.value = action.payload.value;
        },

        // ---- cosmetic: never sent, or never read ----------------------------
        /** Quote.unit is carried for the frontend and never read in pricing, so
         *  changing it costs nothing on the wire. */
        quoteUnitSet(state, action: PayloadAction<{id: string; unit: Quote_Unit}>) {
            const quote = asQuote(find(state, action.payload.id) ?? ({} as MarketObject));
            if (quote) quote.unit = action.payload.unit;
        },
        displayNameSet(state, action: PayloadAction<{id: string; displayName: string}>) {
            const object = find(state, action.payload.id);
            if (object) object.displayName = action.payload.displayName;
        },
        // ---- the trade: a property of the request, not of the graph ----------
        payoffTypeSet(state, action: PayloadAction<Payoff_OptionType>) {
            const payoff = option(state)?.payoff;
            if (payoff) payoff.type = action.payload;
        },
        payoffKindSet(state, action: PayloadAction<PayoffCase>) {
            const payoff = option(state)?.payoff;
            if (!payoff) return;
            const strike = currentStrike(state);
            switch (action.payload) {
                case "plain":
                    payoff.kind = {case: "plain", value: {$typeName: "quantlib.v2.PlainVanillaPayoff", strike}};
                    break;
                case "percentageStrike":
                    payoff.kind = {case: "percentageStrike", value: {$typeName: "quantlib.v2.PercentageStrikePayoff", moneyness: 1}};
                    break;
                case "assetOrNothing":
                    payoff.kind = {case: "assetOrNothing", value: {$typeName: "quantlib.v2.AssetOrNothingPayoff", strike}};
                    break;
                case "cashOrNothing":
                    payoff.kind = {case: "cashOrNothing", value: {$typeName: "quantlib.v2.CashOrNothingPayoff", strike, cashPayoff: 0}};
                    break;
                case "gap":
                    payoff.kind = {case: "gap", value: {$typeName: "quantlib.v2.GapPayoff", strike, secondStrike: 0}};
                    break;
                case "superFund":
                    payoff.kind = {case: "superFund", value: {$typeName: "quantlib.v2.SuperFundPayoff", strike, secondStrike: 0}};
                    break;
                case "superShare":
                    payoff.kind = {case: "superShare", value: {$typeName: "quantlib.v2.SuperSharePayoff", strike, secondStrike: 0, cashPayoff: 0}};
                    break;
                default:
                    break;
            }
        },
        payoffNumberSet(state, action: PayloadAction<{field: "strike" | "secondStrike" | "cashPayoff" | "moneyness"; value: number}>) {
            const kind = option(state)?.payoff?.kind;
            if (!kind || kind.case === undefined) return;
            const target = kind.value as unknown as Record<string, number>;
            if (action.payload.field in target) target[action.payload.field] = action.payload.value;
        },
        exerciseTypeSet(state, action: PayloadAction<Exercise_Type>) {
            const exercise = option(state)?.exercise;
            if (exercise) exercise.type = action.payload;
        },
        exerciseDatesSet(state, action: PayloadAction<string[]>) {
            const exercise = option(state)?.exercise;
            if (!exercise) return;
            exercise.dates = action.payload.map(iso => ({
                $typeName: "quantlib.v1.Date" as const,
                form: {case: "iso" as const, value: iso}
            }));
        },
        payoffAtExpirySet(state, action: PayloadAction<Flag>) {
            const exercise = option(state)?.exercise;
            if (exercise) exercise.payoffAtExpiry = action.payload;
        },
        underlyingRefSet(state, action: PayloadAction<{field: "spotQuoteId" | "discountCurveId" | "dividendCurveId" | "volatilityId"; value: string}>) {
            const underlying = option(state)?.underlyings[0];
            if (underlying) underlying[action.payload.field] = action.payload.value;
        },
        processSet(state, action: PayloadAction<Underlying_Process>) {
            const underlying = option(state)?.underlyings[0];
            if (underlying) underlying.process = action.payload;
        },
        /** The method selects the parameter block; a field that does not apply
         *  cannot be set, rather than being set and dropped. */
        engineMethodSet(state, action: PayloadAction<Engine_Method>) {
            const engine = state.trade.engine;
            if (!engine) return;
            engine.method = action.payload;
            switch (action.payload) {
                case 1: // ANALYTIC
                    engine.parameters = {case: "analytic", value: {$typeName: "quantlib.v2.AnalyticParameters", approximation: 0}};
                    break;
                case 2: // LATTICE
                    engine.parameters = {case: "lattice", value: {$typeName: "quantlib.v2.LatticeParameters", tree: 0, steps: 0}};
                    break;
                case 3: // FINITE_DIFFERENCE
                    engine.parameters = {case: "fd", value: {$typeName: "quantlib.v2.FdParameters", grid: {case: "preset", value: 0}}};
                    break;
                case 4: // MONTE_CARLO
                    engine.parameters = {
                        case: "mc",
                        value: {
                            $typeName: "quantlib.v2.McParameters",
                            seed: 0n,
                            stopping: {case: "samples", value: 0n},
                            rng: 0,
                            timeStepsPerYear: 0,
                            antitheticVariate: false,
                            controlVariate: false,
                            brownianBridge: false,
                            progressEveryPaths: 0n
                        }
                    };
                    break;
                default:
                    engine.parameters = {case: undefined};
                    break;
            }
        },
        approximationSet(state, action: PayloadAction<AnalyticParameters_Approximation>) {
            const parameters = analyticParameters(state);
            if (parameters) parameters.approximation = action.payload;
        },
        latticeTreeSet(state, action: PayloadAction<LatticeParameters_Tree>) {
            const parameters = latticeParameters(state);
            if (parameters) parameters.tree = action.payload;
        },
        latticeStepsSet(state, action: PayloadAction<number>) {
            const parameters = latticeParameters(state);
            if (parameters) parameters.steps = action.payload;
        },
        fdGridModeSet(state, action: PayloadAction<"preset" | "custom">) {
            const parameters = fdParameters(state);
            if (!parameters) return;
            parameters.grid =
                action.payload === "preset"
                    ? {case: "preset", value: 0}
                    : {
                          case: "custom",
                          value: {$typeName: "quantlib.v2.FdParameters.Explicit", timeSteps: 100, assetSteps: 100, dampingSteps: 0, scheme: 0}
                      };
        },
        fdPresetSet(state, action: PayloadAction<FdParameters_Preset>) {
            const parameters = fdParameters(state);
            if (parameters?.grid.case === "preset") parameters.grid.value = action.payload;
        },
        fdCustomSet(state, action: PayloadAction<{field: "timeSteps" | "assetSteps" | "dampingSteps"; value: number}>) {
            const parameters = fdParameters(state);
            if (parameters?.grid.case === "custom") parameters.grid.value[action.payload.field] = action.payload.value;
        },
        fdSchemeSet(state, action: PayloadAction<FdParameters_Explicit_Scheme>) {
            const parameters = fdParameters(state);
            if (parameters?.grid.case === "custom") parameters.grid.value.scheme = action.payload;
        },
        resultKindsSet(state, action: PayloadAction<ResultKind[]>) {
            state.trade.results = action.payload;
        },
        /** Whatever the engine published in its own additionalResults map. Off by
         *  default because the contents vary by engine; on, it is how a panel
         *  shows the working behind a price. */
        includeAdditionalResultsSet(state, action: PayloadAction<boolean>) {
            state.trade.includeAdditionalResults = action.payload;
        },

        // ---- style: the oneof says what is buildable ---------------------------
        /** Switching style builds a fresh arm. Its fields start unset, because a
         *  barrier level or an averaging convention carried over from another
         *  trade is a number nobody chose. */
        styleSet(state, action: PayloadAction<StyleCase>) {
            const target = option(state);
            if (!target) return;
            switch (action.payload) {
                case "vanilla":
                    target.style = {case: "vanilla", value: {$typeName: "quantlib.v2.Vanilla"}};
                    break;
                case "barrier":
                    target.style = {case: "barrier", value: {$typeName: "quantlib.v2.Barrier", type: 0, level: 0, rebate: 0, monitoringDates: []}};
                    break;
                case "doubleBarrier":
                    target.style = {case: "doubleBarrier", value: {$typeName: "quantlib.v2.DoubleBarrier", type: 0, lower: 0, upper: 0, rebate: 0}};
                    break;
                case "asian":
                    target.style = {case: "asian", value: {$typeName: "quantlib.v2.Asian", averaging: 0, fixingDates: [], runningAverage: 0, pastFixings: 0}};
                    break;
                case "lookback":
                    target.style = {case: "lookback", value: {$typeName: "quantlib.v2.Lookback", runningExtremum: 0, level: 0}};
                    break;
                case "forwardStart":
                    target.style = {case: "forwardStart", value: {$typeName: "quantlib.v2.ForwardStart", performance: 0}};
                    break;
                default:
                    break;
            }
        },
        barrierTypeSet(state, action: PayloadAction<Barrier_Type>) {
            const style = option(state)?.style;
            if (style?.case === "barrier") style.value.type = action.payload;
        },
        barrierNumberSet(state, action: PayloadAction<{field: "level" | "rebate"; value: number}>) {
            const style = option(state)?.style;
            if (style?.case === "barrier") style.value[action.payload.field] = action.payload.value;
        },
        doubleBarrierTypeSet(state, action: PayloadAction<DoubleBarrier_Type>) {
            const style = option(state)?.style;
            if (style?.case === "doubleBarrier") style.value.type = action.payload;
        },
        doubleBarrierNumberSet(state, action: PayloadAction<{field: "lower" | "upper" | "rebate"; value: number}>) {
            const style = option(state)?.style;
            if (style?.case === "doubleBarrier") style.value[action.payload.field] = action.payload.value;
        },
        asianAveragingSet(state, action: PayloadAction<Asian_Averaging>) {
            const style = option(state)?.style;
            if (style?.case === "asian") style.value.averaging = action.payload;
        },
        asianFixingDatesSet(state, action: PayloadAction<string[]>) {
            const style = option(state)?.style;
            if (style?.case !== "asian") return;
            style.value.fixingDates = action.payload.map(iso => ({
                $typeName: "quantlib.v1.Date" as const,
                form: {case: "iso" as const, value: iso}
            }));
        },
        asianNumberSet(state, action: PayloadAction<{field: "runningAverage" | "pastFixings"; value: number}>) {
            const style = option(state)?.style;
            if (style?.case === "asian") style.value[action.payload.field] = action.payload.value;
        },
        lookbackExtremumSet(state, action: PayloadAction<number>) {
            const style = option(state)?.style;
            if (style?.case === "lookback") style.value.runningExtremum = action.payload;
        },
        forwardStartResetSet(state, action: PayloadAction<string>) {
            const style = option(state)?.style;
            if (style?.case === "forwardStart") {
                style.value.reset = {$typeName: "quantlib.v1.Date", form: {case: "iso", value: action.payload}};
            }
        },
        forwardStartPerformanceSet(state, action: PayloadAction<Flag>) {
            const style = option(state)?.style;
            if (style?.case === "forwardStart") style.value.performance = action.payload;
        },

        // ---- quanto: an adjustment to the engine, not a product ---------------
        quantoToggled(state, action: PayloadAction<boolean>) {
            const target = option(state);
            if (!target) return;
            target.quanto = action.payload ? {$typeName: "quantlib.v2.Quanto", fxRiskFreeCurveId: "", fxVolatilityId: "", correlationId: ""} : undefined;
        },
        quantoRefSet(state, action: PayloadAction<{field: "fxRiskFreeCurveId" | "fxVolatilityId" | "correlationId"; value: string}>) {
            const quanto = option(state)?.quanto;
            if (quanto) quanto[action.payload.field] = action.payload.value;
        },

        // ---- Monte Carlo ------------------------------------------------------
        /** Seed and samples are uint64 and arrive as bigint; they stay that way in
         *  the message. A zero seed is rejected by the backend because QuantLib
         *  would seed from the clock and the same inputs would price differently
         *  on every request. */
        mcSeedSet(state, action: PayloadAction<bigint>) {
            const parameters = mcParameters(state);
            if (parameters) parameters.seed = action.payload;
        },
        mcSamplesSet(state, action: PayloadAction<bigint>) {
            const parameters = mcParameters(state);
            if (parameters) parameters.stopping = {case: "samples", value: action.payload};
        },
        mcRngSet(state, action: PayloadAction<number>) {
            const parameters = mcParameters(state);
            if (parameters) parameters.rng = action.payload;
        },
        mcStepsPerYearSet(state, action: PayloadAction<number>) {
            const parameters = mcParameters(state);
            if (parameters) parameters.timeStepsPerYear = action.payload;
        },
        mcToggleSet(state, action: PayloadAction<{field: "antitheticVariate" | "controlVariate" | "brownianBridge"; value: boolean}>) {
            const parameters = mcParameters(state);
            if (parameters) parameters[action.payload.field] = action.payload.value;
        },

        // ---- the swap --------------------------------------------------------
        /** Two of the nine instrument arms are dispatched. Switching builds a
         *  fresh one: an option's payoff has no meaning on a swap. */
        instrumentKindSet(state, action: PayloadAction<"option" | "swap">) {
            if (action.payload === "swap") {
                state.trade.instrument = {
                    $typeName: "quantlib.v2.Instrument",
                    kind: {case: "swap", value: {$typeName: "quantlib.v2.Swap", legs: [], discountCurveId: ""}}
                };
                state.trade.engine = {$typeName: "quantlib.v2.Engine", method: 7, model: 0, parameters: {case: undefined}, modelQuoteIds: {}};
                state.trade.results = [1];
            } else {
                state.trade = seedTrade();
            }
        },
        swapDiscountCurveSet(state, action: PayloadAction<string>) {
            const target = swap(state);
            if (target) target.discountCurveId = action.payload;
        },
        legAdded(state) {
            const target = swap(state);
            if (!target) return;
            target.legs.push({
                $typeName: "quantlib.v2.Leg",
                kind: 0,
                notionals: [],
                rateQuoteId: "",
                indexId: "",
                fixingDays: 0,
                inArrears: 0,
                gearings: [],
                spreads: [],
                caps: [],
                floors: [],
                pays: 0,
                discountCurveId: "",
                currency: "",
                schedule: {
                    $typeName: "quantlib.v2.Schedule",
                    frequency: 0,
                    convention: 0,
                    terminationConvention: 0,
                    dateGeneration: 0,
                    endOfMonth: 0
                }
            });
        },
        legRemoved(state, action: PayloadAction<number>) {
            swap(state)?.legs.splice(action.payload, 1);
        },
        legKindSet(state, action: PayloadAction<{at: number; kind: Leg_Kind}>) {
            const target = leg(state, action.payload.at);
            if (target) target.kind = action.payload.kind;
        },
        legPaysSet(state, action: PayloadAction<{at: number; flag: Flag}>) {
            const target = leg(state, action.payload.at);
            if (target) target.pays = action.payload.flag;
        },
        legDayCounterSet(state, action: PayloadAction<{at: number; dayCounter: DayCounter}>) {
            const target = leg(state, action.payload.at);
            if (target) target.dayCounter = action.payload.dayCounter;
        },
        legNumbersSet(state, action: PayloadAction<{at: number; field: "notionals" | "gearings" | "spreads"; values: number[]}>) {
            const target = leg(state, action.payload.at);
            if (target) target[action.payload.field] = action.payload.values;
        },
        legTextSet(state, action: PayloadAction<{at: number; field: "rateQuoteId" | "indexId"; value: string}>) {
            const target = leg(state, action.payload.at);
            if (target) target[action.payload.field] = action.payload.value;
        },
        legFixingDaysSet(state, action: PayloadAction<{at: number; value: number}>) {
            const target = leg(state, action.payload.at);
            if (target) target.fixingDays = action.payload.value;
        },
        legInArrearsSet(state, action: PayloadAction<{at: number; flag: Flag}>) {
            const target = leg(state, action.payload.at);
            if (target) target.inArrears = action.payload.flag;
        },
        legScheduleDateSet(state, action: PayloadAction<{at: number; field: "start" | "maturity"; value: string}>) {
            const target = leg(state, action.payload.at)?.schedule;
            if (target) target[action.payload.field] = {$typeName: "quantlib.v1.Date", form: {case: "iso", value: action.payload.value}};
        },
        legScheduleSet(
            state,
            action: PayloadAction<{at: number; frequency?: Frequency; calendar?: Calendar; convention?: BusinessDayConvention; terminationConvention?: BusinessDayConvention; dateGeneration?: Schedule_DateGeneration; endOfMonth?: Flag}>
        ) {
            const target = leg(state, action.payload.at)?.schedule;
            if (!target) return;
            const {frequency, calendar, convention, terminationConvention, dateGeneration, endOfMonth} = action.payload;
            if (frequency !== undefined) target.frequency = frequency;
            if (calendar !== undefined) target.calendar = calendar;
            if (convention !== undefined) target.convention = convention;
            if (terminationConvention !== undefined) target.terminationConvention = terminationConvention;
            if (dateGeneration !== undefined) target.dateGeneration = dateGeneration;
            if (endOfMonth !== undefined) target.endOfMonth = endOfMonth;
        },

        selected(state, action: PayloadAction<string | null>) {
            state.selectedId = action.payload;
        },
        /** The worked swap: an index, a curve bootstrapped from pillars that
         *  name it, the fixing that has already happened, and two legs. */
        swapExampleLoaded(state) {
            state.label = "Five-year fixed against Euribor 6M";
            state.evaluationDate = SWAP_EVALUATION_DATE;
            state.market = swapExampleMarket();
            state.trade = swapExampleTrade();
            state.selectedId = null;
            state.structureRevision += 1;
        },
        reset() {
            return {...initialState, market: seedMarket(), trade: seedTrade()};
        }
    }
});

export const workbookActions = workbookSlice.actions;
