import { configureStore } from '@reduxjs/toolkit'
import { WireClient } from '@/protocol/client'
import { wireMiddleware } from '@/protocol/middleware'
import { listenerMiddleware } from './listeners'
import { rootReducer } from './rootReducer'

export const client = new WireClient({
  url: import.meta.env.VITE_WS_URL ?? 'ws://127.0.0.1:9111',
  autoReconnect: true,
})

export const store = configureStore({
  reducer: rootReducer,
  middleware: (getDefault) =>
    getDefault({ thunk: { extraArgument: { client } } })
      .prepend(listenerMiddleware.middleware)
      .concat(wireMiddleware(client)),
})

export type { AppDispatch, AppThunk, RootState, ThunkExtra } from './types'
