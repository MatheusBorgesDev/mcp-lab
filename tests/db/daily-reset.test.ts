import { randomUUID } from 'node:crypto'
import type postgres from 'postgres'
import { afterAll, describe, expect, it } from 'vitest'
import { resetAgenda } from '../../server/app/daily-reset.js'
import type { ResetPlan, SeedAppointment } from '../../server/domain/seed.js'
import {
  connectLocalDb,
  fixtureIds,
  inRolledBackTransaction,
  insertCatalogFixture,
  insertWorkingHoursFixture,
} from './helpers.js'

// The daily reset (docs/SPEC.md, section 9) against the local database. It touches the whole agenda, so every
// test runs in a transaction that is rolled back. "Now" is 03:00 on 2026-01-05, before the data of every other
// test file: the reset may erase their visitor rows inside this transaction, but never ends or ages them.
const sql = connectLocalDb()
const other = connectLocalDb({ max: 1 })
afterAll(() => Promise.all([sql.end(), other.end()]))

const PREFIX = 'test-reset'
const { ana, bia, service } = fixtureIds(PREFIX)
const at = (date: string, hhmm: string) => new Date(`${date}T${hhmm}:00-03:00`)
const NOW = at('2026-01-05', '03:00')
const DAY_MS = 24 * 60 * 60 * 1000

const seed = (key: string, professionalId: string, date: string, hhmm: string): SeedAppointment => {
  const startsAt = at(date, hhmm)
  return { key: `seed:${PREFIX}:${key}`, professionalId, serviceId: service, startsAt, endsAt: new Date(startsAt.getTime() + 30 * 60_000), publicAlias: 'Cliente #1234' }
}
const PLAN: ResetPlan = {
  now: NOW,
  windowStart: at('2026-01-05', '00:00'),
  seeds: [seed('a', ana, '2026-01-05', '09:00'), seed('b', bia, '2026-01-05', '09:00'), seed('c', ana, '2026-01-06', '14:30')],
}

async function prepare(tx: postgres.TransactionSql) {
  await insertCatalogFixture(tx, PREFIX)
  await insertWorkingHoursFixture(tx, PREFIX)
}

type Row = { id: string; status: string; source: string }
async function insertRow(
  tx: postgres.TransactionSql,
  row: { source: 'visitor' | 'seed'; startsAt: Date; status?: string; key?: string; professionalId?: string },
): Promise<string> {
  const [inserted] = await tx<{ id: string }[]>`
    insert into appointments (code_hash, professional_id, service_id, starts_at, ends_at, status, source, public_alias, ip_hash)
    values (${row.key ?? `test-${randomUUID()}`}, ${row.professionalId ?? ana}, ${service}, ${row.startsAt},
            ${new Date(row.startsAt.getTime() + 30 * 60_000)}, ${row.status ?? 'confirmed'}, ${row.source},
            'Cliente #0001', ${row.source === 'visitor' ? 'private-ip-hash' : null})
    returning id
  `
  if (!inserted) throw new Error('insert returned no row')
  return inserted.id
}
const rowsById = async (tx: postgres.TransactionSql, ids: string[]) =>
  tx<Row[]>`select id, status::text, source::text from appointments where id in ${tx(ids)} order by starts_at`
const seedRows = (tx: postgres.TransactionSql) =>
  tx<(Row & { code_hash: string; public_alias: string; client_name: string | null; ip_hash: string | null })[]>`
    select id, status::text, source::text, code_hash, public_alias, client_name, ip_hash from appointments
    where code_hash like ${`seed:${PREFIX}:%`} order by code_hash
  `

describe('resetAgenda', () => {
  it('holds every other write to the agenda until it ends, and lets reads through', async () => {
    await inRolledBackTransaction(sql, async (tx) => {
      await prepare(tx)
      await resetAgenda(tx, PLAN)

      const write = other.begin(async (otx) => {
        await otx`set local lock_timeout = '200ms'`
        await otx`delete from appointments where id = ${randomUUID()}`
      })
      await expect(write).rejects.toMatchObject({ code: '55P03' })
      const [read] = await other<{ n: number }[]>`select count(*)::int as n from appointments`
      expect(read?.n).toBeGreaterThanOrEqual(0)
    })
  })

  it('erases every visitor booking, past or future, of any status', async () => {
    await inRolledBackTransaction(sql, async (tx) => {
      await prepare(tx)
      const visitorIds = [
        await insertRow(tx, { source: 'visitor', startsAt: at('2026-01-02', '10:00'), status: 'completed' }),
        await insertRow(tx, { source: 'visitor', startsAt: at('2026-01-07', '10:00') }),
        await insertRow(tx, { source: 'visitor', startsAt: at('2026-01-07', '11:00'), status: 'cancelled' }),
      ]

      const summary = await resetAgenda(tx, PLAN)

      expect(await rowsById(tx, visitorIds)).toEqual([])
      expect(summary.removedVisitorBookings).toBeGreaterThanOrEqual(visitorIds.length)
    })
  })

  it('writes the fictitious bookings of the plan once: a second run changes nothing', async () => {
    await inRolledBackTransaction(sql, async (tx) => {
      await prepare(tx)

      const first = await resetAgenda(tx, PLAN)
      const written = await seedRows(tx)
      const second = await resetAgenda(tx, PLAN)

      expect(first.addedSeeds).toBe(PLAN.seeds.length)
      expect(written.map((r) => r.code_hash)).toEqual(PLAN.seeds.map((s) => s.key))
      for (const row of written) {
        expect(row).toMatchObject({ status: 'confirmed', source: 'seed', public_alias: 'Cliente #1234', client_name: null, ip_hash: null })
      }
      expect(second).toEqual({ removedVisitorBookings: 0, removedSeeds: 0, addedSeeds: 0, completedBookings: 0, removedEvents: 0 })
      expect(await seedRows(tx)).toEqual(written)
    })
  })

  it('drops fictitious bookings the plan no longer has from the window on, and keeps the ones before it', async () => {
    await inRolledBackTransaction(sql, async (tx) => {
      await prepare(tx)
      const stale = await insertRow(tx, { source: 'seed', startsAt: at('2026-01-06', '16:00'), key: `seed:${PREFIX}:stale` })
      const yesterday = await insertRow(tx, { source: 'seed', startsAt: at('2026-01-04', '16:00'), key: `seed:${PREFIX}:old` })

      const summary = await resetAgenda(tx, PLAN)

      expect(await rowsById(tx, [stale])).toEqual([])
      expect(await rowsById(tx, [yesterday])).toHaveLength(1)
      expect(summary.removedSeeds).toBeGreaterThanOrEqual(1)
    })
  })

  it('marks the bookings that already ended as completed', async () => {
    await inRolledBackTransaction(sql, async (tx) => {
      await prepare(tx)
      const ended = await insertRow(tx, { source: 'seed', startsAt: at('2026-01-04', '16:00'), key: `seed:${PREFIX}:ended` })
      const cancelled = await insertRow(tx, {
        source: 'seed',
        startsAt: at('2026-01-04', '17:00'),
        status: 'cancelled',
        key: `seed:${PREFIX}:cancelled`,
      })

      const summary = await resetAgenda(tx, PLAN)

      expect(await rowsById(tx, [ended, cancelled])).toEqual([
        { id: ended, status: 'completed', source: 'seed' },
        { id: cancelled, status: 'cancelled', source: 'seed' },
      ])
      expect(summary.completedBookings).toBeGreaterThanOrEqual(1)
      expect((await seedRows(tx)).filter((r) => PLAN.seeds.some((s) => s.key === r.code_hash)).every((r) => r.status === 'confirmed')).toBe(true)
    })
  })

  it('deletes the inspector events older than 7 days', async () => {
    await inRolledBackTransaction(sql, async (tx) => {
      await prepare(tx)
      const requestId = randomUUID()
      const event = (ageDays: number) => ({
        request_id: requestId,
        tool_name: 'list_services',
        step: 'received',
        detail: {},
        duration_ms: 0,
        client_label: 'Cliente MCP',
        created_at: new Date(NOW.getTime() - ageDays * DAY_MS),
      })
      await tx`insert into mcp_events ${tx([event(8), event(7.5), event(6)])}`

      const summary = await resetAgenda(tx, PLAN)

      const left = await tx<{ created_at: Date }[]>`select created_at from mcp_events where request_id = ${requestId}`
      expect(left.map((r) => r.created_at)).toEqual([new Date(NOW.getTime() - 6 * DAY_MS)])
      expect(summary.removedEvents).toBe(2)
    })
  })
})
