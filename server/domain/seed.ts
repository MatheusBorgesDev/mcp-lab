import { bookingWindow, slotStatus } from './availability.js'
import { dayCapacityMinutes } from './limits.js'
import { SHOP_RULES, type ShopRules } from './rules.js'
import { addDays, toZoned, weekdayOf, zonedToInstant, type LocalDate } from './time.js'
import type { BusySlot, Schedule } from './types.js'

// The shop's own (fictitious) bookings, recreated by the daily reset (docs/SPEC.md, section 9). A generator
// seeded by the date picks them, so a day keeps the same bookings from one reset to the next: each reset only
// adds the new last day of the window.

export type SeedAppointment = {
  /** Stored as the code hash. Booking codes hash to 64 hex characters, never to this, so nobody can view,
   * move or cancel a fictitious booking. */
  key: string
  professionalId: string
  serviceId: string
  startsAt: Date
  endsAt: Date
  publicAlias: string
}

/** What the daily reset writes: the fictitious bookings of the booking window, which starts at `windowStart`. */
export type ResetPlan = { now: Date; windowStart: Date; seeds: SeedAppointment[] }

/** FNV-1a: the date as the generator's seed. */
function hash(text: string): number {
  let h = 0x811c9dc5
  for (let i = 0; i < text.length; i++) h = Math.imul(h ^ text.charCodeAt(i), 0x01000193)
  return h >>> 0
}

/** mulberry32: a small generator of numbers in [0, 1), the same sequence for the same seed. */
function generator(seed: number): () => number {
  let state = seed
  return () => {
    state = (state + 0x6d2b79f5) >>> 0
    let t = Math.imul(state ^ (state >>> 15), state | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 2 ** 32
  }
}

function shuffled<T>(items: readonly T[], random: () => number): T[] {
  const copy = [...items]
  for (let i = copy.length - 1; i > 0; i--) {
    const j = Math.floor(random() * (i + 1))
    ;[copy[i], copy[j]] = [copy[j] as T, copy[i] as T]
  }
  return copy
}

/**
 * The shop's own bookings for one day: random starts on the slot grid, each with a service the professional
 * does, until `seedOccupancyPercent` of the day's working minutes is taken. Ignores the schedule's
 * appointments: the reset replaces them.
 */
export function seedAppointmentsFor(schedule: Schedule, date: LocalDate, rules: ShopRules = SHOP_RULES): SeedAppointment[] {
  const random = generator(hash(date))
  const target = Math.floor((dayCapacityMinutes(schedule, date, rules) * rules.seedOccupancyPercent) / 100)
  const weekday = weekdayOf(date)
  const services = schedule.services.filter((s) => s.active)

  const candidates = schedule.professionals
    .filter((p) => p.active)
    .flatMap((professional) => {
      const offered = services.filter((s) => professional.serviceIds.includes(s.id))
      return schedule.workingHours
        .filter((w) => w.professionalId === professional.id && w.weekday === weekday)
        .flatMap((w) => {
          const minutes: number[] = []
          const first = Math.ceil(w.startMin / rules.slotMinutes) * rules.slotMinutes
          for (let minute = first; minute < w.endMin; minute += rules.slotMinutes) minutes.push(minute)
          return minutes.map((minute) => ({ professional, offered, minute }))
        })
    })

  const seeds: SeedAppointment[] = []
  const taken: BusySlot[] = []
  let occupied = 0
  for (const { professional, offered, minute } of shuffled(candidates, random)) {
    // Both draws happen for every candidate, so one skipped candidate never shifts the rest of the day.
    const service = offered[Math.floor(random() * offered.length)]
    const alias = 1000 + Math.floor(random() * 9000)
    if (!service || occupied + service.durationMin > target) continue
    const startsAt = zonedToInstant(date, minute, rules.timeZone)
    if (slotStatus({ ...schedule, appointments: taken }, professional.id, service, startsAt, rules).kind !== 'free') continue

    const endsAt = new Date(startsAt.getTime() + service.durationMin * 60_000)
    // Everything the row holds but the alias: a booking the catalogue changes gets a new key and is replaced.
    const key = `seed:${date}:${professional.id}:${minute}:${service.id}:${service.durationMin}`
    seeds.push({ key, professionalId: professional.id, serviceId: service.id, startsAt, endsAt, publicAlias: `Cliente #${alias}` })
    taken.push({ appointmentId: key, professionalId: professional.id, startsAt, endsAt })
    occupied += service.durationMin
  }
  return seeds.toSorted((a, b) => a.startsAt.getTime() - b.startsAt.getTime() || a.key.localeCompare(b.key))
}

/** The fictitious bookings of every day a visitor can book, from today on. */
export function planDailyReset(schedule: Schedule, now: Date, rules: ShopRules = SHOP_RULES): ResetPlan {
  const today = toZoned(now, rules.timeZone).date
  const days = Array.from({ length: rules.maxDaysAhead + 1 }, (_, i) => addDays(today, i))
  return {
    now,
    windowStart: bookingWindow(now, rules).from,
    seeds: days.flatMap((date) => seedAppointmentsFor(schedule, date, rules)),
  }
}
