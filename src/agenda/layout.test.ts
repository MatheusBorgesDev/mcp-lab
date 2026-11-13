import { describe, expect, it } from 'vitest'
import { parseCatalog } from '../data/catalog'
import { AGENDA_RAW } from '../test/fixtures'
import { dayLayout, type AgendaItem } from './layout'
import type { Appointment, Closure } from './types'

const catalog = parseCatalog(AGENDA_RAW)
const THURSDAY = '2026-11-12'
const at = (hhmm: string, date = THURSDAY) => new Date(`${date}T${hhmm}:00-03:00`)
const NOON = at('12:30')

const appointment = (over: Partial<Appointment> = {}): Appointment => ({
  id: 'a1',
  professionalId: 'rafael',
  serviceId: 'barba',
  startsAt: at('14:00'),
  endsAt: at('14:30'),
  status: 'confirmed',
  alias: 'Cliente #2268',
  ...over,
})

const layout = (appointments: AgendaItem[] = [], closures: Closure[] = [], now = NOON, date = THURSDAY) =>
  dayLayout({ date, catalog, appointments, closures, now })

describe('dayLayout', () => {
  it('spans from the first opening to the last closing of the day, hour by hour', () => {
    const day = layout()

    expect(day).toMatchObject({ startMin: 9 * 60, endMin: 19 * 60 })
    expect(day.hours).toEqual([9, 10, 11, 12, 13, 14, 15, 16, 17, 18].map((h) => h * 60))
  })

  it('has one column per barber, with lunch as a break and a day off as such', () => {
    const [rafael, lucas] = layout().columns

    expect(rafael?.professional.name).toBe('Rafael')
    expect(rafael?.blocks).toEqual([{ startMin: 720, endMin: 780, kind: 'break', label: 'pausa' }])
    expect(lucas?.blocks).toEqual([{ startMin: 540, endMin: 1140, kind: 'off', label: 'folga' }])
  })

  it('places each taken time in its barber column, with the service and the public alias', () => {
    const [rafael] = layout([appointment(), appointment({ id: 'a2', startsAt: at('16:00'), endsAt: at('17:00'), serviceId: 'corte-e-barba' })]).columns

    expect(rafael?.slots).toEqual([
      { key: 'a1', id: 'a1', startMin: 840, endMin: 870, alias: 'Cliente #2268', service: 'Barba' },
      { key: 'a2', id: 'a2', startMin: 960, endMin: 1020, alias: 'Cliente #2268', service: 'Corte + barba' },
    ])
  })

  it('keeps the key and the flash of a time that just changed, for the animation', () => {
    const [rafael] = layout([{ ...appointment(), key: 'freed:a1', flash: 'freed' }]).columns

    expect(rafael?.slots[0]).toMatchObject({ key: 'freed:a1', id: 'a1', flash: 'freed' })
  })

  it('leaves out cancelled appointments and those of other days', () => {
    const [rafael] = layout([
      appointment({ status: 'cancelled' }),
      appointment({ id: 'a2', startsAt: at('14:00', '2026-11-13'), endsAt: at('14:30', '2026-11-13') }),
    ]).columns

    expect(rafael?.slots).toEqual([])
  })

  it('marks a closure of the whole shop on every column, with its reason', () => {
    const holiday: Closure = { professionalId: null, startsAt: at('00:00'), endsAt: at('00:00', '2026-11-13'), reason: 'Feriado' }

    const day = layout([], [holiday])

    expect(day.closed).toBe('Feriado')
    for (const column of day.columns) expect(column.blocks).toContainEqual({ startMin: 540, endMin: 1140, kind: 'closed', label: 'Feriado' })
  })

  it('marks a closure of one barber on that column only, clipped to the day', () => {
    const away: Closure = { professionalId: 'rafael', startsAt: at('16:00'), endsAt: at('23:00'), reason: null }

    const [rafael, lucas] = layout([], [away]).columns

    expect(rafael?.blocks).toContainEqual({ startMin: 960, endMin: 1140, kind: 'closed', label: 'fechado' })
    expect(lucas?.blocks).not.toContainEqual(expect.objectContaining({ kind: 'closed' }))
  })

  it('draws the "now" line only on today, inside the opening hours', () => {
    expect(layout([], [], NOON).now).toBe(750)
    expect(layout([], [], at('20:00')).now).toBeNull()
    expect(layout([], [], at('12:30', '2026-11-11')).now).toBeNull()
  })

  it('says the shop is closed on a day nobody works', () => {
    const sunday = layout([], [], NOON, '2026-11-15')

    expect(sunday.closed).toBe('Fechado')
    expect(sunday.columns.every((c) => c.slots.length === 0)).toBe(true)
  })
})
