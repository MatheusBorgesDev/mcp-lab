import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest'
import { createBarbershop } from '../../server/app/barbershop.js'
import {
  connectLocalDb,
  deleteFixtureAppointments,
  fixtureIds,
  insertCommittedFixture,
  removeCommittedFixture,
} from './helpers.js'

// Many visitors share one agenda. Simultaneous requests for the same time must not double-book:
// the planning step may see the time as free in all of them; the database constraint decides.
const sql = connectLocalDb({ max: 20 })
const PREFIX = 'test-race'
const { ana, bia, service } = fixtureIds(PREFIX)
beforeAll(() => insertCommittedFixture(sql, PREFIX))
afterEach(() => deleteFixtureAppointments(sql, PREFIX))
afterAll(async () => {
  await removeCommittedFixture(sql, PREFIX)
  await sql.end()
})

const start = new Date('2030-01-07T10:00:00-03:00')
const shop = createBarbershop({ sql, now: () => new Date('2030-01-06T12:00:00-03:00') })
const SIMULTANEOUS = 20

describe('simultaneous bookings for the same time', () => {
  it('accepts exactly one of 20 requests for the same professional', async () => {
    const results = await Promise.all(
      Array.from({ length: SIMULTANEOUS }, () =>
        shop.book({ serviceId: service, start, professionalId: ana }),
      ),
    )

    expect(results.filter((r) => r.ok)).toHaveLength(1)
    expect(results.filter((r) => !r.ok).map((r) => !r.ok && r.error.code)).toEqual(
      Array(SIMULTANEOUS - 1).fill('SLOT_UNAVAILABLE'),
    )
    const [row] = await sql<{ count: number }[]>`
      select count(*)::int as count from appointments where professional_id = ${ana} and status <> 'cancelled'
    `
    expect(row?.count).toBe(1)
  })

  it('gives the time once to each professional when the shop chooses', async () => {
    const results = await Promise.all(
      Array.from({ length: SIMULTANEOUS }, () => shop.book({ serviceId: service, start })),
    )

    const booked = results.flatMap((r) => (r.ok ? [r.value.appointment.professional.id] : []))
    expect(booked.toSorted()).toEqual([ana, bia])
    expect(results.filter((r) => !r.ok)).toHaveLength(SIMULTANEOUS - 2)
  })
})
