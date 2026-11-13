import { fail, ok, type Result } from './result.js'
import { SHOP_RULES, type ShopRules } from './rules.js'
import { addMinutes, dayBounds, weekdayOf, zonedToInstant, type LocalDate } from './time.js'
import type { Schedule } from './types.js'

// Limits that keep the shared agenda usable by the next visitor (docs/SPEC.md, sections 3 and 8). The
// database transaction that writes a booking checks them again with fresh counts (server/db/appointments.ts).

const overlaps = (aStart: Date, aEnd: Date, bStart: Date, bEnd: Date) => aStart < bEnd && bStart < aEnd

/** The minutes active professionals work on `date`, minus closures. Counted slot by slot, so closures that
 * overlap each other are taken out once. */
export function dayCapacityMinutes(schedule: Schedule, date: LocalDate, rules: ShopRules = SHOP_RULES): number {
  const weekday = weekdayOf(date)
  const active = new Set(schedule.professionals.filter((p) => p.active).map((p) => p.id))
  let minutes = 0
  for (const interval of schedule.workingHours) {
    if (interval.weekday !== weekday || !active.has(interval.professionalId)) continue
    for (let minute = interval.startMin; minute < interval.endMin; minute += rules.slotMinutes) {
      const length = Math.min(rules.slotMinutes, interval.endMin - minute)
      const start = zonedToInstant(date, minute, rules.timeZone)
      const end = addMinutes(start, length)
      const closed = schedule.closures.some(
        (c) =>
          (c.professionalId === null || c.professionalId === interval.professionalId) &&
          overlaps(start, end, c.startsAt, c.endsAt),
      )
      if (!closed) minutes += length
    }
  }
  return minutes
}

/** Minutes taken by the schedule's active appointments that start on `date`, except `excludeAppointmentId`. */
export function occupiedMinutes(
  schedule: Schedule,
  date: LocalDate,
  rules: ShopRules = SHOP_RULES,
  excludeAppointmentId?: string,
): number {
  const { from, to } = dayBounds(date, rules.timeZone)
  return schedule.appointments
    .filter((a) => a.appointmentId !== excludeAppointmentId && a.startsAt >= from && a.startsAt < to)
    .reduce((sum, a) => sum + (a.endsAt.getTime() - a.startsAt.getTime()) / 60_000, 0)
}

/** A visitor may hold `maxActiveBookingsPerVisitor` upcoming appointments; `active` is how many they hold. */
export function checkVisitorBookings(active: number, rules: ShopRules = SHOP_RULES): Result<void> {
  if (active < rules.maxActiveBookingsPerVisitor) return ok(undefined)
  return fail(
    'BOOKING_LIMIT_REACHED',
    `Each visitor can hold up to ${rules.maxActiveBookingsPerVisitor} upcoming appointments. ` +
      'Cancel one with its booking code, or book again after one has passed.',
  )
}

export type DayUsage = { occupiedMinutes: number; durationMin: number; capacityMinutes: number }

/** A booking fits while the day stays at or below `maxDailyOccupancyPercent` of its working minutes. */
export function checkDailyCapacity(usage: DayUsage, rules: ShopRules = SHOP_RULES): Result<void> {
  const after = usage.occupiedMinutes + usage.durationMin
  // Whole numbers on both sides: no rounding at the edge.
  if (usage.capacityMinutes > 0 && after * 100 <= usage.capacityMinutes * rules.maxDailyOccupancyPercent) {
    return ok(undefined)
  }
  return fail(
    'DAILY_CAPACITY_REACHED',
    `This day is full for new bookings: the shop keeps ${100 - rules.maxDailyOccupancyPercent}% of each day free. ` +
      'Call check_availability for another day.',
  )
}

/** Whether a service of `durationMin` still fits the day's limit, by what the schedule holds. */
export function dayHasRoom(
  schedule: Schedule,
  date: LocalDate,
  durationMin: number,
  rules: ShopRules = SHOP_RULES,
  excludeAppointmentId?: string,
): boolean {
  return checkDailyCapacity(
    {
      occupiedMinutes: occupiedMinutes(schedule, date, rules, excludeAppointmentId),
      durationMin,
      capacityMinutes: dayCapacityMinutes(schedule, date, rules),
    },
    rules,
  ).ok
}
