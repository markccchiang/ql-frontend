import { createSlice, type PayloadAction } from '@reduxjs/toolkit'
import type { Compounding, DayCounter_Family, Frequency } from '@/gen/quantlib/v1/conventions_pb'
import type { PriceRequest } from '@/gen/quantlib/v2/envelope_pb'
import type { MarketObject, Quote_Unit } from '@/gen/quantlib/v2/market_pb'
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
    selected(state, action: PayloadAction<string | null>) {
      state.selectedId = action.payload
    },
    reset() {
      return { ...initialState, market: seedMarket(), trade: seedTrade() }
    },
  },
})

export const workbookActions = workbookSlice.actions
