import {create, fromBinary, type MessageInitShape, toBinary} from "@bufbuild/protobuf";

import {type ClientFrame, ClientFrameSchema, type Progress, type ServerFrame, ServerFrameSchema} from "@/gen/quantlib/v2/envelope_pb";

import {DisconnectedError, WireError} from "./errors";

export type ConnectionStatus = "disconnected" | "connecting" | "connected";

type FrameInit = MessageInitShape<typeof ClientFrameSchema>;
export type ClientPayloadInit = NonNullable<FrameInit["payload"]>;
export type RequestKind = NonNullable<ClientFrame["payload"]["case"]>;

export interface WireListener {
    onStatus?(status: ConnectionStatus, detail?: string): void;
    onSent?(frame: ClientFrame): void;
    onReceived?(frame: ServerFrame): void;
    onProgress?(frame: ServerFrame, progress: Progress): void;
    onSettled?(frame: ServerFrame, elapsedMs: number): void;
    onFailed?(requestId: bigint, error: unknown): void;
    onStalled?(requestId: bigint, sinceMs: number): void;
    /** A frame whose request_id we never issued. A backend bug, so it is loud. */
    onOrphan?(frame: ServerFrame): void;
}

interface Pending {
    requestId: bigint;
    kind: RequestKind;
    /** The session it was sent under, or "" for one that has none yet. */
    sessionId: string;
    startedAt: number;
    lastFrameAt: number;
    stalled: boolean;
    /** Waiting through a dead socket for a resume that has not happened. */
    held: boolean;
    resolve(frame: ServerFrame): void;
    reject(error: unknown): void;
}

/** The subprotocol name this service answers with. It has to be offered
 *  alongside the token, because a browser fails a handshake in which it
 *  named protocols and the server selected none. */
const PROTOCOL = "qlservice.v2";

export interface WireClientOptions {
    url: string;
    /** The shared secret, when the service was started with one.
     *
     *  It rides the subprotocol list because that is the only part of the
     *  handshake a browser lets a page set: `new WebSocket` takes a URL and
     *  a list of protocols and nothing else. A query string would be the
     *  alternative, and a secret in a URL is a secret in the logs.
     *
     *  Being here at all means it is readable by anything that can read this
     *  bundle, which is the point and the limit both: it keeps out another
     *  user's process, not one running as this user. */
    token?: string;
    /** Flag a request that has heard nothing for this long. Flagged, not failed:
     *  a missing terminal frame is a backend bug and must be visible, not a hang. */
    stallAfterMs?: number;
    autoReconnect?: boolean;
    /** How long a request in flight waits through a dead socket before it is
     *  failed. Longer than the service's resume window, so the service gives
     *  up first and the client hears about it. */
    holdPendingMs?: number;
}

export interface SentRequest {
    requestId: bigint;
    /** Settles on the terminal frame. Rejects with WireError on a terminal Error. */
    done: Promise<ServerFrame>;
}

/** One socket, several sessions, one terminal frame per request.
 *
 *  Owns request_id allocation (monotonic, never reused), the pending registry,
 *  the stall watchdog and reconnection. It knows nothing about Redux; the
 *  middleware mirrors its callbacks into the store.
 */
export class WireClient {
    private ws: WebSocket | null = null;
    private status: ConnectionStatus = "disconnected";
    private nextRequestId = 1n;
    private readonly pending = new Map<string, Pending>();
    private readonly listeners: WireListener[] = [];
    private watchdog: ReturnType<typeof setInterval> | null = null;
    private reconnectTimer: ReturnType<typeof setTimeout> | null = null;
    private holdTimer: ReturnType<typeof setTimeout> | null = null;
    /** The connect in progress, if one is. A second caller joins it rather
     *  than opening a second socket: openSession and resumeSession both call
     *  connect() and either can arrive while an automatic reconnect is still
     *  in its handshake, and two sockets meant the first one's close tore
     *  down the status of the second. */
    private connecting: Promise<void> | null = null;
    private attempt = 0;
    private shouldStayOpen = false;

    constructor(private readonly options: WireClientOptions) {}

    get url(): string {
        return this.options.url;
    }

    get connectionStatus(): ConnectionStatus {
        return this.status;
    }

    listen(listener: WireListener): () => void {
        this.listeners.push(listener);
        return () => {
            const at = this.listeners.indexOf(listener);
            if (at >= 0) this.listeners.splice(at, 1);
        };
    }

    connect(): Promise<void> {
        this.shouldStayOpen = true;
        if (this.ws && this.status === "connected") return Promise.resolve();
        if (this.connecting) return this.connecting;

        if (this.reconnectTimer) clearTimeout(this.reconnectTimer);
        this.reconnectTimer = null;

        this.connecting = new Promise<void>((resolve, reject) => {
            this.setStatus("connecting");
            const {token} = this.options;
            const ws = token ? new WebSocket(this.options.url, [PROTOCOL, `token.${token}`]) : new WebSocket(this.options.url);
            ws.binaryType = "arraybuffer";
            this.ws = ws;

            ws.onopen = () => {
                this.attempt = 0;
                // The hold outlives the reconnect. A new socket is not a resume:
                // what was held stays held until its own session is taken back
                // (release) or refused (failPending), and the timer fails the
                // rest. Clearing it here left anything nobody resumed -- a
                // parked tab's request, a comparison's -- waiting forever.
                this.setStatus("connected");
                this.startWatchdog();
                resolve();
            };
            ws.onmessage = (event: MessageEvent<ArrayBuffer>) => this.receive(event.data);
            ws.onerror = () => {
                // The browser gives no detail on a failed connect, by design.
                if (this.status === "connecting") reject(new Error(`cannot reach ${this.options.url}`));
            };
            ws.onclose = event => {
                // A socket this client has already moved on from says nothing
                // about the one it is using now.
                if (this.ws !== ws) return;
                this.teardown(event.reason || `socket closed (${event.code})`);
                if (this.status === "connecting") reject(new Error(`cannot reach ${this.options.url}`));
                this.setStatus("disconnected", event.reason);
                if (this.shouldStayOpen && this.options.autoReconnect) this.scheduleReconnect();
            };
        }).finally(() => {
            this.connecting = null;
        });
        return this.connecting;
    }

    /** Intentional close: nothing is coming back, so nothing is held. */
    close(): void {
        this.shouldStayOpen = false;
        if (this.reconnectTimer) clearTimeout(this.reconnectTimer);
        this.reconnectTimer = null;
        if (this.holdTimer) clearTimeout(this.holdTimer);
        this.holdTimer = null;
        this.ws?.close(1000, "client closing");
        this.failPending("client closing");
    }

    send(payload: ClientPayloadInit, sessionId = ""): SentRequest {
        const ws = this.ws;
        if (!ws || this.status !== "connected") throw new Error("not connected");

        const requestId = this.nextRequestId++;
        const frame = create(ClientFrameSchema, {requestId, sessionId, payload});
        const kind = frame.payload.case;
        if (!kind) throw new Error("frame has no payload");

        // Encoded before it is registered: a frame that cannot be serialised
        // throws here, and left nothing pending that nobody would ever settle.
        const bytes = toBinary(ClientFrameSchema, frame);
        const done = new Promise<ServerFrame>((resolve, reject) => {
            const now = Date.now();
            this.pending.set(requestId.toString(), {
                requestId,
                kind,
                sessionId,
                startedAt: now,
                lastFrameAt: now,
                stalled: false,
                held: false,
                resolve,
                reject
            });
        });

        ws.send(bytes);
        this.emit(l => l.onSent?.(frame));
        return {requestId, done};
    }

    /** Cancels one in-flight request. The cancel gets its own terminal Ack from
     *  the gateway; the target comes back CANCELLED. Note that work is only
     *  really interrupted at a Monte Carlo batch boundary (DESIGN §3). */
    cancel(targetRequestId: bigint, sessionId: string): SentRequest {
        return this.send({case: "cancel", value: {targetRequestId}}, sessionId);
    }

    inFlight(): number {
        return this.pending.size;
    }

    private receive(data: ArrayBuffer): void {
        const frame = fromBinary(ServerFrameSchema, new Uint8Array(data));
        this.emit(l => l.onReceived?.(frame));

        const key = frame.requestId.toString();
        const entry = this.pending.get(key);
        if (!entry) {
            this.emit(l => l.onOrphan?.(frame));
            return;
        }
        entry.lastFrameAt = Date.now();
        entry.stalled = false;

        if (!frame.terminal) {
            if (frame.payload.case === "progress") {
                this.emit(l => l.onProgress?.(frame, frame.payload.value as Progress));
            }
            return;
        }

        this.pending.delete(key);
        const elapsed = Date.now() - entry.startedAt;
        this.emit(l => l.onSettled?.(frame, elapsed));

        if (frame.payload.case === "error") {
            const error = new WireError(frame.payload.value, frame.requestId);
            this.emit(l => l.onFailed?.(frame.requestId, error));
            entry.reject(error);
        } else {
            entry.resolve(frame);
        }
    }

    /** Fails everything still waiting, and says why.
     *
     *  Called when a resume was refused or never attempted, and by the hold
     *  timer below. Split out of `teardown` because a dropped socket is no
     *  longer the end of a request: the service holds the session, and the
     *  work in it, for a grace window (DESIGN §9.4), so a request in flight
     *  may still have a terminal frame coming on the next socket.
     */
    failPending(reason?: string, sessionId?: string): void {
        this.failWhere(entry => sessionId === undefined || entry.sessionId === sessionId);
        void reason;
    }

    /** Stops holding one session's requests: it was taken back, and the
     *  service delivers what it kept for them on this socket. */
    release(sessionId: string): void {
        for (const entry of this.pending.values()) {
            if (entry.sessionId === sessionId) entry.held = false;
        }
        if (![...this.pending.values()].some(entry => entry.held) && this.holdTimer) {
            clearTimeout(this.holdTimer);
            this.holdTimer = null;
        }
    }

    private failWhere(matches: (entry: Pending) => boolean): void {
        for (const [key, entry] of [...this.pending.entries()]) {
            if (!matches(entry)) continue;
            this.pending.delete(key);
            const error = new DisconnectedError(entry.requestId);
            this.emit(l => l.onFailed?.(entry.requestId, error));
            entry.reject(error);
        }
    }

    private teardown(reason: string): void {
        if (this.watchdog) clearInterval(this.watchdog);
        this.watchdog = null;

        // A request with no session -- a Hello, an OpenSession still waiting
        // for its id -- has nothing to be resumed under, so nothing will ever
        // answer it. Failed now, rather than left to the timer.
        this.failWhere(entry => entry.sessionId === "");
        if (this.pending.size === 0) return;

        // The rest are held, not failed. Whoever owns each session decides: a
        // successful ResumeSession releases its requests to wait for the
        // frames the service kept, and a refused one fails them. The timer is
        // the backstop for a session nobody does either for -- a promise
        // nobody will ever settle is worse than a rejected one.
        for (const entry of this.pending.values()) entry.held = true;
        if (this.holdTimer) clearTimeout(this.holdTimer);
        this.holdTimer = setTimeout(() => {
            this.holdTimer = null;
            this.failWhere(entry => entry.held);
        }, this.options.holdPendingMs ?? 90_000);
        void reason;
    }

    private startWatchdog(): void {
        if (this.watchdog) return;
        const limit = this.options.stallAfterMs ?? 30_000;
        this.watchdog = setInterval(() => {
            const now = Date.now();
            for (const entry of this.pending.values()) {
                const since = now - entry.lastFrameAt;
                if (!entry.stalled && since > limit) {
                    entry.stalled = true;
                    this.emit(l => l.onStalled?.(entry.requestId, since));
                }
            }
        }, 1000);
    }

    private scheduleReconnect(): void {
        if (this.reconnectTimer) clearTimeout(this.reconnectTimer);
        this.attempt += 1;
        const delay = Math.min(250 * 2 ** (this.attempt - 1), 8000);
        this.reconnectTimer = setTimeout(() => {
            this.reconnectTimer = null;
            void this.connect().catch(() => undefined);
        }, delay);
    }

    private setStatus(status: ConnectionStatus, detail?: string): void {
        this.status = status;
        this.emit(l => l.onStatus?.(status, detail));
    }

    private emit(fn: (listener: WireListener) => void): void {
        for (const listener of [...this.listeners]) fn(listener);
    }
}
