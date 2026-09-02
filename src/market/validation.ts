import {DayCounter_Family, type DayCounter} from "@/gen/quantlib/v1/conventions_pb";
import type {MarketObject} from "@/gen/quantlib/v2/market_pb";
import {Quote_Unit} from "@/gen/quantlib/v2/market_pb";
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
                } else if (curve.shape.case === undefined) {
                    issues.push({objectId: object.id, path: "yield_curve", severity: "error", message: "A curve needs a shape."});
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
