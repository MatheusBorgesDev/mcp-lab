import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest'
import { createBarbershop } from '../../server/app/barbershop.js'
import { hashCode } from '../../server/security/codes.js'
import {
  connectLocalDb,
  deleteFixtureAppointments,
  fixtureIds,
  insertCommittedFixture,
  removeCommittedFixture,
} from './helpers.js'

// The booking service against the real database, with two fixture professionals (Mondays 09:00-18:00)
// and one 30-minute service, all prefixed test-shop-.
const sql = connectLocalDb()
const PREFIX = 'test-shop'
const { ana, bia, service } = fixtureIds(PREFIX)
beforeAll(() => insertCommittedFixture(sql, PREFIX))
afterEach(() => deleteFixtureAppointments(sql, PREFIX))
afterAll(async () => {
  await removeCommittedFixture(sql, PREFIX)
  await sql.end()
})

const at = (date: string, hhmm: string) => new Date(`${date}T${hhmm}:00-03:00`)
const MONDAY = '2030-01-07'
const SUNDAY_NOON = at('2030-01-06', '12:00')
const shop = createBarbershop({ sql, now: () => SUNDAY_NOON })

async function bookOrThrow(start: Date, professionalId = ana) {
  const booked = await shop.book({ serviceId: service, start, professionalId, clientName: 'João Privado' })
  if (!booked.ok) throw new Error(`booking failed: ${booked.error.code}`)
  return booked.value
}

describe('booking service', () => {
  it('books a free time and returns a code that finds the appointment', async () => {
    const { code, appointment } = await bookOrThrow(at(MONDAY, '10:00'))

    expect(code).toMatch(/^[0-9A-Z]{5}-[0-9A-Z]{5}$/)
    expect(appointment).toMatchObject({
      status: 'confirmed',
      startsAt: at(MONDAY, '10:00'),
      endsAt: at(MONDAY, '10:30'),
      service: { id: service },
      professional: { id: ana },
    })
    expect(appointment.publicAlias).toMatch(/^Cliente #\d{4}$/)

    const found = await shop.getAppointment(code.toLowerCase())
    expect(found).toMatchObject({ ok: true, value: { id: appointment.id } })
  })

  it('stores only the hash of the code, and the client name only in its private column', async () => {
    const { code, appointment } = await bookOrThrow(at(MONDAY, '10:00'))

    const [row] = await sql`select * from appointments where id = ${appointment.id}`
    expect(row?.code_hash).toBe(hashCode(code.replace('-', '')))
    expect(JSON.stringify(row)).not.toContain(code.replace('-', ''))
    expect(row?.client_name).toBe('João Privado')
    expect(appointment).not.toHaveProperty('clientName')
  })

  it('refuses a time that is already taken and suggests others', async () => {
    await bookOrThrow(at(MONDAY, '10:00'))

    const second = await shop.book({ serviceId: service, start: at(MONDAY, '10:00'), professionalId: ana })

    expect(second).toMatchObject({ ok: false, error: { code: 'SLOT_UNAVAILABLE' } })
    expect(second.ok || second.error.suggestions).toHaveLength(3)
  })

  it.each(['ABCDE-FGHJK', 'not a code'])('does not find an appointment for %j', async (code) => {
    expect(await shop.getAppointment(code)).toMatchObject({ ok: false, error: { code: 'APPOINTMENT_NOT_FOUND' } })
  })

  it('reschedules into a time that overlaps its own current slot', async () => {
    const { code } = await bookOrThrow(at(MONDAY, '10:00'))

    const moved = await shop.reschedule({ code, newStart: at(MONDAY, '10:15') })

    expect(moved).toMatchObject({
      ok: true,
      value: { startsAt: at(MONDAY, '10:15'), endsAt: at(MONDAY, '10:45'), professional: { id: ana } },
    })
  })

  it('reschedules to another professional when asked', async () => {
    const { code } = await bookOrThrow(at(MONDAY, '10:00'))

    const moved = await shop.reschedule({ code, newStart: at(MONDAY, '10:00'), professionalId: bia })

    expect(moved).toMatchObject({ ok: true, value: { professional: { id: bia } } })
  })

  it('refuses to reschedule into a time taken by someone else', async () => {
    const { code } = await bookOrThrow(at(MONDAY, '10:00'))
    await bookOrThrow(at(MONDAY, '11:00'))

    const moved = await shop.reschedule({ code, newStart: at(MONDAY, '11:00') })

    expect(moved).toMatchObject({ ok: false, error: { code: 'SLOT_UNAVAILABLE' } })
  })

  it('refuses to reschedule or cancel less than 2 hours before the start', async () => {
    const { code } = await bookOrThrow(at(MONDAY, '10:00'))
    const late = createBarbershop({ sql, now: () => at(MONDAY, '08:30') })

    expect(await late.reschedule({ code, newStart: at(MONDAY, '15:00') })).toMatchObject({
      ok: false,
      error: { code: 'CHANGE_WINDOW_PASSED' },
    })
    expect(await late.cancel(code)).toMatchObject({ ok: false, error: { code: 'CHANGE_WINDOW_PASSED' } })
  })

  it('cancels, frees the time, and treats a second cancel as already done', async () => {
    const { code } = await bookOrThrow(at(MONDAY, '10:00'))

    expect(await shop.cancel(code)).toMatchObject({
      ok: true,
      value: { alreadyCancelled: false, appointment: { status: 'cancelled' } },
    })
    await bookOrThrow(at(MONDAY, '10:00'))
    expect(await shop.cancel(code)).toMatchObject({ ok: true, value: { alreadyCancelled: true } })
  })

  it('does not reschedule a cancelled appointment', async () => {
    const { code } = await bookOrThrow(at(MONDAY, '10:00'))
    await shop.cancel(code)

    expect(await shop.reschedule({ code, newStart: at(MONDAY, '11:00') })).toMatchObject({
      ok: false,
      error: { code: 'APPOINTMENT_NOT_FOUND' },
    })
  })
})
