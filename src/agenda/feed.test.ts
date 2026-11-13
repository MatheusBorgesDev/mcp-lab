import { describe, expect, it } from 'vitest'
import { parseCatalog } from '../data/catalog'
import { AGENDA_RAW } from '../test/fixtures'
import { feedEntry } from './feed'
import type { Appointment } from './types'

const catalog = parseCatalog(AGENDA_RAW)
const at = (hhmm: string, date = '2026-11-12') => new Date(`${date}T${hhmm}:00-03:00`)
const NOW = at('14:58')
const appt = (over: Partial<Appointment> = {}): Appointment => ({
  id: 'a1',
  professionalId: 'rafael',
  serviceId: 'barba',
  startsAt: at('17:00'),
  endsAt: at('17:30'),
  status: 'confirmed',
  alias: 'Cliente #2268',
  ...over,
})
const text = (op: 'insert' | 'update' | 'delete', appointment: Appointment) => feedEntry({ op, appointment, catalog, now: NOW })?.text

describe('feedEntry', () => {
  it('tells a booking, with the time it happened', () => {
    expect(feedEntry({ op: 'insert', appointment: appt(), catalog, now: NOW })).toMatchObject({
      time: '14:58',
      text: 'Cliente #2268 marcou Barba com o Rafael às 17h',
    })
  })

  it('keys each entry by its message, so two changes in the same instant stay apart', () => {
    const first = feedEntry({ op: 'update', appointment: appt(), catalog, now: NOW, messageId: 'm1' })
    const second = feedEntry({ op: 'update', appointment: appt(), catalog, now: NOW, messageId: 'm2' })

    expect(first?.key).not.toBe(second?.key)
  })

  it('names the day when it is not today', () => {
    expect(text('insert', appt({ startsAt: at('09:30', '2026-11-13') }))).toBe('Cliente #2268 marcou Barba com o Rafael amanhã às 9h30')
    expect(text('insert', appt({ startsAt: at('10:00', '2026-11-19') }))).toBe('Cliente #2268 marcou Barba com o Rafael qui, 19/11 às 10h')
  })

  it('tells a reschedule and a cancellation', () => {
    expect(text('update', appt())).toBe('Cliente #2268 remarcou Barba com o Rafael para as 17h')
    expect(text('update', appt({ status: 'cancelled' }))).toBe('Cliente #2268 cancelou Barba com o Rafael às 17h')
  })

  it('says nothing about other changes', () => {
    expect(text('delete', appt())).toBeUndefined()
    expect(text('update', appt({ status: 'completed' }))).toBeUndefined()
  })
})
