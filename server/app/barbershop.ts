import { randomInt } from 'node:crypto'
import type postgres from 'postgres'
import {
  cancelAppointment,
  countUpcomingByVisitor,
  findAppointmentByCodeHash,
  inAgendaTransaction,
  insertAppointment,
  moveAppointment,
  occupiedMinutesBetween,
  type Appointment,
} from '../db/appointments.js'
import { isSlotConflict } from '../db/client.js'
import { loadCatalog, loadSchedule, type Catalog } from '../db/schedule.js'
import { findAvailability, type Availability, type AvailabilityQuery } from '../domain/availability.js'
import { checkChangeWindow, planBooking, type Check, type CheckRule, type Evaluated } from '../domain/booking.js'
import { checkDailyCapacity, checkVisitorBookings, dayCapacityMinutes } from '../domain/limits.js'
import { fail, ok, type Failure, type Result } from '../domain/result.js'
import { SHOP_RULES, type ShopRules } from '../domain/rules.js'
import { addDays, dayBounds, toZoned, zonedToInstant } from '../domain/time.js'
import type { Schedule } from '../domain/types.js'
import { generateCode, hashCode, normalizeCode } from '../security/codes.js'

export type BarbershopDeps = {
  sql: postgres.Sql
  /** Injected so tests can pin "now". */
  now?: () => Date
  rules?: ShopRules
}

export type BookInput = {
  serviceId: string
  start: Date
  professionalId?: string
  clientName?: string
  /** Who is booking, for the per-visitor limit: the key from server/security/ip.ts. */
  visitor: string
}
export type Booked = { code: string; appointment: Appointment }
export type RescheduleInput = { code: string; newStart: Date; professionalId?: string }
export type Cancelled = { appointment: Appointment; alreadyCancelled: boolean }

// When the database refuses a write because someone else just took the time, plan again with fresh
// data: another professional may still be free, or the new plan fails with suggestions.
const MAX_WRITE_ATTEMPTS = 3
const OVERLAP = Symbol('overlap')

async function unlessOverlap<T>(write: () => Promise<T>): Promise<T | typeof OVERLAP> {
  try {
    return await write()
  } catch (error) {
    if (isSlotConflict(error)) return OVERLAP
    throw error
  }
}

const notFound = (): Failure => fail('APPOINTMENT_NOT_FOUND', 'No appointment matches this code.')

const stillContested = (checks: Check[]): Evaluated<never> => ({
  ...fail('SLOT_UNAVAILABLE', 'That time was just taken by someone else. Call check_availability for free times.'),
  checks,
})

type Gate = [CheckRule, () => Promise<Result<void>>]
type Gated<T> = { checks: Check[]; result: Result<T> }

/** Runs the limit gates in order and writes only if all pass; the first failure stops. For use inside the
 * write transaction, so the counts the gates read cannot change before the write. */
async function gated<T>(gates: Gate[], write: () => Promise<T>): Promise<Gated<T>> {
  const checks: Check[] = []
  for (const [rule, gate] of gates) {
    const result = await gate()
    checks.push({ rule, passed: result.ok })
    if (!result.ok) return { checks, result }
  }
  return { checks, result: ok(await write()) }
}

/** The daily occupancy gate (docs/SPEC.md, section 3): counts every active appointment that day, fresh. */
function dailyCapacityGate(
  tx: postgres.TransactionSql,
  schedule: Schedule,
  plan: { startsAt: Date; service: { durationMin: number } },
  rules: ShopRules,
  excludeAppointmentId?: string,
): Gate {
  const { date } = toZoned(plan.startsAt, rules.timeZone)
  return [
    'daily_capacity',
    async () =>
      checkDailyCapacity(
        {
          occupiedMinutes: await occupiedMinutesBetween(tx, dayBounds(date, rules.timeZone), excludeAppointmentId),
          durationMin: plan.service.durationMin,
          capacityMinutes: dayCapacityMinutes(schedule, date, rules),
        },
        rules,
      ),
  ]
}

/** Bookable range: from the start of today to the end of the last bookable day, in shop time. */
function bookingWindow(now: Date, rules: ShopRules) {
  const today = toZoned(now, rules.timeZone).date
  return {
    from: zonedToInstant(today, 0, rules.timeZone),
    to: zonedToInstant(addDays(today, rules.maxDaysAhead + 1), 0, rules.timeZone),
  }
}

/** The use cases behind the MCP tools: domain rules plus the database. */
export function createBarbershop({ sql, now = () => new Date(), rules = SHOP_RULES }: BarbershopDeps) {
  const scheduleAt = (instant: Date) => loadSchedule(sql, bookingWindow(instant, rules))

  async function findByCode(code: string): Promise<Appointment | undefined> {
    const normalized = normalizeCode(code)
    return normalized ? findAppointmentByCodeHash(sql, hashCode(normalized)) : undefined
  }

  return {
    rules,

    catalog(): Promise<Catalog> {
      return loadCatalog(sql)
    },

    async checkAvailability(query: AvailabilityQuery): Promise<Result<Availability>> {
      const instant = now()
      return findAvailability(await scheduleAt(instant), query, instant, rules)
    },

    async book(input: BookInput): Promise<Evaluated<Booked>> {
      let checks: Check[] = []
      for (let attempt = 1; attempt <= MAX_WRITE_ATTEMPTS; attempt++) {
        const instant = now()
        const schedule = await scheduleAt(instant)
        const plan = planBooking(schedule, input, instant, { rules })
        if (!plan.ok) return plan
        checks = plan.checks
        const { professional, service, startsAt, endsAt } = plan.value

        const code = generateCode()
        const locks = { visitor: input.visitor, day: toZoned(startsAt, rules.timeZone).date, professionalId: professional.id }
        const written = await unlessOverlap(() =>
          inAgendaTransaction(sql, locks, (tx) =>
            gated(
              [
                ['visitor_bookings', async () => checkVisitorBookings(await countUpcomingByVisitor(tx, input.visitor, instant), rules)],
                dailyCapacityGate(tx, schedule, plan.value, rules),
              ],
              () =>
                insertAppointment(tx, {
                  codeHash: hashCode(code.replace('-', '')),
                  professionalId: professional.id,
                  serviceId: service.id,
                  startsAt,
                  endsAt,
                  clientName: input.clientName ?? null,
                  publicAlias: `Cliente #${randomInt(1000, 10_000)}`,
                  ipHash: input.visitor,
                }),
            ),
          ),
        )
        if (written === OVERLAP) continue
        checks = [...checks, ...written.checks]
        if (!written.result.ok) return { ...written.result, checks }
        return { ...ok({ code, appointment: written.result.value }), checks }
      }
      return stillContested(checks)
    },

    async getAppointment(code: string): Promise<Result<Appointment>> {
      const appointment = await findByCode(code)
      return appointment ? ok(appointment) : notFound()
    },

    async reschedule(input: RescheduleInput): Promise<Evaluated<Appointment>> {
      let checks: Check[] = []
      for (let attempt = 1; attempt <= MAX_WRITE_ATTEMPTS; attempt++) {
        const instant = now()
        const current = await findByCode(input.code)
        if (!current) return { ...notFound(), checks: [{ rule: 'appointment_exists', passed: false }] }

        const window = checkChangeWindow(current, instant, rules)
        const before: Check[] = [
          { rule: 'appointment_exists', passed: true },
          { rule: 'change_window', passed: window.ok },
        ]
        if (!window.ok) return { ...window, checks: before }

        const schedule = await scheduleAt(instant)
        const plan = planBooking(
          schedule,
          {
            serviceId: current.service.id,
            start: input.newStart,
            professionalId: input.professionalId ?? current.professional.id,
          },
          instant,
          { rules, excludeAppointmentId: current.id },
        )
        checks = [...before, ...plan.checks]
        if (!plan.ok) return { ...plan, checks }
        const { professional, startsAt, endsAt } = plan.value

        const locks = { day: toZoned(startsAt, rules.timeZone).date, professionalId: professional.id }
        const written = await unlessOverlap(() =>
          inAgendaTransaction(sql, locks, (tx) =>
            gated([dailyCapacityGate(tx, schedule, plan.value, rules, current.id)], () =>
              moveAppointment(tx, current.id, { professionalId: professional.id, startsAt, endsAt }),
            ),
          ),
        )
        if (written === OVERLAP) continue
        checks = [...checks, ...written.checks]
        if (!written.result.ok) return { ...written.result, checks }
        if (written.result.value === undefined) return { ...notFound(), checks }
        return { ...ok(written.result.value), checks }
      }
      return stillContested(checks)
    },

    async cancel(code: string): Promise<Evaluated<Cancelled>> {
      const current = await findByCode(code)
      if (!current) return { ...notFound(), checks: [{ rule: 'appointment_exists', passed: false }] }
      const exists: Check = { rule: 'appointment_exists', passed: true }
      if (current.status === 'cancelled') return { ...ok({ appointment: current, alreadyCancelled: true }), checks: [exists] }

      const window = checkChangeWindow(current, now(), rules)
      const checks: Check[] = [exists, { rule: 'change_window', passed: window.ok }]
      if (!window.ok) return { ...window, checks }

      const cancelled = await cancelAppointment(sql, current.id)
      if (cancelled) return { ...ok({ appointment: cancelled, alreadyCancelled: false }), checks }
      // Changed in the meantime (cancelled by a parallel request): report what is there now.
      const latest = await findByCode(code)
      return latest
        ? { ...ok({ appointment: latest, alreadyCancelled: latest.status === 'cancelled' }), checks }
        : { ...notFound(), checks }
    },
  }
}

export type Barbershop = ReturnType<typeof createBarbershop>
