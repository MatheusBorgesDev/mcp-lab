import { describe, expect, it } from 'vitest'
import {
  checkDailyCapacity,
  checkVisitorBookings,
  dayCapacityMinutes,
  dayHasRoom,
  occupiedMinutes,
} from '../../server/domain/limits.js'
import { SHOP_RULES } from '../../server/domain/rules.js'
import { at, MONDAY, scheduleWith, TUESDAY } from './fixtures.js'

const SUNDAY = '2030-01-06'
const busy = (id: string, professionalId: string, date: string, from: string, to: string) => ({
  appointmentId: id,
  professionalId,
  startsAt: at(date, from),
  endsAt: at(date, to),
})

describe('dayCapacityMinutes', () => {
  it('adds the working minutes of every active professional that day', () => {
    // ana 3 h + 5 h, bia 4 h; caio is inactive.
    expect(dayCapacityMinutes(scheduleWith(), MONDAY)).toBe(720)
    expect(dayCapacityMinutes(scheduleWith(), TUESDAY)).toBe(180)
    expect(dayCapacityMinutes(scheduleWith(), SUNDAY)).toBe(0)
  })

  it('leaves out closed time, counting overlapping closures once', () => {
    const closures = [
      { professionalId: 'ana', startsAt: at(MONDAY, '09:00'), endsAt: at(MONDAY, '11:00'), reason: 'médico' },
      { professionalId: null, startsAt: at(MONDAY, '10:00'), endsAt: at(MONDAY, '12:00'), reason: 'reforma' },
      { professionalId: 'bia', startsAt: at(MONDAY, '00:00'), endsAt: at(TUESDAY, '00:00'), reason: 'folga' },
    ]
    // ana loses 09:00-12:00 (300 min left); bia is off all day.
    expect(dayCapacityMinutes(scheduleWith({ closures }), MONDAY)).toBe(300)
  })
})

describe('occupiedMinutes', () => {
  it('adds the length of the active appointments that day, except the one being moved', () => {
    const schedule = scheduleWith({
      appointments: [
        busy('a1', 'ana', MONDAY, '09:00', '09:30'),
        busy('a2', 'bia', MONDAY, '14:00', '16:00'),
        busy('a3', 'bia', TUESDAY, '09:00', '09:30'),
      ],
    })
    expect(occupiedMinutes(schedule, MONDAY)).toBe(150)
    expect(occupiedMinutes(schedule, MONDAY, SHOP_RULES, 'a2')).toBe(30)
  })
})

describe('checkVisitorBookings', () => {
  it('lets a visitor hold up to 2 upcoming appointments', () => {
    expect(checkVisitorBookings(0).ok).toBe(true)
    expect(checkVisitorBookings(1).ok).toBe(true)
    expect(checkVisitorBookings(2)).toMatchObject({ ok: false, error: { code: 'BOOKING_LIMIT_REACHED' } })
  })
})

describe('checkDailyCapacity', () => {
  it('accepts a booking only while the day stays at or below 70% full', () => {
    // 600 min of work: up to 420 occupied.
    expect(checkDailyCapacity({ occupiedMinutes: 390, durationMin: 30, capacityMinutes: 600 }).ok).toBe(true)
    expect(checkDailyCapacity({ occupiedMinutes: 391, durationMin: 30, capacityMinutes: 600 })).toMatchObject({
      ok: false,
      error: { code: 'DAILY_CAPACITY_REACHED' },
    })
  })

  it('refuses any booking on a day without working time', () => {
    expect(checkDailyCapacity({ occupiedMinutes: 0, durationMin: 30, capacityMinutes: 0 }).ok).toBe(false)
  })
})

describe('dayHasRoom', () => {
  it('compares what the schedule already holds with the day capacity', () => {
    // Monday: 720 min of work, room up to 504. 450 taken: a 30-min service still fits, a 120-min one does not.
    const schedule = scheduleWith({
      appointments: [busy('a1', 'ana', MONDAY, '13:00', '18:00'), busy('a2', 'bia', MONDAY, '14:00', '16:30')],
    })
    expect(dayHasRoom(schedule, MONDAY, 30)).toBe(true)
    expect(dayHasRoom(schedule, MONDAY, 120)).toBe(false)
    expect(dayHasRoom(schedule, MONDAY, 120, SHOP_RULES, 'a2')).toBe(true)
  })
})
