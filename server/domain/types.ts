import type { LocalDate } from './time.js'

export type Service = {
  id: string
  name: string
  description: string | null
  durationMin: number
  priceCents: number
  active: boolean
}

export type Professional = {
  id: string
  name: string
  bio: string | null
  active: boolean
  serviceIds: readonly string[]
}

/** One working interval of a professional on a weekday (0 = Sunday), in minutes since local midnight. */
export type WorkingInterval = {
  professionalId: string
  weekday: number
  startMin: number
  endMin: number
}

/** A blocked period: a holiday (professionalId null = whole shop) or a professional's day off. */
export type Closure = {
  professionalId: string | null
  startsAt: Date
  endsAt: Date
  reason: string | null
}

/** An active (not cancelled) appointment, as far as availability is concerned. */
export type BusySlot = {
  appointmentId: string
  professionalId: string
  startsAt: Date
  endsAt: Date
}

/** Everything the rules need to decide about one service over a range of days. */
export type Schedule = {
  services: readonly Service[]
  /** In display order; this order also breaks ties when the shop picks a professional. */
  professionals: readonly Professional[]
  workingHours: readonly WorkingInterval[]
  closures: readonly Closure[]
  appointments: readonly BusySlot[]
}

export type { LocalDate }
