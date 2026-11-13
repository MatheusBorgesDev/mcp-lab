import { dayHasRoom } from './limits.js'
import { fail, ok, type Result } from './result.js'
import { SHOP_RULES, type ShopRules } from './rules.js'
import { addDays, addMinutes, toZoned, weekdayOf, zonedToInstant, type LocalDate } from './time.js'
import type { Closure, Professional, Schedule, Service } from './types.js'

export type AvailabilityQuery = {
  serviceId: string
  date: LocalDate
  professionalId?: string
  /** Treat this appointment as free (used when rescheduling it). */
  excludeAppointmentId?: string
}

export type Availability = {
  date: LocalDate
  service: Service
  professionals: Array<{ professional: Professional; starts: Date[] }>
  /** Closures touching that day, for the listed professionals or the whole shop, to explain empty days. */
  closures: Closure[]
  /** The day is over the daily limit for this service (docs/SPEC.md, section 3): no starts are offered. */
  dayFull: boolean
}

const overlaps = (aStart: Date, aEnd: Date, bStart: Date, bEnd: Date) => aStart < bEnd && bStart < aEnd

/** The active service and the active professionals who could do it (only the chosen one, if any). */
export function resolveCandidates(
  schedule: Schedule,
  serviceId: string,
  professionalId?: string,
): Result<{ service: Service; professionals: Professional[] }> {
  const service = schedule.services.find((s) => s.id === serviceId && s.active)
  if (!service) {
    return fail('SERVICE_NOT_FOUND', `No service with id "${serviceId}". Call list_services for valid ids.`)
  }

  if (professionalId === undefined) {
    const professionals = schedule.professionals.filter((p) => p.active && p.serviceIds.includes(service.id))
    return ok({ service, professionals })
  }

  const professional = schedule.professionals.find((p) => p.id === professionalId && p.active)
  if (!professional) {
    return fail(
      'PROFESSIONAL_NOT_FOUND',
      `No professional with id "${professionalId}". Call list_professionals for valid ids.`,
    )
  }
  if (!professional.serviceIds.includes(service.id)) {
    return fail(
      'PROFESSIONAL_DOES_NOT_OFFER_SERVICE',
      `${professional.name} does not offer ${service.name}. Omit professional_id to let the shop choose.`,
    )
  }
  return ok({ service, professionals: [professional] })
}

/** Bookable dates go from today (shop time) up to `maxDaysAhead` days ahead. */
export function checkDateWindow(date: LocalDate, now: Date, rules: ShopRules = SHOP_RULES): Result<void> {
  const today = toZoned(now, rules.timeZone).date
  if (date < today) {
    return fail('TOO_SOON', `${date} has already passed. Today is ${today} (${rules.timeZone}).`)
  }
  const lastDay = addDays(today, rules.maxDaysAhead)
  if (date > lastDay) {
    return fail('TOO_FAR_AHEAD', `Bookings open up to ${rules.maxDaysAhead} days ahead, until ${lastDay}.`)
  }
  return ok(undefined)
}

export type SlotStatus =
  | { kind: 'free' }
  | { kind: 'outside_working_hours' }
  | { kind: 'closed'; reason: string | null }
  | { kind: 'busy' }

/** Whether one professional can do the service at `start`, and if not, why. Ignores notice and date window. */
export function slotStatus(
  schedule: Schedule,
  professionalId: string,
  service: Service,
  start: Date,
  rules: ShopRules = SHOP_RULES,
  excludeAppointmentId?: string,
): SlotStatus {
  const { weekday, minutes } = toZoned(start, rules.timeZone)
  const fits = schedule.workingHours.some(
    (w) =>
      w.professionalId === professionalId &&
      w.weekday === weekday &&
      w.startMin <= minutes &&
      minutes + service.durationMin <= w.endMin,
  )
  if (!fits) return { kind: 'outside_working_hours' }

  const end = addMinutes(start, service.durationMin)
  const closure = schedule.closures.find(
    (c) =>
      (c.professionalId === null || c.professionalId === professionalId) && overlaps(start, end, c.startsAt, c.endsAt),
  )
  if (closure) return { kind: 'closed', reason: closure.reason }

  const taken = schedule.appointments.some(
    (a) =>
      a.professionalId === professionalId &&
      a.appointmentId !== excludeAppointmentId &&
      overlaps(start, end, a.startsAt, a.endsAt),
  )
  return taken ? { kind: 'busy' } : { kind: 'free' }
}

/** Free start times of one professional for a service on a date, honouring every time rule and the daily limit. */
export function freeStarts(
  schedule: Schedule,
  professionalId: string,
  service: Service,
  date: LocalDate,
  now: Date,
  rules: ShopRules = SHOP_RULES,
  excludeAppointmentId?: string,
): Date[] {
  if (!dayHasRoom(schedule, date, service.durationMin, rules, excludeAppointmentId)) return []
  const weekday = weekdayOf(date)
  const earliest = addMinutes(now, rules.minAdvanceMinutes)
  const intervals = schedule.workingHours
    .filter((w) => w.professionalId === professionalId && w.weekday === weekday)
    .toSorted((a, b) => a.startMin - b.startMin)

  const starts: Date[] = []
  for (const interval of intervals) {
    const first = Math.ceil(interval.startMin / rules.slotMinutes) * rules.slotMinutes
    for (let minute = first; minute + service.durationMin <= interval.endMin; minute += rules.slotMinutes) {
      const start = zonedToInstant(date, minute, rules.timeZone)
      if (start < earliest) continue
      if (slotStatus(schedule, professionalId, service, start, rules, excludeAppointmentId).kind === 'free') {
        starts.push(start)
      }
    }
  }
  return starts
}

export function findAvailability(
  schedule: Schedule,
  query: AvailabilityQuery,
  now: Date,
  rules: ShopRules = SHOP_RULES,
): Result<Availability> {
  const candidates = resolveCandidates(schedule, query.serviceId, query.professionalId)
  if (!candidates.ok) return candidates
  const window = checkDateWindow(query.date, now, rules)
  if (!window.ok) return window

  const { service, professionals } = candidates.value
  const dayStart = zonedToInstant(query.date, 0, rules.timeZone)
  const dayEnd = zonedToInstant(addDays(query.date, 1), 0, rules.timeZone)
  const listed = new Set(professionals.map((p) => p.id))

  return ok({
    date: query.date,
    service,
    professionals: professionals.map((professional) => ({
      professional,
      starts: freeStarts(schedule, professional.id, service, query.date, now, rules, query.excludeAppointmentId),
    })),
    closures: schedule.closures.filter(
      (c) =>
        (c.professionalId === null || listed.has(c.professionalId)) &&
        overlaps(c.startsAt, c.endsAt, dayStart, dayEnd),
    ),
    dayFull: !dayHasRoom(schedule, query.date, service.durationMin, rules, query.excludeAppointmentId),
  })
}
