import { afterAll, describe, expect, it } from 'vitest'
import {
  connectLocalDb,
  inRolledBackTransaction,
  insertAppointment,
  insertCatalogFixture,
} from './helpers.js'

const sql = connectLocalDb()
afterAll(() => sql.end())

/** A time on a fixed future Monday, in São Paulo's offset. */
const at = (hhmm: string) => `2030-01-07T${hhmm}:00-03:00`

const EXCLUSION_VIOLATION = '23P01'
const CHECK_VIOLATION = '23514'
const INSUFFICIENT_PRIVILEGE = '42501'

describe('appointments: no overlap for the same professional, enforced by the database', () => {
  it('rejects an overlapping confirmed appointment', () =>
    inRolledBackTransaction(sql, async (tx) => {
      await insertCatalogFixture(tx)
      await insertAppointment(tx, { startsAt: at('10:00'), endsAt: at('10:30') })

      await expect(
        tx.savepoint((sp) => insertAppointment(sp, { startsAt: at('10:15'), endsAt: at('10:45') })),
      ).rejects.toMatchObject({ code: EXCLUSION_VIOLATION })
    }))

  it('accepts back-to-back appointments (end is exclusive)', () =>
    inRolledBackTransaction(sql, async (tx) => {
      await insertCatalogFixture(tx)
      await insertAppointment(tx, { startsAt: at('10:00'), endsAt: at('10:30') })
      await insertAppointment(tx, { startsAt: at('10:30'), endsAt: at('11:00') })
    }))

  it('accepts the same time with another professional', () =>
    inRolledBackTransaction(sql, async (tx) => {
      await insertCatalogFixture(tx)
      await insertAppointment(tx, { startsAt: at('10:00'), endsAt: at('10:30') })
      await insertAppointment(tx, {
        startsAt: at('10:00'),
        endsAt: at('10:30'),
        professionalId: 'test-bia',
      })
    }))

  it('lets a cancelled appointment free its slot', () =>
    inRolledBackTransaction(sql, async (tx) => {
      await insertCatalogFixture(tx)
      await insertAppointment(tx, { startsAt: at('10:00'), endsAt: at('10:30'), status: 'cancelled' })
      await insertAppointment(tx, { startsAt: at('10:00'), endsAt: at('10:30') })
    }))

  it('rejects an appointment that ends before it starts', () =>
    inRolledBackTransaction(sql, async (tx) => {
      await insertCatalogFixture(tx)

      await expect(
        tx.savepoint((sp) => insertAppointment(sp, { startsAt: at('10:30'), endsAt: at('10:00') })),
      ).rejects.toMatchObject({ code: CHECK_VIOLATION })
    }))
})

describe('row level security: what the anon role (the public front) can do', () => {
  it('has RLS enabled on every table in the public schema', async () => {
    const tables = await sql<{ name: string; rls: boolean }[]>`
      select c.relname as name, c.relrowsecurity as rls
      from pg_class c join pg_namespace n on n.oid = c.relnamespace
      where n.nspname = 'public' and c.relkind = 'r'
    `
    expect(tables.length).toBeGreaterThan(0)
    expect(tables.filter((t) => !t.rls).map((t) => t.name)).toEqual([])
  })

  it('has no write privilege on any table or view in the public schema', async () => {
    const relations = await sql<{ name: string; writable: boolean }[]>`
      select c.relname as name,
             has_table_privilege('anon', c.oid, 'INSERT, UPDATE, DELETE, TRUNCATE') as writable
      from pg_class c join pg_namespace n on n.oid = c.relnamespace
      where n.nspname = 'public' and c.relkind in ('r', 'v')
    `
    expect(relations.length).toBeGreaterThan(0)
    expect(relations.filter((r) => r.writable).map((r) => r.name)).toEqual([])
  })

  it('cannot read appointments', () =>
    inRolledBackTransaction(sql, async (tx) => {
      await tx`set local role anon`

      await expect(tx.savepoint((sp) => sp`select id from appointments`)).rejects.toMatchObject({
        code: INSUFFICIENT_PRIVILEGE,
      })
    }))

  it('cannot insert into the catalogue', () =>
    inRolledBackTransaction(sql, async (tx) => {
      await tx`set local role anon`

      await expect(
        tx.savepoint(
          (sp) => sp`insert into services (id, name, duration_min, price_cents) values ('x', 'x', 30, 0)`,
        ),
      ).rejects.toMatchObject({ code: INSUFFICIENT_PRIVILEGE })
    }))

  it('reads the catalogue, the closures and the inspector events', () =>
    inRolledBackTransaction(sql, async (tx) => {
      await insertCatalogFixture(tx)
      await tx`set local role anon`

      const professionals = await tx`select id from professionals where id in ('test-ana', 'test-bia') order by id`
      expect(professionals.map((p) => p.id)).toEqual(['test-ana', 'test-bia'])

      for (const table of ['services', 'professional_services', 'working_hours', 'closures', 'mcp_events']) {
        await tx`select count(*) from ${tx(table)}`
      }
    }))

  it('reads public_agenda with only public columns and without cancelled appointments', () =>
    inRolledBackTransaction(sql, async (tx) => {
      await insertCatalogFixture(tx)
      await insertAppointment(tx, { startsAt: at('10:00'), endsAt: at('10:30') })
      await insertAppointment(tx, { startsAt: at('11:00'), endsAt: at('11:30'), status: 'cancelled' })
      await tx`set local role anon`

      const rows = await tx`select * from public_agenda where professional_id in ('test-ana', 'test-bia')`

      expect(rows).toHaveLength(1)
      expect(Object.keys(rows[0] ?? {}).sort()).toEqual(
        ['ends_at', 'id', 'professional_id', 'public_alias', 'service_id', 'starts_at', 'status'].sort(),
      )
    }))
})
