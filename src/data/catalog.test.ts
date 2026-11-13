import { describe, expect, it } from 'vitest'
import { RAW } from '../test/fixtures'
import { parseCatalog, shopFacts } from './catalog'

describe('parseCatalog', () => {
  it('keeps active services and professionals, with what each one does and when', () => {
    const catalog = parseCatalog(RAW)

    expect(catalog.services.map((s) => s.id)).toEqual(['barba', 'corte'])
    expect(catalog.professionals).toEqual([
      {
        id: 'ana',
        name: 'Ana',
        bio: 'Barba.',
        serviceIds: ['barba', 'corte'],
        hours: [
          { weekday: 2, startMin: 540, endMin: 720 },
          { weekday: 2, startMin: 780, endMin: 1140 },
          { weekday: 3, startMin: 540, endMin: 1140 },
        ],
      },
      { id: 'bia', name: 'Bia', bio: null, serviceIds: ['corte'], hours: [{ weekday: 6, startMin: 600, endMin: 840 }] },
    ])
  })

  it('refuses rows that are not in the expected shape', () => {
    expect(() => parseCatalog({ ...RAW, services: [{ id: 'barba', name: 'Barba' }] })).toThrow()
  })
})

describe('shopFacts', () => {
  it('counts barbers and services and joins the days anyone works', () => {
    expect(shopFacts(parseCatalog(RAW))).toEqual({ professionals: 2, services: 2, days: 'ter, qua, sáb' })
  })
})
