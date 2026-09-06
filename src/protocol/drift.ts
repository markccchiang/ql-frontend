import type {Capabilities} from "@/gen/quantlib/v2/envelope_pb";

import {
    APPROXIMATIONS,
    BOOTSTRAP_INTERPOLATORS,
    BOOTSTRAP_TRAITS,
    type Choice,
    CURVE_SHAPES,
    EXERCISES,
    INDEX_FAMILIES,
    INSTRUMENTS,
    latticeTrees,
    LEG_KINDS,
    MARKET_KINDS,
    type PayoffCase,
    payoffsFor,
    PILLAR_KINDS,
    PROCESSES,
    STYLES,
    VOLATILITY_SHAPES
} from "./capabilities";

/** Compares what this client offers with what the service says it can price.
 *
 *  The capability tables here are a second copy of a fact the backend owns, and
 *  a second copy drifts. Before the handshake existed the only way to notice
 *  was for a user to hit it: the client would offer something that came back
 *  UNSUPPORTED, or hide something the service had since learned. Now the two
 *  can be diffed, and the diff is checked.
 *
 *  Only the *sets* are compared. Combination rules — that an analytic barrier
 *  is European only — stay local, because the wire carries sets and the rules
 *  are ours.
 */
export interface Drift {
    what: string;
    /** Offered here, not advertised there: authoring this earns a rejection. */
    weOfferTheyDoNot: string[];
    /** Advertised there, not offered here: the service grew and we did not. */
    theyOfferWeDoNot: string[];
}

function compare<T extends string | number>(what: string, ours: Choice<T>[], theirs: readonly T[], name: (value: T) => string): Drift | null {
    // "pending" means the backend prices it and this client has not built the
    // controls; that is a known gap rather than drift, so it counts as offered.
    const offered = new Set(ours.filter(choice => choice.availability !== "unsupported").map(choice => name(choice.value)));
    const advertised = new Set(theirs.map(name));

    const weOfferTheyDoNot = [...offered].filter(value => !advertised.has(value)).sort();
    const theyOfferWeDoNot = [...advertised].filter(value => !offered.has(value)).sort();
    return weOfferTheyDoNot.length || theyOfferWeDoNot.length ? {what, weOfferTheyDoNot, theyOfferWeDoNot} : null;
}

const asString = (value: string | number) => String(value);

/** Every payoff some style can take. */
function unionOfPayoffs(): Choice<PayoffCase>[] {
    const best = new Map<PayoffCase, Choice<PayoffCase>>();
    for (const style of STYLES) {
        for (const choice of payoffsFor(style.value)) {
            const held = best.get(choice.value);
            if (!held || (held.availability === "unsupported" && choice.availability !== "unsupported")) {
                best.set(choice.value, choice);
            }
        }
    }
    return [...best.values()];
}

export function findDrift(reported: Capabilities): Drift[] {
    const drift: (Drift | null)[] = [
        compare("instruments", INSTRUMENTS, reported.instruments, asString),
        compare("option styles", STYLES, reported.optionStyles.map(camel), asString),
        // The union across styles, not the base table: the wire carries the
        // set of payoffs that exist, and which style may take which is a
        // combination rule this client keeps. `floating` is built and is valid
        // on a lookback alone, so a comparison against the base table reports
        // drift that is not there.
        compare("payoffs", unionOfPayoffs(), reported.payoffs.map(camel), asString),
        compare("exercises", EXERCISES, reported.exercises, asString),
        compare("processes", PROCESSES, reported.processes, asString),
        compare("lattice trees", latticeTrees("vanilla"), reported.latticeTrees, asString),
        compare("approximations", APPROXIMATIONS, reported.approximations, asString),
        compare("index families", INDEX_FAMILIES, reported.indexFamilies, asString),
        compare("pillar kinds", PILLAR_KINDS, reported.pillarKinds, asString),
        compare("bootstrap traits", BOOTSTRAP_TRAITS, reported.bootstrapTraits, asString),
        compare("bootstrap interpolators", BOOTSTRAP_INTERPOLATORS, reported.bootstrapInterpolators, asString),
        compare("leg kinds", LEG_KINDS, reported.legKinds, asString),
        // The market half of the schema, which went uncompared for a
        // milestone: the service advertises what it builds here too, and the
        // one time the two disagreed -- a correlation matrix this service
        // priced and did not advertise -- nothing said so, because nothing
        // was looking.
        compare("market kinds", MARKET_KINDS, reported.marketKinds.map(camel), asString),
        compare("curve shapes", CURVE_SHAPES, reported.yieldCurveShapes.map(camel), asString),
        compare("volatility shapes", VOLATILITY_SHAPES, reported.volatilityShapes.map(camel), asString)
    ];
    return drift.filter((entry): entry is Drift => entry !== null);
}

/** The wire names oneof arms in snake_case; the generated client sees the
 *  camelCase property names. */
function camel(arm: string): string {
    return arm.replace(/_([a-z])/g, (_match, letter: string) => letter.toUpperCase());
}

export function describeDrift(drift: readonly Drift[]): string[] {
    return drift.flatMap(entry => [
        ...entry.weOfferTheyDoNot.map(value => `${entry.what}: this build offers ${value}, the service does not price it`),
        ...entry.theyOfferWeDoNot.map(value => `${entry.what}: the service prices ${value}, this build does not offer it`)
    ]);
}
