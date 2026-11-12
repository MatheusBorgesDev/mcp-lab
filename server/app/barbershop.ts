import { randomInt } from 'node:crypto'
import type postgres from 'postgres'
import {
  cancelAppointment,
  findAppointmentByCodeHash,
  insertAppointment,
  moveAppointment,
  type Appointment,
} from '../db/appointments.js'
import { isSlotConflict } from '../db/client.js'
import { loadCatalog, loadSchedule, type Catalog } from '../db/schedule.js'
import { findAvailability, type Availability, type AvailabilityQuery } from '../domain/availability.js'
import { checkChangeWindow, planBooking, type Check, type Evaluated } from '../domain/booking.js'
import { fail, ok, type Failure, type Result } from '../domain/result.js'
import { SHOP_RULES, type ShopRules } from '../domain/rules.js'
import { addDays, toZoned, zonedToInstant } from '../domain/time.js'
import { generateCode, hashCode, normalizeCode } from '../security/codes.js'

export type BarbershopDeps = {
  sql: postgres.Sql
  /** Injected so tests can pin "now". */
  now?: () => Date
  rules?: ShopRules
}

export type BookInput = { serviceId: string; start: Date; professionalId?: string; clientName?: string }
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
        const plan = planBooking(await scheduleAt(instant), input, instant, { rules })
        if (!plan.ok) return plan
        checks = plan.checks

        const code = generateCode()
        const appointment = await unlessOverlap(() =>
          insertAppointment(sql, {
            codeHash: hashCode(code.replace('-', '')),
            professionalId: plan.value.professional.id,
            serviceId: plan.value.service.id,
            startsAt: plan.value.startsAt,
            endsAt: plan.value.endsAt,
            clientName: input.clientName ?? null,
            publicAlias: `Cliente #${randomInt(1000, 10_000)}`,
            ipHash: null,
          }),
        )
        if (appointment !== OVERLAP) return { ...ok({ code, appointment }), checks }
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

        const plan = planBooking(
          await scheduleAt(instant),
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

        const moved = await unlessOverlap(() =>
          moveAppointment(sql, current.id, {
            professionalId: plan.value.professional.id,
            startsAt: plan.value.startsAt,
            endsAt: plan.value.endsAt,
          }),
        )
        if (moved === undefined) return { ...notFound(), checks }
        if (moved !== OVERLAP) return { ...ok(moved), checks }
      }
      return stillContested(checks)
    },

    async cancel(code: string): Promise<Result<Cancelled>> {
      const current = await findByCode(code)
      if (!current) return notFound()
      if (current.status === 'cancelled') return ok({ appointment: current, alreadyCancelled: true })

      const window = checkChangeWindow(current, now(), rules)
      if (!window.ok) return window

      const cancelled = await cancelAppointment(sql, current.id)
      if (cancelled) return ok({ appointment: cancelled, alreadyCancelled: false })
      // Changed in the meantime (cancelled by a parallel request): report what is there now.
      const latest = await findByCode(code)
      return latest ? ok({ appointment: latest, alreadyCancelled: latest.status === 'cancelled' }) : notFound()
    },
  }
}

export type Barbershop = ReturnType<typeof createBarbershop>
