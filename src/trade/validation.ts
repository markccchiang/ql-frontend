import { Engine_Method } from '@/gen/quantlib/v2/engine_pb'
import type { PriceRequest } from '@/gen/quantlib/v2/envelope_pb'
import { Exercise_Type } from '@/gen/quantlib/v2/instrument_pb'
import { Flag } from '@/gen/quantlib/v2/market_pb'
import {
  isDigitalPayoff,
  needsApproximation,
  readsPayoffAtExpiry,
  rejectsDividendCurve,
  type PayoffCase,
} from '@/protocol/capabilities'

export interface TradeIssue {
  /** The backend's own dotted path, so a client complaint and a server
   *  field_path highlight the same control. */
  path: string
  severity: 'error' | 'warning'
  message: string
}

/** Catches what the dispatch in session.cpp would reject, before the frame.
 *
 *  Only the rules that are certain: whether a field is set, and the
 *  combinations HANDLERS.md and the dispatch spell out. Anything that depends
 *  on the maths — whether a strike is sane, whether a tree converges — is the
 *  backend's to say.
 */
export function validateTrade(trade: PriceRequest, marketIds: ReadonlySet<string>): TradeIssue[] {
  const issues: TradeIssue[] = []
  const instrument = trade.instrument
  if (instrument?.kind.case !== 'option') {
    return [{ path: 'instrument', severity: 'error', message: 'No instrument.' }]
  }
  const option = instrument.kind.value
  const base = 'instrument.option'

  // -- payoff --------------------------------------------------------------
  const payoffCase = option.payoff?.kind.case as PayoffCase | undefined
  if (!option.payoff?.type) {
    issues.push({ path: `${base}.payoff.type`, severity: 'error', message: 'Call or put is required.' })
  }
  if (!payoffCase) {
    issues.push({ path: `${base}.payoff`, severity: 'error', message: 'A payoff is required.' })
  }

  // -- exercise ------------------------------------------------------------
  const exercise = option.exercise
  const exerciseType = exercise?.type ?? Exercise_Type.UNSPECIFIED
  if (!exerciseType) {
    issues.push({ path: `${base}.exercise.type`, severity: 'error', message: 'An exercise type is required.' })
  }
  if (!exercise || exercise.dates.length === 0) {
    issues.push({ path: `${base}.exercise.dates`, severity: 'error', message: 'An expiry date is required.' })
  } else if (exerciseType === Exercise_Type.BERMUDAN && exercise.dates.length < 2) {
    issues.push({ path: `${base}.exercise.dates`, severity: 'warning', message: 'A Bermudan with one date is a European. Add the other exercise dates.' })
  }
  // Read on American and Bermudan only, and there it must be set explicitly:
  // it settles the payoff at expiry rather than on exercise.
  if (readsPayoffAtExpiry(exerciseType) && exercise?.payoffAtExpiry === Flag.UNSPECIFIED) {
    issues.push({ path: `${base}.exercise.payoff_at_expiry`, severity: 'error', message: 'Required on an American or Bermudan exercise: it changes the price, not the wording.' })
  }

  // -- underlying ----------------------------------------------------------
  const underlying = option.underlyings[0]
  if (option.underlyings.length !== 1) {
    issues.push({ path: `${base}.underlyings`, severity: 'error', message: 'Exactly one underlying.' })
  } else if (underlying) {
    const ref = (field: 'spotQuoteId' | 'discountCurveId' | 'volatilityId' | 'dividendCurveId', required: boolean) => {
      const id = underlying[field]
      const path = `${base}.underlyings[0].${snake(field)}`
      if (!id) {
        if (required) issues.push({ path, severity: 'error', message: 'Required.' })
      } else if (!marketIds.has(id)) {
        issues.push({ path, severity: 'error', message: `No market object with id "${id}".` })
      }
    }
    ref('spotQuoteId', true)
    ref('discountCurveId', true)
    ref('volatilityId', true)
    ref('dividendCurveId', false)

    if (!underlying.process) {
      issues.push({ path: `${base}.underlyings[0].process`, severity: 'error', message: 'A process is required.' })
    } else if (rejectsDividendCurve(underlying.process) && underlying.dividendCurveId) {
      issues.push({
        path: `${base}.underlyings[0].dividend_curve_id`,
        severity: 'error',
        message: 'PROCESS_BLACK_SCHOLES has no dividend yield. Use Black-Scholes-Merton to give it one, or clear the curve.',
      })
    } else if (!underlying.dividendCurveId) {
      // Not an error, and the one default worth saying out loud.
      issues.push({
        path: `${base}.underlyings[0].dividend_curve_id`,
        severity: 'warning',
        message: 'No dividend curve means a flat zero dividend yield — not the risk-free curve.',
      })
    }
  }

  // -- engine --------------------------------------------------------------
  const engine = trade.engine
  const method = engine?.method ?? Engine_Method.UNSPECIFIED
  if (!method) {
    issues.push({ path: 'engine.method', severity: 'error', message: 'An engine method is required.' })
  }
  if (needsApproximation(exerciseType, method, payoffCase)) {
    const approximation = engine?.parameters.case === 'analytic' ? engine.parameters.value.approximation : 0
    if (!approximation) {
      issues.push({
        path: 'engine.analytic.approximation',
        severity: 'error',
        message: 'An American analytic price needs an explicit approximation: QuantLib has three and they disagree in the third decimal.',
      })
    }
  }
  if (method === Engine_Method.LATTICE) {
    const lattice = engine?.parameters.case === 'lattice' ? engine.parameters.value : null
    if (!lattice?.tree) issues.push({ path: 'engine.lattice.tree', severity: 'error', message: 'A tree is required.' })
    if (!lattice?.steps) issues.push({ path: 'engine.lattice.steps', severity: 'error', message: 'Steps must be non-zero. A tree with no steps is not a fast tree.' })
  }
  if (method === Engine_Method.FINITE_DIFFERENCE) {
    const fd = engine?.parameters.case === 'fd' ? engine.parameters.value : null
    if (!fd || fd.grid.case === undefined) {
      issues.push({ path: 'engine.fd', severity: 'error', message: 'Choose a preset grid or give explicit steps.' })
    } else if (fd.grid.case === 'preset' && !fd.grid.value) {
      issues.push({ path: 'engine.fd.preset', severity: 'error', message: 'A preset is required.' })
    }
  }
  // A binary payoff on a non-European exercise is a one-touch and takes its own
  // analytic engine, so it needs no approximation — worth saying, because the
  // control disappears.
  if (isDigitalPayoff(payoffCase) && exerciseType === Exercise_Type.AMERICAN && method === Engine_Method.ANALYTIC) {
    issues.push({ path: 'engine.analytic', severity: 'warning', message: 'A binary payoff on an American exercise is a one-touch: AnalyticDigitalAmericanEngine prices it and no approximation applies.' })
  }

  return issues
}

function snake(field: string): string {
  return field.replace(/[A-Z]/g, (letter) => `_${letter.toLowerCase()}`)
}

export const tradeHasErrors = (issues: readonly TradeIssue[]): boolean =>
  issues.some((issue) => issue.severity === 'error')
