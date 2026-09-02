import { describe, expect, it } from 'vitest'
import { newConstantVol, newFlatCurve, newQuote } from './model'
import { dependenciesOf, topoSort } from './graph'

describe('dependenciesOf', () => {
  it('finds the quote a flat curve is built on', () => {
    expect(dependenciesOf(newFlatCurve('RC', 'R'))).toEqual([
      { id: 'R', path: 'yield_curve.flat.rate.quote_id' },
    ])
  })

  it('finds the quote a constant vol is built on', () => {
    expect(dependenciesOf(newConstantVol('VOL', 'V'))).toEqual([
      { id: 'V', path: 'volatility.constant.volatility.quote_id' },
    ])
  })

  it('gives a quote no dependencies', () => {
    expect(dependenciesOf(newQuote('S', 100))).toEqual([])
  })
})

describe('topoSort', () => {
  it('puts dependencies before their dependents', () => {
    const { sorted, cycle } = topoSort([
      newFlatCurve('RC', 'R'),
      newConstantVol('VOL', 'V'),
      newQuote('R', 0.05),
      newQuote('V', 0.2),
    ])
    expect(cycle).toEqual([])
    const order = sorted.map((o) => o.id)
    expect(order.indexOf('R')).toBeLessThan(order.indexOf('RC'))
    expect(order.indexOf('V')).toBeLessThan(order.indexOf('VOL'))
  })

  it('leaves an already-ordered market untouched', () => {
    const objects = [newQuote('R', 0.05), newFlatCurve('RC', 'R')]
    expect(topoSort(objects).sorted.map((o) => o.id)).toEqual(['R', 'RC'])
  })

  it('reports a cycle rather than dropping objects silently', () => {
    // Not authorable through the UI, but a rename can produce it.
    const a = newFlatCurve('A', 'B')
    const b = newFlatCurve('B', 'A')
    const { sorted, cycle } = topoSort([a, b])
    expect(sorted).toHaveLength(0)
    expect(cycle.sort()).toEqual(['A', 'B'])
  })

  it('ignores a reference to an id that is not in the market', () => {
    // Dangling references are validation's job; the sort must still terminate.
    const { sorted, cycle } = topoSort([newFlatCurve('RC', 'nope')])
    expect(cycle).toEqual([])
    expect(sorted.map((o) => o.id)).toEqual(['RC'])
  })
})
