import { createSlice, type PayloadAction } from '@reduxjs/toolkit'
import type { Compounding, DayCounter_Family, Frequency } from '@/gen/quantlib/v1/conventions_pb'
import type {
  AnalyticParameters_Approximation,
  Engine_Method,
  FdParameters_Explicit_Scheme,
  FdParameters_Preset,
  LatticeParameters_Tree,
} from '@/gen/quantlib/v2/engine_pb'
import type { PriceRequest } from '@/gen/quantlib/v2/envelope_pb'
import type {
  Asian_Averaging,
  Barrier_Type,
  DoubleBarrier_Type,
  Exercise_Type,
  Option,
  Payoff_OptionType,
  Underlying_Process,
} from '@/gen/quantlib/v2/instrument_pb'
import type { Flag, MarketObject, Quote_Unit } from '@/gen/quantlib/v2/market_pb'
import type { ResultKind } from '@/gen/quantlib/v2/results_pb'
import type { PayoffCase, StyleCase } from '@/protocol/capabilities'
import { asQuote, asVolatility, asYieldCurve, newConstantVol, newFlatCurve, newQuote, type AuthorableKind } from '@/market/model'
import { seedMarket, seedTrade, HANDLERS_EVALUATION_DATE } from '@/market/handlersSession'

/** The document the client owns.
 *
 *  A session dies with its socket (DESIGN §9.4), so the workbook — not the
 *  backend — is the source of truth for the market. A reconnect is a replay of
 *  this, not a resume of that.
 *
 *  `structureRevision` is the whole two-speed edit model in one number. Quote
 *  writes leave it alone because UpdateMarket can carry them to a live graph;
 *  anything that changes graph *structure* bumps it, and the session is stale
 *  until it is rebuilt. Nothing rebuilds silently.
 */
interface WorkbookState {
  label: string
  evaluationDate: string
  market: MarketObject[]
  trade: PriceRequest
  structureRevision: number
  selectedId: string | null
}

const initialState: WorkbookState = {
  label: 'HANDLERS.md session',
  evaluationDate: HANDLERS_EVALUATION_DATE,
  market: seedMarket(),
  trade: seedTrade(),
  structureRevision: 1,
  selectedId: null,
}

function find(state: WorkbookState, id: string): MarketObject | undefined {
  return state.market.find((object) => object.id === id)
}

/** The option under edit. Trade edits never touch structureRevision: the
 *  instrument is a property of the request, not of the graph, so changing it
 *  costs a price and not a rebuild. */
function option(state: WorkbookState): Option | undefined {
  const kind = state.trade.instrument?.kind
  return kind?.case === 'option' ? kind.value : undefined
}

/** Carries the strike across a payoff change where both arms have one, so
 *  switching to a gap payoff does not silently zero it. */
function currentStrike(state: WorkbookState): number {
  const payoff = option(state)?.payoff
  switch (payoff?.kind.case) {
    case 'plain':
    case 'assetOrNothing':
    case 'cashOrNothing':
    case 'gap':
    case 'superFund':
    case 'superShare':
      return payoff.kind.value.strike
    default:
      return 0
  }
}

/** The parameter block for the current method, created if the engine does not
 *  carry one yet.
 *
 *  A method can be set without its block ever having been built — the seed
 *  trade is analytic and carries no AnalyticParameters — so a setter that only
 *  wrote into an existing block would silently drop the first edit.
 */
function analyticParameters(state: WorkbookState) {
  const engine = state.trade.engine
  if (!engine) return null
  if (engine.parameters.case !== 'analytic') {
    engine.parameters = { case: 'analytic', value: { $typeName: 'quantlib.v2.AnalyticParameters', approximation: 0 } }
  }
  return engine.parameters.case === 'analytic' ? engine.parameters.value : null
}

function latticeParameters(state: WorkbookState) {
  const engine = state.trade.engine
  if (!engine) return null
  if (engine.parameters.case !== 'lattice') {
    engine.parameters = { case: 'lattice', value: { $typeName: 'quantlib.v2.LatticeParameters', tree: 0, steps: 0 } }
  }
  return engine.parameters.case === 'lattice' ? engine.parameters.value : null
}

function fdParameters(state: WorkbookState) {
  const engine = state.trade.engine
  if (!engine) return null
  if (engine.parameters.case !== 'fd') {
    engine.parameters = { case: 'fd', value: { $typeName: 'quantlib.v2.FdParameters', grid: { case: 'preset', value: 0 } } }
  }
  return engine.parameters.case === 'fd' ? engine.parameters.value : null
}

function mcParameters(state: WorkbookState) {
  const engine = state.trade.engine
  if (!engine) return null
  if (engine.parameters.case !== 'mc') {
    engine.parameters = {
      case: 'mc',
      value: {
        $typeName: 'quantlib.v2.McParameters',
        seed: 0n,
        stopping: { case: 'samples', value: 0n },
        rng: 0,
        timeStepsPerYear: 0,
        antitheticVariate: false,
        controlVariate: false,
        brownianBridge: false,
        progressEveryPaths: 0n,
      },
    }
  }
  return engine.parameters.case === 'mc' ? engine.parameters.value : null
}

function uniqueId(state: WorkbookState, stem: string): string {
  if (!find(state, stem)) return stem
  for (let n = 2; ; n += 1) {
    const candidate = `${stem}${n}`
    if (!find(state, candidate)) return candidate
  }
}

export const workbookSlice = createSlice({
  name: 'workbook',
  initialState,
  reducers: {
    // ---- structural: the graph has to be rebuilt -------------------------
    evaluationDateSet(state, action: PayloadAction<string>) {
      state.evaluationDate = action.payload
      state.structureRevision += 1
    },
    objectAdded(state, action: PayloadAction<AuthorableKind>) {
      const kind = action.payload
      const object =
        kind === 'quote'
          ? newQuote(uniqueId(state, 'Q'))
          : kind === 'yieldCurve'
            ? newFlatCurve(uniqueId(state, 'C'))
            : newConstantVol(uniqueId(state, 'VOL'))
      state.market.push(object)
      state.selectedId = object.id
      state.structureRevision += 1
    },
    objectRemoved(state, action: PayloadAction<string>) {
      state.market = state.market.filter((object) => object.id !== action.payload)
      if (state.selectedId === action.payload) state.selectedId = null
      state.structureRevision += 1
    },
    /** Renames and rewrites every reference to the old id, because a rename
     *  that leaves dangling references is a rename that breaks the session. */
    objectRenamed(state, action: PayloadAction<{ from: string; to: string }>) {
      const { from, to } = action.payload
      const object = find(state, from)
      if (!object) return
      object.id = to
      for (const other of state.market) {
        const curve = asYieldCurve(other)
        if (curve?.shape.case === 'flat' && curve.shape.value.rate?.source.case === 'quoteId' && curve.shape.value.rate.source.value === from) {
          curve.shape.value.rate.source.value = to
        }
        const surface = asVolatility(other)
        if (surface?.shape.case === 'constant' && surface.shape.value.volatility?.source.case === 'quoteId' && surface.shape.value.volatility.source.value === from) {
          surface.shape.value.volatility.source.value = to
        }
      }
      if (state.selectedId === from) state.selectedId = to
      state.structureRevision += 1
    },
    dayCounterSet(state, action: PayloadAction<{ id: string; family: DayCounter_Family }>) {
      const object = find(state, action.payload.id)
      if (!object) return
      const target = asYieldCurve(object) ?? asVolatility(object)
      if (!target) return
      target.dayCounter = { $typeName: 'quantlib.v1.DayCounter', family: action.payload.family, thirty360: 0, actualActual: 0 }
      state.structureRevision += 1
    },
    flatRateSet(state, action: PayloadAction<{ id: string; source: { case: 'quoteId'; value: string } | { case: 'fixed'; value: number } }>) {
      const curve = asYieldCurve(find(state, action.payload.id) ?? ({} as MarketObject))
      if (curve?.shape.case !== 'flat' || !curve.shape.value.rate) return
      curve.shape.value.rate.source = action.payload.source
      state.structureRevision += 1
    },
    compoundingSet(state, action: PayloadAction<{ id: string; compounding: Compounding }>) {
      const curve = asYieldCurve(find(state, action.payload.id) ?? ({} as MarketObject))
      if (curve?.shape.case !== 'flat') return
      curve.shape.value.compounding = action.payload.compounding
      state.structureRevision += 1
    },
    frequencySet(state, action: PayloadAction<{ id: string; frequency: Frequency }>) {
      const curve = asYieldCurve(find(state, action.payload.id) ?? ({} as MarketObject))
      if (curve?.shape.case !== 'flat') return
      curve.shape.value.frequency = action.payload.frequency
      state.structureRevision += 1
    },
    volatilitySourceSet(state, action: PayloadAction<{ id: string; source: { case: 'quoteId'; value: string } | { case: 'fixed'; value: number } }>) {
      const surface = asVolatility(find(state, action.payload.id) ?? ({} as MarketObject))
      if (surface?.shape.case !== 'constant' || !surface.shape.value.volatility) return
      surface.shape.value.volatility.source = action.payload.source
      state.structureRevision += 1
    },

    // ---- live: UpdateMarket carries these to the running graph -----------
    /** The only edit the backend can take without a rebuild. */
    quoteValueSet(state, action: PayloadAction<{ id: string; value: number }>) {
      const quote = asQuote(find(state, action.payload.id) ?? ({} as MarketObject))
      if (quote) quote.value = action.payload.value
    },

    // ---- cosmetic: never sent, or never read ----------------------------
    /** Quote.unit is carried for the frontend and never read in pricing, so
     *  changing it costs nothing on the wire. */
    quoteUnitSet(state, action: PayloadAction<{ id: string; unit: Quote_Unit }>) {
      const quote = asQuote(find(state, action.payload.id) ?? ({} as MarketObject))
      if (quote) quote.unit = action.payload.unit
    },
    displayNameSet(state, action: PayloadAction<{ id: string; displayName: string }>) {
      const object = find(state, action.payload.id)
      if (object) object.displayName = action.payload.displayName
    },
    // ---- the trade: a property of the request, not of the graph ----------
    payoffTypeSet(state, action: PayloadAction<Payoff_OptionType>) {
      const payoff = option(state)?.payoff
      if (payoff) payoff.type = action.payload
    },
    payoffKindSet(state, action: PayloadAction<PayoffCase>) {
      const payoff = option(state)?.payoff
      if (!payoff) return
      const strike = currentStrike(state)
      switch (action.payload) {
        case 'plain':
          payoff.kind = { case: 'plain', value: { $typeName: 'quantlib.v2.PlainVanillaPayoff', strike } }
          break
        case 'percentageStrike':
          payoff.kind = { case: 'percentageStrike', value: { $typeName: 'quantlib.v2.PercentageStrikePayoff', moneyness: 1 } }
          break
        case 'assetOrNothing':
          payoff.kind = { case: 'assetOrNothing', value: { $typeName: 'quantlib.v2.AssetOrNothingPayoff', strike } }
          break
        case 'cashOrNothing':
          payoff.kind = { case: 'cashOrNothing', value: { $typeName: 'quantlib.v2.CashOrNothingPayoff', strike, cashPayoff: 0 } }
          break
        case 'gap':
          payoff.kind = { case: 'gap', value: { $typeName: 'quantlib.v2.GapPayoff', strike, secondStrike: 0 } }
          break
        case 'superFund':
          payoff.kind = { case: 'superFund', value: { $typeName: 'quantlib.v2.SuperFundPayoff', strike, secondStrike: 0 } }
          break
        case 'superShare':
          payoff.kind = { case: 'superShare', value: { $typeName: 'quantlib.v2.SuperSharePayoff', strike, secondStrike: 0, cashPayoff: 0 } }
          break
        default:
          break
      }
    },
    payoffNumberSet(state, action: PayloadAction<{ field: 'strike' | 'secondStrike' | 'cashPayoff' | 'moneyness'; value: number }>) {
      const kind = option(state)?.payoff?.kind
      if (!kind || kind.case === undefined) return
      const target = kind.value as unknown as Record<string, number>
      if (action.payload.field in target) target[action.payload.field] = action.payload.value
    },
    exerciseTypeSet(state, action: PayloadAction<Exercise_Type>) {
      const exercise = option(state)?.exercise
      if (exercise) exercise.type = action.payload
    },
    exerciseDatesSet(state, action: PayloadAction<string[]>) {
      const exercise = option(state)?.exercise
      if (!exercise) return
      exercise.dates = action.payload.map((iso) => ({
        $typeName: 'quantlib.v1.Date' as const,
        form: { case: 'iso' as const, value: iso },
      }))
    },
    payoffAtExpirySet(state, action: PayloadAction<Flag>) {
      const exercise = option(state)?.exercise
      if (exercise) exercise.payoffAtExpiry = action.payload
    },
    underlyingRefSet(state, action: PayloadAction<{ field: 'spotQuoteId' | 'discountCurveId' | 'dividendCurveId' | 'volatilityId'; value: string }>) {
      const underlying = option(state)?.underlyings[0]
      if (underlying) underlying[action.payload.field] = action.payload.value
    },
    processSet(state, action: PayloadAction<Underlying_Process>) {
      const underlying = option(state)?.underlyings[0]
      if (underlying) underlying.process = action.payload
    },
    /** The method selects the parameter block; a field that does not apply
     *  cannot be set, rather than being set and dropped. */
    engineMethodSet(state, action: PayloadAction<Engine_Method>) {
      const engine = state.trade.engine
      if (!engine) return
      engine.method = action.payload
      switch (action.payload) {
        case 1: // ANALYTIC
          engine.parameters = { case: 'analytic', value: { $typeName: 'quantlib.v2.AnalyticParameters', approximation: 0 } }
          break
        case 2: // LATTICE
          engine.parameters = { case: 'lattice', value: { $typeName: 'quantlib.v2.LatticeParameters', tree: 0, steps: 0 } }
          break
        case 3: // FINITE_DIFFERENCE
          engine.parameters = { case: 'fd', value: { $typeName: 'quantlib.v2.FdParameters', grid: { case: 'preset', value: 0 } } }
          break
        case 4: // MONTE_CARLO
          engine.parameters = {
            case: 'mc',
            value: {
              $typeName: 'quantlib.v2.McParameters',
              seed: 0n,
              stopping: { case: 'samples', value: 0n },
              rng: 0,
              timeStepsPerYear: 0,
              antitheticVariate: false,
              controlVariate: false,
              brownianBridge: false,
              progressEveryPaths: 0n,
            },
          }
          break
        default:
          engine.parameters = { case: undefined }
          break
      }
    },
    approximationSet(state, action: PayloadAction<AnalyticParameters_Approximation>) {
      const parameters = analyticParameters(state)
      if (parameters) parameters.approximation = action.payload
    },
    latticeTreeSet(state, action: PayloadAction<LatticeParameters_Tree>) {
      const parameters = latticeParameters(state)
      if (parameters) parameters.tree = action.payload
    },
    latticeStepsSet(state, action: PayloadAction<number>) {
      const parameters = latticeParameters(state)
      if (parameters) parameters.steps = action.payload
    },
    fdGridModeSet(state, action: PayloadAction<'preset' | 'custom'>) {
      const parameters = fdParameters(state)
      if (!parameters) return
      parameters.grid =
        action.payload === 'preset'
          ? { case: 'preset', value: 0 }
          : {
              case: 'custom',
              value: { $typeName: 'quantlib.v2.FdParameters.Explicit', timeSteps: 100, assetSteps: 100, dampingSteps: 0, scheme: 0 },
            }
    },
    fdPresetSet(state, action: PayloadAction<FdParameters_Preset>) {
      const parameters = fdParameters(state)
      if (parameters?.grid.case === 'preset') parameters.grid.value = action.payload
    },
    fdCustomSet(state, action: PayloadAction<{ field: 'timeSteps' | 'assetSteps' | 'dampingSteps'; value: number }>) {
      const parameters = fdParameters(state)
      if (parameters?.grid.case === 'custom') parameters.grid.value[action.payload.field] = action.payload.value
    },
    fdSchemeSet(state, action: PayloadAction<FdParameters_Explicit_Scheme>) {
      const parameters = fdParameters(state)
      if (parameters?.grid.case === 'custom') parameters.grid.value.scheme = action.payload
    },
    resultKindsSet(state, action: PayloadAction<ResultKind[]>) {
      state.trade.results = action.payload
    },
    /** Whatever the engine published in its own additionalResults map. Off by
     *  default because the contents vary by engine; on, it is how a panel
     *  shows the working behind a price. */
    includeAdditionalResultsSet(state, action: PayloadAction<boolean>) {
      state.trade.includeAdditionalResults = action.payload
    },

    // ---- style: the oneof says what is buildable ---------------------------
    /** Switching style builds a fresh arm. Its fields start unset, because a
     *  barrier level or an averaging convention carried over from another
     *  trade is a number nobody chose. */
    styleSet(state, action: PayloadAction<StyleCase>) {
      const target = option(state)
      if (!target) return
      switch (action.payload) {
        case 'vanilla':
          target.style = { case: 'vanilla', value: { $typeName: 'quantlib.v2.Vanilla' } }
          break
        case 'barrier':
          target.style = { case: 'barrier', value: { $typeName: 'quantlib.v2.Barrier', type: 0, level: 0, rebate: 0, monitoringDates: [] } }
          break
        case 'doubleBarrier':
          target.style = { case: 'doubleBarrier', value: { $typeName: 'quantlib.v2.DoubleBarrier', type: 0, lower: 0, upper: 0, rebate: 0 } }
          break
        case 'asian':
          target.style = { case: 'asian', value: { $typeName: 'quantlib.v2.Asian', averaging: 0, fixingDates: [], runningAverage: 0, pastFixings: 0 } }
          break
        case 'lookback':
          target.style = { case: 'lookback', value: { $typeName: 'quantlib.v2.Lookback', runningExtremum: 0, level: 0 } }
          break
        case 'forwardStart':
          target.style = { case: 'forwardStart', value: { $typeName: 'quantlib.v2.ForwardStart', performance: 0 } }
          break
        default:
          break
      }
    },
    barrierTypeSet(state, action: PayloadAction<Barrier_Type>) {
      const style = option(state)?.style
      if (style?.case === 'barrier') style.value.type = action.payload
    },
    barrierNumberSet(state, action: PayloadAction<{ field: 'level' | 'rebate'; value: number }>) {
      const style = option(state)?.style
      if (style?.case === 'barrier') style.value[action.payload.field] = action.payload.value
    },
    doubleBarrierTypeSet(state, action: PayloadAction<DoubleBarrier_Type>) {
      const style = option(state)?.style
      if (style?.case === 'doubleBarrier') style.value.type = action.payload
    },
    doubleBarrierNumberSet(state, action: PayloadAction<{ field: 'lower' | 'upper' | 'rebate'; value: number }>) {
      const style = option(state)?.style
      if (style?.case === 'doubleBarrier') style.value[action.payload.field] = action.payload.value
    },
    asianAveragingSet(state, action: PayloadAction<Asian_Averaging>) {
      const style = option(state)?.style
      if (style?.case === 'asian') style.value.averaging = action.payload
    },
    asianFixingDatesSet(state, action: PayloadAction<string[]>) {
      const style = option(state)?.style
      if (style?.case !== 'asian') return
      style.value.fixingDates = action.payload.map((iso) => ({
        $typeName: 'quantlib.v1.Date' as const,
        form: { case: 'iso' as const, value: iso },
      }))
    },
    asianNumberSet(state, action: PayloadAction<{ field: 'runningAverage' | 'pastFixings'; value: number }>) {
      const style = option(state)?.style
      if (style?.case === 'asian') style.value[action.payload.field] = action.payload.value
    },
    lookbackExtremumSet(state, action: PayloadAction<number>) {
      const style = option(state)?.style
      if (style?.case === 'lookback') style.value.runningExtremum = action.payload
    },
    forwardStartResetSet(state, action: PayloadAction<string>) {
      const style = option(state)?.style
      if (style?.case === 'forwardStart') {
        style.value.reset = { $typeName: 'quantlib.v1.Date', form: { case: 'iso', value: action.payload } }
      }
    },
    forwardStartPerformanceSet(state, action: PayloadAction<Flag>) {
      const style = option(state)?.style
      if (style?.case === 'forwardStart') style.value.performance = action.payload
    },

    // ---- quanto: an adjustment to the engine, not a product ---------------
    quantoToggled(state, action: PayloadAction<boolean>) {
      const target = option(state)
      if (!target) return
      target.quanto = action.payload
        ? { $typeName: 'quantlib.v2.Quanto', fxRiskFreeCurveId: '', fxVolatilityId: '', correlationId: '' }
        : undefined
    },
    quantoRefSet(state, action: PayloadAction<{ field: 'fxRiskFreeCurveId' | 'fxVolatilityId' | 'correlationId'; value: string }>) {
      const quanto = option(state)?.quanto
      if (quanto) quanto[action.payload.field] = action.payload.value
    },

    // ---- Monte Carlo ------------------------------------------------------
    /** Seed and samples are uint64 and arrive as bigint; they stay that way in
     *  the message. A zero seed is rejected by the backend because QuantLib
     *  would seed from the clock and the same inputs would price differently
     *  on every request. */
    mcSeedSet(state, action: PayloadAction<bigint>) {
      const parameters = mcParameters(state)
      if (parameters) parameters.seed = action.payload
    },
    mcSamplesSet(state, action: PayloadAction<bigint>) {
      const parameters = mcParameters(state)
      if (parameters) parameters.stopping = { case: 'samples', value: action.payload }
    },
    mcRngSet(state, action: PayloadAction<number>) {
      const parameters = mcParameters(state)
      if (parameters) parameters.rng = action.payload
    },
    mcStepsPerYearSet(state, action: PayloadAction<number>) {
      const parameters = mcParameters(state)
      if (parameters) parameters.timeStepsPerYear = action.payload
    },
    mcToggleSet(state, action: PayloadAction<{ field: 'antitheticVariate' | 'controlVariate' | 'brownianBridge'; value: boolean }>) {
      const parameters = mcParameters(state)
      if (parameters) parameters[action.payload.field] = action.payload.value
    },

    selected(state, action: PayloadAction<string | null>) {
      state.selectedId = action.payload
    },
    reset() {
      return { ...initialState, market: seedMarket(), trade: seedTrade() }
    },
  },
})

export const workbookActions = workbookSlice.actions
