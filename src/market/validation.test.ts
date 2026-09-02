import { describe, expect, it } from 'vitest'
import { Compounding, DayCounter_Family, Frequency } from '@/gen/quantlib/v1/conventions_pb'
import { type MarketObject, Quote_Unit } from '@/gen/quantlib/v2/market_pb'
import { newConstantVol, newFlatCurve, newQuote } from './model'
import { hasErrors, resolveMarketPath, validateMarket } from './validation'

/** What the editor makes a user fill in after adding a curve. The constructors
 *  deliberately leave conventions unset — see the "carries no conventions"
 *  test below. */
function flatCurve(id: string, rateQuoteId: string): MarketObject {
  const object = newFlatCurve(id, rateQuoteId)
  if (object.kind.case !== 'yieldCurve' || object.kind.value.shape.case !== 'flat') throw new Error('shape')
  object.kind.value.dayCounter = { $typeName: 'quantlib.v1.DayCounter', family: DayCounter_Family.ACTUAL_360, thirty360: 0, actualActual: 0 }
  object.kind.value.shape.value.compounding = Compounding.CONTINUOUS
  object.kind.value.shape.value.frequency = Frequency.ANNUAL
  return object
}

function constantVol(id: string, volQuoteId: string): MarketObject {
  const object = newConstantVol(id, volQuoteId)
  if (object.kind.case !== 'volatility') throw new Error('kind')
  object.kind.value.dayCounter = { $typeName: 'quantlib.v1.DayCounter', family: DayCounter_Family.ACTUAL_360, thirty360: 0, actualActual: 0 }
  return object
}

const seed = () => [
  newQuote('S', 100, Quote_Unit.ABSOLUTE),
  newQuote('R', 0.05, Quote_Unit.RATE),
  flatCurve('RC', 'R'),
  constantVol('VOL', 'V'),
  newQuote('V', 0.2, Quote_Unit.VOLATILITY),
]

describe('validateMarket', () => {
  it('passes a well-formed market', () => {
    expect(validateMarket(seed())).toEqual([])
  })

  it('rejects a dangling reference and offers the ids that exist', () => {
    const market = [newQuote('R', 0.05, Quote_Unit.RATE), flatCurve('RC', 'MISSING')]
    const issues = validateMarket(market)
    expect(issues).toHaveLength(1)
    expect(issues[0]).toMatchObject({
      objectId: 'RC',
      path: 'yield_curve.flat.rate.quote_id',
      severity: 'error',
    })
    expect(issues[0]?.knownIds).toEqual(['R', 'RC'])
  })

  it('rejects a duplicate id', () => {
    const market = [newQuote('S', 1, Quote_Unit.ABSOLUTE), newQuote('S', 2, Quote_Unit.ABSOLUTE)]
    expect(hasErrors(validateMarket(market))).toBe(true)
  })

  it('warns, but does not fail, on a missing unit — the backend never reads it', () => {
    const issues = validateMarket([newQuote('S', 100, Quote_Unit.UNSPECIFIED)])
    expect(issues.map((i) => i.severity)).toEqual(['warning'])
  })

  it('a newly added curve carries no conventions, and says so', () => {
    // Proto3 cannot tell an unset enum from its first value, so the "+ add"
    // path must not pre-fill ACT/360 and let the user ship a convention they
    // never chose.
    const issues = validateMarket([newQuote('R', 0.05, Quote_Unit.RATE), newFlatCurve('RC', 'R')])
    expect(issues.map((issue) => issue.path).sort()).toEqual([
      'yield_curve.day_counter',
      'yield_curve.flat.compounding',
      'yield_curve.flat.frequency',
    ])
  })

  it('requires the frequency QuantLib ignores under CONTINUOUS', () => {
    const market = seed()
    const curve = market[2]!
    if (curve.kind.case === 'yieldCurve' && curve.kind.value.shape.case === 'flat') {
      curve.kind.value.shape.value.frequency = 0
    }
    expect(validateMarket(market).map((i) => i.path)).toContain('yield_curve.flat.frequency')
  })
})

describe('resolveMarketPath', () => {
  // The backend indexes by position in the sorted frame, not by the order the
  // user authored in.
  const sentOrder = ['R', 'V', 'RC', 'VOL']

  it('maps an indexed path back to the object that was sent there', () => {
    expect(resolveMarketPath('market[2].yield_curve.flat.compounding', sentOrder)).toEqual({
      objectId: 'RC',
      path: 'yield_curve.flat.compounding',
    })
  })

  it('returns null for a path that is not about the market', () => {
    expect(resolveMarketPath('instrument.option.barrier.level', sentOrder)).toBeNull()
  })

  it('returns null for an index nothing was sent at', () => {
    expect(resolveMarketPath('market[9].id', sentOrder)).toBeNull()
  })
})
