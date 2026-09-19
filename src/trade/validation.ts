import type {DayCounter} from "@/gen/quantlib/v1/conventions_pb";
import {Engine_Method} from "@/gen/quantlib/v2/engine_pb";
import type {PriceRequest} from "@/gen/quantlib/v2/envelope_pb";
import {Asian_Averaging, Basket_Kind, Exercise_Type, Leg_Kind, type Swap} from "@/gen/quantlib/v2/instrument_pb";
import type {MarketObject} from "@/gen/quantlib/v2/market_pb";
import {Flag} from "@/gen/quantlib/v2/market_pb";
import {ResultKind} from "@/gen/quantlib/v2/results_pb";
import {asCorrelation, asVolatility, asYieldCurve} from "@/market/model";
import {
    canImplyVolatility,
    canTakeFairRate,
    engineMethodsFor,
    exercisesFor,
    isDigitalPayoff,
    isOpen,
    needsApproximation,
    type PayoffCase,
    payoffsFor,
    quantoSupport,
    readsBasketWeights,
    readsPayoffAtExpiry,
    rejectsDividendCurve,
    type StyleCase,
    takesControlVariate
} from "@/protocol/capabilities";

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
export function validateTrade(trade: PriceRequest, market: readonly MarketObject[], evaluationDate = ""): TradeIssue[] {
    const marketIds = new Set(market.map(object => object.id));
    const instrument = trade.instrument;
    if (instrument?.kind.case === "swap") {
        return validateSwap(trade, instrument.kind.value, market, marketIds);
    }
    const issues: TradeIssue[] = [];
    if (instrument?.kind.case !== "option") {
        return [{path: "instrument", severity: "error", message: "No instrument."}];
    }
    const option = instrument.kind.value;
    const base = "instrument.option";
    const style = (option.style.case ?? undefined) as StyleCase | undefined;
    const quanto = option.quanto;

    // -- payoff --------------------------------------------------------------
    const payoffCase = option.payoff?.kind.case as PayoffCase | undefined;
    if (style === "chooser") {
        // The one arm where a set type would be read and thrown away: both
        // chooser instruments build their own PlainVanillaPayoff and force it
        // to Call. Which side this becomes is the thing being chosen.
        if (option.payoff?.type) {
            issues.push({path: `${base}.payoff.type`, severity: "error", message: "A chooser has no call or put until the choice date — that is what is being chosen. Leave it unset."});
        }
    } else if (!option.payoff?.type) {
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
    // Basket is the one style that takes more than one. Everything below runs
    // per asset, on the indexed path the backend uses.
    const underlying = option.underlyings[0];
    const isBasket = option.style.case === "basket";
    if (option.underlyings.length === 0) {
        issues.push({path: `${base}.underlyings`, severity: "error", message: "An underlying is required."});
    } else if (!isBasket && option.underlyings.length !== 1) {
        issues.push({path: `${base}.underlyings`, severity: "error", message: "Exactly one underlying — basket is the style that takes more."});
    }
    const labels = new Set<string>();
    option.underlyings.forEach((asset, index) => {
        const at = `${base}.underlyings[${index}]`;
        const ref = (field: "spotQuoteId" | "discountCurveId" | "volatilityId" | "dividendCurveId", isRequired: boolean) => {
            const id = asset[field];
            const path = `${at}.${snake(field)}`;
            if (!id) {
                if (isRequired) issues.push({path, severity: "error", message: "Required."});
            } else if (!marketIds.has(id)) {
                issues.push({path, severity: "error", message: `No market object with id "${id}".`});
            }
        };
        ref("spotQuoteId", true);
        ref("discountCurveId", true);
        ref("volatilityId", true);
        ref("dividendCurveId", false);

        if (!asset.process) {
            issues.push({path: `${at}.process`, severity: "error", message: "A process is required."});
        } else if (rejectsDividendCurve(asset.process) && asset.dividendCurveId) {
            issues.push({
                path: `${at}.dividend_curve_id`,
                severity: "error",
                message: "PROCESS_BLACK_SCHOLES has no dividend yield. Use Black-Scholes-Merton to give it one, or clear the curve."
            });
        } else if (!asset.dividendCurveId) {
            // Not an error, and the one default worth saying out loud.
            issues.push({
                path: `${at}.dividend_curve_id`,
                severity: "warning",
                message: "No dividend curve means a flat zero dividend yield — not the risk-free curve."
            });
        }

        // The label is what the correlation matrix indexes on, so it matters
        // only when there is a matrix — and then it matters absolutely.
        if (option.underlyings.length > 1) {
            if (!asset.label) {
                issues.push({path: `${at}.label`, severity: "error", message: "Every underlying in a basket needs a label: the correlation matrix indexes on it, and position would be a second answer to the same question."});
            } else if (labels.has(asset.label)) {
                issues.push({path: `${at}.label`, severity: "error", message: `Duplicate label "${asset.label}".`});
            }
            if (asset.label) labels.add(asset.label);
        }
    });

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

            // A binary payoff here is a knock digital — the product `message
            // Digital` describes, which has no instrument of its own. Every
            // rule below is one AnalyticBinaryBarrierEngine enforces from
            // inside, except the rebate, which it does not enforce at all: it
            // never reads one, so a rebate would be taken and dropped.
            if (isDigitalPayoff(payoffCase)) {
                if (exerciseType !== Exercise_Type.AMERICAN) {
                    issues.push({path: `${base}.exercise.type`, severity: "error", message: "A knock digital is written on an American exercise: AnalyticBinaryBarrierEngine casts to one."});
                } else if (exercise?.payoffAtExpiry !== Flag.TRUE) {
                    issues.push({path: `${base}.exercise.payoff_at_expiry`, severity: "error", message: "A knock digital settles at expiry rather than on touch, so this must be true."});
                }
                if (barrier.rebate !== 0) {
                    issues.push({path: `${base}.barrier.rebate`, severity: "error", message: "AnalyticBinaryBarrierEngine has no rebate. It would be taken and never read."});
                }
                const earliest = exercise?.earliestDate?.form.case === "iso" ? exercise.earliestDate.form.value : "";
                if (earliest && evaluationDate && earliest > evaluationDate) {
                    issues.push({path: `${base}.exercise.earliest_date`, severity: "error", message: "The barrier is live from the evaluation date: QuantLib has no window exercise here."});
                }
            }
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
        case "compound": {
            const compound = option.style.value;
            const path = `${base}.compound`;

            // The mother is the option's own payoff and exercise; these two are
            // the same fields a second time and the backend refuses them by
            // name rather than merging them.
            if (compound.motherPayoff) {
                issues.push({path: `${path}.mother_payoff`, severity: "error", message: "The mother option is the option's own payoff. Set it above, not here."});
            }
            if (compound.motherExercise) {
                issues.push({path: `${path}.mother_exercise`, severity: "error", message: "The mother option is the option's own exercise. Set it above, not here."});
            }

            // The engine casts both payoffs back to a PlainVanillaPayoff, so a
            // binary or gap payoff on either leg is a CALCULATION_FAILED with no
            // field on it.
            if (payoffCase && payoffCase !== "plain") {
                issues.push({path: `${base}.payoff`, severity: "error", message: "A compound option takes a plain payoff on each leg."});
            }
            const daughterPayoff = compound.daughterPayoff;
            if (!daughterPayoff?.type) {
                issues.push({path: `${path}.daughter_payoff.type`, severity: "error", message: "Call or put is required on the option this one is written on."});
            }
            if (daughterPayoff?.kind.case !== "plain") {
                issues.push({path: `${path}.daughter_payoff`, severity: "error", message: "A compound option takes a plain payoff on each leg."});
            } else if (!(daughterPayoff.kind.value.strike > 0)) {
                issues.push({path: `${path}.daughter_payoff.plain.strike`, severity: "error", message: "The strike of the option written on must be positive."});
            }

            const daughter = compound.daughterExercise;
            if (daughter?.type !== Exercise_Type.EUROPEAN) {
                issues.push({
                    path: `${path}.daughter_exercise.type`,
                    severity: "error",
                    message: daughter?.type ? "AnalyticCompoundOptionEngine is European only, on both legs." : "An exercise type is required on the option this one is written on."
                });
            }
            const daughterExpiry = daughter?.dates[0]?.form.case === "iso" ? daughter.dates[0].form.value : "";
            if (!daughterExpiry) {
                issues.push({path: `${path}.daughter_exercise.dates`, severity: "error", message: "The option written on needs an expiry."});
            } else {
                const expiry = exercise?.dates[0]?.form.case === "iso" ? exercise.dates[0].form.value : "";
                // QuantLib checks this in CompoundOption::arguments::validate and
                // throws, which arrives with no field to blame.
                if (expiry && expiry > daughterExpiry) {
                    issues.push({path: `${path}.daughter_exercise.dates`, severity: "error", message: `The compound expires ${expiry}, after the option it is written on, which expires ${daughterExpiry}.`});
                }
            }
            break;
        }
        case "basket": {
            const basket = option.style.value;
            const path = `${base}.basket`;
            const n = option.underlyings.length;

            if (n < 2) {
                issues.push({path: `${base}.underlyings`, severity: "error", message: "A basket needs at least two underlyings; with one it is whatever style that one asset is."});
            }
            if (!basket.kind) {
                issues.push({path: `${path}.kind`, severity: "error", message: "How the assets are accumulated is required: a minimum, a maximum, a spread or a weighted average."});
            }
            if (basket.kind === Basket_Kind.SPREAD && n !== 2) {
                issues.push({path: `${base}.underlyings`, severity: "error", message: `A spread is the difference of two assets, and SpreadBasketPayoff refuses any other count; got ${n}.`});
            }
            if (payoffCase && payoffCase !== "plain") {
                issues.push({path: `${base}.payoff`, severity: "error", message: "A basket wraps a plain payoff: the assets are accumulated to one number and that is handed to the payoff underneath."});
            }

            // Weights are AverageBasketPayoff's and nobody else's.
            if (!readsBasketWeights(basket.kind) && basket.weights.length > 0) {
                issues.push({path: `${path}.weights`, severity: "error", message: "Only a weighted average reads weights: a minimum, a maximum and a spread are not weighted sums."});
            } else if (basket.weights.length > 0 && basket.weights.length !== n) {
                issues.push({path: `${path}.weights`, severity: "error", message: `A weight per underlying, or none for equal weights: got ${basket.weights.length} for ${n} assets.`});
            }

            if (!basket.correlationId) {
                issues.push({path: `${path}.correlation_id`, severity: "error", message: "A basket needs a correlation matrix: with n assets there are n(n-1)/2 numbers and no default for any of them."});
            } else {
                const object = market.find(entry => entry.id === basket.correlationId);
                const matrix = object ? asCorrelation(object) : null;
                if (!matrix) {
                    issues.push({path: `${path}.correlation_id`, severity: "error", message: `No correlation matrix with id "${basket.correlationId}".`});
                } else {
                    for (const [index, asset] of option.underlyings.entries()) {
                        if (asset.label && !matrix.labels.includes(asset.label)) {
                            issues.push({path: `${base}.underlyings[${index}].label`, severity: "error", message: `Correlation matrix "${basket.correlationId}" has no row for label "${asset.label}".`});
                        }
                    }
                }
            }
            break;
        }
        case "cliquet": {
            const cliquet = option.style.value;
            const path = `${base}.cliquet`;

            // Not "no engine for it": CliquetOption::setupArguments copies the
            // reset dates and stops (cliquetoption.cpp:32), so a cap reaches no
            // engine at all and the price would be the uncapped ratchet under a
            // capped description.
            for (const [field, value] of [
                ["local_cap", cliquet.localCap],
                ["local_floor", cliquet.localFloor],
                ["global_cap", cliquet.globalCap],
                ["global_floor", cliquet.globalFloor]
            ] as const) {
                if (value !== 0) {
                    issues.push({
                        path: `${path}.${field}`,
                        severity: "error",
                        message: "QuantLib carries no cap or floor on a cliquet: the instrument never copies this field, so the engine would price the uncapped ratchet and report nothing amiss."
                    });
                }
            }

            const payoffKind = option.payoff?.kind;
            if (payoffKind?.case !== "percentageStrike") {
                issues.push({path: `${base}.payoff.percentage_strike`, severity: "error", message: "A cliquet resets its strike to a fraction of the spot at each reset, so it takes a percentage strike payoff."});
            } else if (!(payoffKind.value.moneyness > 0)) {
                issues.push({path: `${base}.payoff.percentage_strike.moneyness`, severity: "error", message: "Moneyness must be positive."});
            }

            if (cliquet.performance === Flag.UNSPECIFIED) {
                issues.push({path: `${path}.performance`, severity: "error", message: "Required: it selects the engine — the ratchet pays the amount, the performance form pays the return."});
            }

            const expiry = exercise?.dates[0]?.form.case === "iso" ? exercise.dates[0].form.value : "";
            if (cliquet.resetDates.length === 0) {
                issues.push({path: `${path}.reset_dates`, severity: "error", message: "A cliquet needs the dates its strike resets on."});
            }
            let previous = "";
            cliquet.resetDates.forEach((date, index) => {
                const at = `${path}.reset_dates[${index}]`;
                const iso = date.form.case === "iso" ? date.form.value : "";
                if (!iso) {
                    issues.push({path: at, severity: "error", message: "A reset date is required."});
                    return;
                }
                // The engines discount to each reset in turn, and a curve
                // throws rather than extrapolates behind its reference date.
                if (evaluationDate && iso < evaluationDate) {
                    issues.push({path: at, severity: "error", message: `Reset ${iso} is before the evaluation date ${evaluationDate}.`});
                }
                if (expiry && iso >= expiry) {
                    issues.push({path: at, severity: "error", message: `Reset ${iso} is not before the expiry ${expiry}.`});
                }
                if (previous && iso <= previous) {
                    issues.push({path: at, severity: "error", message: `Reset dates must be in order and distinct: ${iso} does not follow ${previous}.`});
                }
                previous = iso;
            });
            break;
        }
        case "chooser": {
            const chooser = option.style.value;
            const path = `${base}.chooser`;

            // The strike and the (call) expiry are the option's own payoff and
            // exercise — both instruments hand those to OneAssetOption — so
            // these two are the same fields a second time.
            if (chooser.callStrike !== 0) {
                issues.push({path: `${path}.call_strike`, severity: "error", message: "The strike is the option's own payoff. Set it above, not here."});
            }
            if (chooser.callExpiry) {
                issues.push({path: `${path}.call_expiry`, severity: "error", message: "The expiry is the option's own exercise. Set it above, not here."});
            }

            const strike = option.payoff?.kind.case === "plain" ? option.payoff.kind.value.strike : 0;
            if (payoffCase && payoffCase !== "plain") {
                issues.push({path: `${base}.payoff`, severity: "error", message: "A chooser is struck on a plain payoff: the instrument builds the payoff itself and takes only a strike."});
            } else if (payoffCase === "plain" && !(strike > 0)) {
                issues.push({path: `${base}.payoff.plain.strike`, severity: "error", message: "The strike must be positive."});
            }

            // One time axis. AnalyticSimpleChooserEngine requires the three day
            // counters to be equal and throws with no field to blame when they
            // are not; the complex engine assumes it and never checks, which is
            // worse — it takes every time off the risk-free counter and then
            // reads the other two curves at that number.
            const counterOf = (id: string) => {
                const object = market.find(entry => entry.id === id);
                if (!object) return undefined;
                return asYieldCurve(object)?.dayCounter ?? asVolatility(object)?.dayCounter;
            };
            const spell = (counter?: DayCounter) => (counter ? `${counter.family}/${counter.thirty360}/${counter.actualActual}` : "");
            const discount = counterOf(underlying?.discountCurveId ?? "");
            if (discount) {
                for (const [field, id] of [
                    ["dividend_curve_id", underlying?.dividendCurveId],
                    ["volatility_id", underlying?.volatilityId]
                ] as const) {
                    const other = id ? counterOf(id) : undefined;
                    if (other && spell(other) !== spell(discount)) {
                        issues.push({path: `${base}.underlyings[0].${field}`, severity: "error", message: "A chooser is priced on one time axis: this counts days differently from the discount curve."});
                    }
                }
            }

            const expiry = exercise?.dates[0]?.form.case === "iso" ? exercise.dates[0].form.value : "";
            const choice = chooser.choiceDate?.form.case === "iso" ? chooser.choiceDate.form.value : "";
            if (!choice) {
                issues.push({path: `${path}.choice_date`, severity: "error", message: "A chooser needs the date the choice is made."});
            } else {
                if (evaluationDate && choice <= evaluationDate) {
                    issues.push({path: `${path}.choice_date`, severity: "error", message: "The choice date must be after the evaluation date: once the choice is made, what is left is a vanilla option."});
                }
                if (expiry && choice >= expiry) {
                    issues.push({path: `${path}.choice_date`, severity: "error", message: `The choice must be made before the expiry ${expiry}.`});
                }
            }

            const putExpiry = chooser.putExpiry?.form.case === "iso" ? chooser.putExpiry.form.value : "";
            if (!chooser.putExpiry) {
                // The simple chooser shares one strike and one expiry, and
                // SimpleChooserOption takes exactly one of each.
                if (chooser.putStrike !== 0) {
                    issues.push({path: `${path}.put_expiry`, severity: "error", message: "A put strike of its own needs a put expiry beside it: the simple chooser shares one strike and one expiry between the two sides."});
                }
            } else {
                if (!putExpiry) {
                    issues.push({path: `${path}.put_expiry`, severity: "error", message: "The put leg needs an expiry."});
                }
                if (!(chooser.putStrike > 0)) {
                    issues.push({path: `${path}.put_strike`, severity: "error", message: "The put strike must be positive."});
                }
                if (putExpiry && choice && choice >= putExpiry) {
                    issues.push({path: `${path}.choice_date`, severity: "error", message: `The choice must be made before the put expiry ${putExpiry}.`});
                }

                // AnalyticComplexChooserEngine solves for the critical spot at
                // (maturity - 2 x choice time), so a leg expiring inside twice
                // the choice date leaves that negative and the volatility
                // surface throws from inside the Newton-Raphson. Counted in
                // calendar days here: the three counters have to agree by the
                // rule above, so this is a ratio of one year fraction.
                const since = (iso: string) => (Date.parse(iso) - Date.parse(evaluationDate)) / 86400000;
                if (evaluationDate && choice) {
                    for (const [field, iso] of [
                        [`${base}.exercise.dates`, expiry],
                        [`${path}.put_expiry`, putExpiry]
                    ] as const) {
                        if (iso && since(iso) <= 2 * since(choice)) {
                            issues.push({path: field, severity: "error", message: "AnalyticComplexChooserEngine prices the choice off (expiry − 2 × choice time), so each leg has to expire more than twice the choice date out."});
                        }
                    }
                }
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
        const support = quantoSupport(style, payoffCase);
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
        const allowed = exercisesFor(style, quanto !== undefined, payoffCase).find(choice => choice.value === exerciseType);
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
            discreteAsian: (asian?.fixingDates.length ?? 0) > 0,
            cliquetPerformance: option.style.case === "cliquet" && option.style.value.performance === Flag.TRUE,
            assetCount: option.underlyings.length,
            basketKind: option.style.case === "basket" ? option.style.value.kind : undefined
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
        } else if (fd.grid.case === "custom") {
            const grid = fd.grid.value;
            if (!grid.timeSteps || !grid.assetSteps) {
                issues.push({path: "engine.fd.custom", severity: "error", message: "A grid needs both dimensions."});
            }
            if (!grid.scheme) {
                issues.push({path: "engine.fd.custom.scheme", severity: "error", message: "A custom grid needs an explicit scheme: two schemes are two prices for the same trade, and Douglas is a choice rather than an absence of one."});
            }
            if (grid.timeSteps && grid.dampingSteps >= grid.timeSteps) {
                issues.push({path: "engine.fd.custom.damping_steps", severity: "error", message: "Damping steps are the first few time steps taken fully implicit, so there have to be more time steps than damping steps."});
            }
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
        if (mc?.controlVariate && style && !takesControlVariate(style)) {
            issues.push({path: "engine.mc.control_variate", severity: "error", message: "Only the Asian Monte Carlo has a control variate; this engine would never apply one."});
        }
    }

    // A binary payoff on a non-European exercise is a one-touch and takes its own
    // analytic engine, so it needs no approximation — worth saying, because the
    // control disappears. On a barrier the same payoff is a knock digital and a
    // different engine, so this is a vanilla rule rather than a payoff one.
    if (style === "vanilla" && isDigitalPayoff(payoffCase) && exerciseType === Exercise_Type.AMERICAN && method === Engine_Method.ANALYTIC) {
        issues.push({path: "engine.analytic", severity: "warning", message: "A binary payoff on an American exercise is a one-touch: AnalyticDigitalAmericanEngine prices it and no approximation applies."});
    }

    // -- implied volatility --------------------------------------------------
    // The one result that reads something off the request. Without a price to
    // invert the service refuses rather than inverting the price it is about to
    // compute, which would hand back the volatility that was sent in.
    if (trade.results.includes(ResultKind.IMPLIED_VOLATILITY)) {
        const implied = trade.impliedVolatility;
        if (!implied || implied.targetPrice <= 0) {
            issues.push({path: "implied_volatility.target_price", severity: "error", message: "A price to invert is required, and it has to be positive."});
        }
        if (implied && implied.minVolatility > 0 && implied.maxVolatility > 0 && implied.minVolatility >= implied.maxVolatility) {
            issues.push({path: "implied_volatility.max_volatility", severity: "error", message: "The bracket is empty: the ceiling has to be above the floor."});
        }
        if (!canImplyVolatility(style)) {
            issues.push({path: "results", severity: "warning", message: "QuantLib inverts a vanilla, a barrier and a double barrier. On this style the result comes back named absent."});
        }
    }

    // -- payoff against style -----------------------------------------------
    // The rule the payoff menu applies, applied to the trade too. A payoff the
    // style does not take -- a floating strike left behind when the style moved
    // off lookback, or one an imported workbook arrives with -- passed here and
    // was refused by the service. Last, and only where no check above has
    // already said something about the payoff.
    if (style && payoffCase && !issues.some(issue => issue.path.startsWith(`${base}.payoff`))) {
        const choice = payoffsFor(style).find(candidate => candidate.value === payoffCase);
        if (choice && !isOpen(choice)) {
            issues.push({path: `${base}.payoff`, severity: "error", message: choice.reason ?? "This payoff is not offered for this style."});
        }
    }

    return issues;
}

/** A general n-leg swap, priced by discounting.
 *
 *  Every rule here is one the dispatch in Session::priceSwap and
 *  Session::buildLeg enforces, in the order it enforces them.
 */
function validateSwap(trade: PriceRequest, swap: Swap, market: readonly MarketObject[], marketIds: ReadonlySet<string>): TradeIssue[] {
    const issues: TradeIssue[] = [];
    const base = "instrument.swap";
    const method = trade.engine?.method ?? Engine_Method.UNSPECIFIED;

    if (method !== Engine_Method.DISCOUNTING) {
        issues.push({
            path: "engine.method",
            severity: "error",
            message: method ? "A swap takes discounting." : "An engine method is required. v1 never read this field, so a swap with an unset engine priced silently; this one checks."
        });
    }

    if (!swap.discountCurveId) {
        issues.push({path: `${base}.discount_curve_id`, severity: "error", message: "A discount curve is required."});
    } else if (!marketIds.has(swap.discountCurveId)) {
        issues.push({path: `${base}.discount_curve_id`, severity: "error", message: `No market object with id "${swap.discountCurveId}".`});
    }

    if (swap.legs.length < 2) {
        issues.push({path: `${base}.legs`, severity: "error", message: `A swap needs at least two legs, got ${swap.legs.length}.`});
    }

    const directions = swap.legs.map(leg => leg.pays);
    if (swap.legs.length >= 2 && directions.every(pays => pays !== Flag.UNSPECIFIED) && directions.every(pays => pays === directions[0])) {
        issues.push({path: `${base}.legs`, severity: "error", message: "Every leg points the same way; that is a portfolio, not a swap."});
    }

    swap.legs.forEach((leg, at) => {
        const path = `${base}.legs[${at}]`;
        if (leg.kind !== Leg_Kind.FIXED && leg.kind !== Leg_Kind.IBOR) {
            issues.push({path: `${path}.kind`, severity: "error", message: leg.kind ? "Only fixed and Ibor legs are built." : "A leg kind is required."});
        }
        if (leg.pays === Flag.UNSPECIFIED) {
            issues.push({path: `${path}.pays`, severity: "error", message: "Pays or receives is required: defaulting it is a sign error."});
        }
        if (leg.notionals.length === 0) {
            issues.push({path: `${path}.notionals`, severity: "error", message: "A leg needs at least one notional."});
        }

        const schedule = leg.schedule;
        const start = schedule?.start?.form.case === "iso" ? schedule.start.form.value : "";
        const maturity = schedule?.maturity?.form.case === "iso" ? schedule.maturity.form.value : "";
        if (!start) issues.push({path: `${path}.schedule.start`, severity: "error", message: "A start date is required."});
        if (!maturity) issues.push({path: `${path}.schedule.maturity`, severity: "error", message: "A maturity is required."});
        if (start && maturity && maturity <= start) {
            issues.push({path: `${path}.schedule.maturity`, severity: "error", message: `Maturity ${maturity} is not after start ${start}.`});
        }
        if (!schedule?.frequency) issues.push({path: `${path}.schedule.frequency`, severity: "error", message: "A frequency is required."});
        if (!schedule?.convention) issues.push({path: `${path}.schedule.convention`, severity: "error", message: "A business-day convention is required."});
        if (!schedule?.dateGeneration) issues.push({path: `${path}.schedule.date_generation`, severity: "error", message: "A date-generation rule is required."});
        if (!schedule?.calendar?.name) issues.push({path: `${path}.schedule.calendar`, severity: "error", message: "A calendar is required."});
        if (schedule?.endOfMonth === Flag.UNSPECIFIED) {
            issues.push({path: `${path}.schedule.end_of_month`, severity: "error", message: "Required: end-of-month moves the schedule, so there is no safe default."});
        }
        if (!leg.dayCounter?.family) {
            issues.push({path: `${path}.day_counter`, severity: "error", message: "A day counter is required."});
        }

        if (leg.kind === Leg_Kind.FIXED) {
            if (!leg.rateQuoteId) {
                issues.push({path: `${path}.rate_quote_id`, severity: "error", message: "A fixed leg needs a rate."});
            } else if (!marketIds.has(leg.rateQuoteId)) {
                issues.push({path: `${path}.rate_quote_id`, severity: "error", message: `No market object with id "${leg.rateQuoteId}".`});
            }
        }

        if (leg.kind === Leg_Kind.IBOR) {
            if (!leg.indexId) {
                issues.push({path: `${path}.index_id`, severity: "error", message: "A floating leg needs an index."});
            } else if (!marketIds.has(leg.indexId)) {
                issues.push({path: `${path}.index_id`, severity: "error", message: `No market object with id "${leg.indexId}".`});
            } else {
                const index = market.find(object => object.id === leg.indexId);
                if (index?.kind.case !== "index") {
                    issues.push({path: `${path}.index_id`, severity: "error", message: `"${leg.indexId}" is not an index.`});
                } else if (!index.kind.value.forwardingCurveId) {
                    issues.push({
                        path: `${path}.index_id`,
                        severity: "error",
                        message: "The floating leg index needs a forwarding curve: pricing off an index with an empty handle fails at the first forecast."
                    });
                }
            }
            if (leg.inArrears === Flag.UNSPECIFIED) {
                issues.push({path: `${path}.in_arrears`, severity: "error", message: "Required: fixing in arrears changes the coupon, so there is no safe default."});
            }
        }
    });

    // The fair-rate formula assumes the fixed leg is first and the floating
    // leg second, and the backend refuses any other arrangement rather than
    // returning a wrong number off the wrong leg.
    if (trade.results.includes(ResultKind.FAIR_RATE) && !canTakeFairRate(swap.legs.map(leg => leg.kind))) {
        issues.push({
            path: `${base}.legs`,
            severity: "error",
            message: "A fair rate needs exactly two legs, the fixed one first and the floating one second."
        });
    }

    return issues;
}

function snake(field: string): string {
    return field.replace(/[A-Z]/g, letter => `_${letter.toLowerCase()}`);
}

export const tradeHasErrors = (issues: readonly TradeIssue[]): boolean => issues.some(issue => issue.severity === "error");
