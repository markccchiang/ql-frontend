import { AnalyticParameters_Approximation, Engine_Method, LatticeParameters_Tree } from '@/gen/quantlib/v2/engine_pb'
import { Exercise_Type, Underlying_Process } from '@/gen/quantlib/v2/instrument_pb'
import { ResultKind } from '@/gen/quantlib/v2/results_pb'

/** What this build prices, as data.
 *
 *  HANDLERS.md is the list; this is that list in a form the forms can gate on,
 *  read against src/session/session.cpp rather than against the table, because
 *  the table is coarser than the dispatch. A user should not be able to author
 *  a request the backend will reject as UNSUPPORTED.
 *
 *  The two ways a choice can be closed are kept apart on purpose:
 *
 *    'unsupported' — the backend will not price it, and says so.
 *    'pending'     — the backend prices it and this frontend has not built the
 *                    controls yet. Saying "unsupported" there would be a lie
 *                    about the service.
 *
 *  This drifts the first time the backend grows an engine. PLAN.md §8.1 asks
 *  for a capability handshake so it does not have to.
 */
export type Availability = 'supported' | 'unsupported' | 'pending'

export interface Choice<T> {
  value: T
  label: string
  availability: Availability
  /** Shown on the disabled control. Every closed door explains itself. */
  reason?: string
}

export const isOpen = <T>(choice: Choice<T>): boolean => choice.availability === 'supported'

// ---------------------------------------------------------------------------
// Styles
// ---------------------------------------------------------------------------

export type StyleCase =
  | 'vanilla' | 'barrier' | 'doubleBarrier' | 'asian' | 'lookback' | 'forwardStart'
  | 'cliquet' | 'digital' | 'compound' | 'chooser' | 'basket' | 'spread'

export const STYLES: Choice<StyleCase>[] = [
  { value: 'vanilla', label: 'vanilla', availability: 'supported' },
  { value: 'barrier', label: 'barrier', availability: 'pending', reason: 'The backend prices it; the controls arrive in M4.' },
  { value: 'doubleBarrier', label: 'double barrier', availability: 'pending', reason: 'The backend prices it; the controls arrive in M4.' },
  { value: 'asian', label: 'asian', availability: 'pending', reason: 'The backend prices it; the controls arrive in M4.' },
  { value: 'lookback', label: 'lookback', availability: 'pending', reason: 'The backend prices it; the controls arrive in M4.' },
  { value: 'forwardStart', label: 'forward start', availability: 'pending', reason: 'The backend prices it; the controls arrive in M4.' },
  { value: 'cliquet', label: 'cliquet', availability: 'unsupported', reason: 'Not built: the schema expresses it, this build does not price it.' },
  { value: 'digital', label: 'digital (knock-in/out)', availability: 'unsupported', reason: 'Not built. The plain digital payoffs are on the payoff, not here.' },
  { value: 'compound', label: 'compound', availability: 'unsupported', reason: 'Not built.' },
  { value: 'chooser', label: 'chooser', availability: 'unsupported', reason: 'Not built.' },
  { value: 'basket', label: 'basket', availability: 'unsupported', reason: 'Not built.' },
  { value: 'spread', label: 'spread', availability: 'unsupported', reason: 'Not built.' },
]

// ---------------------------------------------------------------------------
// Payoffs
// ---------------------------------------------------------------------------

export type PayoffCase =
  | 'plain' | 'percentageStrike' | 'assetOrNothing' | 'cashOrNothing' | 'gap'
  | 'superFund' | 'superShare' | 'floating'

export const PAYOFFS: Choice<PayoffCase>[] = [
  { value: 'plain', label: 'plain vanilla', availability: 'supported' },
  { value: 'percentageStrike', label: 'percentage strike', availability: 'supported' },
  { value: 'assetOrNothing', label: 'asset or nothing', availability: 'supported' },
  { value: 'cashOrNothing', label: 'cash or nothing', availability: 'supported' },
  { value: 'gap', label: 'gap', availability: 'supported' },
  { value: 'superFund', label: 'super fund', availability: 'supported' },
  { value: 'superShare', label: 'super share', availability: 'supported' },
  { value: 'floating', label: 'floating strike', availability: 'unsupported', reason: 'Valid on a lookback only — it is struck at the realised extremum.' },
]

/** A binary payoff on a non-European exercise is a one-touch, which has its own
 *  analytic engine and therefore needs no approximation. */
export function isDigitalPayoff(payoff: PayoffCase | undefined): boolean {
  return payoff === 'cashOrNothing' || payoff === 'assetOrNothing'
}

// ---------------------------------------------------------------------------
// Exercises
// ---------------------------------------------------------------------------

export const EXERCISES: Choice<Exercise_Type>[] = [
  { value: Exercise_Type.EUROPEAN, label: 'European', availability: 'supported' },
  { value: Exercise_Type.AMERICAN, label: 'American', availability: 'supported' },
  { value: Exercise_Type.BERMUDAN, label: 'Bermudan', availability: 'supported' },
]

/** payoff_at_expiry is read on American and Bermudan only, and there it must be
 *  set explicitly: it settles the payoff at expiry rather than on exercise,
 *  which changes the price rather than the wording. */
export function readsPayoffAtExpiry(exercise: Exercise_Type): boolean {
  return exercise === Exercise_Type.AMERICAN || exercise === Exercise_Type.BERMUDAN
}

// ---------------------------------------------------------------------------
// Engines, for a vanilla option
// ---------------------------------------------------------------------------

export function vanillaEngineMethods(exercise: Exercise_Type, _payoff: PayoffCase | undefined): Choice<Engine_Method>[] {
  const european = exercise === Exercise_Type.EUROPEAN
  const bermudan = exercise === Exercise_Type.BERMUDAN

  const methods: Choice<Engine_Method>[] = [
    {
      value: Engine_Method.ANALYTIC,
      label: 'analytic',
      // Bermudan reaches AnalyticDigitalAmericanEngine or one of the three
      // American approximations, and every one of them requires an American
      // exercise (baroneadesiwhaleyengine.cpp:142, analyticdigitalamericanengine.cpp:40).
      availability: bermudan ? 'unsupported' : 'supported',
      ...(bermudan ? { reason: "QuantLib's analytic engines here take a European or an American exercise. A Bermudan prices on a lattice or FD." } : {}),
    },
    {
      value: Engine_Method.INTEGRAL,
      label: 'integral',
      availability: european ? 'supported' : 'unsupported',
      ...(european ? {} : { reason: 'The integral engine is European only.' }),
    },
    { value: Engine_Method.LATTICE, label: 'lattice', availability: 'supported' },
    { value: Engine_Method.FINITE_DIFFERENCE, label: 'finite difference', availability: 'supported' },
    {
      value: Engine_Method.MONTE_CARLO,
      label: 'Monte Carlo',
      availability: european ? 'pending' : 'unsupported',
      reason: european
        ? 'The backend prices it; the seed, sample budget, progress and cancel controls arrive in M6.'
        : 'MCEuropeanEngine is European only.',
    },
    { value: Engine_Method.FOURIER, label: 'Fourier', availability: 'unsupported', reason: 'Not built — the models it exists for are not built.' },
    { value: Engine_Method.DISCOUNTING, label: 'discounting', availability: 'unsupported', reason: 'Cash-flow instruments only.' },
  ]
  return methods
}

/** An American analytic price must name one of the three: they disagree in the
 *  third decimal, so the client chooses rather than inheriting a default. */
export function needsApproximation(exercise: Exercise_Type, method: Engine_Method, payoff: PayoffCase | undefined): boolean {
  return (
    method === Engine_Method.ANALYTIC &&
    exercise === Exercise_Type.AMERICAN &&
    !isDigitalPayoff(payoff)
  )
}

export const APPROXIMATIONS: Choice<AnalyticParameters_Approximation>[] = [
  { value: AnalyticParameters_Approximation.BARONE_ADESI_WHALEY, label: 'Barone-Adesi / Whaley', availability: 'supported' },
  { value: AnalyticParameters_Approximation.BJERKSUND_STENSLAND, label: 'Bjerksund / Stensland', availability: 'supported' },
  { value: AnalyticParameters_Approximation.JU_QUADRATIC, label: 'Ju quadratic', availability: 'supported' },
  { value: AnalyticParameters_Approximation.INTEGRAL, label: 'integral', availability: 'unsupported', reason: 'Not reachable: the integral engine is selected by engine.method, not here.' },
]

/** Seven trees compile for a vanilla. A barrier takes Cox-Ross-Rubinstein only,
 *  because that engine takes a second template argument for the
 *  discretisation and a full menu would be trees x discretisations. */
export function latticeTrees(style: StyleCase): Choice<LatticeParameters_Tree>[] {
  const all: [LatticeParameters_Tree, string][] = [
    [LatticeParameters_Tree.COX_ROSS_RUBINSTEIN, 'Cox-Ross-Rubinstein'],
    [LatticeParameters_Tree.JARROW_RUDD, 'Jarrow-Rudd'],
    [LatticeParameters_Tree.ADDITIVE_EQUIPROBABILITIES, 'additive equiprobabilities'],
    [LatticeParameters_Tree.TRIGEORGIS, 'Trigeorgis'],
    [LatticeParameters_Tree.TIAN, 'Tian'],
    [LatticeParameters_Tree.LEISEN_REIMER, 'Leisen-Reimer'],
    [LatticeParameters_Tree.JOSHI4, 'Joshi4'],
  ]
  const crrOnly = style === 'barrier'
  return all.map(([value, label]) => ({
    value,
    label,
    availability: !crrOnly || value === LatticeParameters_Tree.COX_ROSS_RUBINSTEIN ? 'supported' : 'unsupported',
    ...(crrOnly && value !== LatticeParameters_Tree.COX_ROSS_RUBINSTEIN
      ? { reason: "QuantLib's barrier lattice is Cox-Ross-Rubinstein only, with the Derman-Kani correction." }
      : {}),
  }))
}

// ---------------------------------------------------------------------------
// Underlying
// ---------------------------------------------------------------------------

export const PROCESSES: Choice<Underlying_Process>[] = [
  { value: Underlying_Process.BLACK_SCHOLES_MERTON, label: 'Black-Scholes-Merton', availability: 'supported' },
  { value: Underlying_Process.BLACK_SCHOLES, label: 'Black-Scholes (no dividend yield)', availability: 'supported' },
  { value: Underlying_Process.BLACK, label: 'Black (forward-driven)', availability: 'supported' },
  { value: Underlying_Process.GARMAN_KOHLHAGEN, label: 'Garman-Kohlhagen', availability: 'unsupported', reason: 'Not built.' },
  { value: Underlying_Process.HESTON, label: 'Heston', availability: 'unsupported', reason: 'Not built.' },
  { value: Underlying_Process.BATES, label: 'Bates', availability: 'unsupported', reason: 'Not built.' },
  { value: Underlying_Process.LOCAL_VOL, label: 'local volatility', availability: 'unsupported', reason: 'Not built.' },
]

/** PROCESS_BLACK_SCHOLES rejects a dividend curve rather than ignoring it. */
export function rejectsDividendCurve(process: Underlying_Process): boolean {
  return process === Underlying_Process.BLACK_SCHOLES
}

// ---------------------------------------------------------------------------
// Results
// ---------------------------------------------------------------------------

/** Sixteen of the enum are mapped. Asking for one an engine cannot supply is a
 *  named rejection, not a missing key — a frontend that asked for vega and got
 *  a map without it cannot tell that from a vega of zero. */
export const OPTION_RESULT_KINDS: Choice<ResultKind>[] = [
  { value: ResultKind.NPV, label: 'NPV', availability: 'supported' },
  { value: ResultKind.DELTA, label: 'delta', availability: 'supported' },
  { value: ResultKind.GAMMA, label: 'gamma', availability: 'supported' },
  { value: ResultKind.THETA, label: 'theta', availability: 'supported' },
  { value: ResultKind.VEGA, label: 'vega', availability: 'supported' },
  { value: ResultKind.RHO, label: 'rho', availability: 'supported' },
  { value: ResultKind.DIVIDEND_RHO, label: 'dividend rho', availability: 'supported' },
  { value: ResultKind.THETA_PER_DAY, label: 'theta per day', availability: 'supported' },
  { value: ResultKind.DELTA_FORWARD, label: 'delta forward', availability: 'supported' },
  { value: ResultKind.ELASTICITY, label: 'elasticity', availability: 'supported' },
  { value: ResultKind.STRIKE_SENSITIVITY, label: 'strike sensitivity', availability: 'supported' },
  { value: ResultKind.ITM_CASH_PROBABILITY, label: 'ITM cash probability', availability: 'supported' },
  { value: ResultKind.IMPLIED_VOLATILITY, label: 'implied volatility', availability: 'unsupported', reason: 'In the enum, not mapped by this build.' },
  { value: ResultKind.QRHO, label: 'quanto rho', availability: 'unsupported', reason: 'Quanto only; the quanto controls arrive in M4.' },
  { value: ResultKind.QVEGA, label: 'quanto vega', availability: 'unsupported', reason: 'Quanto only; the quanto controls arrive in M4.' },
  { value: ResultKind.QLAMBDA, label: 'quanto lambda', availability: 'unsupported', reason: 'Quanto only; the quanto controls arrive in M4.' },
  { value: ResultKind.FAIR_RATE, label: 'fair rate', availability: 'unsupported', reason: 'Cash-flow instruments only.' },
]

/** The key each ResultKind arrives under.
 *
 *  PriceResult.results is keyed by the lower-camel name of the kind, sharing a
 *  namespace with the engine's own additionalResults on purpose — QuantLib's
 *  engines already use "delta" for delta. NPV is not in the map; it is a field.
 *
 *  Worth knowing: HANDLERS.md says an engine that cannot supply a result is a
 *  named rejection rather than a missing key, and session.cpp does not do that
 *  — it catches QuantLib's error and leaves the key out (session.cpp:379-411,
 *  `catch (const Error&) { // not provided by this engine }`). So the absence
 *  the documentation warns about is real, and the UI closes it itself: the
 *  results grid lists what was asked for and marks what did not come back.
 */
export const RESULT_KEYS: Partial<Record<ResultKind, string>> = {
  [ResultKind.DELTA]: 'delta',
  [ResultKind.GAMMA]: 'gamma',
  [ResultKind.THETA]: 'theta',
  [ResultKind.VEGA]: 'vega',
  [ResultKind.RHO]: 'rho',
  [ResultKind.DIVIDEND_RHO]: 'dividendRho',
  [ResultKind.THETA_PER_DAY]: 'thetaPerDay',
  [ResultKind.DELTA_FORWARD]: 'deltaForward',
  [ResultKind.ELASTICITY]: 'elasticity',
  [ResultKind.STRIKE_SENSITIVITY]: 'strikeSensitivity',
  [ResultKind.ITM_CASH_PROBABILITY]: 'itmCashProbability',
  [ResultKind.QRHO]: 'qrho',
  [ResultKind.QVEGA]: 'qvega',
  [ResultKind.QLAMBDA]: 'qlambda',
  [ResultKind.FAIR_RATE]: 'fairRate',
}
