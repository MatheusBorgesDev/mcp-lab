import { describe, expect, it } from 'vitest'
import { parseCatalog } from '../data/catalog'
import { AGENDA_RAW } from '../test/fixtures'
import { agendaDays } from './days'

const catalog = parseCatalog(AGENDA_RAW)

describe('agendaDays', () => {
  it('lists today and the days ahead when someone works, as the day picker shows them', () => {
    // Wednesday 2026-11-11, 22:00 in São Paulo: still Wednesday there, already Thursday in UTC.
    const days = agendaDays(catalog, new Date('2026-11-12T01:00:00Z'), 9)

    expect(days).toEqual([
      { date: '2026-11-12', label: 'Amanhã' },
      { date: '2026-11-13', label: 'sex 13' },
      { date: '2026-11-19', label: 'qui 19' },
      { date: '2026-11-20', label: 'sex 20' },
    ])
  })

  it('names today "Hoje" when someone works today', () => {
    expect(agendaDays(catalog, new Date('2026-11-12T15:00:00Z'), 1)[0]).toEqual({ date: '2026-11-12', label: 'Hoje' })
  })
})
