import { describe, expect, it } from 'vitest'
import { scenarioSlice } from '@/store/scenarioSlice'
import { pointsFor } from './scenario'

const spec = scenarioSlice.reducer(undefined, { type: '@@init' }).spec

describe('pointsFor', () => {
  it('sends relative factors as multipliers of the live value', () => {
    // The backend multiplies these by the quote's current value, so the
    // frontend must not pre-multiply them.
    expect(pointsFor({ ...spec, form: 'relative', factors: [0.9, 1, 1.1] })).toEqual({
      case: 'relative',
      value: { factors: [0.9, 1, 1.1] },
    })
  })

  it('sends begin/end/steps for a linear sweep', () => {
    // Named begin/end rather than from/to: `from` is a keyword in Python and
    // the field would be unreachable in the generated client there.
    expect(pointsFor({ ...spec, form: 'linear', begin: 80, end: 120, steps: 21 })).toEqual({
      case: 'linear',
      value: { begin: 80, end: 120, steps: 21 },
    })
  })

  it('sends explicit values as themselves', () => {
    expect(pointsFor({ ...spec, form: 'explicit', explicit: [95, 100, 105] })).toEqual({
      case: 'explicit',
      value: { values: [95, 100, 105] },
    })
  })
})

describe('the default sweep', () => {
  it('does not keep the last swept value', () => {
    // proto3 defaults the field to false and the default has to be the safe
    // one: a sweep is a question, not an edit.
    expect(spec.keepFinalValue).toBe(false)
  })

  it('needs at least two steps to be linear', () => {
    // session/worker.cpp:213 rejects fewer, naming scenario.linear.steps.
    expect(spec.steps).toBeGreaterThanOrEqual(2)
  })
})
