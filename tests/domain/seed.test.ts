import { describe, expect, it } from 'vitest'
import { slotStatus } from '../../server/domain/availability.js'
import { dayCapacityMinutes } from '../../server/domain/limits.js'
import { SHOP_RULES } from '../../server/domain/rules.js'
import { planDailyReset, seedAppointmentsFor, type SeedAppointment } from '../../server/domain/seed.js'
import { addDays, toZoned } from '../../server/domain/time.js'
import { at, MONDAY, scheduleWith, TUESDAY } from './fixtures.js'

// The shop's own (fictitious) bookings, recreated by the daily reset (docs/SPEC.md, section 9): about 30% of
// each day, so the agenda looks alive and the 70% limit still leaves room for visitors.

const minutes = (seeds: SeedAppointment[]) =>
  seeds.reduce((sum, s) => sum + (s.endsAt.getTime() - s.startsAt.getTime()) / 60_000, 0)
const MONDAYS = Array.from({ length: 8 }, (_, week) => addDays(MONDAY, 7 * week))

describe('seedAppointmentsFor', () => {
  it('fills about 30% of the working minutes of each day, never more', () => {
    const schedule = scheduleWith()
    for (const date of MONDAYS) {
      const target = (dayCapacityMinutes(schedule, date) * SHOP_RULES.seedOccupancyPercent) / 100
      const taken = minutes(seedAppointmentsFor(schedule, date))

      expect(taken, date).toBeLessThanOrEqual(target)
      expect(taken, date).toBeGreaterThan(target - 30)
    }
  })

  it('is the same for the same date and changes from one date to another', () => {
    const schedule = scheduleWith()
    const first = seedAppointmentsFor(schedule, MONDAY)

    expect(seedAppointmentsFor(schedule, MONDAY)).toEqual(first)
    const starts = (date: string) => seedAppointmentsFor(schedule, date).map((s) => toZoned(s.startsAt, SHOP_RULES.timeZone).minutes)
    expect(new Set(MONDAYS.map((date) => starts(date).join()))).toHaveLength(MONDAYS.length)
  })

  it('books only what a visitor could: a service the professional does, in working hours, on the grid, without overlaps', () => {
    const schedule = scheduleWith()
    for (const date of [...MONDAYS, TUESDAY]) {
      const seeds = seedAppointmentsFor(schedule, date)
      expect(seeds.length, date).toBeGreaterThan(0)
      for (const seed of seeds) {
        const professional = schedule.professionals.find((p) => p.id === seed.professionalId)
        const service = schedule.services.find((s) => s.id === seed.serviceId)
        expect(professional?.active && service?.active && professional.serviceIds.includes(service.id)).toBe(true)
        if (!service) continue
        expect(seed.endsAt.getTime() - seed.startsAt.getTime()).toBe(service.durationMin * 60_000)
        expect(toZoned(seed.startsAt, SHOP_RULES.timeZone)).toMatchObject({ date })
        expect(toZoned(seed.startsAt, SHOP_RULES.timeZone).minutes % SHOP_RULES.slotMinutes).toBe(0)

        const others = seeds
          .filter((s) => s !== seed)
          .map((s) => ({ appointmentId: s.key, professionalId: s.professionalId, startsAt: s.startsAt, endsAt: s.endsAt }))
        expect(slotStatus(scheduleWith({ appointments: others }), seed.professionalId, service, seed.startsAt)).toEqual({
          kind: 'free',
        })
      }
    }
  })

  it('leaves closed days and closed professionals alone', () => {
    const holiday = { professionalId: null, startsAt: at(MONDAY, '00:00'), endsAt: at(TUESDAY, '00:00'), reason: 'Feriado' }
    const anaOff = { professionalId: 'ana', startsAt: at(MONDAY, '00:00'), endsAt: at(TUESDAY, '00:00'), reason: 'Folga' }

    expect(seedAppointmentsFor(scheduleWith(), addDays(MONDAY, -1))).toEqual([])
    expect(seedAppointmentsFor(scheduleWith({ closures: [holiday] }), MONDAY)).toEqual([])
    const withoutAna = seedAppointmentsFor(scheduleWith({ closures: [anaOff] }), MONDAY)
    expect(withoutAna.length).toBeGreaterThan(0)
    expect(withoutAna.every((s) => s.professionalId === 'bia')).toBe(true)
  })

  it('changes the key whenever the booking changes, so the reset replaces a booking the catalogue changed', () => {
    const before = scheduleWith()
    const after = { ...before, services: before.services.map((s) => (s.id === 'barba' ? { ...s, durationMin: 45 } : s)) }
    const byKey = new Map<string, SeedAppointment>()
    for (const seed of MONDAYS.flatMap((date) => [...seedAppointmentsFor(before, date), ...seedAppointmentsFor(after, date)])) {
      const same = byKey.get(seed.key)
      if (same) expect([same.serviceId, same.startsAt, same.endsAt], seed.key).toEqual([seed.serviceId, seed.startsAt, seed.endsAt])
      byKey.set(seed.key, seed)
    }
  })

  it('gives each booking a key no booking code hashes to, and an alias like a visitor gets', () => {
    const seeds = MONDAYS.flatMap((date) => seedAppointmentsFor(scheduleWith(), date))

    expect(new Set(seeds.map((s) => s.key)).size).toBe(seeds.length)
    for (const seed of seeds) {
      expect(seed.key).not.toMatch(/^[0-9a-f]{64}$/)
      expect(seed.publicAlias).toMatch(/^Cliente #\d{4}$/)
    }
  })
})

describe('planDailyReset', () => {
  it('covers the booking window: from the start of today to the last bookable day', () => {
    const schedule = scheduleWith()
    const now = at(MONDAY, '03:00')
    const plan = planDailyReset(schedule, now)

    expect(plan.now).toBe(now)
    expect(plan.windowStart).toEqual(at(MONDAY, '00:00'))
    const days = Array.from({ length: SHOP_RULES.maxDaysAhead + 1 }, (_, i) => addDays(MONDAY, i))
    expect(plan.seeds).toEqual(days.flatMap((date) => seedAppointmentsFor(schedule, date)))
    const dates = new Set(plan.seeds.map((s) => toZoned(s.startsAt, SHOP_RULES.timeZone).date))
    expect(dates).toContain(addDays(MONDAY, SHOP_RULES.maxDaysAhead))
    expect(dates).not.toContain(addDays(MONDAY, SHOP_RULES.maxDaysAhead + 1))
  })
})
