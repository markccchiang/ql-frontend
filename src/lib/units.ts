import {Quote_Unit} from "@/gen/quantlib/v2/market_pb";

/** Unit-aware display. The wire is always decimal; rates and vols are shown as
 *  percent and basis points as bp, because that is what a user types and reads
 *  (doc/PLAN.md §7.10). Quote.Unit is carried for exactly this — the service never
 *  converts. */
export function formatQuote(value: number, unit: Quote_Unit): string {
    switch (unit) {
        case Quote_Unit.RATE:
        case Quote_Unit.VOLATILITY:
            return `${(value * 100).toFixed(2)} %`;
        case Quote_Unit.BASIS_POINT:
            return `${(value * 1e4).toFixed(1)} bp`;
        case Quote_Unit.CORRELATION:
            return value.toFixed(3);
        case Quote_Unit.ABSOLUTE:
            return value.toFixed(2);
        default:
            return String(value);
    }
}

export function unitLabel(unit: Quote_Unit): string {
    return Quote_Unit[unit]?.toLowerCase().replace(/_/g, " ") ?? "unspecified";
}

export function formatSeconds(seconds: number): string {
    const ms = seconds * 1000;
    return ms < 1 ? `${(ms * 1000).toFixed(0)} µs` : `${ms.toFixed(2)} ms`;
}

/** Rates and vols are typed and read as percent, basis points as bp; the wire
 *  stays decimal throughout. */
export function displayFactor(unit: Quote_Unit): number {
    switch (unit) {
        case Quote_Unit.RATE:
        case Quote_Unit.VOLATILITY:
            return 100;
        case Quote_Unit.BASIS_POINT:
            return 1e4;
        default:
            return 1;
    }
}

export function unitSuffix(unit: Quote_Unit): string {
    switch (unit) {
        case Quote_Unit.RATE:
        case Quote_Unit.VOLATILITY:
            return " %";
        case Quote_Unit.BASIS_POINT:
            return " bp";
        default:
            return "";
    }
}
