import {describe, expect, it} from "vitest";

import {DayCounter_Family} from "@/gen/quantlib/v1/conventions_pb";
import {Engine_Method, FdParameters_Explicit_Scheme} from "@/gen/quantlib/v2/engine_pb";
import type {PriceRequest} from "@/gen/quantlib/v2/envelope_pb";
import {type Basket, Basket_Kind, type Chooser, type Cliquet} from "@/gen/quantlib/v2/instrument_pb";
import {Asian_Averaging, Barrier_Type, Exercise_Type, Payoff_OptionType, Underlying_Process} from "@/gen/quantlib/v2/instrument_pb";
import {Flag} from "@/gen/quantlib/v2/market_pb";
import {HANDLERS_EVALUATION_DATE, HANDLERS_EXPIRY, seedMarket, seedTrade} from "@/market/handlersSession";
import {asYieldCurve, newCorrelation} from "@/market/model";

import {tradeHasErrors, validateTrade} from "./validation";

const market = seedMarket();
const errors = (trade: PriceRequest) =>
    validateTrade(trade, market)
        .filter(issue => issue.severity === "error")
        .map(issue => issue.path);

function option(trade: PriceRequest) {
    if (trade.instrument?.kind.case !== "option") throw new Error("not an option");
    return trade.instrument.kind.value;
}

/** A simple chooser on the HANDLERS.md trade: no side, one strike, one expiry.
 *  The choice-date rules need the evaluation date, which the plain `errors`
 *  helper does not pass. */
function chooserTrade(): PriceRequest {
    const trade = seedTrade();
    option(trade).payoff = {$typeName: "quantlib.v2.Payoff", type: Payoff_OptionType.UNSPECIFIED, kind: {case: "plain", value: {$typeName: "quantlib.v2.PlainVanillaPayoff", strike: 100}}};
    option(trade).exercise!.type = Exercise_Type.EUROPEAN;
    option(trade).style = {
        case: "chooser",
        value: {$typeName: "quantlib.v2.Chooser", callStrike: 0, putStrike: 0, choiceDate: {$typeName: "quantlib.v1.Date", form: {case: "iso", value: "2027-03-01"}}}
    };
    trade.engine!.method = Engine_Method.ANALYTIC;
    return trade;
}

/** A two-asset minimum basket, correlated through a matrix in the market. */
function basketTrade(): PriceRequest {
    const trade = seedTrade();
    const asset = option(trade).underlyings[0]!;
    option(trade).underlyings = [
        {...asset, label: "A"},
        {...asset, label: "B"}
    ];
    option(trade).style = {
        case: "basket",
        value: {$typeName: "quantlib.v2.Basket", kind: Basket_Kind.MIN, correlationId: "CORRM", weights: []}
    };
    trade.engine!.method = Engine_Method.ANALYTIC;
    return trade;
}

const basketMarket = [...market, newCorrelation("CORRM", ["A", "B"])];
const basketErrors = (trade: PriceRequest) =>
    validateTrade(trade, basketMarket, HANDLERS_EVALUATION_DATE)
        .filter(issue => issue.severity === "error")
        .map(issue => issue.path);

/** The ratchet on the HANDLERS.md trade: percentage-struck, one reset. */
function cliquetTrade(): PriceRequest {
    const trade = seedTrade();
    option(trade).payoff = {$typeName: "quantlib.v2.Payoff", type: Payoff_OptionType.CALL, kind: {case: "percentageStrike", value: {$typeName: "quantlib.v2.PercentageStrikePayoff", moneyness: 1.1}}};
    option(trade).exercise!.type = Exercise_Type.EUROPEAN;
    option(trade).style = {
        case: "cliquet",
        value: {
            $typeName: "quantlib.v2.Cliquet",
            resetDates: [{$typeName: "quantlib.v1.Date", form: {case: "iso", value: "2027-03-01"}}],
            localCap: 0,
            localFloor: 0,
            globalCap: 0,
            globalFloor: 0,
            performance: Flag.FALSE
        }
    };
    trade.engine!.method = Engine_Method.ANALYTIC;
    return trade;
}

const cliquetErrors = (trade: PriceRequest) =>
    validateTrade(trade, market, HANDLERS_EVALUATION_DATE)
        .filter(issue => issue.severity === "error")
        .map(issue => issue.path);

const chooserErrors = (trade: PriceRequest) =>
    validateTrade(trade, market, HANDLERS_EVALUATION_DATE)
        .filter(issue => issue.severity === "error")
        .map(issue => issue.path);

describe("validateTrade", () => {
    it("passes the HANDLERS.md trade", () => {
        expect(errors(seedTrade())).toEqual([]);
    });

    it("requires an approximation for an American analytic price", () => {
        const trade = seedTrade();
        option(trade).exercise!.type = Exercise_Type.AMERICAN;
        option(trade).exercise!.payoffAtExpiry = Flag.FALSE;
        expect(errors(trade)).toContain("engine.analytic.approximation");
    });

    it("requires payoff_at_expiry on an American exercise", () => {
        const trade = seedTrade();
        option(trade).exercise!.type = Exercise_Type.AMERICAN;
        expect(errors(trade)).toContain("instrument.option.exercise.payoff_at_expiry");
    });

    it("rejects a dividend curve under Black-Scholes", () => {
        // PROCESS_BLACK_SCHOLES rejects it rather than ignoring it —
        // session.cpp:1139.
        const trade = seedTrade();
        option(trade).underlyings[0]!.process = Underlying_Process.BLACK_SCHOLES;
        expect(errors(trade)).toContain("instrument.option.underlyings[0].dividend_curve_id");
    });

    it("warns that no dividend curve means zero yield, not the risk-free curve", () => {
        const trade = seedTrade();
        option(trade).underlyings[0]!.dividendCurveId = "";
        const issues = validateTrade(trade, market);
        expect(issues.find(issue => issue.path === "instrument.option.underlyings[0].dividend_curve_id")).toMatchObject({
            severity: "warning"
        });
        expect(tradeHasErrors(issues)).toBe(false);
    });

    it("rejects an id that is not in the market", () => {
        const trade = seedTrade();
        option(trade).underlyings[0]!.volatilityId = "NOPE";
        expect(errors(trade)).toContain("instrument.option.underlyings[0].volatility_id");
    });

    it("requires a scheme on a custom finite-difference grid", () => {
        // The backend read neither the scheme nor the damping steps for three
        // milestones and priced every custom grid as Douglas. It reads both
        // now and refuses an unset scheme, so this catches it here first.
        const trade = seedTrade();
        trade.engine!.method = Engine_Method.FINITE_DIFFERENCE;
        trade.engine!.parameters = {
            case: "fd",
            value: {
                $typeName: "quantlib.v2.FdParameters",
                grid: {case: "custom", value: {$typeName: "quantlib.v2.FdParameters.Explicit", timeSteps: 400, assetSteps: 200, dampingSteps: 0, scheme: 0}}
            }
        };
        expect(errors(trade)).toContain("engine.fd.custom.scheme");

        const grid = (trade.engine!.parameters as {case: "fd"; value: {grid: {case: "custom"; value: {scheme: number; dampingSteps: number}}}}).value.grid.value;
        grid.scheme = FdParameters_Explicit_Scheme.DOUGLAS;
        expect(errors(trade)).toEqual([]);

        // Damping steps come out of the time steps rather than being added to
        // them, so there have to be more of the second than the first.
        grid.dampingSteps = 400;
        expect(errors(trade)).toContain("engine.fd.custom.damping_steps");
    });

    it("requires a tree and non-zero steps on a lattice", () => {
        const trade = seedTrade();
        trade.engine!.method = Engine_Method.LATTICE;
        trade.engine!.parameters = {
            case: "lattice",
            value: {$typeName: "quantlib.v2.LatticeParameters", tree: 0, steps: 0}
        };
        const paths = errors(trade);
        expect(paths).toContain("engine.lattice.tree");
        expect(paths).toContain("engine.lattice.steps");
    });
});

describe("backend paths", () => {
    it("the paths this produces are the ones the backend sends", () => {
        // session.cpp builds "instrument.option" + ".underlyings[0]" and
        // "engine.analytic.approximation"; a client path that does not match
        // exactly cannot bind a rejection to a control.
        const trade = seedTrade();
        option(trade).underlyings[0]!.spotQuoteId = "";
        expect(errors(trade)).toContain("instrument.option.underlyings[0].spot_quote_id");
    });
});

describe("the styles M4 added", () => {
    it("requires a positive barrier and a type", () => {
        const trade = seedTrade();
        option(trade).style = {case: "barrier", value: {$typeName: "quantlib.v2.Barrier", type: 0, level: 0, rebate: 0, monitoringDates: []}};
        const paths = errors(trade);
        expect(paths).toContain("instrument.option.barrier.type");
        expect(paths).toContain("instrument.option.barrier.level");
    });

    it("needs 0 < lower < upper on a double barrier", () => {
        const trade = seedTrade();
        option(trade).style = {case: "doubleBarrier", value: {$typeName: "quantlib.v2.DoubleBarrier", type: 2, lower: 120, upper: 80, rebate: 0}};
        expect(errors(trade)).toContain("instrument.option.double_barrier.lower");
    });

    it("refuses a continuously averaged arithmetic Asian", () => {
        // "a continuously averaged Asian option has a closed form for the
        // geometric average only" — session.cpp:1637.
        const trade = seedTrade();
        option(trade).style = {case: "asian", value: {$typeName: "quantlib.v2.Asian", averaging: Asian_Averaging.ARITHMETIC, fixingDates: [], runningAverage: 0, pastFixings: 0}};
        expect(errors(trade)).toContain("instrument.option.asian.averaging");
    });

    it("requires the extremum a running lookback has already realised", () => {
        const trade = seedTrade();
        option(trade).style = {case: "lookback", value: {$typeName: "quantlib.v2.Lookback", runningExtremum: 0, level: 0}};
        expect(errors(trade)).toContain("instrument.option.lookback.running_extremum");
    });

    it("forces a percentage strike and an explicit performance flag on a forward start", () => {
        const trade = seedTrade();
        option(trade).style = {case: "forwardStart", value: {$typeName: "quantlib.v2.ForwardStart", performance: 0}};
        const paths = errors(trade);
        expect(paths).toContain("instrument.option.payoff.percentage_strike");
        expect(paths).toContain("instrument.option.forward_start.reset");
        expect(paths).toContain("instrument.option.forward_start.performance");
    });

    it("holds a knock digital to what its engine actually reads", () => {
        // A barrier with a binary payoff. The rebate is the interesting one:
        // AnalyticBinaryBarrierEngine never reads it, so it would be taken and
        // dropped rather than refused by QuantLib.
        const trade = seedTrade();
        option(trade).style = {case: "barrier", value: {$typeName: "quantlib.v2.Barrier", type: Barrier_Type.DOWN_IN, level: 90, rebate: 3, monitoringDates: []}};
        option(trade).payoff = {$typeName: "quantlib.v2.Payoff", type: Payoff_OptionType.CALL, kind: {case: "cashOrNothing", value: {$typeName: "quantlib.v2.CashOrNothingPayoff", strike: 100, cashPayoff: 15}}};
        const paths = errors(trade);
        expect(paths).toContain("instrument.option.exercise.type");
        expect(paths).toContain("instrument.option.barrier.rebate");
    });

    it("wants a knock digital settled at expiry, not on touch", () => {
        const trade = seedTrade();
        option(trade).style = {case: "barrier", value: {$typeName: "quantlib.v2.Barrier", type: Barrier_Type.DOWN_IN, level: 90, rebate: 0, monitoringDates: []}};
        option(trade).payoff = {$typeName: "quantlib.v2.Payoff", type: Payoff_OptionType.CALL, kind: {case: "cashOrNothing", value: {$typeName: "quantlib.v2.CashOrNothingPayoff", strike: 100, cashPayoff: 15}}};
        option(trade).exercise!.type = Exercise_Type.AMERICAN;
        option(trade).exercise!.payoffAtExpiry = Flag.FALSE;
        expect(errors(trade)).toContain("instrument.option.exercise.payoff_at_expiry");

        option(trade).exercise!.payoffAtExpiry = Flag.TRUE;
        expect(errors(trade)).toEqual([]);
    });

    it("wants the option a compound is written on, and wants it plain", () => {
        const trade = seedTrade();
        option(trade).style = {
            case: "compound",
            value: {
                $typeName: "quantlib.v2.Compound",
                daughterPayoff: {$typeName: "quantlib.v2.Payoff", type: 0, kind: {case: "plain", value: {$typeName: "quantlib.v2.PlainVanillaPayoff", strike: 0}}},
                daughterExercise: {$typeName: "quantlib.v2.Exercise", type: 0, dates: [], payoffAtExpiry: 0}
            }
        };
        const paths = errors(trade);
        expect(paths).toContain("instrument.option.compound.daughter_payoff.type");
        expect(paths).toContain("instrument.option.compound.daughter_payoff.plain.strike");
        expect(paths).toContain("instrument.option.compound.daughter_exercise.type");
        expect(paths).toContain("instrument.option.compound.daughter_exercise.dates");
    });

    it("refuses a compound that outlives the option it is written on", () => {
        // CompoundOption::arguments::validate throws on this and names no field,
        // so it is caught here where there is one.
        const trade = seedTrade();
        const expiry = option(trade).exercise!.dates[0]!;
        option(trade).style = {
            case: "compound",
            value: {
                $typeName: "quantlib.v2.Compound",
                daughterPayoff: {$typeName: "quantlib.v2.Payoff", type: Payoff_OptionType.CALL, kind: {case: "plain", value: {$typeName: "quantlib.v2.PlainVanillaPayoff", strike: 100}}},
                daughterExercise: {$typeName: "quantlib.v2.Exercise", type: Exercise_Type.EUROPEAN, dates: [{$typeName: "quantlib.v1.Date", form: {case: "iso", value: "2000-01-01"}}], payoffAtExpiry: 0}
            }
        };
        expect(expiry.form.case).toBe("iso");
        expect(errors(trade)).toContain("instrument.option.compound.daughter_exercise.dates");
    });

    it("refuses the mother named twice, as the backend does", () => {
        const trade = seedTrade();
        option(trade).style = {
            case: "compound",
            value: {
                $typeName: "quantlib.v2.Compound",
                motherPayoff: {$typeName: "quantlib.v2.Payoff", type: Payoff_OptionType.CALL, kind: {case: "plain", value: {$typeName: "quantlib.v2.PlainVanillaPayoff", strike: 100}}},
                daughterPayoff: {$typeName: "quantlib.v2.Payoff", type: Payoff_OptionType.CALL, kind: {case: "plain", value: {$typeName: "quantlib.v2.PlainVanillaPayoff", strike: 100}}},
                daughterExercise: {$typeName: "quantlib.v2.Exercise", type: Exercise_Type.EUROPEAN, dates: [{$typeName: "quantlib.v1.Date", form: {case: "iso", value: "2099-01-01"}}], payoffAtExpiry: 0}
            }
        };
        expect(errors(trade)).toContain("instrument.option.compound.mother_payoff");
    });

    it("wants a basket's assets labelled, correlated and accumulated", () => {
        const trade = basketTrade();
        const basket = option(trade).style.value as Basket;
        basket.kind = Basket_Kind.UNSPECIFIED;
        basket.correlationId = "";
        option(trade).underlyings[1]!.label = "";
        const paths = basketErrors(trade);
        expect(paths).toContain("instrument.option.basket.kind");
        expect(paths).toContain("instrument.option.basket.correlation_id");
        expect(paths).toContain("instrument.option.underlyings[1].label");
    });

    it("refuses a label the correlation matrix has no row for", () => {
        const trade = basketTrade();
        option(trade).underlyings[1]!.label = "Z";
        expect(basketErrors(trade)).toContain("instrument.option.underlyings[1].label");
    });

    it("reads basket weights on an average and refuses them elsewhere", () => {
        // AverageBasketPayoff is the only payoff that looks at them, so on the
        // other kinds they would be taken and dropped.
        const trade = basketTrade();
        const basket = option(trade).style.value as Basket;
        basket.weights = [0.5, 0.5];
        expect(basketErrors(trade)).toContain("instrument.option.basket.weights");

        basket.kind = Basket_Kind.AVERAGE;
        trade.engine!.method = Engine_Method.MONTE_CARLO;
        trade.engine!.parameters = {
            case: "mc",
            value: {$typeName: "quantlib.v2.McParameters", seed: 42n, stopping: {case: "samples", value: 10000n}, rng: 1, timeStepsPerYear: 1, progressEveryPaths: 0n, antitheticVariate: false, controlVariate: false, brownianBridge: false}
        };
        expect(basketErrors(trade)).toEqual([]);

        basket.weights = [0.5];
        expect(basketErrors(trade)).toContain("instrument.option.basket.weights");
    });

    it("closes the closed form past two assets", () => {
        const trade = basketTrade();
        option(trade).underlyings.push({...option(trade).underlyings[0]!, label: "C"});
        expect(basketErrors(trade)).toContain("engine.method");
    });

    it("refuses the cliquet caps QuantLib never copies to an engine", () => {
        // CliquetOption::setupArguments copies the reset dates and stops, so a
        // cap would price as the uncapped ratchet with nothing said.
        const trade = cliquetTrade();
        const cliquet = option(trade).style.value as Cliquet;
        cliquet.localCap = 0.05;
        cliquet.globalFloor = 0.01;
        const paths = cliquetErrors(trade);
        expect(paths).toContain("instrument.option.cliquet.local_cap");
        expect(paths).toContain("instrument.option.cliquet.global_floor");
    });

    it("wants reset dates in order, before the expiry and after today", () => {
        const trade = cliquetTrade();
        const cliquet = option(trade).style.value as Cliquet;
        const on = (iso: string) => ({$typeName: "quantlib.v1.Date" as const, form: {case: "iso" as const, value: iso}});

        cliquet.resetDates = [on("2028-01-01")];
        expect(cliquetErrors(trade)).toContain("instrument.option.cliquet.reset_dates[0]");

        cliquet.resetDates = [on("2020-01-01")];
        expect(cliquetErrors(trade)).toContain("instrument.option.cliquet.reset_dates[0]");

        cliquet.resetDates = [on("2027-03-01"), on("2027-01-01")];
        expect(cliquetErrors(trade)).toContain("instrument.option.cliquet.reset_dates[1]");

        cliquet.resetDates = [on("2027-01-01"), on("2027-03-01")];
        expect(cliquetErrors(trade)).toEqual([]);
    });

    it("makes the cliquet performance flag explicit, as the forward start's is", () => {
        const trade = cliquetTrade();
        const cliquet = option(trade).style.value as Cliquet;
        cliquet.performance = Flag.UNSPECIFIED;
        expect(cliquetErrors(trade)).toContain("instrument.option.cliquet.performance");
    });

    it("closes Monte Carlo on a ratchet and opens it on the performance form", () => {
        const trade = cliquetTrade();
        trade.engine!.method = Engine_Method.MONTE_CARLO;
        expect(cliquetErrors(trade)).toContain("engine.method");

        (option(trade).style.value as Cliquet).performance = Flag.TRUE;
        expect(cliquetErrors(trade)).not.toContain("engine.method");
    });

    it("takes a simple chooser with no side and no put leg", () => {
        // SimpleChooserOption builds its own PlainVanillaPayoff and forces the
        // type to Call, so a type set here would be read and thrown away.
        const trade = chooserTrade();
        expect(chooserErrors(trade)).toEqual([]);

        option(trade).payoff!.type = Payoff_OptionType.CALL;
        expect(chooserErrors(trade)).toContain("instrument.option.payoff.type");
    });

    it("refuses a chooser naming its strike or expiry twice", () => {
        const trade = chooserTrade();
        const chooser = option(trade).style.value as Chooser;
        chooser.callStrike = 100;
        chooser.callExpiry = {$typeName: "quantlib.v1.Date", form: {case: "iso", value: HANDLERS_EXPIRY}};
        const paths = chooserErrors(trade);
        expect(paths).toContain("instrument.option.chooser.call_strike");
        expect(paths).toContain("instrument.option.chooser.call_expiry");
    });

    it("wants the choice made before the expiry and after today", () => {
        const trade = chooserTrade();
        const chooser = option(trade).style.value as Chooser;
        chooser.choiceDate = {$typeName: "quantlib.v1.Date", form: {case: "iso", value: "2028-01-01"}};
        expect(chooserErrors(trade)).toContain("instrument.option.chooser.choice_date");

        chooser.choiceDate = {$typeName: "quantlib.v1.Date", form: {case: "iso", value: "2020-01-01"}};
        expect(chooserErrors(trade)).toContain("instrument.option.chooser.choice_date");
    });

    it("wants a put strike and a put expiry together or not at all", () => {
        const trade = chooserTrade();
        const chooser = option(trade).style.value as Chooser;
        chooser.putStrike = 95;
        expect(chooserErrors(trade)).toContain("instrument.option.chooser.put_expiry");

        chooser.putExpiry = {$typeName: "quantlib.v1.Date", form: {case: "iso", value: HANDLERS_EXPIRY}};
        expect(chooserErrors(trade)).toEqual([]);
    });

    it("refuses a complex leg expiring inside twice the choice time", () => {
        // AnalyticComplexChooserEngine solves for the critical spot at
        // (expiry - 2 x choice time); below that the vol surface is asked for a
        // negative time and throws with no field on it.
        const trade = chooserTrade();
        const chooser = option(trade).style.value as Chooser;
        chooser.choiceDate = {$typeName: "quantlib.v1.Date", form: {case: "iso", value: "2027-05-01"}};
        chooser.putStrike = 95;
        chooser.putExpiry = {$typeName: "quantlib.v1.Date", form: {case: "iso", value: HANDLERS_EXPIRY}};
        const paths = chooserErrors(trade);
        expect(paths).toContain("instrument.option.exercise.dates");
        expect(paths).toContain("instrument.option.chooser.put_expiry");
    });

    it("refuses a chooser whose curves count days differently", () => {
        // AnalyticSimpleChooserEngine requires all three to agree and throws
        // with no field; the complex engine assumes it and never checks.
        const trade = chooserTrade();
        const dividend = market.find(object => object.id === option(trade).underlyings[0]!.dividendCurveId)!;
        const curve = asYieldCurve(dividend)!;
        const original = curve.dayCounter;
        curve.dayCounter = {$typeName: "quantlib.v1.DayCounter", family: DayCounter_Family.ACTUAL_365_FIXED, thirty360: 0, actualActual: 0};
        expect(chooserErrors(trade)).toContain("instrument.option.underlyings[0].dividend_curve_id");
        curve.dayCounter = original;
    });

    it("flags a method the new style cannot take", () => {
        // Switching style can leave a method selected that no longer applies; the
        // control disables it, and this catches the one already chosen.
        const trade = seedTrade();
        option(trade).style = {case: "doubleBarrier", value: {$typeName: "quantlib.v2.DoubleBarrier", type: 2, lower: 80, upper: 120, rebate: 0}};
        trade.engine!.method = Engine_Method.LATTICE;
        expect(errors(trade)).toContain("engine.method");
    });
});

describe("quanto", () => {
    const withQuanto = (ids: {fx?: string; vol?: string; corr?: string} = {}) => {
        const trade = seedTrade();
        option(trade).quanto = {
            $typeName: "quantlib.v2.Quanto",
            fxRiskFreeCurveId: ids.fx ?? "RC",
            fxVolatilityId: ids.vol ?? "VOL",
            correlationId: ids.corr ?? "V"
        };
        return trade;
    };

    it("accepts all three ids on a vanilla", () => {
        expect(errors(withQuanto())).toEqual([]);
    });

    it("needs all three", () => {
        expect(errors(withQuanto({corr: ""}))).toContain("instrument.option.quanto.correlation_id");
    });

    it("blocks a quanto lookback, which this build would silently ignore", () => {
        // session.cpp's lookback branch builds its engine on graph.process and
        // never consults graph.quanto, so the adjustment would be dropped without
        // an error. A wrong number that looks right is the worst outcome.
        const trade = withQuanto();
        option(trade).style = {case: "lookback", value: {$typeName: "quantlib.v2.Lookback", runningExtremum: 100, level: 0}};
        expect(errors(trade)).toContain("instrument.option.quanto");
    });

    it("blocks a quanto Asian, which QuantLib has no engine for", () => {
        const trade = withQuanto();
        option(trade).style = {case: "asian", value: {$typeName: "quantlib.v2.Asian", averaging: Asian_Averaging.GEOMETRIC, fixingDates: [], runningAverage: 0, pastFixings: 0}};
        expect(errors(trade)).toContain("instrument.option.quanto");
    });
});

describe("Monte Carlo parameters", () => {
    it("requires a non-zero seed and a sample budget", () => {
        const trade = seedTrade();
        option(trade).style = {case: "barrier", value: {$typeName: "quantlib.v2.Barrier", type: Barrier_Type.DOWN_OUT, level: 90, rebate: 0, monitoringDates: []}};
        trade.engine!.method = Engine_Method.MONTE_CARLO;
        const paths = errors(trade);
        expect(paths).toContain("engine.mc.seed");
        expect(paths).toContain("engine.mc.samples");
    });
});
