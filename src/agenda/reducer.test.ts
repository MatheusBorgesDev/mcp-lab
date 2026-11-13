import { describe, expect, it } from 'vitest'
import { agendaReducer, type AgendaState } from './reducer'
import type { Appointment } from './types'

const THURSDAY = '2026-11-12'
const at = (hhmm: string, date = THURSDAY) => new Date(`${date}T${hhmm}:00-03:00`)
const appt = (over: Partial<Appointment> = {}): Appointment => ({
  id: 'a1',
  professionalId: 'rafael',
  serviceId: 'barba',
  startsAt: at('14:00'),
  endsAt: at('14:30'),
  status: 'confirmed',
  alias: 'Cliente #2268',
  ...over,
})
const loaded = (appointments: Appointment[] = []): AgendaState =>
  agendaReducer({ date: THURSDAY, items: [] }, { type: 'loaded', date: THURSDAY, appointments })
const keys = (state: AgendaState) => state.items.map((i) => `${i.key}${i.flash ? `/${i.flash}` : ''}`)

describe('agendaReducer', () => {
  it('shows a new booking on the day with a flash', () => {
    const state = agendaReducer(loaded(), { type: 'changed', op: 'insert', appointment: appt() })

    expect(keys(state)).toEqual(['a1/new'])
  })

  it('ignores a booking on another day', () => {
    const state = agendaReducer(loaded(), {
      type: 'changed',
      op: 'insert',
      appointment: appt({ startsAt: at('14:00', '2026-11-13'), endsAt: at('14:30', '2026-11-13') }),
    })

    expect(state.items).toEqual([])
  })

  it('turns a cancelled time into a freed flash in its old place', () => {
    const state = agendaReducer(loaded([appt()]), { type: 'changed', op: 'update', appointment: appt({ status: 'cancelled' }) })

    expect(keys(state)).toEqual([`freed:a1:${at('14:00').getTime()}/freed`])
    expect(state.items[0]?.startsAt).toEqual(at('14:00'))
  })

  it('moves a rescheduled time: the old place flashes as freed, the new one as new', () => {
    const state = agendaReducer(loaded([appt()]), {
      type: 'changed',
      op: 'update',
      appointment: appt({ startsAt: at('16:00'), endsAt: at('16:30') }),
    })

    expect(keys(state)).toEqual([`freed:a1:${at('14:00').getTime()}/freed`, 'a1/new'])
  })

  it('frees the place of a time rescheduled to another day', () => {
    const state = agendaReducer(loaded([appt()]), {
      type: 'changed',
      op: 'update',
      appointment: appt({ startsAt: at('14:00', '2026-11-13'), endsAt: at('14:30', '2026-11-13') }),
    })

    expect(keys(state)).toEqual([`freed:a1:${at('14:00').getTime()}/freed`])
  })

  it('updates a time in place, without a flash, when nothing visible changed', () => {
    const state = agendaReducer(loaded([appt()]), { type: 'changed', op: 'update', appointment: appt({ alias: 'Cliente #9999' }) })

    expect(keys(state)).toEqual(['a1'])
    expect(state.items[0]?.alias).toBe('Cliente #9999')
  })

  it('drops a freed place and clears a new flash once the animation is over', () => {
    let state = agendaReducer(loaded([appt()]), { type: 'changed', op: 'update', appointment: appt({ startsAt: at('16:00'), endsAt: at('16:30') }) })
    state = agendaReducer(state, { type: 'settled', key: `freed:a1:${at('14:00').getTime()}` })
    state = agendaReducer(state, { type: 'settled', key: 'a1' })

    expect(keys(state)).toEqual(['a1'])
  })

  it('replaces everything on a fresh load', () => {
    const state = agendaReducer(agendaReducer(loaded(), { type: 'changed', op: 'insert', appointment: appt() }), {
      type: 'loaded',
      date: '2026-11-13',
      appointments: [],
    })

    expect(state).toEqual({ date: '2026-11-13', items: [] })
  })
})
