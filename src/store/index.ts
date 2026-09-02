import { configureStore } from '@reduxjs/toolkit'
import { WireClient } from '@/protocol/client'
import { wireMiddleware } from '@/protocol/middleware'
import { connectionSlice } from './connectionSlice'
import { requestsSlice } from './requestsSlice'
import { resultsSlice } from './resultsSlice'
import { sessionSlice } from './sessionSlice'
import { wireSlice } from './wireSlice'

export const client = new WireClient({
  url: import.meta.env.VITE_WS_URL ?? 'ws://127.0.0.1:9111',
  autoReconnect: true,
})

export const store = configureStore({
  reducer: {
    connection: connectionSlice.reducer,
    session: sessionSlice.reducer,
    requests: requestsSlice.reducer,
    results: resultsSlice.reducer,
    wire: wireSlice.reducer,
  },
  middleware: (getDefault) =>
    getDefault({ thunk: { extraArgument: { client } } }).concat(wireMiddleware(client)),
})

export type RootState = ReturnType<typeof store.getState>
export type AppDispatch = typeof store.dispatch
