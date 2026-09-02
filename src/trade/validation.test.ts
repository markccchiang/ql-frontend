import { describe, expect, it } from 'vitest'
import { Engine_Method } from '@/gen/quantlib/v2/engine_pb'
import type { PriceRequest } from '@/gen/quantlib/v2/envelope_pb'
import { Exercise_Type, Underlying_Process } from '@/gen/quantlib/v2/instrument_pb'
import { Flag } from '@/gen/quantlib/v2/market_pb'
import { seedMarket, seedTrade } from '@/market/handlersSession'
import { tradeHasErrors, validateTrade } from './validation'

const ids = new Set(seedMarket().map((object) => object.id))
const errors = (trade: PriceRequest) =>
  validateTrade(trade, ids).filter((issue) => issue.severity === 'error').map((issue) => issue.path)

function option(trade: PriceRequest) {
  if (trade.instrument?.kind.case !== 'option') throw new Error('not an option')
  return trade.instrument.kind.value
}

describe('validateTrade', () => {
  it('passes the HANDLERS.md trade', () => {
    expect(errors(seedTrade())).toEqual([])
  })

  it('requires an approximation for an American analytic price', () => {
    const trade = seedTrade()
    option(trade).exercise!.type = Exercise_Type.AMERICAN
    option(trade).exercise!.payoffAtExpiry = Flag.FALSE
    expect(errors(trade)).toContain('engine.analytic.approximation')
  })

  it('requires payoff_at_expiry on an American exercise', () => {
    const trade = seedTrade()
    option(trade).exercise!.type = Exercise_Type.AMERICAN
    expect(errors(trade)).toContain('instrument.option.exercise.payoff_at_expiry')
  })

  it('rejects a dividend curve under Black-Scholes', () => {
    // PROCESS_BLACK_SCHOLES rejects it rather than ignoring it —
    // session.cpp:1139.
    const trade = seedTrade()
    option(trade).underlyings[0]!.process = Underlying_Process.BLACK_SCHOLES
    expect(errors(trade)).toContain('instrument.option.underlyings[0].dividend_curve_id')
  })

  it('warns that no dividend curve means zero yield, not the risk-free curve', () => {
    const trade = seedTrade()
    option(trade).underlyings[0]!.dividendCurveId = ''
    const issues = validateTrade(trade, ids)
    expect(issues.find((issue) => issue.path === 'instrument.option.underlyings[0].dividend_curve_id')).toMatchObject({
      severity: 'warning',
    })
    expect(tradeHasErrors(issues)).toBe(false)
  })

  it('rejects an id that is not in the market', () => {
    const trade = seedTrade()
    option(trade).underlyings[0]!.volatilityId = 'NOPE'
    expect(errors(trade)).toContain('instrument.option.underlyings[0].volatility_id')
  })

  it('requires a tree and non-zero steps on a lattice', () => {
    const trade = seedTrade()
    trade.engine!.method = Engine_Method.LATTICE
    trade.engine!.parameters = {
      case: 'lattice',
      value: { $typeName: 'quantlib.v2.LatticeParameters', tree: 0, steps: 0 },
    }
    const paths = errors(trade)
    expect(paths).toContain('engine.lattice.tree')
    expect(paths).toContain('engine.lattice.steps')
  })
})

describe('backend paths', () => {
  it('the paths this produces are the ones the backend sends', () => {
    // session.cpp builds "instrument.option" + ".underlyings[0]" and
    // "engine.analytic.approximation"; a client path that does not match
    // exactly cannot bind a rejection to a control.
    const trade = seedTrade()
    option(trade).underlyings[0]!.spotQuoteId = ''
    expect(errors(trade)).toContain('instrument.option.underlyings[0].spot_quote_id')
  })
})
