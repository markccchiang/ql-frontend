import { createSlice, type PayloadAction } from '@reduxjs/toolkit'

export interface WireLogEntry {
  seq: number
  direction: 'out' | 'in'
  at: number
  requestId: string
  kind: string
  terminal: boolean
  /** Canonical protobuf JSON — uint64 renders as a string, so this is safe to
   *  hold in the store and is exactly what went over the wire. */
  json: unknown
}

interface WireState {
  frames: WireLogEntry[]
  seq: number
  open: boolean
  selected: number | null
}

const LIMIT = 300

const initialState: WireState = { frames: [], seq: 0, open: false, selected: null }

export const wireSlice = createSlice({
  name: 'wire',
  initialState,
  reducers: {
    logged(state, action: PayloadAction<Omit<WireLogEntry, 'seq'>>) {
      state.seq += 1
      state.frames.unshift({ ...action.payload, seq: state.seq })
      if (state.frames.length > LIMIT) state.frames.length = LIMIT
    },
    toggled(state) {
      state.open = !state.open
    },
    selected(state, action: PayloadAction<number | null>) {
      state.selected = action.payload
    },
    cleared(state) {
      state.frames = []
      state.selected = null
    },
  },
})

export const wireActions = wireSlice.actions
