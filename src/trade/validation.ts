import {Engine_Method} from "@/gen/quantlib/v2/engine_pb";
import type {PriceRequest} from "@/gen/quantlib/v2/envelope_pb";
import {Asian_Averaging, Exercise_Type} from "@/gen/quantlib/v2/instrument_pb";
import {Flag} from "@/gen/quantlib/v2/market_pb";
import {engineMethodsFor, exercisesFor, isDigitalPayoff, isOpen, needsApproximation, quantoSupport, readsPayoffAtExpiry, rejectsDividendCurve, type PayoffCase, type StyleCase} from "@/protocol/capabilities";

export interface TradeIssue {
    /** The backend's own dotted path, so a client complaint and a server
     *  field_path highlight the same control. */
    path: string;
    severity: "error" | "warning";
    message: string;
}

/** Catches what the dispatch in session.cpp would reject, before the frame.
 *
 *  Only the rules that are certain: whether a field is set, and the
 *  combinations HANDLERS.md and the dispatch spell out. Anything that depends
 *  on the maths — whether a strike is sane, whether a tree converges — is the
 *  backend's to say.
 */
export function validateTrade(trade: PriceRequest, marketIds: ReadonlySet<string>, evaluationDate = ""): TradeIssue[] {
    const issues: TradeIssue[] = [];
    const instrument = trade.instrument;
    if (instrument?.kind.case !== "option") {
        return [{path: "instrument", severity: "error", message: "No instrument."}];
    }
    const option = instrument.kind.value;
    const base = "instrument.option";
    const style = (option.style.case ?? undefined) as StyleCase | undefined;
    const quanto = option.quanto;

    // -- payoff --------------------------------------------------------------
    const payoffCase = option.payoff?.kind.case as PayoffCase | undefined;
    if (!option.payoff?.type) {
        issues.push({path: `${base}.payoff.type`, severity: "error", message: "Call or put is required."});
    }
    if (!payoffCase) {
        issues.push({path: `${base}.payoff`, severity: "error", message: "A payoff is required."});
    }

    // -- exercise ------------------------------------------------------------
    const exercise = option.exercise;
    const exerciseType = exercise?.type ?? Exercise_Type.UNSPECIFIED;
    if (!exerciseType) {
        issues.push({path: `${base}.exercise.type`, severity: "error", message: "An exercise type is required."});
    }
    if (!exercise || exercise.dates.length === 0) {
        issues.push({path: `${base}.exercise.dates`, severity: "error", message: "An expiry date is required."});
    } else if (exerciseType === Exercise_Type.BERMUDAN && exercise.dates.length < 2) {
        issues.push({path: `${base}.exercise.dates`, severity: "warning", message: "A Bermudan with one date is a European. Add the other exercise dates."});
    }
    // Read on American and Bermudan only, and there it must be set explicitly:
    // it settles the payoff at expiry rather than on exercise.
    if (readsPayoffAtExpiry(exerciseType) && exercise?.payoffAtExpiry === Flag.UNSPECIFIED) {
        issues.push({path: `${base}.exercise.payoff_at_expiry`, severity: "error", message: "Required on an American or Bermudan exercise: it changes the price, not the wording."});
    }

    // -- underlying ----------------------------------------------------------
    const underlying = option.underlyings[0];
    if (option.underlyings.length !== 1) {
        issues.push({path: `${base}.underlyings`, severity: "error", message: "Exactly one underlying."});
    } else if (underlying) {
        const ref = (field: "spotQuoteId" | "discountCurveId" | "volatilityId" | "dividendCurveId", required: boolean) => {
            const id = underlying[field];
            const path = `${base}.underlyings[0].${snake(field)}`;
            if (!id) {
                if (required) issues.push({path, severity: "error", message: "Required."});
            } else if (!marketIds.has(id)) {
                issues.push({path, severity: "error", message: `No market object with id "${id}".`});
            }
        };
        ref("spotQuoteId", true);
        ref("discountCurveId", true);
        ref("volatilityId", true);
        ref("dividendCurveId", false);

        if (!underlying.process) {
            issues.push({path: `${base}.underlyings[0].process`, severity: "error", message: "A process is required."});
        } else if (rejectsDividendCurve(underlying.process) && underlying.dividendCurveId) {
            issues.push({
                path: `${base}.underlyings[0].dividend_curve_id`,
                severity: "error",
                message: "PROCESS_BLACK_SCHOLES has no dividend yield. Use Black-Scholes-Merton to give it one, or clear the curve."
            });
        } else if (!underlying.dividendCurveId) {
            // Not an error, and the one default worth saying out loud.
            issues.push({
                path: `${base}.underlyings[0].dividend_curve_id`,
                severity: "warning",
                message: "No dividend curve means a flat zero dividend yield — not the risk-free curve."
            });
        }
    }

    const engine = trade.engine;
    const method = engine?.method ?? Engine_Method.UNSPECIFIED;

    // -- style ---------------------------------------------------------------
    if (!style) {
        issues.push({path: `${base}.style`, severity: "error", message: "An option needs a style."});
    }
    switch (option.style.case) {
        case "barrier": {
            const barrier = option.style.value;
            if (!barrier.type) issues.push({path: `${base}.barrier.type`, severity: "error", message: "A barrier type is required."});
            if (!(barrier.level > 0)) issues.push({path: `${base}.barrier.level`, severity: "error", message: "The barrier must be positive."});
            break;
        }
        case "doubleBarrier": {
            const barrier = option.style.value;
            if (!barrier.type) issues.push({path: `${base}.double_barrier.type`, severity: "error", message: "A double-barrier type is required."});
            if (!(barrier.lower > 0 && barrier.upper > barrier.lower)) {
                issues.push({path: `${base}.double_barrier.lower`, severity: "error", message: `Need 0 < lower < upper, got ${barrier.lower} and ${barrier.upper}.`});
            }
            break;
        }
        case "asian": {
            const asian = option.style.value;
            if (!asian.averaging) {
                issues.push({path: `${base}.asian.averaging`, severity: "error", message: "An averaging convention is required."});
            } else if (asian.fixingDates.length === 0 && asian.averaging !== Asian_Averaging.GEOMETRIC) {
                issues.push({
                    path: `${base}.asian.averaging`,
                    severity: "error",
                    message: "A continuously averaged Asian option has a closed form for the geometric average only. Add fixing dates to price it arithmetically."
                });
            }
            break;
        }
        case "lookback": {
            if (!(option.style.value.runningExtremum > 0)) {
                issues.push({
                    path: `${base}.lookback.running_extremum`,
                    severity: "error",
                    message: "The extremum realised so far is required and must be positive: an option already running whose extremum is dropped prices as if it had just started."
                });
            }
            break;
        }
        case "forwardStart": {
            const forward = option.style.value;
            const payoffKind = option.payoff?.kind;
            if (payoffKind?.case !== "percentageStrike") {
                issues.push({path: `${base}.payoff.percentage_strike`, severity: "error", message: "A forward start is struck as a fraction of the spot at reset, so it takes a percentage strike payoff."});
            } else if (!(payoffKind.value.moneyness > 0)) {
                issues.push({path: `${base}.payoff.percentage_strike.moneyness`, severity: "error", message: "Moneyness must be positive."});
            }
            const reset = forward.reset?.form.case === "iso" ? forward.reset.form.value : "";
            if (!reset) {
                issues.push({path: `${base}.forward_start.reset`, severity: "error", message: "A reset date is required."});
            } else {
                if (evaluationDate && reset < evaluationDate) {
                    issues.push({path: `${base}.forward_start.reset`, severity: "error", message: `Reset ${reset} is before the evaluation date ${evaluationDate}.`});
                }
                const expiry = exercise?.dates[0]?.form.case === "iso" ? exercise.dates[0].form.value : "";
                if (expiry && reset > expiry) {
                    issues.push({path: `${base}.forward_start.reset`, severity: "error", message: `Reset ${reset} is after the expiry ${expiry}.`});
                }
            }
            if (forward.performance === Flag.UNSPECIFIED) {
                issues.push({path: `${base}.forward_start.performance`, severity: "error", message: "Required: the performance variant pays the return rather than the amount, which is a different price for the same trade description."});
            }
            break;
        }
        default:
            break;
    }

    // -- quanto --------------------------------------------------------------
    if (quanto && style) {
        const support = quantoSupport(style);
        if (support.availability !== "supported") {
            issues.push({path: `${base}.quanto`, severity: "error", message: support.reason ?? "Quanto is not available for this style."});
        }
        const ref = (field: "fxRiskFreeCurveId" | "fxVolatilityId" | "correlationId", path: string) => {
            const id = quanto[field];
            if (!id) issues.push({path: `${base}.quanto.${path}`, severity: "error", message: "Quanto needs all three of the FX curve, the FX volatility and the correlation."});
            else if (!marketIds.has(id)) issues.push({path: `${base}.quanto.${path}`, severity: "error", message: `No market object with id "${id}".`});
        };
        ref("fxRiskFreeCurveId", "fx_risk_free_curve_id");
        ref("fxVolatilityId", "fx_volatility_id");
        ref("correlationId", "correlation_id");
    }

    // -- the combination -----------------------------------------------------
    // A style change can leave a method or an exercise selected that the new
    // style cannot take. The controls disable them; this catches the ones
    // already chosen.
    if (style && exerciseType) {
        const allowed = exercisesFor(style, quanto !== undefined).find(choice => choice.value === exerciseType);
        if (allowed && !isOpen(allowed)) {
            issues.push({path: `${base}.exercise.type`, severity: "error", message: allowed.reason ?? "Not available for this style."});
        }
    }
    if (style && method) {
        const asian = option.style.case === "asian" ? option.style.value : null;
        const allowed = engineMethodsFor({
            style,
            exercise: exerciseType,
            payoff: payoffCase,
            quanto: quanto !== undefined,
            averaging: asian?.averaging ?? Asian_Averaging.UNSPECIFIED,
            discreteAsian: (asian?.fixingDates.length ?? 0) > 0
        }).find(choice => choice.value === method);
        if (allowed && !isOpen(allowed)) {
            issues.push({path: "engine.method", severity: "error", message: allowed.reason ?? "Not available for this trade."});
        }
    }

    // -- engine --------------------------------------------------------------
    if (!method) {
        issues.push({path: "engine.method", severity: "error", message: "An engine method is required."});
    }
    if (style && needsApproximation(exerciseType, method, payoffCase, style)) {
        const approximation = engine?.parameters.case === "analytic" ? engine.parameters.value.approximation : 0;
        if (!approximation) {
            issues.push({
                path: "engine.analytic.approximation",
                severity: "error",
                message: "An American analytic price needs an explicit approximation: QuantLib has three and they disagree in the third decimal."
            });
        }
    }
    if (method === Engine_Method.LATTICE) {
        const lattice = engine?.parameters.case === "lattice" ? engine.parameters.value : null;
        if (!lattice?.tree) issues.push({path: "engine.lattice.tree", severity: "error", message: "A tree is required."});
        if (!lattice?.steps) issues.push({path: "engine.lattice.steps", severity: "error", message: "Steps must be non-zero. A tree with no steps is not a fast tree."});
    }
    if (method === Engine_Method.FINITE_DIFFERENCE) {
        const fd = engine?.parameters.case === "fd" ? engine.parameters.value : null;
        if (!fd || fd.grid.case === undefined) {
            issues.push({path: "engine.fd", severity: "error", message: "Choose a preset grid or give explicit steps."});
        } else if (fd.grid.case === "preset" && !fd.grid.value) {
            issues.push({path: "engine.fd.preset", severity: "error", message: "A preset is required."});
        }
    }
    if (method === Engine_Method.MONTE_CARLO) {
        const mc = engine?.parameters.case === "mc" ? engine.parameters.value : null;
        if (!mc || mc.seed === 0n) {
            issues.push({
                path: "engine.mc.seed",
                severity: "error",
                message: "A non-zero seed is required: QuantLib seeds from the clock otherwise, and the same inputs would price differently on every request."
            });
        }
        if (!mc || mc.stopping.case !== "samples" || mc.stopping.value === 0n) {
            issues.push({path: "engine.mc.samples", severity: "error", message: "A sample budget is required."});
        }
    }

    // A binary payoff on a non-European exercise is a one-touch and takes its own
    // analytic engine, so it needs no approximation — worth saying, because the
    // control disappears.
    if (isDigitalPayoff(payoffCase) && exerciseType === Exercise_Type.AMERICAN && method === Engine_Method.ANALYTIC) {
        issues.push({path: "engine.analytic", severity: "warning", message: "A binary payoff on an American exercise is a one-touch: AnalyticDigitalAmericanEngine prices it and no approximation applies."});
    }

    return issues;
}

function snake(field: string): string {
    return field.replace(/[A-Z]/g, letter => `_${letter.toLowerCase()}`);
}

export const tradeHasErrors = (issues: readonly TradeIssue[]): boolean => issues.some(issue => issue.severity === "error");
