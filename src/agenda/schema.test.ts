import { describe, expect, it } from 'vitest'
import { parseAgendaMessage, parseAppointments, parseClosures } from './schema'

// Shapes as Supabase sends them: PostgREST rows and the payload of the "agenda" broadcast (a jsonb object).
const ROW = {
  id: '5f0c6c3e-8a0e-4f43-9a55-2b8a3b1c9d10',
  professional_id: 'rafael',
  service_id: 'barba',
  starts_at: '2026-11-12T20:00:00+00:00',
  ends_at: '2026-11-12T20:30:00+00:00',
  status: 'confirmed',
  public_alias: 'Cliente #2268',
}
const APPOINTMENT = {
  id: ROW.id,
  professionalId: 'rafael',
  serviceId: 'barba',
  startsAt: new Date('2026-11-12T17:00:00-03:00'),
  endsAt: new Date('2026-11-12T17:30:00-03:00'),
  status: 'confirmed',
  alias: 'Cliente #2268',
}

describe('agenda schemas', () => {
  it('reads public_agenda rows', () => {
    expect(parseAppointments([ROW])).toEqual([APPOINTMENT])
  })

  it('reads closures, of one barber or of the whole shop', () => {
    expect(parseClosures([{ professional_id: null, starts_at: ROW.starts_at, ends_at: ROW.ends_at, reason: 'Feriado' }])).toEqual([
      { professionalId: null, startsAt: APPOINTMENT.startsAt, endsAt: APPOINTMENT.endsAt, reason: 'Feriado' },
    ])
  })

  it('reads a broadcast', () => {
    expect(parseAgendaMessage({ op: 'update', appointment: ROW, id: 'message-id' })).toEqual({ op: 'update', appointment: APPOINTMENT })
  })

  it.each([
    ['an unknown operation', { op: 'truncate', appointment: ROW }],
    ['a date that is not a date', { op: 'insert', appointment: { ...ROW, starts_at: 'amanhã' } }],
    ['a missing field', { op: 'insert', appointment: { ...ROW, public_alias: undefined } }],
    ['no payload', null],
  ])('ignores a broadcast with %s', (_case, payload) => {
    expect(parseAgendaMessage(payload)).toBeNull()
  })
})
