import {create, fromBinary, type MessageInitShape, toBinary} from "@bufbuild/protobuf";

import {type ClientFrame, ClientFrameSchema, ServerFrameSchema} from "@/gen/quantlib/v2/envelope_pb";

/** A WebSocket a test opens, closes and answers by hand.
 *
 *  For the unit tests only: stubbed in for the global with
 *  `vi.stubGlobal("WebSocket", FakeSocket)`. It keeps every frame the client
 *  sends, decoded, and delivers a ServerFrame as the service would.
 */
export class FakeSocket {
    static instances: FakeSocket[] = [];
    binaryType = "";
    onopen: (() => void) | null = null;
    onclose: ((event: {code: number; reason: string}) => void) | null = null;
    onerror: (() => void) | null = null;
    onmessage: ((event: MessageEvent<ArrayBuffer>) => void) | null = null;
    readonly sent: ClientFrame[] = [];

    constructor(
        readonly url: string,
        readonly protocols?: string | string[]
    ) {
        FakeSocket.instances.push(this);
    }

    open() {
        this.onopen?.();
    }

    close(code = 1000, reason = "") {
        this.onclose?.({code, reason});
    }

    send(data: Uint8Array) {
        this.sent.push(fromBinary(ClientFrameSchema, data));
    }

    reply(init: MessageInitShape<typeof ServerFrameSchema>) {
        const bytes = toBinary(ServerFrameSchema, create(ServerFrameSchema, init));
        const buffer = bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer;
        this.onmessage?.({data: buffer} as MessageEvent<ArrayBuffer>);
    }
}
