import type { Catalog } from '../data/catalog'
import { dayRange, shopTime, weekdayOf, type LocalDate } from './time'
import type { Appointment, Closure } from './types'

export type Block = { startMin: number; endMin: number; kind: 'break' | 'outside' | 'off' | 'closed'; label: string }
export type Flash = 'new' | 'freed'
export type Slot = { key: string; id: string; startMin: number; endMin: number; alias: string; service: string; flash?: Flash }

/** An appointment on the agenda; `key` and `flash` mark a time that just changed (see reducer.ts). */
export type AgendaItem = Appointment & { key?: string; flash?: Flash }
export type Column = {
  professional: { id: string; name: string }
  /** From the first opening to the last closing of this barber that day; null on a day off. */
  span: { startMin: number; endMin: number } | null
  blocks: Block[]
  slots: Slot[]
}

export type DayLayout = {
  date: LocalDate
  /** The visible window, in minutes since local midnight, whole hours. */
  startMin: number
  endMin: number
  hours: number[]
  columns: Column[]
  /** The "now" line, when the day is today and now is inside the window. */
  now: number | null
  /** The reason the whole shop is closed that day, if it is. */
  closed: string | null
}

const DEFAULT_WINDOW = { startMin: 9 * 60, endMin: 19 * 60 }

/** Minutes since the day's local midnight, clipped to the day (a closure may span several days). */
function minutesInDay(instant: Date, date: LocalDate): number {
  const { from, to } = dayRange(date)
  if (instant <= from) return 0
  if (instant >= to) return 24 * 60
  const local = shopTime(instant)
  return local.minutes
}

const clip = (block: Block, start: number, end: number): Block | null => {
  const startMin = Math.max(block.startMin, start)
  const endMin = Math.min(block.endMin, end)
  return endMin > startMin ? { ...block, startMin, endMin } : null
}

/** One day of the shop as the agenda draws it: a column per barber, with breaks, closures and taken times. */
export function dayLayout(input: {
  date: LocalDate
  catalog: Catalog
  appointments: readonly AgendaItem[]
  closures: readonly Closure[]
  now: Date
}): DayLayout {
  const { date, catalog, appointments, closures, now } = input
  const weekday = weekdayOf(date)
  const { from, to } = dayRange(date)
  const hoursOf = (id: string) =>
    catalog.professionals.find((p) => p.id === id)?.hours.filter((h) => h.weekday === weekday) ?? []

  const intervals = catalog.professionals.flatMap((p) => hoursOf(p.id))
  const startMin = intervals.length ? Math.floor(Math.min(...intervals.map((i) => i.startMin)) / 60) * 60 : DEFAULT_WINDOW.startMin
  const endMin = intervals.length ? Math.ceil(Math.max(...intervals.map((i) => i.endMin)) / 60) * 60 : DEFAULT_WINDOW.endMin

  const dayClosures = closures.filter((c) => c.startsAt < to && c.endsAt > from)
  const shopClosure = dayClosures.find((c) => c.professionalId === null && c.startsAt <= from && c.endsAt >= to)
  const closed = intervals.length === 0 ? 'Fechado' : shopClosure ? (shopClosure.reason ?? 'Fechado') : null
  const serviceName = new Map(catalog.services.map((s) => [s.id, s.name]))

  const columns = catalog.professionals.map((p): Column => {
    const own = hoursOf(p.id)
    const blocks: Block[] = []
    if (own.length === 0) {
      blocks.push({ startMin, endMin, kind: 'off', label: 'folga' })
    } else {
      let cursor = startMin
      own.forEach((interval, index) => {
        if (interval.startMin > cursor) {
          const kind = index === 0 ? 'outside' : 'break'
          blocks.push({ startMin: cursor, endMin: interval.startMin, kind, label: kind === 'break' ? 'pausa' : '' })
        }
        cursor = Math.max(cursor, interval.endMin)
      })
      if (cursor < endMin) blocks.push({ startMin: cursor, endMin, kind: 'outside', label: '' })
    }
    for (const c of dayClosures.filter((c) => c.professionalId === null || c.professionalId === p.id)) {
      const block = clip(
        { startMin: minutesInDay(c.startsAt, date), endMin: minutesInDay(c.endsAt, date), kind: 'closed', label: c.reason ?? 'fechado' },
        startMin,
        endMin,
      )
      if (block) blocks.push(block)
    }

    const slots = appointments
      .filter((a) => a.professionalId === p.id && a.status !== 'cancelled' && a.startsAt >= from && a.startsAt < to)
      .sort((a, b) => a.startsAt.getTime() - b.startsAt.getTime())
      .map((a): Slot => ({
        key: a.key ?? a.id,
        id: a.id,
        startMin: minutesInDay(a.startsAt, date),
        endMin: minutesInDay(a.endsAt, date),
        alias: a.alias,
        service: serviceName.get(a.serviceId) ?? a.serviceId,
        ...(a.flash && { flash: a.flash }),
      }))

    const span = own.length ? { startMin: own[0]!.startMin, endMin: own.at(-1)!.endMin } : null
    return { professional: { id: p.id, name: p.name }, span, blocks, slots }
  })

  const local = shopTime(now)
  const nowMin = local.date === date && local.minutes >= startMin && local.minutes <= endMin ? local.minutes : null
  const hours: number[] = []
  for (let h = startMin; h < endMin; h += 60) hours.push(h)

  return { date, startMin, endMin, hours, columns, now: nowMin, closed }
}
