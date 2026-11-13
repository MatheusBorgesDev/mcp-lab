// Shop time on the page: the same helpers the server uses (pure functions, no Node APIs).
import { SHOP_RULES } from '../../server/domain/rules.js'
import { addDays, formatZoned, toZoned, weekdayOf, zonedToInstant, type LocalDate } from '../../server/domain/time.js'

export { addDays, weekdayOf, type LocalDate }

export const SHOP_TIME_ZONE = SHOP_RULES.timeZone
export const SLOT_MINUTES = SHOP_RULES.slotMinutes
export const MAX_DAYS_AHEAD = SHOP_RULES.maxDaysAhead

export const shopTime = (instant: Date) => toZoned(instant, SHOP_TIME_ZONE)

/** "17:31:07", shop time. */
export const clockWithSeconds = (instant: Date) => formatZoned(instant, SHOP_TIME_ZONE).slice(11, 19)

/** The instants where a shop day starts and ends. */
export const dayRange = (date: LocalDate) => ({
  from: zonedToInstant(date, 0, SHOP_TIME_ZONE),
  to: zonedToInstant(addDays(date, 1), 0, SHOP_TIME_ZONE),
})

/** "17h", "17h30", as a barber says it. */
export function hourLabel(minutes: number): string {
  const h = Math.floor(minutes / 60)
  const m = minutes % 60
  return m === 0 ? `${h}h` : `${h}h${String(m).padStart(2, '0')}`
}

/** "17:30", for clocks and the inspector. */
export const clockLabel = (minutes: number) =>
  `${String(Math.floor(minutes / 60)).padStart(2, '0')}:${String(minutes % 60).padStart(2, '0')}`

const WEEKDAY = ['dom', 'seg', 'ter', 'qua', 'qui', 'sex', 'sáb']

/** "Hoje", "Amanhã" or "sex 14". */
export function dayLabel(date: LocalDate, today: LocalDate): string {
  if (date === today) return 'Hoje'
  if (date === addDays(today, 1)) return 'Amanhã'
  return `${WEEKDAY[weekdayOf(date)]} ${Number(date.slice(8, 10))}`
}

/** "quinta, 12 de novembro". */
export function longDate(date: LocalDate): string {
  return new Intl.DateTimeFormat('pt-BR', { timeZone: 'UTC', weekday: 'long', day: 'numeric', month: 'long' })
    .format(new Date(`${date}T12:00:00Z`))
    .replace('-feira', '')
}
