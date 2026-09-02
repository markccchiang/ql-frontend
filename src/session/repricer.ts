import { workbookActions } from '@/store/workbookSlice'
import type { AppThunk } from '@/store/types'
import { priceCurrentTrade, writeQuotes } from './ops'

/** Coalesces slider traffic into one write-and-price at a time.
 *
 *  A drag emits far more values than the backend can price, and every one of
 *  them is superseded by the next. So: the workbook takes the value
 *  immediately (the slider must not lag the finger), and the wire gets the
 *  latest value once the previous round trip has finished. One request in
 *  flight, never a queue of stale ones.
 *
 *  Module state rather than store state on purpose — this is transport
 *  scheduling, and putting it in Redux would make every keystroke an action
 *  with no reader.
 */
const queued = new Map<string, number>()
let busy = false

/** How long a price may take before the sliders stop repricing continuously.
 *  An FD FINE grid or a Monte Carlo is not a slider (PLAN.md §7.6). */
export const LIVE_REPRICE_BUDGET_MS = 150

export const bumpQuote =
  (id: string, value: number): AppThunk<Promise<void>> =>
  async (dispatch, getState) => {
    dispatch(workbookActions.quoteValueSet({ id, value }))

    const { session } = getState()
    if (session.status !== 'live' || !session.sessionId) return

    queued.set(id, value)
    if (busy) return
    busy = true
    try {
      while (queued.size > 0) {
        const writes = [...queued.entries()].map(([quoteId, v]) => ({ quoteId, value: v }))
        queued.clear()
        if (getState().session.status !== 'live') break
        await dispatch(writeQuotes(writes))
        await dispatch(priceCurrentTrade())
      }
    } catch {
      // The failure is already in the request log and on the session; dropping
      // it here keeps a dead session from throwing on every slider tick.
      queued.clear()
    } finally {
      busy = false
    }
  }

/** True while sliders may reprice on every movement rather than on release. */
export function repricesLive(lastRoundTripMs: number | null): boolean {
  return lastRoundTripMs === null || lastRoundTripMs <= LIVE_REPRICE_BUDGET_MS
}
