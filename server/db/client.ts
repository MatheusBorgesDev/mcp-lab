import postgres from 'postgres'
import { z } from 'zod'

let client: postgres.Sql | undefined

const postgresUrl = z.url({ protocol: /^postgres(ql)?$/, hostname: /./ })

/**
 * DATABASE_URL, checked before it reaches the driver: postgres.js silently falls back to localhost:5432
 * when it finds no host in the string. The error never includes the value, which holds the password.
 */
export function readDatabaseUrl(value: string | undefined): string {
  const url = value?.trim()
  if (!url) throw new Error('DATABASE_URL is not set.')
  if (!postgresUrl.safeParse(url).success) {
    throw new Error('DATABASE_URL is not a valid Postgres URL (expected postgresql://user:password@host:port/database).')
  }
  return url
}

/**
 * The server's connection, created on first use and reused while the function instance lives.
 * In production DATABASE_URL points at the Supabase pooler in transaction mode, which does not
 * support prepared statements.
 */
export function getSql(): postgres.Sql {
  if (!client) {
    client = postgres(readDatabaseUrl(process.env.DATABASE_URL), { prepare: false, max: 5, idle_timeout: 20, connect_timeout: 10, onnotice: () => {} })
  }
  return client
}

const EXCLUSION_VIOLATION = '23P01'
const DEADLOCK_DETECTED = '40P01'

/**
 * True when a competing write made the database refuse this one: it would overlap an active appointment
 * (exclusion constraint), or it was chosen as the victim of a deadlock between overlapping inserts.
 * Either way the caller should plan again with fresh data.
 */
export function isSlotConflict(error: unknown): boolean {
  return (
    error instanceof postgres.PostgresError &&
    (error.code === EXCLUSION_VIOLATION || error.code === DEADLOCK_DETECTED)
  )
}
