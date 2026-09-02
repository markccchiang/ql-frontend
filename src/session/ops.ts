import type { PriceResult } from '@/gen/quantlib/v2/results_pb'
import { topoSort } from '@/market/graph'
import { hasErrors, validateMarket } from '@/market/validation'
import { sessionActions } from '@/store/sessionSlice'
import type { AppThunk } from '@/store/types'

/** Opens (or reopens) the session from the workbook.
 *
 *  The market is topologically sorted on the way out, so the user authors in
 *  whatever order suits them and the frame still arrives in dependency order.
 *  The sent order is recorded because the backend indexes its rejections by
 *  position in that frame.
 */
export const openSession =
  (): AppThunk<Promise<void>> =>
  async (dispatch, getState, { client }) => {
    const { workbook, session } = getState()

    const issues = validateMarket(workbook.market)
    if (hasErrors(issues)) {
      const first = issues.find((issue) => issue.severity === 'error')!
      throw new Error(`${first.objectId}: ${first.message}`)
    }
    const { sorted, cycle } = topoSort(workbook.market)
    if (cycle.length > 0) throw new Error(`circular dependency: ${cycle.join(', ')}`)

    await client.connect()
    if (session.sessionId) await dispatch(closeSession())

    dispatch(
      sessionActions.opening({
        sentOrder: sorted.map((object) => object.id),
        revision: workbook.structureRevision,
      }),
    )

    const { done } = client.send({
      case: 'openSession',
      value: {
        evaluationDate: { form: { case: 'iso', value: workbook.evaluationDate } },
        market: sorted,
        clientLabel: workbook.label,
      },
    })
    const frame = await done
    if (frame.payload.case !== 'sessionOpened') {
      throw new Error(`expected SessionOpened, got ${frame.payload.case}`)
    }
    // sessionActions.opened is dispatched by the middleware, off the frame.
  }

export const closeSession =
  (): AppThunk<Promise<void>> =>
  async (dispatch, getState, { client }) => {
    const { sessionId } = getState().session
    if (!sessionId || client.connectionStatus !== 'connected') {
      dispatch(sessionActions.reset())
      return
    }
    try {
      await client.send({ case: 'closeSession', value: {} }, sessionId).done
    } finally {
      dispatch(sessionActions.reset())
    }
  }

export const priceCurrentTrade =
  (): AppThunk<Promise<PriceResult>> =>
  async (_dispatch, getState, { client }) => {
    const { session, workbook } = getState()
    if (!session.sessionId) throw new Error('no session')
    const { done } = client.send({ case: 'price', value: workbook.trade }, session.sessionId)
    const frame = await done
    if (frame.payload.case !== 'priceResult') {
      throw new Error(`expected PriceResult, got ${frame.payload.case}`)
    }
    return frame.payload.value
  }

export const writeQuotes =
  (writes: { quoteId: string; value: number }[]): AppThunk<Promise<void>> =>
  async (_dispatch, getState, { client }) => {
    const { sessionId } = getState().session
    if (!sessionId || writes.length === 0) return
    await client.send({ case: 'updateMarket', value: { quotes: writes } }, sessionId).done
  }
