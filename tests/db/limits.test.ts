import { randomUUID } from 'node:crypto'
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest'
import { createBarbershop } from '../../server/app/barbershop.js'
import {
  connectLocalDb,
  deleteFixtureAppointments,
  fixtureIds,
  insertCommittedFixture,
  removeCommittedFixture,
} from './helpers.js'

// The limits that keep the shared agenda usable (docs/SPEC.md, sections 3 and 8), checked in the same
// transaction as the write. Fixture prefixed test-limits-: two professionals, one 30-minute service, Mondays
// 09:00-18:00 (shared with the seed's professionals) and, only for this file, Sundays 09:00-11:00, a day
// nobody else works: 240 minutes, so visitors may book while the day stays at or below 168 (70%). Two more
// professionals (Mondays only) let one visitor's simultaneous requests share no lock but the visitor's own.
const sql = connectLocalDb({ max: 12 })
const PREFIX = 'test-limits'
const { ana, bia, service } = fixtureIds(PREFIX)
const caio = `${PREFIX}-caio`
const duda = `${PREFIX}-duda`
beforeAll(async () => {
  await insertCommittedFixture(sql, PREFIX)
  await sql.begin(async (tx) => {
    await tx`insert into professionals (id, name) values (${caio}, 'Caio Teste'), (${duda}, 'Duda Teste')`
    await tx`insert into professional_services (professional_id, service_id) values (${caio}, ${service}), (${duda}, ${service})`
    await tx`
      insert into working_hours (professional_id, weekday, start_time, end_time)
      values (${ana}, 0, '09:00', '11:00'), (${bia}, 0, '09:00', '11:00'),
             (${caio}, 1, '09:00', '18:00'), (${duda}, 1, '09:00', '18:00')
    `
  })
})
afterEach(() => deleteFixtureAppointments(sql, PREFIX))
afterAll(async () => {
  await removeCommittedFixture(sql, PREFIX)
  await sql.end()
})

const at = (date: string, hhmm: string) => new Date(`${date}T${hhmm}:00-03:00`)
const SATURDAY_NOON = at('2030-01-05', '12:00')
const SUNDAY = '2030-01-06'
const MONDAY = '2030-01-07'
const shop = createBarbershop({ sql, now: () => SATURDAY_NOON })
const newVisitor = () => `test-visitor-${randomUUID()}`

async function bookOrThrow(start: Date, professionalId: string, visitor = newVisitor()) {
  const booked = await shop.book({ serviceId: service, start, professionalId, visitor })
  if (!booked.ok) throw new Error(`booking failed: ${booked.error.code}`)
  return booked.value
}

describe('active bookings per visitor', () => {
  it('lets a visitor hold 2 upcoming appointments and refuses the third', async () => {
    const visitor = newVisitor()
    await bookOrThrow(at(MONDAY, '10:00'), ana, visitor)
    await bookOrThrow(at(MONDAY, '10:00'), bia, visitor)

    const third = await shop.book({ serviceId: service, start: at(MONDAY, '11:00'), professionalId: ana, visitor })

    expect(third).toMatchObject({ ok: false, error: { code: 'BOOKING_LIMIT_REACHED' } })
    expect(third.checks.at(-1)).toEqual({ rule: 'visitor_bookings', passed: false })
    await bookOrThrow(at(MONDAY, '11:00'), ana)
  })

  it('stops counting an appointment once it is cancelled or has started', async () => {
    const visitor = newVisitor()
    const { code } = await bookOrThrow(at(MONDAY, '10:00'), ana, visitor)
    await bookOrThrow(at(MONDAY, '10:00'), bia, visitor)
    await sql`
      insert into appointments (code_hash, professional_id, service_id, starts_at, ends_at, public_alias, ip_hash)
      values (${`test-${randomUUID()}`}, ${ana}, ${service}, ${at('2030-01-05', '09:00')}, ${at('2030-01-05', '09:30')},
              'Cliente #0001', ${visitor})
    `
    await shop.cancel(code)

    await bookOrThrow(at(MONDAY, '11:00'), ana, visitor)
  })

  it('stores the visitor key, which is all the server keeps about the visitor', async () => {
    const visitor = newVisitor()
    const { appointment } = await bookOrThrow(at(MONDAY, '10:00'), ana, visitor)

    const [row] = await sql`select ip_hash from appointments where id = ${appointment.id}`
    expect(row?.ip_hash).toBe(visitor)
  })

  it('never lets one visitor past the limit with simultaneous requests', async () => {
    // Four days and four professionals: only the visitor's own lock makes these requests wait for each other.
    const visitor = newVisitor()
    const requests = [
      { start: at(SUNDAY, '09:00'), professionalId: ana },
      { start: at('2030-01-13', '09:00'), professionalId: bia },
      { start: at(MONDAY, '09:00'), professionalId: caio },
      { start: at('2030-01-14', '09:00'), professionalId: duda },
    ]

    const results = await Promise.all(requests.map((r) => shop.book({ serviceId: service, ...r, visitor })))

    expect(results.filter((r) => r.ok)).toHaveLength(2)
    expect(results.filter((r) => !r.ok).map((r) => !r.ok && r.error.code)).toEqual(Array(2).fill('BOOKING_LIMIT_REACHED'))
  })
})

describe('daily occupancy limit', () => {
  it('refuses a booking that would take the day past 70%, counting fictitious appointments', async () => {
    await sql`
      insert into appointments (code_hash, professional_id, service_id, starts_at, ends_at, public_alias, source)
      values (${`test-${randomUUID()}`}, ${ana}, ${service}, ${at(SUNDAY, '09:00')}, ${at(SUNDAY, '10:00')},
              'Cliente #0002', 'seed')
    `
    // 60 minutes taken; three visitors bring it to 150.
    await bookOrThrow(at(SUNDAY, '10:00'), ana)
    await bookOrThrow(at(SUNDAY, '09:00'), bia)
    await bookOrThrow(at(SUNDAY, '09:30'), bia)

    const fourth = await shop.book({ serviceId: service, start: at(SUNDAY, '10:00'), professionalId: bia, visitor: newVisitor() })

    expect(fourth).toMatchObject({ ok: false, error: { code: 'DAILY_CAPACITY_REACHED' } })
    expect(fourth.checks.slice(-2)).toEqual([
      { rule: 'visitor_bookings', passed: true },
      { rule: 'daily_capacity', passed: false },
    ])
  })

  it('refuses to move an appointment into a full day, but not within it', async () => {
    // Sunday at 150 of its 168 minutes: no room for another 30-minute appointment.
    const { code: sundayCode } = await bookOrThrow(at(SUNDAY, '09:00'), ana)
    for (const [hhmm, professionalId] of [['09:30', ana], ['10:00', ana], ['09:00', bia], ['09:30', bia]] as const) {
      await bookOrThrow(at(SUNDAY, hhmm), professionalId)
    }
    const { code: mondayCode } = await bookOrThrow(at(MONDAY, '10:00'), ana)

    const intoFullDay = await shop.reschedule({ code: mondayCode, newStart: at(SUNDAY, '10:30'), professionalId: ana })
    expect(intoFullDay).toMatchObject({ ok: false, error: { code: 'DAILY_CAPACITY_REACHED' } })
    expect(intoFullDay.checks.at(-1)).toEqual({ rule: 'daily_capacity', passed: false })

    const withinDay = await shop.reschedule({ code: sundayCode, newStart: at(SUNDAY, '10:30') })
    expect(withinDay).toMatchObject({ ok: true, value: { startsAt: at(SUNDAY, '10:30') } })
    expect(withinDay.checks.at(-1)).toEqual({ rule: 'daily_capacity', passed: true })
  })

  it('never takes the day past 70% with simultaneous requests', async () => {
    const slots = ['09:00', '09:30', '10:00', '10:30'].flatMap((hhmm) => [
      { hhmm, professionalId: ana },
      { hhmm, professionalId: bia },
    ])

    const results = await Promise.all(
      slots.map(({ hhmm, professionalId }) =>
        shop.book({ serviceId: service, start: at(SUNDAY, hhmm), professionalId, visitor: newVisitor() }),
      ),
    )

    // 5 x 30 = 150 minutes fit under 168; a sixth would make 180.
    expect(results.filter((r) => r.ok)).toHaveLength(5)
    expect(results.filter((r) => !r.ok).map((r) => !r.ok && r.error.code)).toEqual(Array(3).fill('DAILY_CAPACITY_REACHED'))
  })
})
