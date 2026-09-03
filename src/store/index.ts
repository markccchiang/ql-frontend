import {configureStore, isPlain} from "@reduxjs/toolkit";

import {WireClient} from "@/protocol/client";
import {wireMiddleware} from "@/protocol/middleware";

import {listenerMiddleware} from "./listeners";
import {loadWorkbook} from "./persistence";
import {rootReducer} from "./rootReducer";
import {workbookSlice} from "./workbookSlice";

const defaultIsSerializable = (value: unknown): boolean => isPlain(value);

export const client = new WireClient({
    url: import.meta.env.VITE_WS_URL ?? "ws://127.0.0.1:9111",
    autoReconnect: true
});

const restored = loadWorkbook();

export const store = configureStore({
    reducer: rootReducer,
    ...(restored
        ? {
              preloadedState: {
                  workbook: {
                      ...workbookSlice.getInitialState(),
                      label: restored.label,
                      evaluationDate: restored.evaluationDate,
                      market: restored.market,
                      trade: restored.trade
                  }
              }
          }
        : {}),
    middleware: getDefault =>
        getDefault({
            thunk: {extraArgument: {client}},
            // A Monte Carlo seed and sample count are uint64, which protobuf-es maps
            // to bigint. The store holds real messages, so bigint is expected here
            // and is as serialisable as anything else once it reaches the wire.
            serializableCheck: {
                isSerializable: (value: unknown) => typeof value === "bigint" || defaultIsSerializable(value)
            }
        })
            .prepend(listenerMiddleware.middleware)
            .concat(wireMiddleware(client))
});

export type {AppDispatch, AppThunk, RootState, ThunkExtra} from "./types";
