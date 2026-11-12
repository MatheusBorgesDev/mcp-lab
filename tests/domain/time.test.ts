import { describe, expect, it } from 'vitest'
import { addDays, formatZoned, isCalendarDate, toZoned, zonedToInstant } from '../../server/domain/time.js'

const SAO_PAULO = 'America/Sao_Paulo'

describe('zonedToInstant: a local date and time in a zone, as an instant', () => {
  it('converts São Paulo wall-clock time to UTC', () => {
    expect(zonedToInstant('2030-01-07', 9 * 60, SAO_PAULO).toISOString()).toBe('2030-01-07T12:00:00.000Z')
  })

  it('crosses into the next UTC day for late evening times', () => {
    expect(zonedToInstant('2030-01-07', 22 * 60 + 15, SAO_PAULO).toISOString()).toBe('2030-01-08T01:15:00.000Z')
  })

  it('uses the offset in force on that date (daylight saving time)', () => {
    expect(zonedToInstant('2030-01-07', 9 * 60, 'America/New_York').toISOString()).toBe('2030-01-07T14:00:00.000Z')
    expect(zonedToInstant('2030-07-01', 9 * 60, 'America/New_York').toISOString()).toBe('2030-07-01T13:00:00.000Z')
  })
})

describe('toZoned: an instant as local date, weekday and minutes since midnight', () => {
  it('reports the local day when UTC is already on the next one', () => {
    expect(toZoned(new Date('2030-01-08T02:30:00Z'), SAO_PAULO)).toEqual({
      date: '2030-01-07',
      weekday: 1,
      minutes: 23 * 60 + 30,
    })
  })

  it('reports Sunday as weekday 0', () => {
    expect(toZoned(new Date('2030-01-06T15:00:00Z'), SAO_PAULO).weekday).toBe(0)
  })
})

describe('formatZoned: ISO 8601 with the local offset', () => {
  it('formats an instant in São Paulo time', () => {
    expect(formatZoned(new Date('2030-01-07T12:00:00Z'), SAO_PAULO)).toBe('2030-01-07T09:00:00-03:00')
  })

  it('formats a positive offset', () => {
    expect(formatZoned(new Date('2030-01-07T12:00:00Z'), 'Asia/Kolkata')).toBe('2030-01-07T17:30:00+05:30')
  })
})

describe('addDays: calendar arithmetic on YYYY-MM-DD', () => {
  it('rolls over months and years', () => {
    expect(addDays('2030-12-31', 1)).toBe('2031-01-01')
    expect(addDays('2030-03-01', -1)).toBe('2030-02-28')
  })
})

describe('isCalendarDate: a well-formed YYYY-MM-DD that exists', () => {
  it.each([
    ['2030-01-07', true],
    ['2028-02-29', true],
    ['2030-02-29', false],
    ['2030-13-01', false],
    ['07/01/2030', false],
    ['2030-1-7', false],
    ['', false],
  ])('%j -> %s', (date, expected) => {
    expect(isCalendarDate(date)).toBe(expected)
  })
})
