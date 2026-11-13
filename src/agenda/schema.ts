import * as z from 'zod/mini'
import type { Appointment, Closure } from './types'

// What Supabase sends the page: rows of public_agenda and closures, and the "agenda" broadcast payload
// (supabase/migrations, realtime_broadcast). Validated before use: anything else is ignored.
const instant = z.string().check(z.refine((value) => !Number.isNaN(Date.parse(value))))

const appointmentRow = z.object({
  id: z.string(),
  professional_id: z.string(),
  service_id: z.string(),
  starts_at: instant,
  ends_at: instant,
  status: z.enum(['confirmed', 'cancelled', 'completed']),
  public_alias: z.string(),
})

const closureRow = z.object({
  professional_id: z.nullable(z.string()),
  starts_at: instant,
  ends_at: instant,
  reason: z.nullable(z.string()),
})

const agendaMessage = z.object({ op: z.enum(['insert', 'update', 'delete']), appointment: appointmentRow })

const toAppointment = (row: z.infer<typeof appointmentRow>): Appointment => ({
  id: row.id,
  professionalId: row.professional_id,
  serviceId: row.service_id,
  startsAt: new Date(row.starts_at),
  endsAt: new Date(row.ends_at),
  status: row.status,
  alias: row.public_alias,
})

export const APPOINTMENT_COLUMNS = 'id, professional_id, service_id, starts_at, ends_at, status, public_alias'
export const CLOSURE_COLUMNS = 'professional_id, starts_at, ends_at, reason'

export const parseAppointments = (rows: unknown): Appointment[] => z.array(appointmentRow).parse(rows).map(toAppointment)

export const parseClosures = (rows: unknown): Closure[] =>
  z
    .array(closureRow)
    .parse(rows)
    .map((r) => ({ professionalId: r.professional_id, startsAt: new Date(r.starts_at), endsAt: new Date(r.ends_at), reason: r.reason }))

export function parseAgendaMessage(payload: unknown): { op: 'insert' | 'update' | 'delete'; appointment: Appointment } | null {
  const parsed = agendaMessage.safeParse(payload)
  return parsed.success ? { op: parsed.data.op, appointment: toAppointment(parsed.data.appointment) } : null
}
