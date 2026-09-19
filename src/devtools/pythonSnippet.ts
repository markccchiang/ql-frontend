import type {WireLogEntry} from "@/store/wireSlice";

/** Reproduces one frame this page sent, against the service it sent it to.
 *
 *  The snippet parses the canonical JSON rather than rebuilding the message
 *  field by field: the JSON is exactly what went over the wire, and an emitter
 *  that reconstructed it would have to guess at enum types it cannot see from
 *  the JSON alone. Getting that subtly wrong in a debugging tool is worse than
 *  not having one.
 *
 *  Null for a frame that came in: sending a ServerFrame to the service
 *  reproduces nothing. The token, when the service wants one, comes from
 *  QL_TOKEN as test/smoke_v2.py takes it -- never written into the snippet,
 *  which goes to the clipboard and from there anywhere.
 */
export function pythonSnippet(entry: WireLogEntry, url: string): string | null {
    if (entry.direction !== "out") return null;
    const json = JSON.stringify(entry.json, null, 2);
    const hasSession = entry.kind !== "openSession";

    return `# ClientFrame #${entry.requestId} — ${entry.kind}
# Bindings: see ql-backend/doc/TESTING.md (protoc --python_out into a dir on
# sys.path). Set QL_TOKEN when the service was started with --token-file.${hasSession ? `\n# NOTE: this frame names session ${JSON.stringify((entry.json as {sessionId?: string}).sessionId ?? "")}, which only exists\n# inside the connection that opened it. Send an OpenSession first.` : ""}
import asyncio, os, websockets
from google.protobuf.json_format import Parse
from quantlib.v2 import envelope_pb2 as E

URL = ${JSON.stringify(url)}
TOKEN = os.environ.get("QL_TOKEN", "")
FRAME = r"""${json}"""

async def main():
    headers = {"Authorization": "Bearer " + TOKEN} if TOKEN else {}
    async with websockets.connect(URL, additional_headers=headers, max_size=16 << 20) as ws:
        await ws.send(Parse(FRAME, E.ClientFrame()).SerializeToString())
        while True:
            reply = E.ServerFrame()
            reply.ParseFromString(await ws.recv())
            print(reply)
            if reply.terminal:
                break

asyncio.run(main())
`;
}
