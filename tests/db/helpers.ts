import { randomUUID } from 'node:crypto'
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
