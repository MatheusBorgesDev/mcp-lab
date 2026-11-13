import type { Catalog } from '../data/catalog'
import { addDays, dayLabel, shopTime, weekdayOf, type LocalDate } from './time'

/** Today and the next `daysAhead` days on which some barber works, for the day picker. */
export function agendaDays(catalog: Catalog, now: Date, daysAhead: number): Array<{ date: LocalDate; label: string }> {
  const today = shopTime(now).date
  const workdays = new Set(catalog.professionals.flatMap((p) => p.hours.map((h) => h.weekday)))
  const days: Array<{ date: LocalDate; label: string }> = []
  for (let offset = 0; offset <= daysAhead; offset++) {
    const date = addDays(today, offset)
    if (workdays.has(weekdayOf(date))) days.push({ date, label: dayLabel(date, today) })
  }
  return days
}
