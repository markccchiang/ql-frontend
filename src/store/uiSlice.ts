import {createSlice, type PayloadAction} from "@reduxjs/toolkit";

import type {ErrorClass} from "@/protocol/errors";

export interface Rejection {
    code: string;
    errorClass: ErrorClass;
    message: string;
    remedy: string;
    /** Dotted proto path of the field at fault. Empty when the failure came from
     *  the maths rather than from a field, which is the honest answer for a
     *  bootstrap that did not converge. */
    fieldPath: string;
    knownIds: string[];
    at: number;
}

interface UiState {
    /** The last rejection, kept until something succeeds. It is what binds a
     *  backend field_path to the control that produced it. */
    rejection: Rejection | null;
}

const initialState: UiState = {rejection: null};

export const uiSlice = createSlice({
    name: "ui",
    initialState,
    reducers: {
        rejected(state, action: PayloadAction<Rejection>) {
            state.rejection = action.payload;
        },
        rejectionCleared(state) {
            state.rejection = null;
        }
    }
});

export const uiActions = uiSlice.actions;
