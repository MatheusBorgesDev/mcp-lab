import { randomUUID } from 'node:crypto'
import postgres from 'postgres'

const LOCAL_SUPABASE_URL = 'postgresql://postgres:postgres@127.0.0.1:54322/postgres'
const LOCAL_HOSTS = new Set(['127.0.0.1', 'localhost', '[::1]'])

/** Connects to the local Supabase database. Refuses any other host: these tests write data. */
export function connectLocalDb(): postgres.Sql {
  const url = process.env.TEST_DATABASE_URL ?? LOCAL_SUPABASE_URL
  const { hostname } = new URL(url)
  if (!LOCAL_HOSTS.has(hostname)) {
    throw new Error(`Database tests only run against a local database; got host "${hostname}".`)
  }
  return postgres(url, { max: 4, onnotice: () => {} })
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

/** Two professionals who both do one 30-minute service. Ids start with "test-". */
export async function insertCatalogFixture(tx: postgres.TransactionSql): Promise<void> {
  await tx`insert into professionals (id, name) values ('test-ana', 'Ana Teste'), ('test-bia', 'Bia Teste')`
  await tx`
    insert into services (id, name, duration_min, price_cents)
    values ('test-corte', 'Corte Teste', 30, 5000)
  `
  await tx`
    insert into professional_services (professional_id, service_id)
    values ('test-ana', 'test-corte'), ('test-bia', 'test-corte')
  `
}

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
