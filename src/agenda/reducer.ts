import type { AgendaItem } from './layout'
import { dayRange, type LocalDate } from './time'
import type { Appointment } from './types'

export type AgendaState = { date: LocalDate; items: Array<AgendaItem & { key: string }> }

export type AgendaAction =
  | { type: 'loaded'; date: LocalDate; appointments: Appointment[] }
  | { type: 'changed'; op: 'insert' | 'update' | 'delete'; appointment: Appointment }
  /** The flash of `key` is over: a freed place disappears, a new one stays without the flash. */
  | { type: 'settled'; key: string }

const onDay = (a: Appointment, date: LocalDate) => {
  const { from, to } = dayRange(date)
  return a.startsAt >= from && a.startsAt < to
}

/** The day's appointments, kept in step with the live broadcasts. */
export function agendaReducer(state: AgendaState, action: AgendaAction): AgendaState {
  switch (action.type) {
    case 'loaded':
      return { date: action.date, items: action.appointments.map((a) => ({ ...a, key: a.id })) }

    case 'settled':
      return {
        ...state,
        items: state.items.flatMap((i) => {
          if (i.key !== action.key) return [i]
          if (i.flash === 'freed') return []
          const { flash: _, ...settled } = i
          return [settled]
        }),
      }

    case 'changed': {
      const { op, appointment } = action
      const active = op !== 'delete' && appointment.status !== 'cancelled'
      const here = onDay(appointment, state.date)
      const current = state.items.find((i) => i.key === appointment.id)
      let items = state.items

      if (current) {
        const samePlace =
          active && here &&
          current.startsAt.getTime() === appointment.startsAt.getTime() &&
          current.professionalId === appointment.professionalId
        if (samePlace) {
          return { ...state, items: items.map((i) => (i === current ? { ...i, ...appointment } : i)) }
        }
        // The old place stays for a moment, flashing as freed.
        const ghost = { ...current, key: `freed:${current.id}:${current.startsAt.getTime()}`, flash: 'freed' as const }
        items = items.map((i) => (i === current ? ghost : i))
      }
      if (active && here) items = [...items, { ...appointment, key: appointment.id, flash: 'new' }]
      return { ...state, items }
    }
  }
}
