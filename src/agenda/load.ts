import type { SupabaseClient } from '@supabase/supabase-js'
import { APPOINTMENT_COLUMNS, CLOSURE_COLUMNS, parseAppointments, parseClosures } from './schema'
import { dayRange, type LocalDate } from './time'
import type { Appointment, Closure } from './types'

/** Where the agenda reads from: Supabase in the page, a fake in tests. */
export type AgendaSource = {
  loadDay(date: LocalDate): Promise<{ appointments: Appointment[]; closures: Closure[] }>
  findAppointment(id: string): Promise<Appointment | null>
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

/** Reads the public agenda with the anon role: the public_agenda view (no private columns) and closures. */
export function supabaseAgendaSource(client: SupabaseClient): AgendaSource {
  return {
    async loadDay(date) {
      const { from, to } = dayRange(date)
      const [appointments, closures] = await Promise.all([
        client
          .from('public_agenda')
          .select(APPOINTMENT_COLUMNS)
          .gte('starts_at', from.toISOString())
          .lt('starts_at', to.toISOString())
          .order('starts_at'),
        client.from('closures').select(CLOSURE_COLUMNS).lt('starts_at', to.toISOString()).gt('ends_at', from.toISOString()),
      ])
      if (appointments.error) throw new Error(`Could not load the agenda: ${appointments.error.message}`)
      if (closures.error) throw new Error(`Could not load the closures: ${closures.error.message}`)
      return { appointments: parseAppointments(appointments.data), closures: parseClosures(closures.data) }
    },

    async findAppointment(id) {
      // The id comes from the page address: anything that is not a UUID cannot be an appointment.
      if (!UUID.test(id)) return null
      const { data, error } = await client.from('public_agenda').select(APPOINTMENT_COLUMNS).eq('id', id).maybeSingle()
      if (error) throw new Error(`Could not look up the appointment: ${error.message}`)
      return data ? (parseAppointments([data])[0] ?? null) : null
    },
  }
}
