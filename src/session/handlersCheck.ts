import type { PriceResult } from '@/gen/quantlib/v2/results_pb'
import type { WireClient } from '@/protocol/client'
import {
  HANDLERS_EVALUATION_DATE,
  HANDLERS_EXPECTED_NPV,
  HANDLERS_NPV_TOLERANCE,
  HANDLERS_SPOT_BUMP,
  handlersMarket,
  handlersTrade,
} from '@/market/handlersSession'

export type StepStatus = 'pending' | 'running' | 'ok' | 'failed'

export interface CheckStep {
  key: string
  label: string
  note: string
  status: StepStatus
  detail: string | null
  ms: number | null
}

export const HANDLERS_CHECK_STEPS: CheckStep[] = [
  {
    key: 'connect',
    label: 'Connect',
    note: 'One binary WebSocket; sessions live on it and die with it.',
    status: 'pending',
    detail: null,
    ms: null,
  },
  {
    key: 'open',
    label: 'OpenSession',
    note: 'Evaluation date plus seven market objects, in dependency order.',
    status: 'pending',
    detail: null,
    ms: null,
  },
  {
    key: 'update',
    label: 'UpdateMarket',
    note: 'Spot 100 -> 105 on the live graph, under one UpdateGuard.',
    status: 'pending',
    detail: null,
    ms: null,
  },
  {
    key: 'price',
    label: 'PriceRequest',
    note: 'European call, analytic. HANDLERS.md records the answer.',
    status: 'pending',
    detail: null,
    ms: null,
  },
]

export interface CheckOutcome {
  sessionId: string
  bootstrapSeconds: number
  marketIds: string[]
  result: PriceResult
  npvMatches: boolean
}

type Report = (index: number, patch: Partial<CheckStep>) => void

/** Drives the HANDLERS.md session end to end and checks the NPV it records.
 *
 *  Deliberately a plain function over the client rather than a thunk: the
 *  middleware already mirrors every frame into the store, so this needs to own
 *  nothing but the sequence and the assertion.
 */
export async function runHandlersCheck(client: WireClient, report: Report): Promise<CheckOutcome> {
  const timed = async <T>(index: number, run: () => Promise<T>): Promise<T> => {
    report(index, { status: 'running', detail: null, ms: null })
    const started = performance.now()
    try {
      const value = await run()
      report(index, { status: 'ok', ms: Math.round(performance.now() - started) })
      return value
    } catch (error) {
      report(index, {
        status: 'failed',
        detail: error instanceof Error ? error.message : String(error),
        ms: Math.round(performance.now() - started),
      })
      throw error
    }
  }

  await timed(0, () => client.connect())

  const opened = await timed(1, async () => {
    const { done } = client.send({
      case: 'openSession',
      value: {
        evaluationDate: { form: { case: 'iso', value: HANDLERS_EVALUATION_DATE } },
        market: handlersMarket,
        clientLabel: 'ql-frontend M0 acceptance',
      },
    })
    const frame = await done
    if (frame.payload.case !== 'sessionOpened') {
      throw new Error(`expected SessionOpened, got ${frame.payload.case}`)
    }
    return frame.payload.value
  })
  report(1, {
    detail: `${opened.sessionId} · bootstrap ${(opened.bootstrapSeconds * 1000).toFixed(2)} ms · ${
      opened.marketIds.length
    } objects built`,
  })

  await timed(2, async () => {
    const { done } = client.send(
      { case: 'updateMarket', value: { quotes: [HANDLERS_SPOT_BUMP] } },
      opened.sessionId,
    )
    const frame = await done
    if (frame.payload.case !== 'ack') throw new Error(`expected Ack, got ${frame.payload.case}`)
  })
  report(2, { detail: `${HANDLERS_SPOT_BUMP.quoteId} = ${HANDLERS_SPOT_BUMP.value}` })

  const result = await timed(3, async () => {
    const { done } = client.send({ case: 'price', value: handlersTrade }, opened.sessionId)
    const frame = await done
    if (frame.payload.case !== 'priceResult') {
      throw new Error(`expected PriceResult, got ${frame.payload.case}`)
    }
    return frame.payload.value
  })

  const npvMatches = Math.abs(result.npv - HANDLERS_EXPECTED_NPV) < HANDLERS_NPV_TOLERANCE
  report(3, {
    status: npvMatches ? 'ok' : 'failed',
    detail: npvMatches
      ? `NPV ${result.npv.toFixed(6)} matches HANDLERS.md`
      : `NPV ${result.npv.toFixed(6)}, expected ${HANDLERS_EXPECTED_NPV}`,
  })

  return {
    sessionId: opened.sessionId,
    bootstrapSeconds: opened.bootstrapSeconds,
    marketIds: [...opened.marketIds],
    result,
    npvMatches,
  }
}
