import { createSlice, type PayloadAction } from '@reduxjs/toolkit'

/** A display model, not the message.
 *
 *  PriceResult carries uint64s (the MC seed, the sample count) that protobuf-es
 *  maps to bigint, and bigint has no place in a Redux store. The projection
 *  happens once, in the middleware, against the real message.
 */
export interface ResultValue {
  key: string
  /** null when the engine published something that is not a scalar. */
  scalar: number | null
  shape: string
}

export interface PriceSummary {
  requestId: string
  /** The session this price came off. A rebuild makes a new graph, and a price
   *  from the old one is not a price of what is on screen now. */
  sessionId: string
  at: number
  npv: number
  currency: string
  values: ResultValue[]
  /** Keys the request asked for. An engine that cannot supply one leaves it
   *  out of the map, so the grid needs both lists to tell "absent" from
   *  "zero". */
  requested: string[]
  /** The engine as it actually ran, echoed by the backend (DESIGN §4). */
  engine: string
  calculationSeconds: number
  standardError: number | null
  samples: string | null
}

interface ResultsState {
  latest: PriceSummary | null
}

const initialState: ResultsState = { latest: null }

export const resultsSlice = createSlice({
  name: 'results',
  initialState,
  reducers: {
    priced(state, action: PayloadAction<PriceSummary>) {
      state.latest = action.payload
    },
    cleared(state) {
      state.latest = null
    },
  },
})

export const resultsActions = resultsSlice.actions
