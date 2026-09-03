import {toJson} from "@bufbuild/protobuf";
import type {Middleware} from "@reduxjs/toolkit";

import {AnalyticParameters_Approximation, type Engine, Engine_Method, FdParameters_Preset, LatticeParameters_Tree} from "@/gen/quantlib/v2/engine_pb";
import {ClientFrameSchema, Error_Code, ServerFrameSchema} from "@/gen/quantlib/v2/envelope_pb";
import {type PriceResult, ResultKind, type Value} from "@/gen/quantlib/v2/results_pb";
import {roundTripObserved, statusChanged} from "@/store/connectionSlice";
import {requestsActions} from "@/store/requestsSlice";
import {resultsActions} from "@/store/resultsSlice";
import {sessionActions} from "@/store/sessionSlice";
import type {RootState} from "@/store/types";
import {uiActions} from "@/store/uiSlice";
import {wireActions} from "@/store/wireSlice";

import type {WireClient} from "./client";
import {DisconnectedError, WireError} from "./errors";

/** Mirrors the socket into the store.
 *
 *  The client owns the protocol; this owns none of it. Every frame in either
 *  direction lands in the wire log, so the frame inspector is not a special
 *  path that can disagree with what was sent.
 */
export function wireMiddleware(client: WireClient): Middleware {
    return api => {
        const {dispatch, getState} = api;

        client.listen({
            onStatus(status, detail) {
                dispatch(statusChanged({status, detail}));
                if (status === "disconnected") {
                    const state = getState() as {session: {sessionId: string | null}};
                    if (state.session.sessionId) dispatch(sessionActions.lost());
                }
            },

            onSent(frame) {
                const kind = frame.payload.case ?? "unknown";
                dispatch(
                    requestsActions.started({
                        id: frame.requestId.toString(),
                        kind: frame.payload.case!,
                        sessionId: frame.sessionId
                    })
                );
                dispatch(
                    wireActions.logged({
                        direction: "out",
                        at: Date.now(),
                        requestId: frame.requestId.toString(),
                        kind,
                        terminal: false,
                        json: toJson(ClientFrameSchema, frame)
                    })
                );
            },

            onReceived(frame) {
                dispatch(
                    wireActions.logged({
                        direction: "in",
                        at: Date.now(),
                        requestId: frame.requestId.toString(),
                        kind: frame.payload.case ?? "unknown",
                        terminal: frame.terminal,
                        json: toJson(ServerFrameSchema, frame)
                    })
                );
            },

            onProgress(frame, progress) {
                dispatch(
                    requestsActions.progressed({
                        id: frame.requestId.toString(),
                        progress: {
                            completed: progress.completed.toString(),
                            total: progress.total.toString(),
                            runningNpv: progress.runningNpv,
                            runningStandardError: progress.runningStandardError,
                            scenarioPoint: progress.scenarioPoint
                        }
                    })
                );
            },

            onSettled(frame, elapsedMs) {
                const id = frame.requestId.toString();
                // A comparison opens a second session on the same socket and
                // prices in it. Its replies belong to that comparison, not to
                // the session the user is working in.
                const state = getState() as RootState;
                // A reply belongs to the tab that asked for it. A price
                // finishing in a parked tab must not land in the pane of the
                // one in front of the user, and a comparison's second session
                // is not the user's session either.
                const isBackground = state.compare.backgroundIds.includes(id) || (frame.payload.case === "priceResult" && state.session.sessionId !== null && frame.sessionId !== state.session.sessionId);
                const failure = frame.payload.case === "error" ? new WireError(frame.payload.value, frame.requestId) : null;

                dispatch(
                    requestsActions.settled({
                        id,
                        elapsedMs,
                        ...(failure ? {error: `${failure.message}${failure.fieldPath ? ` (${failure.fieldPath})` : ""}`} : {})
                    })
                );
                dispatch(roundTripObserved(elapsedMs));

                if (isBackground) return;

                if (failure) {
                    // Held until something succeeds, so the control it names stays
                    // highlighted while the user fixes it.
                    dispatch(
                        uiActions.rejected({
                            code: Error_Code[failure.code] ?? "UNKNOWN",
                            errorClass: failure.errorClass,
                            message: failure.message,
                            remedy: failure.remedy,
                            fieldPath: failure.fieldPath,
                            knownIds: [...failure.knownIds],
                            at: Date.now()
                        })
                    );
                } else {
                    dispatch(uiActions.rejectionCleared());
                }

                if (frame.payload.case === "sessionOpened") {
                    const opened = frame.payload.value;
                    dispatch(
                        sessionActions.opened({
                            sessionId: opened.sessionId,
                            bootstrapSeconds: opened.bootstrapSeconds,
                            marketIds: [...opened.marketIds]
                        })
                    );
                } else if (frame.payload.case === "priceResult") {
                    dispatch(summarize(id, frame.sessionId, frame.payload.value));
                } else if (failure) {
                    // Only a failure of the session itself belongs on the session. A
                    // rejected price is a fact about the trade, and putting it here made
                    // a live session look broken.
                    const kind = (getState() as RootState).requests.byId[id]?.kind;
                    if (kind === "openSession" || failure.code === Error_Code.SESSION_NOT_FOUND) {
                        dispatch(sessionActions.failed(failure.message));
                    }
                }
            },

            onFailed(requestId, error) {
                // Frame-carried failures are already recorded by onSettled; this is
                // only for the failure that arrives without a frame.
                if (error instanceof DisconnectedError) {
                    dispatch(
                        requestsActions.settled({
                            id: requestId.toString(),
                            elapsedMs: 0,
                            error: error.message
                        })
                    );
                }
            },

            onStalled(requestId, sinceMs) {
                dispatch(requestsActions.stalled(requestId.toString()));
                console.warn(`[wire] request ${requestId} silent for ${Math.round(sinceMs / 1000)}s`);
            },

            onOrphan(frame) {
                // The backend promises exactly one terminal frame per request_id we
                // issued. A frame for an id we never sent is a backend bug.
                console.error("[wire] frame for an unknown request_id", frame.requestId.toString());
            }
        });

        return next => action => next(action);
    };
}

/** Projects a PriceResult into the display model the store holds. */
function summarize(requestId: string, sessionId: string, result: PriceResult) {
    const values = Object.entries(result.results).map(([key, value]) => ({
        key,
        scalar: value.v.case === "scalar" ? value.v.value : null,
        shape: describe(value)
    }));
    values.sort((a, b) => a.key.localeCompare(b.key));

    return resultsActions.priced({
        requestId,
        sessionId,
        at: Date.now(),
        npv: result.npv,
        currency: result.currency,
        values,
        unavailable: result.unavailableResults.map(kind => ResultKind[kind] ?? String(kind)),
        cashflows: result.cashflows.map(row => ({
            leg: row.leg,
            paymentDate: iso(row.paymentDate),
            amount: row.amount,
            discount: row.discount,
            presentValue: row.presentValue,
            accrualStart: iso(row.accrualStart),
            accrualEnd: iso(row.accrualEnd),
            notional: row.notional,
            rate: row.rate,
            fixingDate: iso(row.fixingDate),
            indexFixing: row.indexFixing,
            isPastFixing: row.isPastFixing
        })),
        engine: result.engine ? describeEngine(result.engine) : "not echoed",
        calculationSeconds: result.calculationSeconds,
        standardError: result.errorEstimate ? result.errorEstimate.standardError : null,
        samples: result.errorEstimate ? result.errorEstimate.samples.toString() : null
    });
}

/** Nothing is coerced: a vector result arrives as a vector (results.proto). */
function describe(value: Value): string {
    switch (value.v.case) {
        case "scalar":
            return "scalar";
        case "array":
            return `array[${value.v.value.values.length}]`;
        case "matrix":
            return `matrix[${value.v.value.rows}x${value.v.value.columns}]`;
        case "dates":
            return `dates[${value.v.value.values.length}]`;
        case "date":
            return "date";
        case "text":
            return "text";
        case "flag":
            return "flag";
        default:
            return "empty";
    }
}

/** The engine as it actually ran.
 *
 *  Echoed rather than assumed: an FD price depends on its grid and a batched
 *  Monte Carlo is not the single-shot one, so a client comparing two numbers
 *  has to be able to see which is which from the results alone.
 */
function describeEngine(engine: Engine): string {
    const method = (Engine_Method[engine.method] ?? "unknown").toLowerCase().replace(/_/g, " ");
    const parameters = engine.parameters;
    switch (parameters.case) {
        case "analytic": {
            const approximation = parameters.value.approximation;
            return approximation ? `${method} · ${humanise(AnalyticParameters_Approximation[approximation])}` : method;
        }
        case "lattice":
            return `${method} · ${humanise(LatticeParameters_Tree[parameters.value.tree])} · ${parameters.value.steps} steps`;
        case "fd": {
            const grid = parameters.value.grid;
            if (grid.case === "preset") return `${method} · ${humanise(FdParameters_Preset[grid.value])}`;
            if (grid.case === "custom") return `${method} · ${grid.value.timeSteps} x ${grid.value.assetSteps}`;
            return method;
        }
        case "mc":
            return `${method} · seed ${parameters.value.seed}`;
        default:
            return method;
    }
}

function humanise(name: string | undefined): string {
    return (name ?? "unspecified").toLowerCase().replace(/_/g, " ");
}

/** A wire date as the string it came as, or empty when the field was unset. */
function iso(date: {form: {case?: string; value?: unknown}} | undefined): string {
    return date?.form.case === "iso" ? String(date.form.value) : "";
}
