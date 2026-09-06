import {type Calendar, Calendar_Name, type DayCounter, DayCounter_Family} from "@/gen/quantlib/v1/conventions_pb";
import type {MarketObject} from "@/gen/quantlib/v2/market_pb";
import {Index_Family, Pillar_Kind, Quote_Unit} from "@/gen/quantlib/v2/market_pb";

import {dependenciesOf, topoSort} from "./graph";

export interface Issue {
    objectId: string;
    /** Dotted proto path relative to the MarketObject, in the backend's own
     *  snake_case form, so a client complaint and a server field_path name the
     *  same control. */
    path: string;
    severity: "error" | "warning";
    message: string;
    knownIds?: string[];
}

/** Catches client-side what the backend would reject, so the round trip is
 *  spent on pricing rather than on spelling.
 *
 *  The rules mirror the schema's own discipline: zero is *_UNSPECIFIED
 *  everywhere and is rejected, so an unset enum is an error here too. Anything
 *  this cannot know — whether a curve will bootstrap — is left to the backend.
 */
export function validateMarket(objects: readonly MarketObject[]): Issue[] {
    const issues: Issue[] = [];
    const ids = objects.map(object => object.id);
    const known = new Set(ids.filter(Boolean));
    const seen = new Set<string>();

    for (const object of objects) {
        if (!object.id) {
            issues.push({objectId: object.id, path: "id", severity: "error", message: "An id is required; instruments name it."});
        } else if (seen.has(object.id)) {
            issues.push({objectId: object.id, path: "id", severity: "error", message: `Duplicate id "${object.id}". Ids are unique within a session.`});
        }
        seen.add(object.id);

        for (const dependency of dependenciesOf(object)) {
            if (dependency.id === object.id) {
                issues.push({objectId: object.id, path: dependency.path, severity: "error", message: "An object cannot reference itself."});
            } else if (!known.has(dependency.id)) {
                issues.push({
                    objectId: object.id,
                    path: dependency.path,
                    severity: "error",
                    message: `No market object with id "${dependency.id}".`,
                    knownIds: ids.filter(Boolean)
                });
            }
        }

        switch (object.kind.case) {
            case "quote":
                if (object.kind.value.unit === Quote_Unit.UNSPECIFIED) {
                    // The service never converts and never reads this; it is the
                    // frontend that needs it to label an axis and pick a slider range.
                    issues.push({objectId: object.id, path: "quote.unit", severity: "warning", message: "No unit: this quote gets a raw slider and an unlabelled axis."});
                }
                break;

            case "yieldCurve": {
                const curve = object.kind.value;
                issues.push(...dayCounterIssues(object.id, "yield_curve.day_counter", curve.dayCounter));
                if (curve.shape.case === "flat") {
                    const flat = curve.shape.value;
                    if (!flat.rate || flat.rate.source.case === undefined) {
                        issues.push({objectId: object.id, path: "yield_curve.flat.rate", severity: "error", message: "A rate is required: bind a quote, or state a fixed value."});
                    }
                    if (!flat.compounding) {
                        issues.push({objectId: object.id, path: "yield_curve.flat.compounding", severity: "error", message: "Compounding is required."});
                    }
                    if (!flat.frequency) {
                        // Required even where QuantLib ignores it: a frequency silently
                        // unused today is silently wrong when the compounding changes.
                        issues.push({objectId: object.id, path: "yield_curve.flat.frequency", severity: "error", message: "Frequency is required, including under SIMPLE and CONTINUOUS where QuantLib ignores it."});
                    }
                } else if (curve.shape.case === "bootstrap") {
                    const boot = curve.shape.value;
                    if (!boot.traits) issues.push({objectId: object.id, path: "yield_curve.bootstrap.traits", severity: "error", message: "Bootstrap traits are required."});
                    if (!boot.interpolator) issues.push({objectId: object.id, path: "yield_curve.bootstrap.interpolator", severity: "error", message: "An interpolator is required."});
                    if (boot.pillars.length === 0) {
                        issues.push({objectId: object.id, path: "yield_curve.bootstrap.pillars", severity: "error", message: "A bootstrapped curve needs at least one pillar."});
                    }
                    boot.pillars.forEach((pillar, at) => {
                        const path = `yield_curve.bootstrap.pillars[${at}]`;
                        if (!pillar.kind) issues.push({objectId: object.id, path: `${path}.kind`, severity: "error", message: "A pillar kind is required."});
                        if (!pillar.quoteId) issues.push({objectId: object.id, path: `${path}.quote_id`, severity: "error", message: "A pillar is a live quote; it has no fixed form."});
                        if (!pillar.indexId) issues.push({objectId: object.id, path: `${path}.index_id`, severity: "error", message: "The helper takes its conventions from an index."});
                        if (!pillar.tenor) issues.push({objectId: object.id, path: `${path}.tenor`, severity: "error", message: "A tenor is required, e.g. 6M or 10Y."});
                        if (pillar.kind === Pillar_Kind.SWAP) {
                            // A swap helper names its own fixed-leg
                            // conventions; a deposit takes them from the index.
                            issues.push(...calendarIssues(object.id, `${path}.calendar`, pillar.calendar));
                            issues.push(...dayCounterIssues(object.id, `${path}.fixed_day_counter`, pillar.fixedDayCounter));
                            if (!pillar.fixedFrequency) issues.push({objectId: object.id, path: `${path}.fixed_frequency`, severity: "error", message: "A fixed-leg frequency is required."});
                            if (!pillar.fixedConvention) issues.push({objectId: object.id, path: `${path}.fixed_convention`, severity: "error", message: "A fixed-leg business-day convention is required."});
                        }
                    });
                } else if (curve.shape.case === undefined) {
                    issues.push({objectId: object.id, path: "yield_curve", severity: "error", message: "A curve needs a shape."});
                }
                break;
            }

            case "index": {
                const index = object.kind.value;
                if (!index.family) {
                    issues.push({objectId: object.id, path: "index.family", severity: "error", message: "An index family is required."});
                }
                if (!index.name) {
                    // The service builds the index from these conventions
                    // rather than looking the name up in a table.
                    issues.push({objectId: object.id, path: "index.name", severity: "error", message: "A family name is required, e.g. Euribor or SOFR."});
                }
                issues.push(...dayCounterIssues(object.id, "index.day_counter", index.dayCounter));
                issues.push(...calendarIssues(object.id, "index.fixing_calendar", index.fixingCalendar));
                if (index.family === Index_Family.IBOR) {
                    // OvernightIndex takes none of these; IborIndex takes all
                    // three and the registry rejects each unset.
                    if (!index.tenor) issues.push({objectId: object.id, path: "index.tenor", severity: "error", message: "An Ibor index needs a tenor, e.g. 3M."});
                    if (!index.convention) issues.push({objectId: object.id, path: "index.convention", severity: "error", message: "A business-day convention is required."});
                    if (!index.endOfMonth) issues.push({objectId: object.id, path: "index.end_of_month", severity: "error", message: "Required: end-of-month moves fixing and payment dates, so there is no safe default."});
                }
                if (!index.forwardingCurveId) {
                    issues.push({objectId: object.id, path: "index.forwarding_curve_id", severity: "warning", message: "No forwarding curve: usable for past fixings only. A floating leg needs one."});
                }
                break;
            }

            case "correlation": {
                const matrix = object.kind.value;
                const n = matrix.labels.length;
                if (n < 2) {
                    issues.push({objectId: object.id, path: "correlation.labels", severity: "error", message: "A correlation matrix needs at least two labels: they are what an underlying names to find its row."});
                }
                if (new Set(matrix.labels).size !== n) {
                    issues.push({objectId: object.id, path: "correlation.labels", severity: "error", message: "Correlation labels must be distinct."});
                }
                matrix.values.forEach((entry, index) => {
                    const at = `correlation.values[${index}]`;
                    if (entry.source.case === "quoteId" && !entry.source.value) {
                        issues.push({objectId: object.id, path: at, severity: "error", message: `Row ${matrix.labels[Math.floor(index / n)] ?? "?"} against ${matrix.labels[index % n] ?? "?"} is live but names no quote.`});
                    } else if (entry.source.case === "fixed" && (entry.source.value < -1 || entry.source.value > 1)) {
                        issues.push({objectId: object.id, path: at, severity: "error", message: `A correlation is between -1 and 1; this one is ${entry.source.value}.`});
                    }
                });
                break;
            }

            case "fixings": {
                const fixings = object.kind.value;
                if (!fixings.indexId) {
                    issues.push({objectId: object.id, path: "fixings.index_id", severity: "error", message: "Fixings belong to an index."});
                }
                break;
            }

            case "volatility": {
                const surface = object.kind.value;
                issues.push(...dayCounterIssues(object.id, "volatility.day_counter", surface.dayCounter));
                if (surface.shape.case === "constant") {
                    const constant = surface.shape.value;
                    if (!constant.volatility || constant.volatility.source.case === undefined) {
                        issues.push({objectId: object.id, path: "volatility.constant.volatility", severity: "error", message: "A volatility is required: bind a quote, or state a fixed value."});
                    }
                } else if (surface.shape.case === undefined) {
                    issues.push({objectId: object.id, path: "volatility", severity: "error", message: "A surface needs a shape."});
                }
                break;
            }

            default:
                break;
        }
    }

    for (const id of topoSort(objects).cycle) {
        issues.push({objectId: id, path: "", severity: "error", message: "Circular dependency: this object cannot be built before itself."});
    }

    return issues;
}

function dayCounterIssues(objectId: string, path: string, dayCounter?: DayCounter): Issue[] {
    if (!dayCounter || dayCounter.family === DayCounter_Family.FAMILY_UNSPECIFIED) {
        return [{objectId, path, severity: "error", message: "A day counter is required."}];
    }
    // Thirty360 and ActualActual take a sub-convention that materially changes
    // the year fraction; the registry rejects a missing one rather than picking.
    if (dayCounter.family === DayCounter_Family.THIRTY_360 && !dayCounter.thirty360) {
        return [{objectId, path: `${path}.thirty_360`, severity: "error", message: "30/360 needs its convention — the variants differ in the year fraction."}];
    }
    if (dayCounter.family === DayCounter_Family.ACTUAL_ACTUAL && !dayCounter.actualActual) {
        return [{objectId, path: `${path}.actual_actual`, severity: "error", message: "Act/Act needs its convention — the variants differ in the year fraction."}];
    }
    return [];
}

/** UnitedStates has no default constructor and the registry will not pick a
 *  UnitedKingdom market either. */
function calendarIssues(objectId: string, path: string, calendar?: Calendar): Issue[] {
    if (!calendar || calendar.name === Calendar_Name.NAME_UNSPECIFIED) {
        return [{objectId, path, severity: "error", message: "A calendar is required."}];
    }
    if (calendar.name === Calendar_Name.UNITED_STATES && !calendar.unitedStatesMarket) {
        return [{objectId, path: `${path}.united_states_market`, severity: "error", message: "UnitedStates has no default market in QuantLib."}];
    }
    if (calendar.name === Calendar_Name.UNITED_KINGDOM && !calendar.unitedKingdomMarket) {
        return [{objectId, path: `${path}.united_kingdom_market`, severity: "error", message: "A UnitedKingdom market is required."}];
    }
    return [];
}

export function hasErrors(issues: readonly Issue[]): boolean {
    return issues.some(issue => issue.severity === "error");
}

export function issuesFor(issues: readonly Issue[], objectId: string): Issue[] {
    return issues.filter(issue => issue.objectId === objectId);
}

/** Maps a backend field_path back to the object the user authored.
 *
 *  The backend indexes by position in the frame it received — "market[3]" —
 *  and the frame is topologically sorted, so position 3 is not the fourth row
 *  in the pane. Without the permutation the highlight lands on the wrong
 *  object, which is worse than no highlight at all.
 */
export function resolveMarketPath(fieldPath: string, sentOrder: readonly string[]): {objectId: string; path: string} | null {
    const match = /^market\[(\d+)\]\.?(.*)$/.exec(fieldPath);
    if (!match) return null;
    const index = Number(match[1]);
    const objectId = sentOrder[index];
    return objectId === undefined ? null : {objectId, path: match[2] ?? ""};
}
