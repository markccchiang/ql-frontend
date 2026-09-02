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
  /** Ids in the order they were sent, so a "market[3]..." field_path resolves
   *  to the object the user authored rather than to the fourth row. */
  sentOrder: string[]
  /** workbook.structureRevision at the time of the open. Different from the
   *  workbook's current one means the session is stale. */
  openedRevision: number | null
  error: string | null
}

const initialState: SessionState = {
  status: 'idle',
  sessionId: null,
  bootstrapSeconds: null,
  marketIds: [],
  sentOrder: [],
  openedRevision: null,
  error: null,
}

export const sessionSlice = createSlice({
  name: 'session',
  initialState,
  reducers: {
    opening(state, action: PayloadAction<{ sentOrder: string[]; revision: number }>) {
      state.status = 'opening'
      state.sentOrder = action.payload.sentOrder
      state.openedRevision = action.payload.revision
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
      state.openedRevision = null
    },
    reset() {
      return initialState
    },
  },
})

export const sessionActions = sessionSlice.actions
