import { toJson } from '@bufbuild/protobuf'
import type { Middleware } from '@reduxjs/toolkit'
import { ClientFrameSchema, ServerFrameSchema } from '@/gen/quantlib/v2/envelope_pb'
import { Engine_Method } from '@/gen/quantlib/v2/engine_pb'
import type { PriceResult, Value } from '@/gen/quantlib/v2/results_pb'
import { roundTripObserved, statusChanged } from '@/store/connectionSlice'
import { requestsActions } from '@/store/requestsSlice'
import { resultsActions } from '@/store/resultsSlice'
import { sessionActions } from '@/store/sessionSlice'
import { wireActions } from '@/store/wireSlice'
import type { WireClient } from './client'
import { DisconnectedError, WireError } from './errors'

/** Mirrors the socket into the store.
 *
 *  The client owns the protocol; this owns none of it. Every frame in either
 *  direction lands in the wire log, so the frame inspector is not a special
 *  path that can disagree with what was sent.
 */
export function wireMiddleware(client: WireClient): Middleware {
  return (api) => {
    const { dispatch, getState } = api

    client.listen({
      onStatus(status, detail) {
        dispatch(statusChanged({ status, detail }))
        if (status === 'disconnected') {
          const state = getState() as { session: { sessionId: string | null } }
          if (state.session.sessionId) dispatch(sessionActions.lost())
        }
      },

      onSent(frame) {
        const kind = frame.payload.case ?? 'unknown'
        dispatch(
          requestsActions.started({
            id: frame.requestId.toString(),
            kind: frame.payload.case!,
            sessionId: frame.sessionId,
          }),
        )
        dispatch(
          wireActions.logged({
            direction: 'out',
            at: Date.now(),
            requestId: frame.requestId.toString(),
            kind,
            terminal: false,
            json: toJson(ClientFrameSchema, frame),
          }),
        )
      },

      onReceived(frame) {
        dispatch(
          wireActions.logged({
            direction: 'in',
            at: Date.now(),
            requestId: frame.requestId.toString(),
            kind: frame.payload.case ?? 'unknown',
            terminal: frame.terminal,
            json: toJson(ServerFrameSchema, frame),
          }),
        )
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
              scenarioPoint: progress.scenarioPoint,
            },
          }),
        )
      },

      onSettled(frame, elapsedMs) {
        const id = frame.requestId.toString()
        const failure =
          frame.payload.case === 'error' ? new WireError(frame.payload.value, frame.requestId) : null

        dispatch(
          requestsActions.settled({
            id,
            elapsedMs,
            ...(failure
              ? { error: `${failure.message}${failure.fieldPath ? ` (${failure.fieldPath})` : ''}` }
              : {}),
          }),
        )
        dispatch(roundTripObserved(elapsedMs))

        if (frame.payload.case === 'sessionOpened') {
          const opened = frame.payload.value
          dispatch(
            sessionActions.opened({
              sessionId: opened.sessionId,
              bootstrapSeconds: opened.bootstrapSeconds,
              marketIds: [...opened.marketIds],
            }),
          )
        } else if (frame.payload.case === 'priceResult') {
          dispatch(summarize(id, frame.sessionId, frame.payload.value))
        } else if (failure) {
          dispatch(sessionActions.failed(failure.message))
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
              error: error.message,
            }),
          )
        }
      },

      onStalled(requestId, sinceMs) {
        dispatch(requestsActions.stalled(requestId.toString()))
        console.warn(`[wire] request ${requestId} silent for ${Math.round(sinceMs / 1000)}s`)
      },

      onOrphan(frame) {
        // The backend promises exactly one terminal frame per request_id we
        // issued. A frame for an id we never sent is a backend bug.
        console.error('[wire] frame for an unknown request_id', frame.requestId.toString())
      },
    })

    return (next) => (action) => next(action)
  }
}

/** Projects a PriceResult into the display model the store holds. */
function summarize(requestId: string, sessionId: string, result: PriceResult) {
  const values = Object.entries(result.results).map(([key, value]) => ({
    key,
    scalar: value.v.case === 'scalar' ? value.v.value : null,
    shape: describe(value),
  }))
  values.sort((a, b) => a.key.localeCompare(b.key))

  return resultsActions.priced({
    requestId,
    sessionId,
    at: Date.now(),
    npv: result.npv,
    currency: result.currency,
    values,
    engine: result.engine ? (Engine_Method[result.engine.method] ?? 'unknown') : 'not echoed',
    calculationSeconds: result.calculationSeconds,
    standardError: result.errorEstimate ? result.errorEstimate.standardError : null,
    samples: result.errorEstimate ? result.errorEstimate.samples.toString() : null,
  })
}

/** Nothing is coerced: a vector result arrives as a vector (results.proto). */
function describe(value: Value): string {
  switch (value.v.case) {
    case 'scalar':
      return 'scalar'
    case 'array':
      return `array[${value.v.value.values.length}]`
    case 'matrix':
      return `matrix[${value.v.value.rows}x${value.v.value.columns}]`
    case 'dates':
      return `dates[${value.v.value.values.length}]`
    case 'date':
      return 'date'
    case 'text':
      return 'text'
    case 'flag':
      return 'flag'
    default:
      return 'empty'
  }
}
