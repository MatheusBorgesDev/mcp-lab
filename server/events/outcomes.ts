import type { Appointment } from '../db/appointments.js'
import { maskCode } from '../security/codes.js'

/** An appointment as the public agenda shows it (the same columns as the public_agenda view). */
export type PublicAppointment = {
  id: string
  professional_id: string
  service_id: string
  starts_at: string
  ends_at: string
  status: Appointment['status']
  public_alias: string
}

/** The "processed" step: what a call did, with public data only. */
export type Outcome =
  | { kind: 'services'; count: number }
  | { kind: 'professionals'; count: number }
  | { kind: 'availability'; date: string; service_id: string; professionals: Array<{ id: string; free: number }> }
  | { kind: 'appointment'; appointment: PublicAppointment }
  | { kind: 'booked'; appointment: PublicAppointment; code: string }
  | { kind: 'rescheduled'; appointment: PublicAppointment }
  | { kind: 'cancelled'; appointment: PublicAppointment; already_cancelled: boolean }
  | { kind: 'refused'; code: string; suggestions?: Array<{ start: string; professional_id: string }> }

export function publicAppointment(appointment: Appointment): PublicAppointment {
  return {
    id: appointment.id,
    professional_id: appointment.professional.id,
    service_id: appointment.service.id,
    starts_at: appointment.startsAt.toISOString(),
    ends_at: appointment.endsAt.toISOString(),
    status: appointment.status,
    public_alias: appointment.publicAlias,
  }
}

/** A new booking. The code is masked here, so a caller cannot put the full code in an event. */
export const booked = (appointment: Appointment, code: string): Outcome => ({
  kind: 'booked',
  appointment: publicAppointment(appointment),
  code: maskCode(code),
})
