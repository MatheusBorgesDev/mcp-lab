import type postgres from 'postgres'
import { z } from 'zod'
import type { SeedAppointment } from '../domain/seed.js'
import type { LocalDate } from '../domain/time.js'

/** An appointment as the server shows it to its owner. Never carries the client name, IP or code. */
export type Appointment = {
  id: string
  status: 'confirmed' | 'cancelled' | 'completed'
  startsAt: Date
  endsAt: Date
  publicAlias: string
  service: { id: string; name: string; durationMin: number; priceCents: number }
  professional: { id: string; name: string }
}

const appointmentRow = z.object({
  id: z.string(),
  status: z.enum(['confirmed', 'cancelled', 'completed']),
  starts_at: z.date(),
  ends_at: z.date(),
  public_alias: z.string(),
  service_id: z.string(),
  service_name: z.string(),
  duration_min: z.number().int(),
  price_cents: z.number().int(),
  professional_id: z.string(),
  professional_name: z.string(),
})

function toAppointment(rows: readonly unknown[]): Appointment | undefined {
  if (rows.length === 0) return undefined
  const r = appointmentRow.parse(rows[0])
  return {
    id: r.id,
    status: r.status,
    startsAt: r.starts_at,
    endsAt: r.ends_at,
    publicAlias: r.public_alias,
    service: { id: r.service_id, name: r.service_name, durationMin: r.duration_min, priceCents: r.price_cents },
    professional: { id: r.professional_id, name: r.professional_name },
  }
}

/** Selects the owner's view of the appointments in the CTE named "a". */
const withNames = (sql: postgres.Sql | postgres.TransactionSql) => sql`
  select a.id, a.status, a.starts_at, a.ends_at, a.public_alias,
         s.id as service_id, s.name as service_name, s.duration_min, s.price_cents,
         p.id as professional_id, p.name as professional_name
  from a
  join services s on s.id = a.service_id
  join professionals p on p.id = a.professional_id
`

export type NewAppointment = {
  codeHash: string
  professionalId: string
  serviceId: string
  startsAt: Date
  endsAt: Date
  clientName: string | null
  publicAlias: string
  /** The visitor key (server/security/ip.ts), never the address itself. */
  ipHash: string
}

/** What a write transaction locks: the visitor (on a new booking), the day it writes to and the professional. */
export type AgendaLocks = { visitor?: string; day: LocalDate; professionalId: string }

/**
 * Runs `work` in a transaction that first takes the agenda locks, always in the same order (visitor, day,
 * professional) so concurrent writers wait for each other instead of deadlocking. The locks make the limits
 * exact: two requests at once cannot both count the same free room. The professional's lock also turns
 * overlapping inserts into a clean overlap error, where they would otherwise deadlock inside the exclusion
 * constraint. Locks are released at the end of the transaction.
 */
export function inAgendaTransaction<T>(
  sql: postgres.Sql,
  locks: AgendaLocks,
  work: (tx: postgres.TransactionSql) => Promise<T>,
): Promise<T> {
  const keys = [
    ...(locks.visitor === undefined ? [] : [`visitor:${locks.visitor}`]),
    `day:${locks.day}`,
    `agenda:${locks.professionalId}`,
  ]
  return sql.begin(async (tx) => {
    for (const key of keys) await tx`select pg_advisory_xact_lock(hashtextextended(${key}, 0))`
    return work(tx)
  }) as Promise<T>
}

/** Confirmed appointments of a visitor that have not started yet. */
export async function countUpcomingByVisitor(tx: postgres.TransactionSql, visitor: string, now: Date): Promise<number> {
  const [row] = await tx<{ count: number }[]>`
    select count(*)::int as count from appointments
    where ip_hash = ${visitor} and status = 'confirmed' and starts_at > ${now}
  `
  return row?.count ?? 0
}

/** Minutes taken by active appointments (any source) starting in [from, to), except `excludeId`. */
export async function occupiedMinutesBetween(
  tx: postgres.TransactionSql,
  range: { from: Date; to: Date },
  excludeId?: string,
): Promise<number> {
  const [row] = await tx<{ minutes: number }[]>`
    select coalesce(sum(extract(epoch from ends_at - starts_at) / 60), 0)::int as minutes from appointments
    where status <> 'cancelled' and starts_at >= ${range.from} and starts_at < ${range.to}
      ${excludeId === undefined ? tx`` : tx`and id <> ${excludeId}`}
  `
  return row?.minutes ?? 0
}

/** Inserts a confirmed appointment. Throws the exclusion violation (see isSlotConflict) on overlap. */
export async function insertAppointment(tx: postgres.TransactionSql, input: NewAppointment): Promise<Appointment> {
  const rows = await tx`
    with a as (
      insert into appointments
        (code_hash, professional_id, service_id, starts_at, ends_at, client_name, public_alias, ip_hash, source)
      values
        (${input.codeHash}, ${input.professionalId}, ${input.serviceId}, ${input.startsAt}, ${input.endsAt},
         ${input.clientName}, ${input.publicAlias}, ${input.ipHash}, 'visitor')
      returning *
    )
    ${withNames(tx)}
  `
  const appointment = toAppointment(rows)
  if (!appointment) throw new Error('insert returned no row')
  return appointment
}

export async function findAppointmentByCodeHash(sql: postgres.Sql, codeHash: string): Promise<Appointment | undefined> {
  const rows = await sql`
    with a as (select * from appointments where code_hash = ${codeHash})
    ${withNames(sql)}
  `
  return toAppointment(rows)
}

/** Moves a confirmed appointment. Undefined if it is no longer confirmed; throws on overlap. */
export async function moveAppointment(
  tx: postgres.TransactionSql,
  id: string,
  to: { professionalId: string; startsAt: Date; endsAt: Date },
): Promise<Appointment | undefined> {
  const rows = await tx`
    with a as (
      update appointments
      set professional_id = ${to.professionalId}, starts_at = ${to.startsAt}, ends_at = ${to.endsAt},
          updated_at = now()
      where id = ${id} and status = 'confirmed'
      returning *
    )
    ${withNames(tx)}
  `
  return toAppointment(rows)
}

/** Cancels a confirmed appointment. Undefined if it was not confirmed anymore. */
export async function cancelAppointment(sql: postgres.Sql, id: string): Promise<Appointment | undefined> {
  const rows = await sql`
    with a as (
      update appointments set status = 'cancelled', updated_at = now()
      where id = ${id} and status = 'confirmed'
      returning *
    )
    ${withNames(sql)}
  `
  return toAppointment(rows)
}

/**
 * Holds every other write to appointments until the end of the transaction; reads go on. The daily reset takes
 * it first: a booking made meanwhile waits, then plans against the new agenda instead of racing the reset.
 */
export async function lockAppointmentWrites(tx: postgres.TransactionSql): Promise<void> {
  await tx`lock table appointments in share row exclusive mode`
}

/** Deletes every visitor booking, past or future, with its name and visitor key. */
export async function deleteVisitorAppointments(tx: postgres.TransactionSql): Promise<number> {
  return (await tx`delete from appointments where source = 'visitor'`).count
}

/**
 * Makes the shop's own bookings from `from` on match `seeds`: drops the ones not there, adds the missing ones.
 * The key is the row's code hash, so a booking already written is left as it is.
 */
export async function syncSeedAppointments(
  tx: postgres.TransactionSql,
  seeds: readonly SeedAppointment[],
  from: Date,
): Promise<{ removed: number; added: number }> {
  const removed = await tx`
    delete from appointments
    where source = 'seed' and starts_at >= ${from} and code_hash <> all(${seeds.map((s) => s.key)}::text[])
  `
  if (seeds.length === 0) return { removed: removed.count, added: 0 }
  const rows = seeds.map((s) => ({
    code_hash: s.key,
    professional_id: s.professionalId,
    service_id: s.serviceId,
    starts_at: s.startsAt,
    ends_at: s.endsAt,
    public_alias: s.publicAlias,
    source: 'seed',
  }))
  const added = await tx`
    insert into appointments
    ${tx(rows, 'code_hash', 'professional_id', 'service_id', 'starts_at', 'ends_at', 'public_alias', 'source')}
    on conflict (code_hash) do nothing
  `
  return { removed: removed.count, added: added.count }
}

/** Marks the confirmed bookings that ended by `now` as completed. */
export async function completeEndedAppointments(tx: postgres.TransactionSql, now: Date): Promise<number> {
  return (await tx`
    update appointments set status = 'completed', updated_at = now()
    where status = 'confirmed' and ends_at <= ${now}
  `).count
}
