import {create} from "@bufbuild/protobuf";
import {describe, expect, it} from "vitest";

import {Engine_Method, FdParameters_Preset} from "@/gen/quantlib/v2/engine_pb";
import {CapabilitiesSchema} from "@/gen/quantlib/v2/envelope_pb";
import {ResultKind} from "@/gen/quantlib/v2/results_pb";

import {findDrift} from "./drift";

/** A service that advertises exactly the three sets under test, and nothing
 *  else -- so every other comparison reports drift, and these tests look only
 *  at the three they are about. */
function advertising(methods: Engine_Method[], presets: FdParameters_Preset[], results: ResultKind[]) {
    return findDrift(create(CapabilitiesSchema, {engineMethods: methods, fdPresets: presets, resultKinds: results}));
}

const drift = (entries: ReturnType<typeof findDrift>, what: string) => entries.find(entry => entry.what === what) ?? null;

// What this build prices, per HANDLERS.md: every method but Fourier, the three
// grids, and the nineteen mapped results.
const METHODS = [Engine_Method.ANALYTIC, Engine_Method.INTEGRAL, Engine_Method.LATTICE, Engine_Method.FINITE_DIFFERENCE, Engine_Method.MONTE_CARLO, Engine_Method.DISCOUNTING];
const PRESETS = [FdParameters_Preset.COARSE, FdParameters_Preset.STANDARD, FdParameters_Preset.FINE];
const RESULTS = [
    ResultKind.NPV,
    ResultKind.DELTA,
    ResultKind.GAMMA,
    ResultKind.THETA,
    ResultKind.VEGA,
    ResultKind.RHO,
    ResultKind.DIVIDEND_RHO,
    ResultKind.THETA_PER_DAY,
    ResultKind.DELTA_FORWARD,
    ResultKind.ELASTICITY,
    ResultKind.STRIKE_SENSITIVITY,
    ResultKind.ITM_CASH_PROBABILITY,
    ResultKind.IMPLIED_VOLATILITY,
    ResultKind.QRHO,
    ResultKind.QVEGA,
    ResultKind.QLAMBDA,
    ResultKind.FAIR_RATE,
    ResultKind.LEG_NPV,
    ResultKind.LEG_BPS
];

describe("drift in the engine and result sets", () => {
    // The file said these were compared, and nothing compared them: a method,
    // a grid or a result kind could leave either side with nothing to say so.
    it("finds none when the service advertises what this client offers", () => {
        const found = advertising(METHODS, PRESETS, RESULTS);
        expect(drift(found, "engine methods")).toBeNull();
        expect(drift(found, "finite-difference presets")).toBeNull();
        expect(drift(found, "result kinds")).toBeNull();
    });

    it("names each side of a difference", () => {
        const found = advertising(
            [...METHODS.filter(method => method !== Engine_Method.INTEGRAL), Engine_Method.FOURIER],
            PRESETS.filter(preset => preset !== FdParameters_Preset.FINE),
            RESULTS.filter(kind => kind !== ResultKind.LEG_BPS)
        );
        expect(drift(found, "engine methods")).toEqual({what: "engine methods", weOfferTheyDoNot: [String(Engine_Method.INTEGRAL)], theyOfferWeDoNot: [String(Engine_Method.FOURIER)]});
        expect(drift(found, "finite-difference presets")?.weOfferTheyDoNot).toEqual([String(FdParameters_Preset.FINE)]);
        expect(drift(found, "result kinds")?.weOfferTheyDoNot).toEqual([String(ResultKind.LEG_BPS)]);
    });
});
