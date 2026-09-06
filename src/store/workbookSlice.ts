import {clone, create} from "@bufbuild/protobuf";
import {createSlice, type PayloadAction} from "@reduxjs/toolkit";

import type {BusinessDayConvention, Calendar, Compounding, DayCounter, Frequency} from "@/gen/quantlib/v1/conventions_pb";
import type {AnalyticParameters_Approximation, Engine_Method, FdParameters_Explicit_Scheme, FdParameters_Preset, LatticeParameters_Tree} from "@/gen/quantlib/v2/engine_pb";
import {ImpliedVolatilitySchema, type PriceRequest, PriceRequestSchema} from "@/gen/quantlib/v2/envelope_pb";
import {
    type Asian_Averaging,
    type Barrier_Type,
    type Basket_Kind,
    type DoubleBarrier_Type,
    type Exercise_Type,
    type Leg_Kind,
    type Option,
    Payoff_OptionType,
    type Schedule_DateGeneration,
    type Swap,
    type Underlying_Process
} from "@/gen/quantlib/v2/instrument_pb";
import type {BootstrappedCurve_Traits, Flag, Index_Family, Interpolator, MarketObject, Pillar_Kind, Quote_Unit} from "@/gen/quantlib/v2/market_pb";
import type {ResultKind} from "@/gen/quantlib/v2/results_pb";
import {HANDLERS_EVALUATION_DATE, seedMarket, seedTrade} from "@/market/handlersSession";
import {asCorrelation, asQuote, asVolatility, asYieldCurve, type AuthorableKind, newBootstrapCurve, newConstantVol, newCorrelation, newFixings, newFlatCurve, newIndex, newQuote} from "@/market/model";
import {SWAP_EVALUATION_DATE, swapExampleMarket, swapExampleTrade} from "@/market/swapExample";
import type {PayoffCase, StyleCase} from "@/protocol/capabilities";

import type {DecodedWorkbook} from "./workbookCodec";

/** The document the client owns.
 *
 *  A session outlives its socket by a grace window and no longer (DESIGN
 *  §9.4), so the workbook — not the backend — is the source of truth for the
 *  market. A reconnect resumes the session when it can and replays this when
 *  it cannot, which is the path that has to keep working: it is the only one
 *  that does not depend on the service remembering anything.
 *
 *  `structureRevision` is the whole two-speed edit model in one number. Quote
 *  writes leave it alone because UpdateMarket can carry them to a live graph;
 *  anything that changes graph *structure* bumps it, and the session is stale
 *  until it is rebuilt. Nothing rebuilds silently.
 */
export interface WorkbookState {
    label: string;
    evaluationDate: string;
    market: MarketObject[];
    trade: PriceRequest;
    /** Trades set aside beside the live one, priced together in a single frame.
     *
     *  They share this workbook's market by definition — a batch is one graph —
     *  which is what makes a book worth having here rather than as N tabs. */
    book: PriceRequest[];
    structureRevision: number;
    selectedId: string | null;
}

const initialState: WorkbookState = {
    label: "HANDLERS.md session",
    evaluationDate: HANDLERS_EVALUATION_DATE,
    market: seedMarket(),
    trade: seedTrade(),
    book: [],
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

/** A, B, C… — the correlation matrix indexes on these, so they have to be
 *  distinct and they may as well be short. */
function nextLabel(taken: (string | undefined)[]): string {
    for (let i = 0; i < 26; i++) {
        const label = String.fromCharCode(65 + i);
        if (!taken.includes(label)) return label;
    }
    return `U${taken.length + 1}`;
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
                            : kind === "correlation"
                              ? newCorrelation(uniqueId(state, "CORR"))
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
        /** The underlying, by position. Only a basket has more than one, and
         *  it indexes the correlation matrix on `label` rather than on
         *  position — so the index here addresses the control, and the label
         *  addresses the market. */
        underlyingRefSet(state, action: PayloadAction<{field: "spotQuoteId" | "discountCurveId" | "dividendCurveId" | "volatilityId"; value: string; index?: number}>) {
            const underlying = option(state)?.underlyings[action.payload.index ?? 0];
            if (underlying) underlying[action.payload.field] = action.payload.value;
        },
        processSet(state, action: PayloadAction<Underlying_Process | {process: Underlying_Process; index: number}>) {
            const payload = typeof action.payload === "number" ? {process: action.payload, index: 0} : action.payload;
            const underlying = option(state)?.underlyings[payload.index];
            if (underlying) underlying.process = payload.process;
        },
        underlyingLabelSet(state, action: PayloadAction<{index: number; value: string}>) {
            const underlying = option(state)?.underlyings[action.payload.index];
            if (underlying) underlying.label = action.payload.value;
        },
        underlyingAdded(state) {
            const target = option(state);
            if (!target) return;
            const first = target.underlyings[0];
            target.underlyings.push({
                $typeName: "quantlib.v2.Underlying",
                label: nextLabel(target.underlyings.map(u => u.label)),
                spotQuoteId: "",
                discountCurveId: first?.discountCurveId ?? "",
                dividendCurveId: "",
                volatilityId: "",
                process: first?.process ?? 0
            });
            if (target.underlyings.length === 2 && !target.underlyings[0]!.label) {
                target.underlyings[0]!.label = "A";
            }
        },
        underlyingRemoved(state, action: PayloadAction<number>) {
            const target = option(state);
            if (!target || target.underlyings.length <= 1) return;
            target.underlyings.splice(action.payload, 1);
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
        /** The price to invert, and the search to invert it in. Its own block
         *  because an implied volatility is a question the request has to carry
         *  an answer into: everything else here is read off the market. */
        impliedVolatilitySet(state, action: PayloadAction<{field: "targetPrice" | "accuracy" | "minVolatility" | "maxVolatility"; value: number}>) {
            const block = (state.trade.impliedVolatility ??= create(ImpliedVolatilitySchema, {}));
            block[action.payload.field] = action.payload.value;
        },
        impliedVolatilityMaxEvaluationsSet(state, action: PayloadAction<number>) {
            const block = (state.trade.impliedVolatility ??= create(ImpliedVolatilitySchema, {}));
            block.maxEvaluations = action.payload;
        },
        /** Whatever the engine published in its own additionalResults map. Off by
         *  default because the contents vary by engine; on, it is how a panel
         *  shows the working behind a price. */
        /** Cash-flow instruments only; the service refuses it on an option. */
        includeCashflowsSet(state, action: PayloadAction<boolean>) {
            state.trade.includeCashflows = action.payload;
        },
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
                case "compound":
                    // Only the option written on. The mother is the trade's own
                    // payoff and exercise, where every other style takes them —
                    // Compound.mother_payoff and .mother_exercise are the same
                    // two fields a second time and the backend refuses them.
                    target.style = {
                        case: "compound",
                        value: {
                            $typeName: "quantlib.v2.Compound",
                            daughterPayoff: {$typeName: "quantlib.v2.Payoff", type: 0, kind: {case: "plain", value: {$typeName: "quantlib.v2.PlainVanillaPayoff", strike: 0}}},
                            daughterExercise: {$typeName: "quantlib.v2.Exercise", type: 0, dates: [], payoffAtExpiry: 0}
                        }
                    };
                    break;
                case "basket":
                    // The only style with more than one underlying, and the
                    // only one that names a correlation matrix. A second asset
                    // is added here rather than left to the user, because a
                    // basket with one is not a basket.
                    target.style = {case: "basket", value: {$typeName: "quantlib.v2.Basket", kind: 0, correlationId: "", weights: []}};
                    if (target.underlyings.length === 1) {
                        const first = target.underlyings[0]!;
                        if (!first.label) first.label = "A";
                        target.underlyings.push({
                            $typeName: "quantlib.v2.Underlying",
                            label: "B",
                            spotQuoteId: "",
                            discountCurveId: first.discountCurveId,
                            dividendCurveId: "",
                            volatilityId: "",
                            process: first.process
                        });
                    }
                    break;
                case "cliquet":
                    // Only the reset dates and the performance flag. The four
                    // cap and floor fields stay at zero because they reach no
                    // engine at all — CliquetOption::setupArguments never
                    // copies them — and the backend refuses any that is set.
                    target.style = {case: "cliquet", value: {$typeName: "quantlib.v2.Cliquet", resetDates: [], localCap: 0, localFloor: 0, globalCap: 0, globalFloor: 0, performance: 0}};
                    break;
                case "chooser":
                    // Only the choice date, and the put leg when the two sides
                    // differ. The strike and the (call) expiry are the trade's
                    // own payoff and exercise — Chooser.call_strike and
                    // .call_expiry are those fields a second time and the
                    // backend refuses them.
                    //
                    // The option type goes with them: a chooser has no side
                    // until the choice date, and both instruments overwrite the
                    // one they are given.
                    target.style = {case: "chooser", value: {$typeName: "quantlib.v2.Chooser", callStrike: 0, putStrike: 0}};
                    if (target.payoff) target.payoff.type = Payoff_OptionType.UNSPECIFIED;
                    break;
                default:
                    break;
            }
            // Leaving a chooser: every other arm requires a side, and an unset
            // one is UNSPECIFIED_ENUM rather than a default nobody chose.
            if (action.payload !== "chooser" && target.payoff?.type === Payoff_OptionType.UNSPECIFIED) {
                target.payoff.type = Payoff_OptionType.CALL;
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
        /** The daughter: the option a compound is written on. Its payoff arm is
         *  fixed — the engine casts both back to a PlainVanillaPayoff — so there
         *  is a strike rather than a payoff kind. */
        compoundDaughterTypeSet(state, action: PayloadAction<Payoff_OptionType>) {
            const style = option(state)?.style;
            if (style?.case === "compound" && style.value.daughterPayoff) style.value.daughterPayoff.type = action.payload;
        },
        compoundDaughterStrikeSet(state, action: PayloadAction<number>) {
            const style = option(state)?.style;
            if (style?.case !== "compound") return;
            const kind = style.value.daughterPayoff?.kind;
            if (kind?.case === "plain") kind.value.strike = action.payload;
        },
        compoundDaughterExerciseTypeSet(state, action: PayloadAction<Exercise_Type>) {
            const style = option(state)?.style;
            if (style?.case === "compound" && style.value.daughterExercise) style.value.daughterExercise.type = action.payload;
        },
        compoundDaughterExpirySet(state, action: PayloadAction<string>) {
            const style = option(state)?.style;
            if (style?.case !== "compound" || !style.value.daughterExercise) return;
            style.value.daughterExercise.dates = [{$typeName: "quantlib.v1.Date", form: {case: "iso", value: action.payload}}];
        },

        /** The basket. `kind` picks the payoff wrapper, and with it the
         *  engine: a minimum or a maximum is Stulz, a spread is Kirk, an
         *  average has no closed form at all. */
        basketKindSet(state, action: PayloadAction<Basket_Kind>) {
            const style = option(state)?.style;
            if (style?.case !== "basket") return;
            style.value.kind = action.payload;
            // Weights are read by AverageBasketPayoff and by nothing else, so
            // they are cleared rather than carried into a kind that would have
            // them refused.
            if (action.payload !== 4) style.value.weights = [];
        },
        basketCorrelationSet(state, action: PayloadAction<string>) {
            const style = option(state)?.style;
            if (style?.case === "basket") style.value.correlationId = action.payload;
        },
        basketWeightsSet(state, action: PayloadAction<number[]>) {
            const style = option(state)?.style;
            if (style?.case === "basket") style.value.weights = action.payload;
        },

        // ---- the correlation matrix ------------------------------------------
        /** One entry, and its mirror: a correlation matrix is symmetric, so
         *  writing [i][j] without [j][i] would author one the service refuses. */
        correlationEntrySet(state, action: PayloadAction<{id: string; row: number; column: number; value: number}>) {
            const {id, row, column, value} = action.payload;
            const object = state.market.find(entry => entry.id === id);
            const matrix = object ? asCorrelation(object) : null;
            if (!matrix) return;
            const n = matrix.labels.length;
            for (const [i, j] of [
                [row, column],
                [column, row]
            ]) {
                const entry = matrix.values[i! * n + j!];
                if (entry) entry.source = {case: "fixed", value};
            }
        },
        /** Make a cell live without choosing which quote. Picking the first
         *  one in the market would be a default nobody chose, and a
         *  correlation pointed at a spot is not obviously wrong on screen. */
        correlationEntryLive(state, action: PayloadAction<{id: string; row: number; column: number}>) {
            const {id, row, column} = action.payload;
            const object = state.market.find(entry => entry.id === id);
            const matrix = object ? asCorrelation(object) : null;
            if (!matrix) return;
            const n = matrix.labels.length;
            for (const [i, j] of [
                [row, column],
                [column, row]
            ]) {
                const entry = matrix.values[i! * n + j!];
                if (entry) entry.source = {case: "quoteId", value: ""};
            }
            state.structureRevision += 1;
        },
        correlationEntryQuoteSet(state, action: PayloadAction<{id: string; row: number; column: number; quoteId: string}>) {
            const {id, row, column, quoteId} = action.payload;
            const object = state.market.find(entry => entry.id === id);
            const matrix = object ? asCorrelation(object) : null;
            if (!matrix) return;
            const n = matrix.labels.length;
            for (const [i, j] of [
                [row, column],
                [column, row]
            ]) {
                const entry = matrix.values[i! * n + j!];
                if (entry) entry.source = quoteId ? {case: "quoteId", value: quoteId} : {case: "fixed", value: 0};
            }
            state.structureRevision += 1;
        },
        /** Resizing keeps the entries whose two labels both survive, because
         *  re-entering a correlation you already typed is how a grid gets
         *  filled with zeros nobody meant. */
        correlationLabelsSet(state, action: PayloadAction<{id: string; labels: string[]}>) {
            const {id, labels} = action.payload;
            const object = state.market.find(entry => entry.id === id);
            const matrix = object ? asCorrelation(object) : null;
            if (!matrix || !object) return;
            const previous = matrix.labels;
            const n = labels.length;
            const values = [];
            for (let i = 0; i < n; i++) {
                for (let j = 0; j < n; j++) {
                    const wasI = previous.indexOf(labels[i]!);
                    const wasJ = previous.indexOf(labels[j]!);
                    const kept = wasI >= 0 && wasJ >= 0 ? matrix.values[wasI * previous.length + wasJ] : undefined;
                    values.push(i === j ? {$typeName: "quantlib.v2.Number" as const, source: {case: "fixed" as const, value: 1}} : (kept ?? {$typeName: "quantlib.v2.Number" as const, source: {case: "fixed" as const, value: 0}}));
                }
            }
            object.kind = {case: "correlation", value: {$typeName: "quantlib.v2.CorrelationMatrix", labels, values}};
            state.structureRevision += 1;
        },

        /** The cliquet. Reset dates in order and distinct, each before the
         *  expiry; `performance` picks the engine rather than scaling the
         *  price, so it is a Flag with no default. */
        cliquetResetDatesSet(state, action: PayloadAction<string[]>) {
            const style = option(state)?.style;
            if (style?.case !== "cliquet") return;
            style.value.resetDates = action.payload.map(iso => ({
                $typeName: "quantlib.v1.Date" as const,
                form: {case: "iso" as const, value: iso}
            }));
        },
        cliquetPerformanceSet(state, action: PayloadAction<Flag>) {
            const style = option(state)?.style;
            if (style?.case === "cliquet") style.value.performance = action.payload;
        },

        /** The chooser. `choiceDate` is the whole of the simple one; a put leg
         *  beside it is what makes it the complex one, so clearing the expiry
         *  clears the strike with it rather than leaving a field the backend
         *  would refuse on its own. */
        chooserChoiceDateSet(state, action: PayloadAction<string>) {
            const style = option(state)?.style;
            if (style?.case !== "chooser") return;
            style.value.choiceDate = {$typeName: "quantlib.v1.Date", form: {case: "iso", value: action.payload}};
        },
        chooserPutLegToggled(state, action: PayloadAction<boolean>) {
            const style = option(state)?.style;
            if (style?.case !== "chooser") return;
            if (action.payload) {
                style.value.putExpiry = {$typeName: "quantlib.v1.Date", form: {case: "iso", value: ""}};
            } else {
                style.value.putExpiry = undefined;
                style.value.putStrike = 0;
            }
        },
        chooserPutStrikeSet(state, action: PayloadAction<number>) {
            const style = option(state)?.style;
            if (style?.case === "chooser") style.value.putStrike = action.payload;
        },
        chooserPutExpirySet(state, action: PayloadAction<string>) {
            const style = option(state)?.style;
            if (style?.case !== "chooser") return;
            style.value.putExpiry = {$typeName: "quantlib.v1.Date", form: {case: "iso", value: action.payload}};
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
        /** Batching is what produces Progress frames and what makes a cancel
         *  possible — and it changes the answer, because batches draw from the
         *  RNG stream differently from one run of the same total. */
        mcProgressEverySet(state, action: PayloadAction<bigint>) {
            const parameters = mcParameters(state);
            if (parameters) parameters.progressEveryPaths = action.payload;
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

        /** The trade as it stands, set aside. Copied rather than referenced:
         *  the builder goes on editing the live one afterwards. */
        bookAdded(state) {
            state.book.push(clone(PriceRequestSchema, state.trade as PriceRequest) as never);
        },
        bookRemoved(state, action: PayloadAction<number>) {
            state.book.splice(action.payload, 1);
        },
        /** Back into the builder, where it can be changed and priced alone. */
        bookRecalled(state, action: PayloadAction<number>) {
            const entry = state.book[action.payload];
            if (entry) state.trade = entry;
        },
        bookCleared(state) {
            state.book = [];
        },
        selected(state, action: PayloadAction<string | null>) {
            state.selectedId = action.payload;
        },
        labelSet(state, action: PayloadAction<string>) {
            state.label = action.payload;
        },
        /** Replaces everything the document holds. Structural by definition. */
        workbookLoaded(state, action: PayloadAction<DecodedWorkbook>) {
            state.label = action.payload.label;
            state.evaluationDate = action.payload.evaluationDate;
            state.market = action.payload.market;
            state.trade = action.payload.trade;
            state.book = action.payload.book;
            state.selectedId = null;
            state.structureRevision += 1;
        },
        /** The worked swap: an index, a curve bootstrapped from pillars that
         *  name it, the fixing that has already happened, and two legs. */
        swapExampleLoaded(state) {
            state.label = "Five-year fixed against Euribor 6M";
            state.evaluationDate = SWAP_EVALUATION_DATE;
            state.market = swapExampleMarket();
            state.trade = swapExampleTrade();
            state.book = [];
            state.selectedId = null;
            state.structureRevision += 1;
        },
        /** Replaced wholesale when a tab is switched in. */
        restored(_state, action: PayloadAction<WorkbookState>) {
            return action.payload;
        },
        reset() {
            return {...initialState, market: seedMarket(), trade: seedTrade(), book: []};
        }
    }
});

export const workbookActions = workbookSlice.actions;
