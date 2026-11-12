import { describe, expect, it } from 'vitest'
import { checkChangeWindow, planBooking, type BookingPlan } from '../../server/domain/booking.js'
import type { Result } from '../../server/domain/result.js'
import type { BusySlot } from '../../server/domain/types.js'
import { MONDAY, TUESDAY, at, hhmm, scheduleWith } from './fixtures.js'

const SUNDAY_NOON = at('2030-01-06', '12:00')

const busy = (professionalId: string, from: string, to: string, appointmentId = `${professionalId}-${from}`): BusySlot => ({
  appointmentId,
  professionalId,
  startsAt: at(MONDAY, from),
  endsAt: at(MONDAY, to),
})

function planOf(result: Result<BookingPlan>): BookingPlan {
  if (!result.ok) throw new Error(`expected a plan, got ${result.error.code}: ${result.error.message}`)
  return result.value
}

const suggestedTimes = (result: Result<BookingPlan>) =>
  result.ok ? [] : (result.error.suggestions ?? []).map((s) => `${s.professionalId} ${hhmm(s.startsAt)}`)

describe('planBooking: the server-side decision for a booking request', () => {
  it('books a free start and computes the end from the service duration', () => {
    const plan = planOf(
      planBooking(scheduleWith(), { serviceId: 'platinado', start: at(MONDAY, '14:00'), professionalId: 'bia' }, SUNDAY_NOON),
    )

    expect(plan.professional.id).toBe('bia')
    expect(plan.startsAt).toEqual(at(MONDAY, '14:00'))
    expect(plan.endsAt).toEqual(at(MONDAY, '16:00'))
  })

  it('records every rule it checked, in order, for the inspector', () => {
    const result = planBooking(
      scheduleWith(),
      { serviceId: 'corte', start: at(MONDAY, '10:00'), professionalId: 'ana' },
      SUNDAY_NOON,
    )

    expect(result.checks).toEqual([
      { rule: 'service_exists', passed: true },
      { rule: 'professional_exists', passed: true },
      { rule: 'professional_offers_service', passed: true },
      { rule: 'on_slot_grid', passed: true },
      { rule: 'min_advance', passed: true },
      { rule: 'max_days_ahead', passed: true },
      { rule: 'within_working_hours', passed: true },
      { rule: 'slot_free', passed: true },
    ])
  })

  it('stops at the first failed rule', () => {
    const result = planBooking(scheduleWith(), { serviceId: 'nope', start: at(MONDAY, '10:00') }, SUNDAY_NOON)

    expect(result).toMatchObject({ ok: false, error: { code: 'SERVICE_NOT_FOUND' } })
    expect(result.checks).toEqual([{ rule: 'service_exists', passed: false }])
  })

  it.each([
    ['10:10', at(MONDAY, '10:10')],
    ['10:00:30', new Date(`${MONDAY}T10:00:30-03:00`)],
  ])('rejects a start off the 15-minute grid (%s)', (_label, start) => {
    const result = planBooking(scheduleWith(), { serviceId: 'corte', start, professionalId: 'ana' }, SUNDAY_NOON)

    expect(result).toMatchObject({ ok: false, error: { code: 'INVALID_INPUT' } })
  })

  it('requires at least 2 hours of notice', () => {
    const now = at(MONDAY, '08:00')

    const exactly = planBooking(scheduleWith(), { serviceId: 'corte', start: at(MONDAY, '10:00'), professionalId: 'ana' }, now)
    const short = planBooking(scheduleWith(), { serviceId: 'corte', start: at(MONDAY, '09:45'), professionalId: 'ana' }, now)

    expect(exactly.ok).toBe(true)
    expect(short).toMatchObject({ ok: false, error: { code: 'TOO_SOON' } })
  })

  it('accepts a start 14 days ahead and rejects one 15 days ahead', () => {
    const now = at(MONDAY, '06:00')

    const fourteen = planBooking(scheduleWith(), { serviceId: 'corte', start: at('2030-01-21', '09:00') }, now)
    const fifteen = planBooking(scheduleWith(), { serviceId: 'corte', start: at('2030-01-22', '09:00') }, now)

    expect(fourteen.ok).toBe(true)
    expect(fifteen).toMatchObject({ ok: false, error: { code: 'TOO_FAR_AHEAD' } })
  })

  it('rejects a start in the lunch break and suggests the 3 nearest free starts', () => {
    const result = planBooking(
      scheduleWith(),
      { serviceId: 'corte', start: at(MONDAY, '12:00'), professionalId: 'ana' },
      SUNDAY_NOON,
    )

    expect(result).toMatchObject({ ok: false, error: { code: 'OUTSIDE_WORKING_HOURS' } })
    // 11:30 is 30 min away, 11:15 is 45, then 11:00 and 13:00 tie at 60 and the earlier one wins.
    expect(suggestedTimes(result)).toEqual(['ana 11:00', 'ana 11:15', 'ana 11:30'])
  })

  it('rejects a service that would run past the end of the working interval', () => {
    const result = planBooking(
      scheduleWith(),
      { serviceId: 'corte', start: at(MONDAY, '17:45'), professionalId: 'ana' },
      SUNDAY_NOON,
    )

    expect(result).toMatchObject({ ok: false, error: { code: 'OUTSIDE_WORKING_HOURS' } })
  })

  it('names the closure when the shop is closed', () => {
    const schedule = scheduleWith({
      closures: [{ professionalId: null, startsAt: at(MONDAY, '00:00'), endsAt: at(TUESDAY, '00:00'), reason: 'Feriado' }],
    })

    const result = planBooking(schedule, { serviceId: 'corte', start: at(MONDAY, '10:00') }, SUNDAY_NOON)

    expect(result).toMatchObject({ ok: false, error: { code: 'OUTSIDE_WORKING_HOURS' } })
    expect(result.ok || result.error.message).toContain('Feriado')
  })

  it('rejects a taken start and suggests the 3 nearest free starts', () => {
    const schedule = scheduleWith({ appointments: [busy('ana', '10:00', '10:30')] })

    const result = planBooking(schedule, { serviceId: 'corte', start: at(MONDAY, '10:00'), professionalId: 'ana' }, SUNDAY_NOON)

    expect(result).toMatchObject({ ok: false, error: { code: 'SLOT_UNAVAILABLE' } })
    // 09:30 and 10:30 are 30 min away, then 09:15 and 10:45 tie at 45 and the earlier one wins.
    expect(suggestedTimes(result)).toEqual(['ana 09:15', 'ana 09:30', 'ana 10:30'])
  })

  it('looks for suggestions on later days when the requested day is full', () => {
    const schedule = scheduleWith({ appointments: [busy('ana', '09:00', '18:00')] })

    const result = planBooking(schedule, { serviceId: 'barba', start: at(MONDAY, '10:00') }, SUNDAY_NOON)

    expect(result).toMatchObject({ ok: false, error: { code: 'SLOT_UNAVAILABLE' } })
    expect(result.ok || result.error.suggestions?.map((s) => s.startsAt)).toEqual([
      at('2030-01-14', '09:00'),
      at('2030-01-14', '09:15'),
      at('2030-01-14', '09:30'),
    ])
  })

  describe('when no professional is chosen', () => {
    it('picks the first professional, in display order, who is free', () => {
      const plan = planOf(planBooking(scheduleWith(), { serviceId: 'corte', start: at(MONDAY, '15:00') }, SUNDAY_NOON))

      expect(plan.professional.id).toBe('ana')
    })

    it('prefers the professional with fewer appointments that day', () => {
      const schedule = scheduleWith({ appointments: [busy('ana', '09:00', '09:30')] })

      const plan = planOf(planBooking(schedule, { serviceId: 'corte', start: at(MONDAY, '15:00') }, SUNDAY_NOON))

      expect(plan.professional.id).toBe('bia')
    })

    it('skips a professional who is busy at that time', () => {
      const schedule = scheduleWith({ appointments: [busy('bia', '09:00', '09:30'), busy('ana', '15:00', '15:30')] })

      const plan = planOf(planBooking(schedule, { serviceId: 'corte', start: at(MONDAY, '15:00') }, SUNDAY_NOON))

      expect(plan.professional.id).toBe('bia')
    })

    it('reports OUTSIDE_WORKING_HOURS when nobody who does the service works then', () => {
      const result = planBooking(scheduleWith(), { serviceId: 'corte', start: at(MONDAY, '08:00') }, SUNDAY_NOON)

      expect(result).toMatchObject({ ok: false, error: { code: 'OUTSIDE_WORKING_HOURS' } })
    })

    it('reports SLOT_UNAVAILABLE with suggestions from any of them when all are busy', () => {
      const schedule = scheduleWith({ appointments: [busy('ana', '15:00', '15:30'), busy('bia', '14:30', '15:30')] })

      const result = planBooking(schedule, { serviceId: 'corte', start: at(MONDAY, '15:00') }, SUNDAY_NOON)

      expect(result).toMatchObject({ ok: false, error: { code: 'SLOT_UNAVAILABLE' } })
      // 14:30 and 15:30 are 30 min away; ana is free at 14:30 and both at 15:30 (ana comes first);
      // then 14:15 (ana) and 15:45 tie at 45 and the earlier one wins.
      expect(suggestedTimes(result)).toEqual(['ana 14:15', 'ana 14:30', 'ana 15:30'])
    })
  })

  it('treats the appointment being rescheduled as free', () => {
    const schedule = scheduleWith({ appointments: [busy('ana', '10:00', '10:30', 'a1')] })

    const result = planBooking(
      schedule,
      { serviceId: 'corte', start: at(MONDAY, '10:15'), professionalId: 'ana' },
      SUNDAY_NOON,
      { excludeAppointmentId: 'a1' },
    )

    expect(result.ok).toBe(true)
  })
})

describe('checkChangeWindow: whether an appointment can still be changed or cancelled', () => {
  const appointment = (status: 'confirmed' | 'cancelled' | 'completed') => ({
    status,
    startsAt: at(MONDAY, '10:00'),
  })

  it('allows a change up to 2 hours before the start', () => {
    expect(checkChangeWindow(appointment('confirmed'), at(MONDAY, '08:00')).ok).toBe(true)
  })

  it('refuses a change less than 2 hours before the start', () => {
    expect(checkChangeWindow(appointment('confirmed'), at(MONDAY, '08:01'))).toMatchObject({
      ok: false,
      error: { code: 'CHANGE_WINDOW_PASSED' },
    })
  })

  it('refuses a change to a completed appointment', () => {
    expect(checkChangeWindow(appointment('completed'), SUNDAY_NOON)).toMatchObject({
      ok: false,
      error: { code: 'CHANGE_WINDOW_PASSED' },
    })
  })

  it('treats a cancelled appointment as not found', () => {
    expect(checkChangeWindow(appointment('cancelled'), SUNDAY_NOON)).toMatchObject({
      ok: false,
      error: { code: 'APPOINTMENT_NOT_FOUND' },
    })
  })
})
