export type ErrorCode =
  | 'INVALID_INPUT'
  | 'SERVICE_NOT_FOUND'
  | 'PROFESSIONAL_NOT_FOUND'
  | 'PROFESSIONAL_DOES_NOT_OFFER_SERVICE'
  | 'OUTSIDE_WORKING_HOURS'
  | 'SLOT_UNAVAILABLE'
  | 'TOO_SOON'
  | 'TOO_FAR_AHEAD'
  | 'CHANGE_WINDOW_PASSED'
  | 'BOOKING_LIMIT_REACHED'
  | 'DAILY_CAPACITY_REACHED'
  | 'RATE_LIMITED'
  | 'APPOINTMENT_NOT_FOUND'
  | 'INTERNAL_ERROR'

export type Suggestion = { professionalId: string; professionalName: string; startsAt: Date }

/** Messages are read by the visitor's AI, so they are in English and never expose internals. */
export type DomainError = { code: ErrorCode; message: string; suggestions?: Suggestion[] }

/** A failure carries no value type, so it can be returned as is from any function returning a Result. */
export type Failure = { ok: false; error: DomainError }

export type Result<T> = { ok: true; value: T } | Failure

export const ok = <T>(value: T): { ok: true; value: T } => ({ ok: true, value })

export const fail = (code: ErrorCode, message: string, suggestions?: Suggestion[]): Failure => ({
  ok: false,
  error: suggestions ? { code, message, suggestions } : { code, message },
})
