import {describe, expect, it} from "vitest";

import {Engine_Method} from "@/gen/quantlib/v2/engine_pb";
import {Asian_Averaging, Exercise_Type} from "@/gen/quantlib/v2/instrument_pb";

import {canImplyVolatility, type EngineContext, engineMethodsFor, exercisesFor, isOpen, needsApproximation, payoffsFor, quantoSupport, type StyleCase, STYLES} from "./capabilities";

const context = (style: StyleCase, over: Partial<EngineContext> = {}): EngineContext => ({
    style,
    exercise: Exercise_Type.EUROPEAN,
    payoff: "plain",
    quanto: false,
    averaging: Asian_Averaging.GEOMETRIC,
    discreteAsian: false,
    ...over
});

const methodsFor = (style: StyleCase, over: Partial<EngineContext> = {}) => new Map(engineMethodsFor(context(style, over)).map(choice => [choice.value, choice]));

/** These encode what src/session/session.cpp actually dispatches, which is
 *  narrower than the table in HANDLERS.md. If the backend grows an engine,
 *  these fail and say where. */
describe("engineMethodsFor, vanilla", () => {
    it("offers analytic, integral, lattice and FD on a European", () => {
        const methods = methodsFor("vanilla");
        for (const method of [Engine_Method.ANALYTIC, Engine_Method.INTEGRAL, Engine_Method.LATTICE, Engine_Method.FINITE_DIFFERENCE]) {
            expect(isOpen(methods.get(method)!), Engine_Method[method]).toBe(true);
        }
    });

    it("closes the integral engine off a European exercise", () => {
        // "the integral engine is European only" — session.cpp:1366
        const american = methodsFor("vanilla", {exercise: Exercise_Type.AMERICAN});
        expect(isOpen(american.get(Engine_Method.INTEGRAL)!)).toBe(false);
        expect(american.get(Engine_Method.INTEGRAL)!.reason).toMatch(/European only/);
    });

    it("closes Monte Carlo off a European exercise", () => {
        // "MCEuropeanEngine is European only" — session.cpp:1383
        expect(isOpen(methodsFor("vanilla", {exercise: Exercise_Type.AMERICAN}).get(Engine_Method.MONTE_CARLO)!)).toBe(false);
    });

    it("closes analytic on a Bermudan", () => {
        // Every analytic branch for a vanilla requires a European or American
        // exercise: baroneadesiwhaleyengine.cpp:142,
        // analyticdigitalamericanengine.cpp:40.
        const bermudan = methodsFor("vanilla", {exercise: Exercise_Type.BERMUDAN});
        expect(isOpen(bermudan.get(Engine_Method.ANALYTIC)!)).toBe(false);
        expect(isOpen(bermudan.get(Engine_Method.LATTICE)!)).toBe(true);
        expect(isOpen(bermudan.get(Engine_Method.FINITE_DIFFERENCE)!)).toBe(true);
    });
});

describe("needsApproximation", () => {
    it("is required for an American analytic price", () => {
        expect(needsApproximation(Exercise_Type.AMERICAN, Engine_Method.ANALYTIC, "plain")).toBe(true);
    });

    it("is not required for a European", () => {
        expect(needsApproximation(Exercise_Type.EUROPEAN, Engine_Method.ANALYTIC, "plain")).toBe(false);
    });

    it("is not required for a binary payoff, which is a one-touch", () => {
        // digitalPayoff && !european goes to AnalyticDigitalAmericanEngine and
        // never reads the approximation — session.cpp:1330-1334.
        expect(needsApproximation(Exercise_Type.AMERICAN, Engine_Method.ANALYTIC, "cashOrNothing")).toBe(false);
        expect(needsApproximation(Exercise_Type.AMERICAN, Engine_Method.ANALYTIC, "assetOrNothing")).toBe(false);
    });

    it("is not required off the analytic method", () => {
        expect(needsApproximation(Exercise_Type.AMERICAN, Engine_Method.LATTICE, "plain")).toBe(false);
    });
});

describe("engineMethodsFor, the other styles", () => {
    it("closes the analytic barrier off a European exercise but keeps lattice and FD", () => {
        // "AnalyticBarrierEngine is European only; an American barrier takes
        // METHOD_LATTICE or METHOD_FINITE_DIFFERENCE" — session.cpp:1454.
        const american = methodsFor("barrier", {exercise: Exercise_Type.AMERICAN});
        expect(isOpen(american.get(Engine_Method.ANALYTIC)!)).toBe(false);
        expect(isOpen(american.get(Engine_Method.LATTICE)!)).toBe(true);
        expect(isOpen(american.get(Engine_Method.FINITE_DIFFERENCE)!)).toBe(true);
    });

    it("leaves a double barrier analytic only", () => {
        const methods = methodsFor("doubleBarrier");
        expect(isOpen(methods.get(Engine_Method.ANALYTIC)!)).toBe(true);
        expect(isOpen(methods.get(Engine_Method.FINITE_DIFFERENCE)!)).toBe(false);
    });

    it("sends an arithmetic discrete Asian to Monte Carlo and nowhere else", () => {
        const methods = methodsFor("asian", {discreteAsian: true, averaging: Asian_Averaging.ARITHMETIC});
        expect(isOpen(methods.get(Engine_Method.MONTE_CARLO)!)).toBe(true);
        expect(isOpen(methods.get(Engine_Method.ANALYTIC)!)).toBe(false);
    });

    it("sends a geometric discrete Asian to the closed form and nowhere else", () => {
        const methods = methodsFor("asian", {discreteAsian: true, averaging: Asian_Averaging.GEOMETRIC});
        expect(isOpen(methods.get(Engine_Method.ANALYTIC)!)).toBe(true);
        expect(isOpen(methods.get(Engine_Method.MONTE_CARLO)!)).toBe(false);
    });

    it("closes everything but analytic on a continuous Asian", () => {
        const methods = methodsFor("asian", {discreteAsian: false});
        expect(isOpen(methods.get(Engine_Method.ANALYTIC)!)).toBe(true);
        expect(isOpen(methods.get(Engine_Method.MONTE_CARLO)!)).toBe(false);
    });

    it("leaves a quanto vanilla with analytic and FD only", () => {
        const methods = methodsFor("vanilla", {quanto: true});
        expect(isOpen(methods.get(Engine_Method.ANALYTIC)!)).toBe(true);
        expect(isOpen(methods.get(Engine_Method.FINITE_DIFFERENCE)!)).toBe(true);
        expect(isOpen(methods.get(Engine_Method.LATTICE)!)).toBe(false);
    });

    it("leaves a compound analytic only", () => {
        const methods = methodsFor("compound");
        expect(isOpen(methods.get(Engine_Method.ANALYTIC)!)).toBe(true);
        for (const method of [Engine_Method.LATTICE, Engine_Method.FINITE_DIFFERENCE, Engine_Method.MONTE_CARLO, Engine_Method.INTEGRAL]) {
            expect(isOpen(methods.get(method)!), Engine_Method[method]).toBe(false);
        }
    });
});

describe("the knock digital", () => {
    // A binary payoff on a barrier. There is no digital-knock instrument in
    // QuantLib, so the gate is style x payoff rather than style alone.
    const digital = (over: Partial<EngineContext> = {}) => context("barrier", {payoff: "cashOrNothing", exercise: Exercise_Type.AMERICAN, ...over});

    it("takes analytic and nothing else", () => {
        const methods = new Map(engineMethodsFor(digital()).map(choice => [choice.value, choice]));
        expect(isOpen(methods.get(Engine_Method.ANALYTIC)!)).toBe(true);
        for (const method of [Engine_Method.LATTICE, Engine_Method.FINITE_DIFFERENCE, Engine_Method.MONTE_CARLO]) {
            expect(isOpen(methods.get(method)!), Engine_Method[method]).toBe(false);
        }
    });

    it("is American only, where a plain barrier is not", () => {
        const forDigital = new Map(exercisesFor("barrier", false, "cashOrNothing").map(choice => [choice.value, choice]));
        expect(isOpen(forDigital.get(Exercise_Type.AMERICAN)!)).toBe(true);
        expect(isOpen(forDigital.get(Exercise_Type.EUROPEAN)!)).toBe(false);

        const forPlain = new Map(exercisesFor("barrier", false, "plain").map(choice => [choice.value, choice]));
        expect(isOpen(forPlain.get(Exercise_Type.EUROPEAN)!)).toBe(true);
        expect(isOpen(forPlain.get(Exercise_Type.AMERICAN)!)).toBe(true);
    });

    it("has no quanto engine, where a plain barrier does", () => {
        expect(isOpen(quantoSupport("barrier", "cashOrNothing"))).toBe(false);
        expect(isOpen(quantoSupport("barrier", "plain"))).toBe(true);
    });

    it("closes the analytic barrier off a payoff that is neither plain nor binary", () => {
        // "non-plain payoff given" — analyticbarrierengine.cpp:40.
        const methods = new Map(engineMethodsFor(context("barrier", {payoff: "gap"})).map(choice => [choice.value, choice]));
        expect(isOpen(methods.get(Engine_Method.ANALYTIC)!)).toBe(false);
        expect(isOpen(methods.get(Engine_Method.FINITE_DIFFERENCE)!)).toBe(true);
    });
});

describe("what a compound will take", () => {
    it("is European, plain and not quanto", () => {
        const european = exercisesFor("compound", false).find(choice => choice.value === Exercise_Type.EUROPEAN)!;
        const american = exercisesFor("compound", false).find(choice => choice.value === Exercise_Type.AMERICAN)!;
        expect(isOpen(european)).toBe(true);
        expect(isOpen(american)).toBe(false);

        // The engine casts both payoffs back to a PlainVanillaPayoff.
        for (const choice of payoffsFor("compound")) {
            expect(isOpen(choice), choice.label).toBe(choice.value === "plain");
        }

        expect(isOpen(quantoSupport("compound"))).toBe(false);
    });

    it("cannot be inverted for an implied volatility", () => {
        // OneAssetOption does not declare impliedVolatility; VanillaOption does.
        expect(canImplyVolatility("compound")).toBe(false);
    });
});

describe("what a chooser will take", () => {
    it("is European, plain, analytic and not quanto", () => {
        // Neither engine reads the exercise type, so an American one would be
        // priced as European rather than refused by QuantLib.
        const exercises = new Map(exercisesFor("chooser", false).map(choice => [choice.value, choice]));
        expect(isOpen(exercises.get(Exercise_Type.EUROPEAN)!)).toBe(true);
        expect(isOpen(exercises.get(Exercise_Type.AMERICAN)!)).toBe(false);

        // Both instruments build their own PlainVanillaPayoff.
        for (const choice of payoffsFor("chooser")) {
            expect(isOpen(choice), choice.label).toBe(choice.value === "plain");
        }

        const methods = new Map(engineMethodsFor(context("chooser")).map(choice => [choice.value, choice]));
        expect(isOpen(methods.get(Engine_Method.ANALYTIC)!)).toBe(true);
        for (const method of [Engine_Method.LATTICE, Engine_Method.FINITE_DIFFERENCE, Engine_Method.MONTE_CARLO]) {
            expect(isOpen(methods.get(method)!), Engine_Method[method]).toBe(false);
        }

        expect(isOpen(quantoSupport("chooser"))).toBe(false);
    });

    it("is offered at all, now that it prices", () => {
        expect(isOpen(STYLES.find(choice => choice.value === "chooser")!)).toBe(true);
    });
});
