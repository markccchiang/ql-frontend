import { createListenerMiddleware } from '@reduxjs/toolkit'
import { openSession, priceCurrentTrade } from '@/session/ops'
import { statusChanged } from './connectionSlice'
import type { AppDispatch, RootState, ThunkExtra } from './types'

export const listenerMiddleware = createListenerMiddleware<RootState, AppDispatch, ThunkExtra>()

/** Reconnect means replay.
 *
 *  A session cannot be resumed: it died with the socket, and the backend keeps
 *  no log for an absent client (DESIGN §9.4). The workbook is what makes that
 *  survivable — reopening from it costs one bootstrap, which SessionOpened
 *  measures and the UI reports.
 */
listenerMiddleware.startListening({
  actionCreator: statusChanged,
  effect: async (action, api) => {
    if (action.payload.status !== 'connected') return
    const state = api.getState()
    if (state.session.status !== 'lost') return

    try {
      await api.dispatch(openSession())
      await api.dispatch(priceCurrentTrade())
    } catch {
      // Left on the session slice; the pane offers a manual rebuild.
    }
  },
})
