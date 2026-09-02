import type {MarketObject} from "@/gen/quantlib/v2/market_pb";

/** One id an object names, and the proto path it names it at.
 *
 *  Paths are in the backend's own dotted, snake_case form
 *  ("yield_curve.flat.rate.quote_id") so that a client-side complaint and a
 *  server-side field_path are the same string and bind to the same control.
 */
export interface Dependency {
    id: string;
    path: string;
    /** A soft edge may point forward.
     *
     *  Index.forwarding_curve_id is the one the schema allows: a bootstrapped
     *  curve's pillars name an index for their conventions and that index names
     *  the curve to forecast off, so one of the two is always a forward
     *  reference. Soft edges are excluded from the sort and checked for
     *  existence only. */
    soft?: boolean;
}

/** What an object needs built before it.
 *
 *  M1 authors quotes, flat curves and constant vol, so those are the arms that
 *  resolve. Every other arm returns nothing rather than guessing — an
 *  unhandled shape must not silently sort as a root. M5 extends this alongside
 *  the generic renderer.
 */
export function dependenciesOf(object: MarketObject): Dependency[] {
    switch (object.kind.case) {
        case "quote":
            return [];

        case "yieldCurve": {
            const curve = object.kind.value;
            if (curve.shape.case === "flat" && curve.shape.value.rate?.source.case === "quoteId") {
                return [{id: curve.shape.value.rate.source.value, path: "yield_curve.flat.rate.quote_id"}];
            }
            return [];
        }

        case "volatility": {
            const surface = object.kind.value;
            if (surface.shape.case === "constant" && surface.shape.value.volatility?.source.case === "quoteId") {
                return [
                    {
                        id: surface.shape.value.volatility.source.value,
                        path: "volatility.constant.volatility.quote_id"
                    }
                ];
            }
            return [];
        }

        case "index": {
            const index = object.kind.value;
            return index.forwardingCurveId ? [{id: index.forwardingCurveId, path: "index.forwarding_curve_id", soft: true}] : [];
        }

        default:
            return [];
    }
}

export interface SortResult {
    /** Dependency order, which is the order OpenSession.market must arrive in. */
    sorted: MarketObject[];
    /** Ids that take part in a dependency cycle; empty when the sort succeeded. */
    cycle: string[];
}

/** Kahn's algorithm over the hard edges.
 *
 *  Market objects must arrive in dependency order because the session resolves
 *  ids against its maps as it fills. That is the client's job, not the user's:
 *  they author in any order and this puts it right on the way out.
 */
export function topoSort(objects: readonly MarketObject[]): SortResult {
    const byId = new Map<string, MarketObject>();
    for (const object of objects) byId.set(object.id, object);

    const outstanding = new Map<string, number>();
    const dependents = new Map<string, string[]>();

    for (const object of objects) {
        const hard = dependenciesOf(object).filter(d => !d.soft && byId.has(d.id));
        const unique = new Set(hard.map(d => d.id));
        unique.delete(object.id);
        outstanding.set(object.id, unique.size);
        for (const id of unique) {
            const list = dependents.get(id) ?? [];
            list.push(object.id);
            dependents.set(id, list);
        }
    }

    // Ready objects keep their authored order, so a sort that changes nothing
    // leaves the market exactly as the user wrote it.
    const ready = objects.filter(object => outstanding.get(object.id) === 0).map(o => o.id);
    const sorted: MarketObject[] = [];

    while (ready.length > 0) {
        const id = ready.shift()!;
        const object = byId.get(id);
        if (!object) continue;
        sorted.push(object);
        for (const dependent of dependents.get(id) ?? []) {
            const left = (outstanding.get(dependent) ?? 0) - 1;
            outstanding.set(dependent, left);
            if (left === 0) ready.push(dependent);
        }
    }

    if (sorted.length === objects.length) return {sorted, cycle: []};

    const placed = new Set(sorted.map(o => o.id));
    return {sorted, cycle: objects.filter(o => !placed.has(o.id)).map(o => o.id)};
}
