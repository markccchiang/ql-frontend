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
    startedAt: number;
    lastFrameAt: number;
    stalled: boolean;
    resolve(frame: ServerFrame): void;
    reject(error: unknown): void;
}

export interface WireClientOptions {
    url: string;
    /** Flag a request that has heard nothing for this long. Flagged, not failed:
     *  a missing terminal frame is a backend bug and must be visible, not a hang. */
    stallAfterMs?: number;
    autoReconnect?: boolean;
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

        return new Promise<void>((resolve, reject) => {
            this.setStatus("connecting");
            const ws = new WebSocket(this.options.url);
            ws.binaryType = "arraybuffer";
            this.ws = ws;

            ws.onopen = () => {
                this.attempt = 0;
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
                this.teardown(event.reason || `socket closed (${event.code})`);
                if (this.status === "connecting") reject(new Error(`cannot reach ${this.options.url}`));
                this.setStatus("disconnected", event.reason);
                if (this.shouldStayOpen && this.options.autoReconnect) this.scheduleReconnect();
            };
        });
    }

    /** Intentional close. Every session on this socket dies with it (DESIGN §9.4). */
    close(): void {
        this.shouldStayOpen = false;
        if (this.reconnectTimer) clearTimeout(this.reconnectTimer);
        this.reconnectTimer = null;
        this.ws?.close(1000, "client closing");
    }

    send(payload: ClientPayloadInit, sessionId = ""): SentRequest {
        const ws = this.ws;
        if (!ws || this.status !== "connected") throw new Error("not connected");

        const requestId = this.nextRequestId++;
        const frame = create(ClientFrameSchema, {requestId, sessionId, payload});
        const kind = frame.payload.case;
        if (!kind) throw new Error("frame has no payload");

        const done = new Promise<ServerFrame>((resolve, reject) => {
            const now = Date.now();
            this.pending.set(requestId.toString(), {
                requestId,
                kind,
                startedAt: now,
                lastFrameAt: now,
                stalled: false,
                resolve,
                reject
            });
        });

        ws.send(toBinary(ClientFrameSchema, frame));
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

    private teardown(reason: string): void {
        if (this.watchdog) clearInterval(this.watchdog);
        this.watchdog = null;
        for (const entry of this.pending.values()) {
            const error = new DisconnectedError(entry.requestId);
            this.emit(l => l.onFailed?.(entry.requestId, error));
            entry.reject(error);
        }
        this.pending.clear();
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
        this.attempt += 1;
        const delay = Math.min(250 * 2 ** (this.attempt - 1), 8000);
        this.reconnectTimer = setTimeout(() => {
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
