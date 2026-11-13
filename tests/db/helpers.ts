import { execFileSync } from 'node:child_process'
import { randomUUID } from 'node:crypto'
import { createClient, type SupabaseClient } from '@supabase/supabase-js'
import postgres from 'postgres'

const LOCAL_SUPABASE_URL = 'postgresql://postgres:postgres@127.0.0.1:54322/postgres'
const LOCAL_HOSTS = new Set(['127.0.0.1', 'localhost', '[::1]'])

/** Connects to the local Supabase database. Refuses any other host: these tests write data. */
export function connectLocalDb({ max = 4 }: { max?: number } = {}): postgres.Sql {
  const url = process.env.TEST_DATABASE_URL ?? LOCAL_SUPABASE_URL
  const { hostname } = new URL(url)
  if (!LOCAL_HOSTS.has(hostname)) {
    throw new Error(`Database tests only run against a local database; got host "${hostname}".`)
  }
  return postgres(url, { max, onnotice: () => {} })
}

/**
 * A Supabase client with the local publishable key: what a visitor's browser has (role anon). The key is
 * read from `supabase status`, which prints it only while the local stack runs with auth enabled.
 */
export function connectLocalSupabase(): SupabaseClient {
  const env = Object.fromEntries(
    execFileSync('pnpm', ['exec', 'supabase', 'status', '-o', 'env'], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] })
      .split('\n')
      .flatMap((line) => {
        const match = /^([A-Z_]+)="(.*)"$/.exec(line)
        return match ? [[match[1], match[2]]] : []
      }),
  )
  const url = env.API_URL
  const key = env.PUBLISHABLE_KEY
  if (!url || !key) throw new Error('Local Supabase is not running with auth enabled (pnpm db:start).')
  if (!LOCAL_HOSTS.has(new URL(url).hostname)) throw new Error(`Realtime tests only run locally; got "${url}".`)
  return createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } })
}

/** Runs `fn` in a transaction that is always rolled back, so tests leave no data behind. */
export async function inRolledBackTransaction(
  sql: postgres.Sql,
  fn: (tx: postgres.TransactionSql) => Promise<void>,
): Promise<void> {
  await sql.begin(async (tx) => {
    await fn(tx)
    await tx.rollback()
  })
}

/** Ids of a fixture: two professionals who both do one 30-minute service. */
export function fixtureIds(prefix = 'test') {
  return { ana: `${prefix}-ana`, bia: `${prefix}-bia`, service: `${prefix}-corte` }
}

/** Inserts the fixture catalogue. Ids start with `prefix` (default "test-"). */
export async function insertCatalogFixture(tx: postgres.TransactionSql, prefix = 'test'): Promise<void> {
  const { ana, bia, service } = fixtureIds(prefix)
  await tx`insert into professionals (id, name) values (${ana}, 'Ana Teste'), (${bia}, 'Bia Teste')`
  await tx`
    insert into services (id, name, duration_min, price_cents)
    values (${service}, 'Corte Teste', 30, 5000)
  `
  await tx`
    insert into professional_services (professional_id, service_id)
    values (${ana}, ${service}), (${bia}, ${service})
  `
}

/** Both fixture professionals work Mondays from 09:00 to 18:00, without a lunch break. */
export async function insertWorkingHoursFixture(tx: postgres.TransactionSql, prefix = 'test'): Promise<void> {
  const { ana, bia } = fixtureIds(prefix)
  await tx`
    insert into working_hours (professional_id, weekday, start_time, end_time)
    values (${ana}, 1, '09:00', '18:00'), (${bia}, 1, '09:00', '18:00')
  `
}

/**
 * The fixture, committed, for tests that use several connections at once and so cannot run inside one
 * rolled-back transaction. Test files may run in parallel (VITEST_MAX_WORKERS overrides fileParallelism),
 * so each file passes its own prefix and touches only its own rows. Always pair with removeCommittedFixture.
 */
export async function insertCommittedFixture(sql: postgres.Sql, prefix: string): Promise<void> {
  await removeCommittedFixture(sql, prefix)
  await sql.begin(async (tx) => {
    await insertCatalogFixture(tx, prefix)
    await insertWorkingHoursFixture(tx, prefix)
  })
}

export async function removeCommittedFixture(sql: postgres.Sql, prefix: string): Promise<void> {
  const ids = `${prefix}-%`
  await sql.begin(async (tx) => {
    await tx`delete from appointments where professional_id like ${ids}`
    await tx`delete from closures where professional_id like ${ids}`
    await tx`delete from working_hours where professional_id like ${ids}`
    await tx`delete from professional_services where professional_id like ${ids}`
    await tx`delete from services where id like ${ids}`
    await tx`delete from professionals where id like ${ids}`
  })
}

/** Deletes the appointments of a committed fixture between tests. */
export const deleteFixtureAppointments = (sql: postgres.Sql, prefix: string) =>
  sql`delete from appointments where professional_id like ${`${prefix}-%`}`

type AppointmentFixture = {
  startsAt: string
  endsAt: string
  professionalId?: string
  status?: 'confirmed' | 'cancelled' | 'completed'
}

export function insertAppointment(tx: postgres.TransactionSql, fixture: AppointmentFixture) {
  const { startsAt, endsAt, professionalId = 'test-ana', status = 'confirmed' } = fixture
  return tx`
    insert into appointments
      (code_hash, professional_id, service_id, starts_at, ends_at, status, public_alias, client_name, ip_hash)
    values
      (${`test-${randomUUID()}`}, ${professionalId}, 'test-corte', ${startsAt}, ${endsAt}, ${status},
       'Cliente #0001', 'Private Name', 'private-ip-hash')
  `
}
