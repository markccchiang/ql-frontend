import {describe, expect, it} from "vitest";
import {Engine_Method} from "@/gen/quantlib/v2/engine_pb";
import {Asian_Averaging, Exercise_Type} from "@/gen/quantlib/v2/instrument_pb";
import {engineMethodsFor, isOpen, needsApproximation, type EngineContext, type StyleCase} from "./capabilities";

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
});
