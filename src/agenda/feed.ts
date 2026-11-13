import type { Catalog } from '../data/catalog'
import { addDays, clockLabel, hourLabel, shopTime } from './time'
import type { Appointment } from './types'

export type FeedEntry = { key: string; time: string; text: string }

/** "às 17h", "amanhã às 9h30", "qui, 19/11 às 10h", relative to the day of `now`. */
function when(start: Date, now: Date): string {
  const local = shopTime(start)
  const today = shopTime(now).date
  const hour = `às ${hourLabel(local.minutes)}`
  if (local.date === today) return hour
  if (local.date === addDays(today, 1)) return `amanhã ${hour}`
  const weekday = ['dom', 'seg', 'ter', 'qua', 'qui', 'sex', 'sáb'][local.weekday]
  return `${weekday}, ${local.date.slice(8, 10)}/${local.date.slice(5, 7)} ${hour}`
}

/** One line of the agenda feed for a broadcast change, or null when there is nothing to tell. */
export function feedEntry(input: {
  op: 'insert' | 'update' | 'delete'
  appointment: Appointment
  catalog: Catalog
  now: Date
  /** The broadcast's own id: two changes may arrive in the same millisecond. */
  messageId?: string
}): FeedEntry | null {
  const { op, appointment: a, catalog, now, messageId } = input
  const service = catalog.services.find((s) => s.id === a.serviceId)?.name ?? 'um horário'
  const barber = catalog.professionals.find((p) => p.id === a.professionalId)?.name ?? 'a equipe'
  const what = `${service} com o ${barber}`

  let text: string | null = null
  if (op === 'insert' && a.status === 'confirmed') text = `${a.alias} marcou ${what} ${when(a.startsAt, now)}`
  else if (op === 'update' && a.status === 'cancelled') text = `${a.alias} cancelou ${what} ${when(a.startsAt, now)}`
  else if (op === 'update' && a.status === 'confirmed') {
    const moment = when(a.startsAt, now)
    text = `${a.alias} remarcou ${what} para ${moment.startsWith('às') ? `as${moment.slice(2)}` : moment}`
  }
  const key = messageId ?? `${a.id}:${op}:${now.getTime()}`
  return text ? { key, time: clockLabel(shopTime(now).minutes), text } : null
}
