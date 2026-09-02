import { createSlice, type PayloadAction } from '@reduxjs/toolkit'

/** `stale` is a first-class state, not an error: a structural edit needs a
 *  rebuild, and the UI shows what that costs rather than doing it silently
 *  (PLAN.md §4). M0 only reaches idle/opening/live/lost. */
export type SessionStatus = 'idle' | 'opening' | 'live' | 'stale' | 'lost'

interface SessionState {
  status: SessionStatus
  sessionId: string | null
  bootstrapSeconds: number | null
  /** What the backend says it built, in build order. Diffing this against what
   *  we posted is how a client sees which object went missing. */
  marketIds: string[]
  error: string | null
}

const initialState: SessionState = {
  status: 'idle',
  sessionId: null,
  bootstrapSeconds: null,
  marketIds: [],
  error: null,
}

export const sessionSlice = createSlice({
  name: 'session',
  initialState,
  reducers: {
    opening(state) {
      state.status = 'opening'
      state.error = null
    },
    opened(
      state,
      action: PayloadAction<{ sessionId: string; bootstrapSeconds: number; marketIds: string[] }>,
    ) {
      state.status = 'live'
      state.sessionId = action.payload.sessionId
      state.bootstrapSeconds = action.payload.bootstrapSeconds
      state.marketIds = action.payload.marketIds
      state.error = null
    },
    failed(state, action: PayloadAction<string>) {
      state.status = state.sessionId ? 'live' : 'idle'
      state.error = action.payload
    },
    /** The socket died, so every session on it died (DESIGN §9.4). */
    lost(state) {
      state.status = 'lost'
      state.sessionId = null
      state.bootstrapSeconds = null
      state.marketIds = []
    },
    reset() {
      return initialState
    },
  },
})

export const sessionActions = sessionSlice.actions
