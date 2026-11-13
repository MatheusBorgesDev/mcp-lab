import { describe, expect, it } from 'vitest'
import { findAvailability, type Availability } from '../../server/domain/availability.js'
import type { Result } from '../../server/domain/result.js'
import { MONDAY, TUESDAY, at, hhmm, scheduleWith } from './fixtures.js'

/** Sunday noon: far enough from Monday that the 2-hour rule does not get in the way. */
const SUNDAY_NOON = at('2030-01-06', '12:00')

function startsOf(result: Result<Availability>, professionalId: string): string[] {
  if (!result.ok) throw new Error(`expected availability, got ${result.error.code}`)
  const entry = result.value.professionals.find((p) => p.professional.id === professionalId)
  if (!entry) throw new Error(`${professionalId} not listed`)
  return entry.starts.map(hhmm)
}

const between = (starts: string[], from: string, to: string) => starts.filter((s) => s >= from && s <= to)

describe('findAvailability: free start times for a service on a date', () => {
  it('lists every 15-minute start where the whole service fits in a working interval', () => {
    const result = findAvailability(scheduleWith(), { serviceId: 'platinado', date: MONDAY }, SUNDAY_NOON)

    expect(startsOf(result, 'bia')).toEqual([
      '14:00', '14:15', '14:30', '14:45', '15:00', '15:15', '15:30', '15:45', '16:00',
    ])
  })

  it('does not offer starts that would run into the lunch break', () => {
    const result = findAvailability(scheduleWith(), { serviceId: 'corte', date: MONDAY }, SUNDAY_NOON)

    expect(between(startsOf(result, 'ana'), '11:00', '13:30')).toEqual([
      '11:00', '11:15', '11:30', '13:00', '13:15', '13:30',
    ])
  })

  it('skips starts that overlap an active appointment, keeping the ones right before and after', () => {
    const schedule = scheduleWith({
      appointments: [
        { appointmentId: 'a1', professionalId: 'ana', startsAt: at(MONDAY, '10:00'), endsAt: at(MONDAY, '10:30') },
      ],
    })

    const result = findAvailability(schedule, { serviceId: 'corte', date: MONDAY }, SUNDAY_NOON)

    expect(between(startsOf(result, 'ana'), '09:15', '10:45')).toEqual(['09:15', '09:30', '10:30', '10:45'])
  })

  it('offers the time of the appointment being rescheduled', () => {
    const schedule = scheduleWith({
      appointments: [
        { appointmentId: 'a1', professionalId: 'ana', startsAt: at(MONDAY, '10:00'), endsAt: at(MONDAY, '10:30') },
      ],
    })

    const result = findAvailability(
      schedule,
      { serviceId: 'corte', date: MONDAY, excludeAppointmentId: 'a1' },
      SUNDAY_NOON,
    )

    expect(between(startsOf(result, 'ana'), '09:45', '10:15')).toEqual(['09:45', '10:00', '10:15'])
  })

  it("skips starts during a professional's closure without affecting the others", () => {
    const schedule = scheduleWith({
      closures: [{ professionalId: 'ana', startsAt: at(MONDAY, '15:00'), endsAt: at(MONDAY, '16:00'), reason: 'Médico' }],
    })

    const result = findAvailability(schedule, { serviceId: 'corte', date: MONDAY }, SUNDAY_NOON)

    expect(between(startsOf(result, 'ana'), '14:30', '16:00')).toEqual(['14:30', '16:00'])
    expect(startsOf(result, 'bia')).toContain('15:00')
  })

  it('offers nothing on a shop-wide closure and reports it', () => {
    const holiday = { professionalId: null, startsAt: at(MONDAY, '00:00'), endsAt: at(TUESDAY, '00:00'), reason: 'Feriado' }

    const result = findAvailability(scheduleWith({ closures: [holiday] }), { serviceId: 'corte', date: MONDAY }, SUNDAY_NOON)

    expect(startsOf(result, 'ana')).toEqual([])
    expect(startsOf(result, 'bia')).toEqual([])
    expect(result.ok && result.value.closures).toEqual([holiday])
  })

  it('offers nothing on a day already full for new bookings, and says so', () => {
    // Monday: 720 min of work and room up to 504 (70%). 480 taken: no 30-minute service fits anymore.
    const appointments = [
      { appointmentId: 'a1', professionalId: 'ana', startsAt: at(MONDAY, '13:00'), endsAt: at(MONDAY, '18:00') },
      { appointmentId: 'a2', professionalId: 'bia', startsAt: at(MONDAY, '14:00'), endsAt: at(MONDAY, '17:00') },
    ]
    const query = { serviceId: 'corte', date: MONDAY }

    const full = findAvailability(scheduleWith({ appointments }), query, SUNDAY_NOON)
    expect(full).toMatchObject({ ok: true, value: { dayFull: true } })
    expect(startsOf(full, 'ana')).toEqual([])
    expect(startsOf(full, 'bia')).toEqual([])

    const roomy = findAvailability(scheduleWith({ appointments: appointments.slice(1) }), query, SUNDAY_NOON)
    expect(roomy).toMatchObject({ ok: true, value: { dayFull: false } })
    expect(startsOf(roomy, 'ana')).not.toEqual([])
  })

  it('does not offer starts less than 2 hours from now', () => {
    const result = findAvailability(scheduleWith(), { serviceId: 'corte', date: MONDAY }, at(MONDAY, '08:20'))

    expect(startsOf(result, 'ana')[0]).toBe('10:30')
  })

  it('lists the active professionals who do the service when none is chosen', () => {
    const corte = findAvailability(scheduleWith(), { serviceId: 'corte', date: MONDAY }, SUNDAY_NOON)
    const barba = findAvailability(scheduleWith(), { serviceId: 'barba', date: MONDAY }, SUNDAY_NOON)

    expect(corte.ok && corte.value.professionals.map((p) => p.professional.id)).toEqual(['ana', 'bia'])
    expect(barba.ok && barba.value.professionals.map((p) => p.professional.id)).toEqual(['ana'])
  })

  it('lists a chosen professional with no starts on a day they do not work', () => {
    const result = findAvailability(
      scheduleWith(),
      { serviceId: 'corte', date: TUESDAY, professionalId: 'ana' },
      SUNDAY_NOON,
    )

    expect(startsOf(result, 'ana')).toEqual([])
  })

  it('accepts a date 14 days ahead and rejects 15', () => {
    const now = at(MONDAY, '06:00')

    const fourteen = findAvailability(scheduleWith(), { serviceId: 'corte', date: '2030-01-21' }, now)
    const fifteen = findAvailability(scheduleWith(), { serviceId: 'corte', date: '2030-01-22' }, now)

    expect(startsOf(fourteen, 'ana')).toContain('09:00')
    expect(fifteen).toMatchObject({ ok: false, error: { code: 'TOO_FAR_AHEAD' } })
  })

  it('rejects a date that has already passed', () => {
    const result = findAvailability(scheduleWith(), { serviceId: 'corte', date: '2030-01-05' }, SUNDAY_NOON)

    expect(result).toMatchObject({ ok: false, error: { code: 'TOO_SOON' } })
  })

  it.each([
    ['an unknown service', { serviceId: 'nope' }, 'SERVICE_NOT_FOUND'],
    ['an inactive service', { serviceId: 'retired' }, 'SERVICE_NOT_FOUND'],
    ['an unknown professional', { serviceId: 'corte', professionalId: 'zeca' }, 'PROFESSIONAL_NOT_FOUND'],
    ['an inactive professional', { serviceId: 'corte', professionalId: 'caio' }, 'PROFESSIONAL_NOT_FOUND'],
    [
      'a professional who does not do the service',
      { serviceId: 'barba', professionalId: 'bia' },
      'PROFESSIONAL_DOES_NOT_OFFER_SERVICE',
    ],
  ])('rejects %s', (_label, query, code) => {
    const result = findAvailability(scheduleWith(), { date: MONDAY, ...query }, SUNDAY_NOON)

    expect(result).toMatchObject({ ok: false, error: { code } })
  })
})
