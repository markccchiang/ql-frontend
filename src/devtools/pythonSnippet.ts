import type { WireLogEntry } from '@/store/wireSlice'

/** Reproduces one frame against a running ql-backend.
 *
 *  The snippet parses the canonical JSON rather than rebuilding the message
 *  field by field: the JSON is exactly what went over the wire, and an emitter
 *  that reconstructed it would have to guess at enum types it cannot see from
 *  the JSON alone. Getting that subtly wrong in a debugging tool is worse than
 *  not having one.
 */
export function pythonSnippet(entry: WireLogEntry): string {
  const message = entry.direction === 'out' ? 'ClientFrame' : 'ServerFrame'
  const json = JSON.stringify(entry.json, null, 2)
  const needsSession = entry.direction === 'out' && entry.kind !== 'openSession'

  return `# ${message} #${entry.requestId} — ${entry.kind}
# Bindings: see ql-backend/test/README.md (protoc --python_out into a dir on
# sys.path).${
    needsSession
      ? `\n# NOTE: this frame names session ${JSON.stringify(
          (entry.json as { sessionId?: string }).sessionId ?? '',
        )}, which only exists\n# inside the connection that opened it. Send an OpenSession first.`
      : ''
  }
import asyncio, websockets
from google.protobuf.json_format import Parse
from quantlib.v2 import envelope_pb2 as E

FRAME = r"""${json}"""

async def main():
    async with websockets.connect("ws://127.0.0.1:9111", max_size=16 << 20) as ws:
        await ws.send(Parse(FRAME, E.${message}()).SerializeToString())
        while True:
            reply = E.ServerFrame()
            reply.ParseFromString(await ws.recv())
            print(reply)
            if reply.terminal:
                break

asyncio.run(main())
`
}
