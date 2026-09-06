import {AnalyticParameters_Approximation, Engine_Method, FdParameters_Explicit_Scheme, LatticeParameters_Tree} from "@/gen/quantlib/v2/engine_pb";
import {Asian_Averaging, Barrier_Type, DoubleBarrier_Type, Exercise_Type, Leg_Kind, Underlying_Process} from "@/gen/quantlib/v2/instrument_pb";
import {BootstrappedCurve_Traits, Index_Family, Interpolator, Pillar_Kind} from "@/gen/quantlib/v2/market_pb";
import {ResultKind} from "@/gen/quantlib/v2/results_pb";

/** What this build prices, as data.
 *
 *  HANDLERS.md is the list; this is that list in a form the forms can gate on,
 *  read against src/session/session.cpp rather than against the table, because
 *  the table is coarser than the dispatch. A user should not be able to author
 *  a request the backend will reject as UNSUPPORTED.
 *
 *  The two ways a choice can be closed are kept apart on purpose:
 *
 *    'unsupported' — the backend will not price it, and says so.
 *    'pending'     — the backend prices it and this frontend has not built the
 *                    controls yet. Saying "unsupported" there would be a lie
 *                    about the service.
 *
 *  These are the combination rules, and they stay here. What the service
 *  itself advertises — the sets of styles, methods, trees and result kinds it
 *  implements — arrives from the Hello handshake and is diffed against these
 *  tables by protocol/drift.ts, so a list going stale is a failing test rather
 *  than a support question.
 */
export type Availability = "supported" | "unsupported" | "pending";

export interface Choice<T> {
    value: T;
    label: string;
    availability: Availability;
    /** Shown on the disabled control. Every closed door explains itself. */
    reason?: string;
}

export const isOpen = <T>(choice: Choice<T>): boolean => choice.availability === "supported";

// ---------------------------------------------------------------------------
// Styles
// ---------------------------------------------------------------------------

export type StyleCase = "vanilla" | "barrier" | "doubleBarrier" | "asian" | "lookback" | "forwardStart" | "cliquet" | "digital" | "compound" | "chooser" | "basket" | "spread";

export const STYLES: Choice<StyleCase>[] = [
    {value: "vanilla", label: "vanilla", availability: "supported"},
    {value: "barrier", label: "barrier", availability: "supported"},
    {value: "doubleBarrier", label: "double barrier", availability: "supported"},
    {value: "asian", label: "asian", availability: "supported"},
    {value: "lookback", label: "lookback", availability: "supported"},
    {value: "forwardStart", label: "forward start", availability: "supported"},
    {value: "cliquet", label: "cliquet", availability: "unsupported", reason: "Not built: the schema expresses it, this build does not price it."},
    {
        value: "digital",
        label: "digital (knock-in/out)",
        availability: "unsupported",
        reason: "Not a style: a knock digital is a barrier carrying a binary payoff, and prices as one. Choose barrier, then cash-or-nothing or asset-or-nothing."
    },
    {value: "compound", label: "compound (option on option)", availability: "supported"},
    {value: "chooser", label: "chooser", availability: "unsupported", reason: "Not built."},
    {value: "basket", label: "basket", availability: "unsupported", reason: "Not built."},
    {value: "spread", label: "spread", availability: "unsupported", reason: "Not built."}
];

// ---------------------------------------------------------------------------
// Payoffs
// ---------------------------------------------------------------------------

export type PayoffCase = "plain" | "percentageStrike" | "assetOrNothing" | "cashOrNothing" | "gap" | "superFund" | "superShare" | "floating";

export const PAYOFFS: Choice<PayoffCase>[] = [
    {value: "plain", label: "plain vanilla", availability: "supported"},
    {value: "percentageStrike", label: "percentage strike", availability: "supported"},
    {value: "assetOrNothing", label: "asset or nothing", availability: "supported"},
    {value: "cashOrNothing", label: "cash or nothing", availability: "supported"},
    {value: "gap", label: "gap", availability: "supported"},
    {value: "superFund", label: "super fund", availability: "supported"},
    {value: "superShare", label: "super share", availability: "supported"},
    {value: "floating", label: "floating strike", availability: "unsupported", reason: "Valid on a lookback only — it is struck at the realised extremum."}
];

/** A binary payoff on a non-European exercise is a one-touch, which has its own
 *  analytic engine and therefore needs no approximation. */
export function isDigitalPayoff(payoff: PayoffCase | undefined): boolean {
    return payoff === "cashOrNothing" || payoff === "assetOrNothing";
}

// ---------------------------------------------------------------------------
// Exercises
// ---------------------------------------------------------------------------

export const EXERCISES: Choice<Exercise_Type>[] = [
    {value: Exercise_Type.EUROPEAN, label: "European", availability: "supported"},
    {value: Exercise_Type.AMERICAN, label: "American", availability: "supported"},
    {value: Exercise_Type.BERMUDAN, label: "Bermudan", availability: "supported"}
];

/** Which exercises a style can carry.
 *
 *  Only vanilla and barrier reach anything but European, and quanto closes
 *  even those: QuantoEngine builds its inner engine from a process alone and
 *  every quanto path here is a European engine.
 */
export function exercisesFor(style: StyleCase, isQuanto: boolean, payoff?: PayoffCase): Choice<Exercise_Type>[] {
    const only = (open: Exercise_Type, reason: string): Choice<Exercise_Type>[] => EXERCISES.map(choice => (choice.value === open ? choice : {...choice, availability: "unsupported", reason}));
    const europeanOnly = (reason: string) => only(Exercise_Type.EUROPEAN, reason);

    if (isQuanto) return europeanOnly("Quanto options are European only: QuantoEngine wraps an engine built from a process alone.");

    switch (style) {
        case "barrier":
            // A binary payoff on a barrier is a knock digital, and
            // AnalyticBinaryBarrierEngine casts the exercise to an American one
            // (analyticbinarybarrierengine.cpp:65).
            if (isDigitalPayoff(payoff)) return only(Exercise_Type.AMERICAN, "A knock digital is written on an American exercise: AnalyticBinaryBarrierEngine casts to one.");
            return EXERCISES;
        case "vanilla":
            return EXERCISES;
        case "doubleBarrier":
            return europeanOnly("AnalyticDoubleBarrierEngine is European only.");
        case "asian":
            return europeanOnly("The Asian engines here are European only.");
        case "lookback":
            return europeanOnly("The continuous lookback engines are European only.");
        case "compound":
            return europeanOnly("AnalyticCompoundOptionEngine is European only, on both the compound and the option it is written on.");
        default:
            return europeanOnly("European only.");
    }
}

/** Which payoffs a style takes.
 *
 *  Two styles are opinionated: a forward start is struck as a fraction of the
 *  spot at reset, and a floating-strike payoff is the lookback instrument
 *  rather than a modifier on it.
 */
export function payoffsFor(style: StyleCase): Choice<PayoffCase>[] {
    return PAYOFFS.map(choice => {
        if (style === "forwardStart") {
            return choice.value === "percentageStrike" ? choice : {...choice, availability: "unsupported" as const, reason: "A forward start is struck as a fraction of the spot at reset, so it takes a percentage strike."};
        }
        if (style === "compound") {
            // The engine casts both payoffs back to a PlainVanillaPayoff and fails
            // with "non-plain payoff given" (analyticcompoundoptionengine.cpp:205,213).
            return choice.value === "plain" ? choice : {...choice, availability: "unsupported" as const, reason: "A compound option takes a plain payoff on each leg."};
        }
        if (style === "lookback") {
            // Floating is the floating-strike lookback; the striked payoffs give the
            // fixed-strike one.
            return choice.value === "floating" ? {...choice, availability: "supported" as const, reason: undefined} : choice;
        }
        return choice;
    });
}

/** Whether quanto composes over a style, and what happens if it does not. */
export function quantoSupport(style: StyleCase, payoff?: PayoffCase): Choice<boolean> {
    // The quanto barrier path wraps AnalyticBarrierEngine, which wants a plain
    // payoff; there is no quanto binary barrier engine to wrap instead.
    if (style === "barrier" && isDigitalPayoff(payoff)) {
        return {value: false, label: "quanto", availability: "unsupported", reason: "There is no quanto binary barrier engine in QuantLib, and a knock digital is a barrier with a binary payoff."};
    }

    switch (style) {
        case "vanilla":
        case "barrier":
        case "doubleBarrier":
        case "forwardStart":
            return {value: true, label: "quanto", availability: "supported"};
        case "asian":
            return {value: false, label: "quanto", availability: "unsupported", reason: "There is no quanto Asian engine in QuantLib."};
        case "compound":
            return {value: false, label: "quanto", availability: "unsupported", reason: "There is no quanto compound engine in QuantLib, and the backend refuses it by name."};
        case "lookback":
            // This was once priced as a plain lookback with no error at all: the
            // lookback arm built its engine on graph.process and never consulted
            // graph.quanto. The backend checks now and refuses it by name, so the
            // gate here saves a round trip rather than preventing a wrong number.
            return {value: false, label: "quanto", availability: "unsupported", reason: "There is no quanto lookback engine in QuantLib, and the backend refuses it by name."};
        default:
            return {value: false, label: "quanto", availability: "unsupported", reason: "Not built."};
    }
}

export const BARRIER_TYPES: Choice<Barrier_Type>[] = [
    {value: Barrier_Type.DOWN_IN, label: "down and in", availability: "supported"},
    {value: Barrier_Type.UP_IN, label: "up and in", availability: "supported"},
    {value: Barrier_Type.DOWN_OUT, label: "down and out", availability: "supported"},
    {value: Barrier_Type.UP_OUT, label: "up and out", availability: "supported"}
];

export const DOUBLE_BARRIER_TYPES: Choice<DoubleBarrier_Type>[] = [
    {value: DoubleBarrier_Type.KNOCK_IN, label: "knock in", availability: "supported"},
    {value: DoubleBarrier_Type.KNOCK_OUT, label: "knock out", availability: "supported"},
    // The registry maps them and the engine refuses them: analyticdoublebarrier-
    // engine.cpp:67 is QL_FAIL("unsupported double-barrier type"), which comes
    // back as CALCULATION_FAILED with no field to blame.
    {value: DoubleBarrier_Type.KIKO, label: "KIKO", availability: "unsupported", reason: "AnalyticDoubleBarrierEngine prices knock-in and knock-out only."},
    {value: DoubleBarrier_Type.KOKI, label: "KOKI", availability: "unsupported", reason: "AnalyticDoubleBarrierEngine prices knock-in and knock-out only."}
];

export const AVERAGINGS: Choice<Asian_Averaging>[] = [
    {value: Asian_Averaging.GEOMETRIC, label: "geometric", availability: "supported"},
    {value: Asian_Averaging.ARITHMETIC, label: "arithmetic", availability: "supported"}
];

/** payoff_at_expiry is read on American and Bermudan only, and there it must be
 *  set explicitly: it settles the payoff at expiry rather than on exercise,
 *  which changes the price rather than the wording. */
export function readsPayoffAtExpiry(exercise: Exercise_Type): boolean {
    return exercise === Exercise_Type.AMERICAN || exercise === Exercise_Type.BERMUDAN;
}

// ---------------------------------------------------------------------------
// Engines, for a vanilla option
// ---------------------------------------------------------------------------

export interface EngineContext {
    style: StyleCase;
    exercise: Exercise_Type;
    payoff: PayoffCase | undefined;
    quanto: boolean;
    /** Asian only. */
    averaging: Asian_Averaging;
    /** Asian only: fixing dates make it discretely averaged. */
    discreteAsian: boolean;
}

const ALL_METHODS: [Engine_Method, string][] = [
    [Engine_Method.ANALYTIC, "analytic"],
    [Engine_Method.INTEGRAL, "integral"],
    [Engine_Method.LATTICE, "lattice"],
    [Engine_Method.FINITE_DIFFERENCE, "finite difference"],
    [Engine_Method.MONTE_CARLO, "Monte Carlo"],
    [Engine_Method.FOURIER, "Fourier"],
    [Engine_Method.DISCOUNTING, "discounting"]
];

/** Which engines this build will price the given trade with.
 *
 *  Read from the dispatch in src/session/session.cpp, style by style. The
 *  table in HANDLERS.md is a summary of this and is coarser in several places
 *  — an American barrier, a continuous Asian and a Bermudan analytic all
 *  behave differently from what the row suggests.
 */
export function engineMethodsFor(context: EngineContext): Choice<Engine_Method>[] {
    const isEuropean = context.exercise === Exercise_Type.EUROPEAN;
    const closed = new Map<Engine_Method, string>();

    const only = (allowed: Engine_Method[], reason: string) => {
        for (const [method] of ALL_METHODS) if (!allowed.includes(method)) closed.set(method, reason);
    };

    switch (context.style) {
        case "vanilla":
            if (context.quanto) {
                only([Engine_Method.ANALYTIC, Engine_Method.FINITE_DIFFERENCE], "A quanto vanilla option takes analytic or finite difference.");
            } else {
                only([Engine_Method.ANALYTIC, Engine_Method.INTEGRAL, Engine_Method.LATTICE, Engine_Method.FINITE_DIFFERENCE, Engine_Method.MONTE_CARLO], "Not wired up for vanilla options.");
                if (!isEuropean) closed.set(Engine_Method.INTEGRAL, "The integral engine is European only.");
                if (!isEuropean) closed.set(Engine_Method.MONTE_CARLO, "MCEuropeanEngine is European only.");
                if (context.exercise === Exercise_Type.BERMUDAN) {
                    // Both analytic branches for a vanilla want a European or an
                    // American exercise: baroneadesiwhaleyengine.cpp:142,
                    // analyticdigitalamericanengine.cpp:40.
                    closed.set(Engine_Method.ANALYTIC, "QuantLib's analytic engines here take a European or an American exercise. A Bermudan prices on a lattice or FD.");
                }
            }
            break;

        case "barrier":
            if (context.quanto) {
                only([Engine_Method.ANALYTIC, Engine_Method.FINITE_DIFFERENCE], "A quanto barrier option takes analytic or finite difference.");
            } else if (isDigitalPayoff(context.payoff)) {
                // The knock digital. One engine reads a binary payoff off a
                // barrier and it is the closed form; the lattice, FD and MC
                // barrier engines would price a different trade.
                only([Engine_Method.ANALYTIC], "A binary payoff on a barrier is a knock digital, and AnalyticBinaryBarrierEngine is the only engine here that reads one.");
            } else {
                only([Engine_Method.ANALYTIC, Engine_Method.LATTICE, Engine_Method.FINITE_DIFFERENCE, Engine_Method.MONTE_CARLO], "Not wired up for barrier options.");
                if (!isEuropean) {
                    closed.set(Engine_Method.ANALYTIC, "AnalyticBarrierEngine is European only; an American barrier takes a lattice or FD.");
                } else if (context.payoff && context.payoff !== "plain") {
                    // "non-plain payoff given" (analyticbarrierengine.cpp:40).
                    closed.set(Engine_Method.ANALYTIC, "AnalyticBarrierEngine takes a plain payoff. A binary one is a knock digital; the rest price on a lattice, FD or Monte Carlo.");
                }
            }
            break;

        case "doubleBarrier":
            only([Engine_Method.ANALYTIC], "A double-barrier option takes analytic: QuantLib's only FD double-barrier engine is Heston, which takes a calibrated model rather than a process.");
            break;

        case "forwardStart":
            only([Engine_Method.ANALYTIC], "Forward-start options take analytic: there is no FD forward-start engine.");
            break;

        case "lookback":
            only([Engine_Method.ANALYTIC], "Lookback options take analytic.");
            break;

        case "compound":
            only([Engine_Method.ANALYTIC], "Compound options take analytic: QuantLib has one compound engine and it is the Wystup closed form.");
            break;

        case "asian":
            if (!context.discreteAsian) {
                only([Engine_Method.ANALYTIC], "A continuously averaged Asian option takes analytic.");
            } else if (context.averaging === Asian_Averaging.ARITHMETIC) {
                only([Engine_Method.MONTE_CARLO], "An arithmetic average takes Monte Carlo: the discrete Asian closed form is geometric only.");
            } else {
                only([Engine_Method.ANALYTIC], "A geometric discrete average takes the analytic engine; Monte Carlo here averages arithmetically.");
            }
            break;

        default:
            only([], "This option style is in the schema but not implemented.");
            break;
    }

    return ALL_METHODS.map(([value, label]) => {
        const reason = closed.get(value);
        return reason ? {value, label, availability: "unsupported" as const, reason} : {value, label, availability: "supported" as const};
    });
}

/** An American analytic price must name one of the three: they disagree in the
 *  third decimal, so the client chooses rather than inheriting a default. */
export function needsApproximation(exercise: Exercise_Type, method: Engine_Method, payoff: PayoffCase | undefined, style: StyleCase = "vanilla"): boolean {
    return style === "vanilla" && method === Engine_Method.ANALYTIC && exercise === Exercise_Type.AMERICAN && !isDigitalPayoff(payoff);
}

export const APPROXIMATIONS: Choice<AnalyticParameters_Approximation>[] = [
    {value: AnalyticParameters_Approximation.BARONE_ADESI_WHALEY, label: "Barone-Adesi / Whaley", availability: "supported"},
    {value: AnalyticParameters_Approximation.BJERKSUND_STENSLAND, label: "Bjerksund / Stensland", availability: "supported"},
    {value: AnalyticParameters_Approximation.JU_QUADRATIC, label: "Ju quadratic", availability: "supported"},
    {value: AnalyticParameters_Approximation.INTEGRAL, label: "integral", availability: "unsupported", reason: "Not reachable: the integral engine is selected by engine.method, not here."}
];

/** The time-stepping schemes a custom grid may name. Five of the six build, and
 *  the scheme has no default: two schemes are two prices for one trade, so the
 *  service refuses an unset one rather than picking Douglas quietly. */
export const FD_SCHEMES: Choice<FdParameters_Explicit_Scheme>[] = [
    {value: FdParameters_Explicit_Scheme.DOUGLAS, label: "Douglas — QuantLib's default, second order", availability: "supported"},
    {value: FdParameters_Explicit_Scheme.CRANK_NICOLSON, label: "Crank-Nicolson — Douglas to within a bit here", availability: "supported"},
    {value: FdParameters_Explicit_Scheme.CRAIG_SNEYD, label: "Craig-Sneyd — exactly Douglas in one dimension", availability: "supported"},
    {value: FdParameters_Explicit_Scheme.HUNDSDORFER, label: "Hundsdorfer — differs in the seventh digit", availability: "supported"},
    {value: FdParameters_Explicit_Scheme.IMPLICIT_EULER, label: "implicit Euler — first order, unconditionally stable", availability: "supported"},
    {
        value: FdParameters_Explicit_Scheme.EXPLICIT_EULER,
        label: "explicit Euler",
        availability: "unsupported",
        reason: "Stable only while the time step is small against the square of the asset step, which depends on the grid QuantLib builds inside the engine. An unstable run answers with a number rather than an error, so the service refuses it. Implicit Euler is first order too, with no such condition."
    }
];

/** Seven trees compile for a vanilla. A barrier takes Cox-Ross-Rubinstein only,
 *  because that engine takes a second template argument for the
 *  discretisation and a full menu would be trees x discretisations. */
export function latticeTrees(style: StyleCase): Choice<LatticeParameters_Tree>[] {
    const all: [LatticeParameters_Tree, string][] = [
        [LatticeParameters_Tree.COX_ROSS_RUBINSTEIN, "Cox-Ross-Rubinstein"],
        [LatticeParameters_Tree.JARROW_RUDD, "Jarrow-Rudd"],
        [LatticeParameters_Tree.ADDITIVE_EQUIPROBABILITIES, "additive equiprobabilities"],
        [LatticeParameters_Tree.TRIGEORGIS, "Trigeorgis"],
        [LatticeParameters_Tree.TIAN, "Tian"],
        [LatticeParameters_Tree.LEISEN_REIMER, "Leisen-Reimer"],
        [LatticeParameters_Tree.JOSHI4, "Joshi4"]
    ];
    const isCrrOnly = style === "barrier";
    return all.map(([value, label]) => ({
        value,
        label,
        availability: !isCrrOnly || value === LatticeParameters_Tree.COX_ROSS_RUBINSTEIN ? "supported" : "unsupported",
        ...(isCrrOnly && value !== LatticeParameters_Tree.COX_ROSS_RUBINSTEIN ? {reason: "QuantLib's barrier lattice is Cox-Ross-Rubinstein only, with the Derman-Kani correction."} : {})
    }));
}

// ---------------------------------------------------------------------------
// Underlying
// ---------------------------------------------------------------------------

export const PROCESSES: Choice<Underlying_Process>[] = [
    {value: Underlying_Process.BLACK_SCHOLES_MERTON, label: "Black-Scholes-Merton", availability: "supported"},
    {value: Underlying_Process.BLACK_SCHOLES, label: "Black-Scholes (no dividend yield)", availability: "supported"},
    {value: Underlying_Process.BLACK, label: "Black (forward-driven)", availability: "supported"},
    {value: Underlying_Process.GARMAN_KOHLHAGEN, label: "Garman-Kohlhagen", availability: "unsupported", reason: "Not built."},
    {value: Underlying_Process.HESTON, label: "Heston", availability: "unsupported", reason: "Not built."},
    {value: Underlying_Process.BATES, label: "Bates", availability: "unsupported", reason: "Not built."},
    {value: Underlying_Process.LOCAL_VOL, label: "local volatility", availability: "unsupported", reason: "Not built."}
];

/** Which styles a volatility can be inverted out of.
 *
 *  Not a judgement about the maths: impliedVolatility() is declared on
 *  VanillaOption, BarrierOption and DoubleBarrierOption and on no base they
 *  share, so these three are the whole of it. Anywhere else the kind comes
 *  back named absent.
 */
export function canImplyVolatility(style: StyleCase | undefined): boolean {
    return style === "vanilla" || style === "barrier" || style === "doubleBarrier";
}

/** PROCESS_BLACK_SCHOLES rejects a dividend curve rather than ignoring it. */
export function rejectsDividendCurve(process: Underlying_Process): boolean {
    return process === Underlying_Process.BLACK_SCHOLES;
}

// ---------------------------------------------------------------------------
// Results
// ---------------------------------------------------------------------------

/** Sixteen of the enum are mapped. Asking for one an engine cannot supply is a
 *  named rejection, not a missing key — a frontend that asked for vega and got
 *  a map without it cannot tell that from a vega of zero. */
export const OPTION_RESULT_KINDS: Choice<ResultKind>[] = [
    {value: ResultKind.NPV, label: "NPV", availability: "supported"},
    {value: ResultKind.DELTA, label: "delta", availability: "supported"},
    {value: ResultKind.GAMMA, label: "gamma", availability: "supported"},
    {value: ResultKind.THETA, label: "theta", availability: "supported"},
    {value: ResultKind.VEGA, label: "vega", availability: "supported"},
    {value: ResultKind.RHO, label: "rho", availability: "supported"},
    {value: ResultKind.DIVIDEND_RHO, label: "dividend rho", availability: "supported"},
    {value: ResultKind.THETA_PER_DAY, label: "theta per day", availability: "supported"},
    {value: ResultKind.DELTA_FORWARD, label: "delta forward", availability: "supported"},
    {value: ResultKind.ELASTICITY, label: "elasticity", availability: "supported"},
    {value: ResultKind.STRIKE_SENSITIVITY, label: "strike sensitivity", availability: "supported"},
    {value: ResultKind.ITM_CASH_PROBABILITY, label: "ITM cash probability", availability: "supported"},
    {value: ResultKind.IMPLIED_VOLATILITY, label: "implied volatility", availability: "supported"},
    {value: ResultKind.QRHO, label: "quanto rho", availability: "unsupported", reason: "Quanto only; the quanto controls arrive in M4."},
    {value: ResultKind.QVEGA, label: "quanto vega", availability: "unsupported", reason: "Quanto only; the quanto controls arrive in M4."},
    {value: ResultKind.QLAMBDA, label: "quanto lambda", availability: "unsupported", reason: "Quanto only; the quanto controls arrive in M4."},
    {value: ResultKind.FAIR_RATE, label: "fair rate", availability: "unsupported", reason: "Cash-flow instruments only."}
];

/** The key each ResultKind arrives under.
 *
 *  PriceResult.results is keyed by the lower-camel name of the kind, sharing a
 *  namespace with the engine's own additionalResults on purpose — QuantLib's
 *  engines already use "delta" for delta. NPV is not in the map; it is a field.
 *
 *  A result an engine cannot supply comes back in PriceResult.unavailable_results
 *  rather than simply missing, so "asked for and not answered" is readable
 *  without comparing the request to the reply. The results grid still lists what
 *  was asked for and marks what did not come back, which covers a server that
 *  predates that field.
 */
export const RESULT_KEYS: Partial<Record<ResultKind, string>> = {
    [ResultKind.DELTA]: "delta",
    [ResultKind.GAMMA]: "gamma",
    [ResultKind.THETA]: "theta",
    [ResultKind.VEGA]: "vega",
    [ResultKind.RHO]: "rho",
    [ResultKind.DIVIDEND_RHO]: "dividendRho",
    [ResultKind.THETA_PER_DAY]: "thetaPerDay",
    [ResultKind.DELTA_FORWARD]: "deltaForward",
    [ResultKind.ELASTICITY]: "elasticity",
    [ResultKind.STRIKE_SENSITIVITY]: "strikeSensitivity",
    [ResultKind.ITM_CASH_PROBABILITY]: "itmCashProbability",
    [ResultKind.IMPLIED_VOLATILITY]: "impliedVolatility",
    [ResultKind.QRHO]: "qrho",
    [ResultKind.QVEGA]: "qvega",
    [ResultKind.QLAMBDA]: "qlambda",
    [ResultKind.FAIR_RATE]: "fairRate",
    [ResultKind.LEG_NPV]: "legNPV",
    [ResultKind.LEG_BPS]: "legBPS"
};

// ---------------------------------------------------------------------------
// Instruments
// ---------------------------------------------------------------------------

export type InstrumentCase = "option" | "swap" | "swaption" | "capFloor" | "bond" | "creditDefaultSwap" | "fra" | "fxForward" | "varianceSwap";

/** Two of the nine arms are dispatched. */
export const INSTRUMENTS: Choice<InstrumentCase>[] = [
    {value: "option", label: "option", availability: "supported"},
    {value: "swap", label: "swap", availability: "supported"},
    {value: "swaption", label: "swaption", availability: "unsupported", reason: "Not built."},
    {value: "capFloor", label: "cap / floor", availability: "unsupported", reason: "Not built."},
    {value: "bond", label: "bond", availability: "unsupported", reason: "Not built."},
    {value: "creditDefaultSwap", label: "credit default swap", availability: "unsupported", reason: "Not built."},
    {value: "fra", label: "FRA", availability: "unsupported", reason: "Not built."},
    {value: "fxForward", label: "FX forward", availability: "unsupported", reason: "Not built."},
    {value: "varianceSwap", label: "variance swap", availability: "unsupported", reason: "Not built."}
];

/** A swap takes METHOD_DISCOUNTING, and the backend checks: v1 always used
 *  DiscountingSwapEngine and never read the field, so a swap priced with an
 *  unset engine succeeded silently. */
export function swapEngineMethods(): Choice<Engine_Method>[] {
    return ALL_METHODS.map(([value, label]) => (value === Engine_Method.DISCOUNTING ? {value, label, availability: "supported" as const} : {value, label, availability: "unsupported" as const, reason: "A swap takes discounting."}));
}

/** Two of the eight leg kinds build. */
export const LEG_KINDS: Choice<Leg_Kind>[] = [
    {value: Leg_Kind.FIXED, label: "fixed", availability: "supported"},
    {value: Leg_Kind.IBOR, label: "Ibor (floating)", availability: "supported"},
    {value: Leg_Kind.OVERNIGHT, label: "overnight", availability: "unsupported", reason: "Not built: buildLeg dispatches fixed and Ibor only."},
    {value: Leg_Kind.CMS, label: "CMS", availability: "unsupported", reason: "Not built."},
    {value: Leg_Kind.ZERO_COUPON, label: "zero coupon", availability: "unsupported", reason: "Not built."},
    {value: Leg_Kind.INFLATION_ZERO, label: "inflation zero", availability: "unsupported", reason: "Not built."},
    {value: Leg_Kind.INFLATION_YOY, label: "inflation year-on-year", availability: "unsupported", reason: "Not built."}
];

/** A fair rate is computed for a two-leg swap with the fixed leg first and the
 *  floating leg second: the formula assumes that order and the backend refuses
 *  any other rather than returning a wrong number silently. */
export function canTakeFairRate(kinds: readonly Leg_Kind[]): boolean {
    return kinds.length === 2 && kinds[0] === Leg_Kind.FIXED && kinds[1] === Leg_Kind.IBOR;
}

/** What a swap can be asked for. The option greeks are absent rather than
 *  refused on this path, which is the same ambiguity RESULT_KEYS notes, so
 *  they are closed here instead of offered. */
export function swapResultKinds(kinds: readonly Leg_Kind[]): Choice<ResultKind>[] {
    const isFairRateAvailable = canTakeFairRate(kinds);
    return [
        {value: ResultKind.NPV, label: "NPV", availability: "supported"},
        {value: ResultKind.LEG_NPV, label: "leg NPV", availability: "supported"},
        {value: ResultKind.LEG_BPS, label: "leg BPS", availability: "supported"},
        {
            value: ResultKind.FAIR_RATE,
            label: "fair rate",
            availability: isFairRateAvailable ? "supported" : "unsupported",
            ...(isFairRateAvailable ? {} : {reason: "Needs exactly two legs, fixed first and Ibor second."})
        },
        {value: ResultKind.FAIR_SPREAD, label: "fair spread", availability: "unsupported", reason: "In the enum, not mapped by this build."},
        {value: ResultKind.BPS, label: "BPS", availability: "unsupported", reason: "In the enum, not mapped by this build."},
        {value: ResultKind.ACCRUED, label: "accrued", availability: "unsupported", reason: "In the enum, not mapped by this build."}
    ];
}

// ---------------------------------------------------------------------------
// Market objects a swap needs
// ---------------------------------------------------------------------------

/** Two of the six families build. `name` is required: the service builds the
 *  index from the conventions sent rather than looking it up in a table of
 *  hardcoded indices, because that table is what goes stale. */
export const INDEX_FAMILIES: Choice<Index_Family>[] = [
    {value: Index_Family.IBOR, label: "Ibor", availability: "supported"},
    {value: Index_Family.OVERNIGHT, label: "overnight", availability: "supported"},
    {value: Index_Family.SWAP, label: "swap", availability: "unsupported", reason: "Not built."},
    {value: Index_Family.INFLATION_ZERO, label: "inflation zero", availability: "unsupported", reason: "Not built."},
    {value: Index_Family.INFLATION_YOY, label: "inflation year-on-year", availability: "unsupported", reason: "Not built."}
];

/** OvernightIndex takes only a name, fixing days, calendar and day counter;
 *  the tenor, business-day convention and end-of-month flag are not read. */
export function indexReadsTenor(family: Index_Family): boolean {
    return family === Index_Family.IBOR;
}

/** Three pillar kinds build. */
export const PILLAR_KINDS: Choice<Pillar_Kind>[] = [
    {value: Pillar_Kind.DEPOSIT, label: "deposit", availability: "supported"},
    {value: Pillar_Kind.SWAP, label: "swap", availability: "supported"},
    {value: Pillar_Kind.OIS, label: "OIS", availability: "supported"},
    {value: Pillar_Kind.FRA, label: "FRA", availability: "unsupported", reason: "Not built."},
    {value: Pillar_Kind.FUTURE, label: "future", availability: "unsupported", reason: "Not built."},
    {value: Pillar_Kind.BASIS_SWAP, label: "basis swap", availability: "unsupported", reason: "Not built."}
];

/** A swap pillar names its own fixed-leg conventions; a deposit takes them
 *  from the index and an OIS from the curve's settlement days. */
export function pillarNeedsFixedConventions(kind: Pillar_Kind): boolean {
    return kind === Pillar_Kind.SWAP;
}

export const BOOTSTRAP_TRAITS: Choice<BootstrappedCurve_Traits>[] = [
    {value: BootstrappedCurve_Traits.DISCOUNT, label: "discount", availability: "supported"},
    {value: BootstrappedCurve_Traits.ZERO_YIELD, label: "zero yield", availability: "supported"},
    {value: BootstrappedCurve_Traits.FORWARD_RATE, label: "forward rate", availability: "supported"}
];

/** PiecewiseYieldCurve\<Traits, Interpolator\> is a template, so each pair is a
 *  distinct compiled type and the menu is the schema: three traits by three
 *  interpolators, nine instantiations. Growing it is a line of C++ and a
 *  recompile, not a schema change. */
export const BOOTSTRAP_INTERPOLATORS: Choice<Interpolator>[] = [
    {value: Interpolator.LINEAR, label: "linear", availability: "supported"},
    {value: Interpolator.LOG_LINEAR, label: "log linear", availability: "supported"},
    {value: Interpolator.CUBIC, label: "cubic", availability: "supported"},
    {value: Interpolator.LOG_CUBIC, label: "log cubic", availability: "unsupported", reason: "Not among the nine compiled trait/interpolator pairs."},
    {value: Interpolator.BACKWARD_FLAT, label: "backward flat", availability: "unsupported", reason: "Not among the nine compiled trait/interpolator pairs."},
    {value: Interpolator.FORWARD_FLAT, label: "forward flat", availability: "unsupported", reason: "Not among the nine compiled trait/interpolator pairs."}
];

/** Batched Monte Carlo, and therefore progress and a working cancel, exists
 *  for the vanilla path only: Session::priceInBatches takes a VanillaOption
 *  and only the vanilla arm calls it. On a barrier or an Asian the field is
 *  read by nothing, so setting it there buys no progress and no error either.
 */
export function supportsBatchedProgress(style: StyleCase): boolean {
    return style === "vanilla";
}
