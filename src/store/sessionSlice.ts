import {createSlice, type PayloadAction} from "@reduxjs/toolkit";

/** `stale` is a first-class state, not an error: a structural edit needs a
 *  rebuild, and the UI shows what that costs rather than doing it silently
 *  (PLAN.md §4). M0 only reaches idle/opening/live/lost. */
export type SessionStatus = "idle" | "opening" | "live" | "stale" | "lost";

export interface SessionState {
    status: SessionStatus;
    sessionId: string | null;
    bootstrapSeconds: number | null;
    /** What the backend says it built, in build order. Diffing this against what
     *  we posted is how a client sees which object went missing. */
    marketIds: string[];
    /** Ids in the order they were sent, so a "market[3]..." field_path resolves
     *  to the object the user authored rather than to the fourth row. */
    sentOrder: string[];
    /** workbook.structureRevision at the time of the open. Different from the
     *  workbook's current one means the session is stale. */
    openedRevision: number | null;
    /** The bearer secret this session is taken back with after a dropped
     *  socket (DESIGN §9.4). In memory only: it is a credential, it is worth
     *  nothing once the window has passed, and a service with the window
     *  turned off sends none. */
    resumeToken: string | null;
    /** How long the service holds this session after its socket dies. */
    resumeGraceSeconds: number;
    /** True when the live session was taken back rather than opened. Worth
     *  showing: it means the graph, and anything that was running, survived. */
    resumed: boolean;
    error: string | null;
}

const initialState: SessionState = {
    status: "idle",
    sessionId: null,
    bootstrapSeconds: null,
    marketIds: [],
    sentOrder: [],
    openedRevision: null,
    resumeToken: null,
    resumeGraceSeconds: 0,
    resumed: false,
    error: null
};

export const sessionSlice = createSlice({
    name: "session",
    initialState,
    reducers: {
        opening(state, action: PayloadAction<{sentOrder: string[]; revision: number}>) {
            state.status = "opening";
            state.sentOrder = action.payload.sentOrder;
            state.openedRevision = action.payload.revision;
            state.error = null;
        },
        opened(
            state,
            action: PayloadAction<{
                sessionId: string;
                bootstrapSeconds: number;
                marketIds: string[];
                resumeToken?: string;
                resumeGraceSeconds?: number;
                resumed?: boolean;
            }>
        ) {
            state.status = "live";
            state.sessionId = action.payload.sessionId;
            state.bootstrapSeconds = action.payload.bootstrapSeconds;
            state.marketIds = action.payload.marketIds;
            state.resumeToken = action.payload.resumeToken || null;
            state.resumeGraceSeconds = action.payload.resumeGraceSeconds ?? 0;
            state.resumed = action.payload.resumed ?? false;
            state.error = null;
        },
        failed(state, action: PayloadAction<string>) {
            // A lost session stays lost. Holding the id and the token through
            // a drop is what makes a resume possible (DESIGN §9.4), and it
            // also means "we still have an id" no longer implies "we still
            // have a session": a rejection arriving while the socket is down
            // used to flip the status back to live on that reasoning, which
            // skipped the resume and left the tab pricing into nothing.
            if (state.status !== "lost") state.status = state.sessionId ? "live" : "idle";
            state.error = action.payload;
        },
        /** The socket died. The session did not, for as long as the service
         *  holds it (DESIGN §9.4), so the id and the token are kept: they are
         *  what `resumeSession` needs to take it back. Everything the session
         *  reported is left alone for the same reason — a resume answers with
         *  the original SessionOpened, and re-reporting it would be the only
         *  change a reader could see. */
        lost(state) {
            state.status = "lost";
            state.resumed = false;
        },
        restored(_state, action: PayloadAction<SessionState>) {
            return action.payload;
        },
        reset() {
            return initialState;
        }
    }
});

export const sessionActions = sessionSlice.actions;
