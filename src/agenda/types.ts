/** An appointment as the public agenda shows it (view public_agenda, or a broadcast on "agenda"). */
export type Appointment = {
  id: string
  professionalId: string
  serviceId: string
  startsAt: Date
  endsAt: Date
  status: 'confirmed' | 'cancelled' | 'completed'
  alias: string
}

/** A closure: one barber (professionalId) or the whole shop (null). */
export type Closure = { professionalId: string | null; startsAt: Date; endsAt: Date; reason: string | null }
