import { describe, expect, it } from 'vitest'
import { Engine_Method } from '@/gen/quantlib/v2/engine_pb'
import { Exercise_Type } from '@/gen/quantlib/v2/instrument_pb'
import { isOpen, needsApproximation, vanillaEngineMethods } from './capabilities'

/** These encode what src/session/session.cpp actually dispatches, which is
 *  narrower than the table in HANDLERS.md. If the backend grows an engine,
 *  these fail and say where. */
describe('vanillaEngineMethods', () => {
  const methodsFor = (exercise: Exercise_Type) =>
    new Map(vanillaEngineMethods(exercise, 'plain').map((choice) => [choice.value, choice]))

  it('offers analytic, integral, lattice and FD on a European', () => {
    const methods = methodsFor(Exercise_Type.EUROPEAN)
    for (const method of [Engine_Method.ANALYTIC, Engine_Method.INTEGRAL, Engine_Method.LATTICE, Engine_Method.FINITE_DIFFERENCE]) {
      expect(isOpen(methods.get(method)!), Engine_Method[method]).toBe(true)
    }
  })

  it('closes the integral engine off a European exercise', () => {
    // "the integral engine is European only" — session.cpp:1366
    expect(isOpen(methodsFor(Exercise_Type.AMERICAN).get(Engine_Method.INTEGRAL)!)).toBe(false)
    expect(methodsFor(Exercise_Type.AMERICAN).get(Engine_Method.INTEGRAL)!.reason).toMatch(/European only/)
  })

  it('closes Monte Carlo off a European exercise', () => {
    // "MCEuropeanEngine is European only" — session.cpp:1383
    expect(isOpen(methodsFor(Exercise_Type.AMERICAN).get(Engine_Method.MONTE_CARLO)!)).toBe(false)
  })

  it('closes analytic on a Bermudan', () => {
    // Every analytic branch for a vanilla requires a European or American
    // exercise: baroneadesiwhaleyengine.cpp:142,
    // analyticdigitalamericanengine.cpp:40.
    expect(isOpen(methodsFor(Exercise_Type.BERMUDAN).get(Engine_Method.ANALYTIC)!)).toBe(false)
    expect(isOpen(methodsFor(Exercise_Type.BERMUDAN).get(Engine_Method.LATTICE)!)).toBe(true)
    expect(isOpen(methodsFor(Exercise_Type.BERMUDAN).get(Engine_Method.FINITE_DIFFERENCE)!)).toBe(true)
  })
})

describe('needsApproximation', () => {
  it('is required for an American analytic price', () => {
    expect(needsApproximation(Exercise_Type.AMERICAN, Engine_Method.ANALYTIC, 'plain')).toBe(true)
  })

  it('is not required for a European', () => {
    expect(needsApproximation(Exercise_Type.EUROPEAN, Engine_Method.ANALYTIC, 'plain')).toBe(false)
  })

  it('is not required for a binary payoff, which is a one-touch', () => {
    // digitalPayoff && !european goes to AnalyticDigitalAmericanEngine and
    // never reads the approximation — session.cpp:1330-1334.
    expect(needsApproximation(Exercise_Type.AMERICAN, Engine_Method.ANALYTIC, 'cashOrNothing')).toBe(false)
    expect(needsApproximation(Exercise_Type.AMERICAN, Engine_Method.ANALYTIC, 'assetOrNothing')).toBe(false)
  })

  it('is not required off the analytic method', () => {
    expect(needsApproximation(Exercise_Type.AMERICAN, Engine_Method.LATTICE, 'plain')).toBe(false)
  })
})
