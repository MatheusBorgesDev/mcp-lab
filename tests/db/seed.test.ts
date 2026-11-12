import { afterAll, describe, expect, it } from 'vitest'
import { connectLocalDb } from './helpers.js'

// Reads the data loaded by supabase/seed.sql (pnpm db:reset). Test fixtures (ids "test-*") are ignored.
const sql = connectLocalDb()
afterAll(() => sql.end())

type Service = { id: string; duration_min: number; price_cents: number }
type Offer = { professional_id: string; service_id: string }
type Interval = { professional_id: string; weekday: number; start_min: number; end_min: number }

const services = () => sql<Service[]>`
  select id, duration_min, price_cents from services where active and id not like 'test-%'
`
const professionals = () => sql<{ id: string }[]>`
  select id from professionals where active and id not like 'test-%'
`
const offers = () => sql<Offer[]>`
  select professional_id, service_id from professional_services where professional_id not like 'test-%'
`
const intervals = () => sql<Interval[]>`
  select professional_id, weekday,
         extract(hour from start_time)::int * 60 + extract(minute from start_time)::int as start_min,
         extract(hour from end_time)::int * 60 + extract(minute from end_time)::int as end_min
  from working_hours where professional_id not like 'test-%'
`

describe('seed: the barbershop loaded by pnpm db:reset', () => {
  it('has about 8 active services, each with a price', async () => {
    const rows = await services()
    expect(rows.length).toBeGreaterThanOrEqual(7)
    expect(rows.length).toBeLessThanOrEqual(10)
    expect(rows.filter((s) => s.price_cents <= 0).map((s) => s.id)).toEqual([])
  })

  it('has 3 or 4 active professionals', async () => {
    const rows = await professionals()
    expect(rows.length).toBeGreaterThanOrEqual(3)
    expect(rows.length).toBeLessThanOrEqual(4)
  })

  it('offers every service through someone, and not everyone offers everything', async () => {
    const [serviceRows, professionalRows, offerRows] = await Promise.all([services(), professionals(), offers()])

    const offered = new Set(offerRows.map((o) => o.service_id))
    expect(serviceRows.filter((s) => !offered.has(s.id)).map((s) => s.id)).toEqual([])

    const offersPerProfessional = professionalRows.map(
      (p) => offerRows.filter((o) => o.professional_id === p.id).length,
    )
    expect(Math.min(...offersPerProfessional)).toBeGreaterThan(0)
    expect(offersPerProfessional.some((count) => count < serviceRows.length)).toBe(true)
  })

  it('gives every professional working hours with a lunch break on some day', async () => {
    const [professionalRows, intervalRows] = await Promise.all([professionals(), intervals()])
    expect(professionalRows.length).toBeGreaterThan(0)

    const withoutLunch = professionalRows.filter((p) => {
      const perDay = new Map<number, number>()
      for (const i of intervalRows.filter((i) => i.professional_id === p.id)) {
        perDay.set(i.weekday, (perDay.get(i.weekday) ?? 0) + 1)
      }
      return ![...perDay.values()].some((count) => count >= 2)
    })
    expect(withoutLunch.map((p) => p.id)).toEqual([])
  })

  it('keeps working intervals on the 15-minute grid and never overlapping on the same day', async () => {
    const rows = await intervals()
    expect(rows.length).toBeGreaterThan(0)

    expect(rows.filter((i) => i.start_min % 15 !== 0 || i.end_min % 15 !== 0)).toEqual([])

    const overlapping = rows.filter((a) =>
      rows.some(
        (b) =>
          a !== b &&
          a.professional_id === b.professional_id &&
          a.weekday === b.weekday &&
          a.start_min < b.end_min &&
          b.start_min < a.end_min,
      ),
    )
    expect(overlapping).toEqual([])
  })

  it('fits every offered service inside one working interval of the professional', async () => {
    const [serviceRows, offerRows, intervalRows] = await Promise.all([services(), offers(), intervals()])
    expect(offerRows.length).toBeGreaterThan(0)
    const duration = new Map(serviceRows.map((s) => [s.id, s.duration_min]))

    const misfits = offerRows.filter((o) => {
      const longest = Math.max(
        0,
        ...intervalRows.filter((i) => i.professional_id === o.professional_id).map((i) => i.end_min - i.start_min),
      )
      return longest < (duration.get(o.service_id) ?? Infinity)
    })
    expect(misfits).toEqual([])
  })

  it('closes the whole shop for at least one full local day (a holiday)', async () => {
    const rows = await sql<{ reason: string }[]>`
      select reason from closures
      where professional_id is null
        and (starts_at at time zone 'America/Sao_Paulo')::time = '00:00'
        and ends_at - starts_at >= interval '1 day'
    `
    expect(rows.length).toBeGreaterThan(0)
  })
})
