import {Engine_Method} from "@/gen/quantlib/v2/engine_pb";
import type {PriceRequest} from "@/gen/quantlib/v2/envelope_pb";
import {Exercise_Type, Payoff_OptionType} from "@/gen/quantlib/v2/instrument_pb";
import {type StyleCase, STYLES} from "@/protocol/capabilities";

const EXERCISES: Partial<Record<Exercise_Type, string>> = {
    [Exercise_Type.EUROPEAN]: "european",
    [Exercise_Type.AMERICAN]: "american",
    [Exercise_Type.BERMUDAN]: "bermudan"
};

const METHODS: Partial<Record<Engine_Method, string>> = {
    [Engine_Method.ANALYTIC]: "analytic",
    [Engine_Method.LATTICE]: "lattice",
    [Engine_Method.MONTE_CARLO]: "monte carlo",
    [Engine_Method.FINITE_DIFFERENCE]: "finite difference",
    [Engine_Method.INTEGRAL]: "integral"
};

/** A name for a trade, read off the trade.
 *
 *  The wire has no label field and inventing one would mean asking the user to
 *  name forty rows. Derived instead, so a row in the book says what it is and
 *  cannot drift from what it prices — the same reason the engine echo is shown
 *  beside a result rather than the engine that was requested.
 */
export function describeTrade(trade: PriceRequest): string {
    const instrument = trade.instrument?.kind;
    const method = METHODS[trade.engine?.method ?? Engine_Method.UNSPECIFIED] ?? "no engine";

    if (instrument?.case === "swap") {
        const legs = instrument.value.legs.length;
        return `swap · ${legs} ${legs === 1 ? "leg" : "legs"} · ${method}`;
    }
    if (instrument?.case !== "option") return `no instrument · ${method}`;

    const option = instrument.value;
    const type = option.payoff?.type === Payoff_OptionType.PUT ? "put" : option.payoff?.type === Payoff_OptionType.CALL ? "call" : "option";
    const strike = strikeOf(option.payoff?.kind);
    const style = (option.style.case ?? undefined) as StyleCase | undefined;
    // Vanilla is the unmarked case: saying so on every row would crowd out what
    // actually distinguishes one trade from the next.
    const styled = style && style !== "vanilla" ? ` ${STYLES.find(choice => choice.value === style)?.label ?? style}` : "";
    const exercise = EXERCISES[option.exercise?.type ?? Exercise_Type.UNSPECIFIED] ?? "no exercise";

    return `${type}${strike === null ? "" : ` ${trim(strike)}`}${styled} · ${exercise} · ${method}`;
}

/** The strike, wherever this payoff keeps it. A digital keeps a strike and a
 *  payment; the strike is the half that names the trade. */
function strikeOf(payoff: {case?: string; value?: unknown} | undefined): number | null {
    if (!payoff?.case) return null;
    const value = payoff.value as {strike?: number} | undefined;
    return typeof value?.strike === "number" ? value.strike : null;
}

function trim(value: number): string {
    return Number.isInteger(value) ? String(value) : String(Number(value.toPrecision(6)));
}
