import { checkDateWindow, freeStarts, resolveCandidates, slotStatus } from './availability.js'
import { fail, ok, type ErrorCode, type Failure, type Result, type Suggestion } from './result.js'
import { SHOP_RULES, type ShopRules } from './rules.js'
import { addDays, addMinutes, formatZoned, toZoned, type LocalDate } from './time.js'
import type { Professional, Schedule, Service } from './types.js'

export type BookingRequest = { serviceId: string; start: Date; professionalId?: string }

export type BookingPlan = { service: Service; professional: Professional; startsAt: Date; endsAt: Date }

/** The rules a booking goes through, in order. The inspector shows each one with its result. */
export type CheckRule =
  | 'appointment_exists'
  | 'change_window'
  | 'service_exists'
  | 'professional_exists'
  | 'professional_offers_service'
  | 'on_slot_grid'
  | 'min_advance'
  | 'max_days_ahead'
  | 'within_working_hours'
  | 'slot_free'

export type Check = { rule: CheckRule; passed: boolean }

export type Evaluated<T> = Result<T> & { checks: Check[] }

export type PlanOptions = {
  /** Treat this appointment as free (used when rescheduling it). */
  excludeAppointmentId?: string
  rules?: ShopRules
}

const CANDIDATE_RULE: Partial<Record<ErrorCode, CheckRule>> = {
  SERVICE_NOT_FOUND: 'service_exists',
  PROFESSIONAL_NOT_FOUND: 'professional_exists',
  PROFESSIONAL_DOES_NOT_OFFER_SERVICE: 'professional_offers_service',
}

/**
 * Decides a booking request: validates it against every rule and, when no professional is chosen,
 * picks one. The database still has the last word on overlaps (exclusion constraint).
 */
export function planBooking(
  schedule: Schedule,
  request: BookingRequest,
  now: Date,
  options: PlanOptions = {},
): Evaluated<BookingPlan> {
  const rules = options.rules ?? SHOP_RULES
  const { excludeAppointmentId } = options
  const checks: Check[] = []
  const pass = (rule: CheckRule) => checks.push({ rule, passed: true })
  const reject = (rule: CheckRule, failure: Failure): Evaluated<BookingPlan> => {
    checks.push({ rule, passed: false })
    return { ...failure, checks }
  }

  const candidateRules: CheckRule[] =
    request.professionalId === undefined
      ? ['service_exists']
      : ['service_exists', 'professional_exists', 'professional_offers_service']
  const candidates = resolveCandidates(schedule, request.serviceId, request.professionalId)
  if (!candidates.ok) {
    const failed = CANDIDATE_RULE[candidates.error.code] ?? 'service_exists'
    candidateRules.slice(0, candidateRules.indexOf(failed)).forEach(pass)
    return reject(failed, candidates)
  }
  candidateRules.forEach(pass)
  const { service, professionals } = candidates.value
  const { start } = request
  const local = toZoned(start, rules.timeZone)

  if (local.minutes % rules.slotMinutes !== 0 || start.getTime() % 60_000 !== 0) {
    return reject(
      'on_slot_grid',
      fail('INVALID_INPUT', `start must be on a ${rules.slotMinutes}-minute boundary, like 10:00 or 10:15.`),
    )
  }
  pass('on_slot_grid')

  const earliest = addMinutes(now, rules.minAdvanceMinutes)
  if (start < earliest) {
    return reject(
      'min_advance',
      fail(
        'TOO_SOON',
        `Bookings need at least ${rules.minAdvanceMinutes / 60} hours of notice. ` +
          `The earliest possible start is ${formatZoned(earliest, rules.timeZone)}.`,
      ),
    )
  }
  pass('min_advance')

  const window = checkDateWindow(local.date, now, rules)
  if (!window.ok) return reject('max_days_ahead', window)
  pass('max_days_ahead')

  const statuses = professionals.map((professional) => ({
    professional,
    status: slotStatus(schedule, professional.id, service, start, rules, excludeAppointmentId),
  }))
  const suggest = () =>
    suggestStarts(schedule, { service, professionals, around: start, now, rules, excludeAppointmentId })

  const working = statuses.filter((s) => s.status.kind === 'free' || s.status.kind === 'busy')
  if (working.length === 0) {
    const closed = statuses.find((s) => s.status.kind === 'closed')?.status
    const message =
      closed?.kind === 'closed'
        ? `Not available at that time: ${closed.reason ?? 'closed'}.`
        : request.professionalId === undefined
          ? `Nobody who offers ${service.name} works at that time.`
          : `${professionals[0]?.name ?? 'The professional'} does not work at that time.`
    return reject('within_working_hours', fail('OUTSIDE_WORKING_HOURS', message, suggest()))
  }
  pass('within_working_hours')

  const free = working.filter((s) => s.status.kind === 'free').map((s) => s.professional)
  if (free.length === 0) {
    return reject(
      'slot_free',
      fail('SLOT_UNAVAILABLE', 'That time is already taken. Offer the suggested times instead.', suggest()),
    )
  }
  pass('slot_free')

  const professional = pickProfessional(schedule, free, local.date, rules, excludeAppointmentId)
  return { ...ok({ service, professional, startsAt: start, endsAt: addMinutes(start, service.durationMin) }), checks }
}

/** Among free professionals, the one with the fewest appointments that day; ties keep display order. */
function pickProfessional(
  schedule: Schedule,
  candidates: readonly Professional[],
  date: LocalDate,
  rules: ShopRules,
  excludeAppointmentId?: string,
): Professional {
  const appointmentsThatDay = (professionalId: string) =>
    schedule.appointments.filter(
      (a) =>
        a.professionalId === professionalId &&
        a.appointmentId !== excludeAppointmentId &&
        toZoned(a.startsAt, rules.timeZone).date === date,
    ).length

  let best: Professional | undefined
  let bestCount = Infinity
  for (const candidate of candidates) {
    const count = appointmentsThatDay(candidate.id)
    if (count < bestCount) {
      best = candidate
      bestCount = count
    }
  }
  if (!best) throw new Error('pickProfessional needs at least one candidate')
  return best
}

type SuggestionQuery = {
  service: Service
  professionals: readonly Professional[]
  around: Date
  now: Date
  rules: ShopRules
  excludeAppointmentId?: string | undefined
}

/** The free starts closest to `around` within the booking window, in chronological order. */
export function suggestStarts(schedule: Schedule, query: SuggestionQuery): Suggestion[] {
  const { service, professionals, around, now, rules, excludeAppointmentId } = query
  const today = toZoned(now, rules.timeZone).date
  const options: Suggestion[] = []

  for (let day = 0; day <= rules.maxDaysAhead; day++) {
    const date = addDays(today, day)
    const freeAt = new Map<number, Professional[]>()
    for (const professional of professionals) {
      for (const start of freeStarts(schedule, professional.id, service, date, now, rules, excludeAppointmentId)) {
        freeAt.set(start.getTime(), [...(freeAt.get(start.getTime()) ?? []), professional])
      }
    }
    for (const [time, free] of freeAt) {
      const professional = pickProfessional(schedule, free, date, rules, excludeAppointmentId)
      options.push({ professionalId: professional.id, professionalName: professional.name, startsAt: new Date(time) })
    }
  }

  const distance = (s: Suggestion) => Math.abs(s.startsAt.getTime() - around.getTime())
  return options
    .toSorted((a, b) => distance(a) - distance(b) || a.startsAt.getTime() - b.startsAt.getTime())
    .slice(0, rules.suggestionCount)
    .toSorted((a, b) => a.startsAt.getTime() - b.startsAt.getTime())
}

/** Appointments can be changed or cancelled up to `minChangeAdvanceMinutes` before they start. */
export function checkChangeWindow(
  appointment: { status: 'confirmed' | 'cancelled' | 'completed'; startsAt: Date },
  now: Date,
  rules: ShopRules = SHOP_RULES,
): Result<void> {
  if (appointment.status === 'cancelled') {
    return fail('APPOINTMENT_NOT_FOUND', 'This appointment was cancelled. Book a new one with book_appointment.')
  }
  const limit = addMinutes(now, rules.minChangeAdvanceMinutes)
  if (appointment.status === 'completed' || appointment.startsAt < limit) {
    return fail(
      'CHANGE_WINDOW_PASSED',
      `Appointments can only be changed or cancelled up to ${rules.minChangeAdvanceMinutes / 60} hours before they start.`,
    )
  }
  return ok(undefined)
}
