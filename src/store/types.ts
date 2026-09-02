import type {ThunkAction, ThunkDispatch, UnknownAction} from "@reduxjs/toolkit";

import type {WireClient} from "@/protocol/client";

import type {rootReducer} from "./rootReducer";

export interface ThunkExtra {
    client: WireClient;
}

export type RootState = ReturnType<typeof rootReducer>;
export type AppDispatch = ThunkDispatch<RootState, ThunkExtra, UnknownAction>;
export type AppThunk<Result = void> = ThunkAction<Result, RootState, ThunkExtra, UnknownAction>;
