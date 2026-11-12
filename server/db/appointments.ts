import type postgres from 'postgres'
import { z } from 'zod'

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
  ipHash: string | null
}

/**
 * Writes to one professional's agenda go one at a time. Without this, overlapping inserts that run at the
 * same moment wait on each other inside the exclusion constraint and end in a deadlock instead of a clean
 * overlap error. The lock is released at the end of the transaction.
 */
async function lockAgenda(tx: postgres.TransactionSql, professionalId: string): Promise<void> {
  await tx`select pg_advisory_xact_lock(hashtextextended(${`agenda:${professionalId}`}, 0))`
}

/** Inserts a confirmed appointment. Throws the exclusion violation (see isSlotConflict) on overlap. */
export async function insertAppointment(sql: postgres.Sql, input: NewAppointment): Promise<Appointment> {
  const rows = await sql.begin(async (tx) => {
    await lockAgenda(tx, input.professionalId)
    return tx`
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
  })
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
  sql: postgres.Sql,
  id: string,
  to: { professionalId: string; startsAt: Date; endsAt: Date },
): Promise<Appointment | undefined> {
  const rows = await sql.begin(async (tx) => {
    await lockAgenda(tx, to.professionalId)
    return tx`
      with a as (
        update appointments
        set professional_id = ${to.professionalId}, starts_at = ${to.startsAt}, ends_at = ${to.endsAt},
            updated_at = now()
        where id = ${id} and status = 'confirmed'
        returning *
      )
      ${withNames(tx)}
    `
  })
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
