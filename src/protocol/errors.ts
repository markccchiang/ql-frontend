import { Error_Code, type Error as ErrorPayload } from '@/gen/quantlib/v2/envelope_pb'

/** The five things an error can mean to a user, which is fewer than the codes.
 *
 *  HANDLERS.md: the three a frontend must tell apart are UNSPECIFIED_ENUM (you
 *  left a field out), INVALID_ARGUMENT (you filled it in wrongly) and
 *  UNSUPPORTED (well-formed, and this build refuses to price it on a
 *  substitute). Each gets a different presentation; see PLAN.md §7.5.
 */
export type ErrorClass =
  | 'missing-field'
  | 'invalid-field'
  | 'unsupported'
  | 'unknown-id'
  | 'session'
  | 'cancelled'
  | 'calculation'
  | 'infrastructure'

export function classifyError(code: Error_Code): ErrorClass {
  switch (code) {
    case Error_Code.UNSPECIFIED_ENUM:
      return 'missing-field'
    case Error_Code.INVALID_ARGUMENT:
      return 'invalid-field'
    case Error_Code.UNSUPPORTED:
      return 'unsupported'
    case Error_Code.UNKNOWN_ID:
      return 'unknown-id'
    case Error_Code.SESSION_NOT_FOUND:
      return 'session'
    case Error_Code.CANCELLED:
      return 'cancelled'
    case Error_Code.BOOTSTRAP_FAILED:
    case Error_Code.CALCULATION_FAILED:
      return 'calculation'
    default:
      return 'infrastructure'
  }
}

/** What the user is being asked to do about it. */
export const REMEDY: Record<ErrorClass, string> = {
  'missing-field': 'Fill this field in — the backend rejects an unset enum rather than defaulting it.',
  'invalid-field': 'This value cannot work. Correct it.',
  unsupported: 'The schema expresses it; this build does not price it, and will not substitute.',
  'unknown-id': 'No market object of that id in the session.',
  session: 'The session is gone. Reopen and replay.',
  cancelled: 'Cancelled at your request.',
  calculation: 'The maths failed — no field to blame.',
  infrastructure: 'Backend trouble. Retry or back off.',
}

/** A terminal Error frame, as a throwable. */
export class WireError extends Error {
  readonly code: Error_Code
  readonly errorClass: ErrorClass
  readonly fieldPath: string
  readonly knownIds: readonly string[]
  readonly requestId: bigint

  constructor(payload: ErrorPayload, requestId: bigint) {
    super(payload.message || Error_Code[payload.code] || 'unknown error')
    this.name = 'WireError'
    this.code = payload.code
    this.errorClass = classifyError(payload.code)
    this.fieldPath = payload.fieldPath
    this.knownIds = payload.knownIds
    this.requestId = requestId
  }

  get remedy(): string {
    return REMEDY[this.errorClass]
  }
}

/** The socket went away with requests outstanding.
 *
 *  Not a protocol error: the backend promises one terminal frame per request,
 *  and a lost connection is the one way that promise is not kept. DESIGN §9.4
 *  also means every session on that socket is gone, so the recovery is replay.
 */
export class DisconnectedError extends Error {
  constructor(readonly requestId: bigint) {
    super('connection closed before the terminal frame arrived')
    this.name = 'DisconnectedError'
  }
}
