import {createSlice, type PayloadAction} from "@reduxjs/toolkit";

import type {Capabilities} from "@/gen/quantlib/v2/envelope_pb";

/** What the service says it can price, as it said it.
 *
 *  Held as the message rather than folded into the local tables on arrival:
 *  the point of the handshake is to be able to compare the two, and a merge
 *  would destroy the thing being compared.
 */
interface CapabilitiesState {
    reported: Capabilities | null;
    /** Sets this build offers that the service does not, and the reverse.
     *  Empty is the expected state; anything here is drift. */
    drift: string[];
}

const initialState: CapabilitiesState = {reported: null, drift: []};

export const capabilitiesSlice = createSlice({
    name: "capabilities",
    initialState,
    reducers: {
        received(state, action: PayloadAction<{reported: Capabilities; drift: string[]}>) {
            state.reported = action.payload.reported;
            state.drift = action.payload.drift;
        },
        cleared(state) {
            state.reported = null;
            state.drift = [];
        }
    }
});

export const capabilitiesActions = capabilitiesSlice.actions;
