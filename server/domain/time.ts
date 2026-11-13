/** Calendar date in a time zone, as YYYY-MM-DD. */
export type LocalDate = string

export type ZonedParts = {
  date: LocalDate
  /** 0 = Sunday, like `working_hours.weekday`. */
  weekday: number
  /** Minutes since local midnight. */
  minutes: number
}

const MINUTE_MS = 60_000
const formatters = new Map<string, Intl.DateTimeFormat>()

function formatterFor(timeZone: string): Intl.DateTimeFormat {
  let formatter = formatters.get(timeZone)
  if (!formatter) {
    formatter = new Intl.DateTimeFormat('en-US', {
      timeZone,
      hourCycle: 'h23',
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
    })
    formatters.set(timeZone, formatter)
  }
  return formatter
}

function wallClock(instant: Date, timeZone: string) {
  const parts: Record<string, number> = {}
  for (const { type, value } of formatterFor(timeZone).formatToParts(instant)) {
    if (type !== 'literal') parts[type] = Number(value)
  }
  const { year = 0, month = 1, day = 1, hour = 0, minute = 0, second = 0 } = parts
  return { year, month, day, hour, minute, second }
}

/** Local time minus UTC, in minutes, at that instant (-180 in São Paulo). */
function offsetMinutes(instant: Date, timeZone: string): number {
  const { year, month, day, hour, minute, second } = wallClock(instant, timeZone)
  const asUtc = Date.UTC(year, month - 1, day, hour, minute, second)
  const truncated = Math.floor(instant.getTime() / 1000) * 1000
  return Math.round((asUtc - truncated) / MINUTE_MS)
}

function parseDate(date: LocalDate): [number, number, number] {
  const [year = 0, month = 1, day = 1] = date.split('-').map(Number)
  return [year, month, day]
}

const pad = (value: number, length = 2) => String(value).padStart(length, '0')

/** The instant of a local wall-clock time (`minutes` since midnight) on `date` in `timeZone`. */
export function zonedToInstant(date: LocalDate, minutes: number, timeZone: string): Date {
  const [year, month, day] = parseDate(date)
  const wallAsUtc = Date.UTC(year, month - 1, day, 0, minutes)
  // First guess with the offset at that UTC instant, then correct once if the offset differs there.
  const firstOffset = offsetMinutes(new Date(wallAsUtc), timeZone)
  const guess = wallAsUtc - firstOffset * MINUTE_MS
  const secondOffset = offsetMinutes(new Date(guess), timeZone)
  return new Date(wallAsUtc - secondOffset * MINUTE_MS)
}

export function toZoned(instant: Date, timeZone: string): ZonedParts {
  const { year, month, day, hour, minute } = wallClock(instant, timeZone)
  const date = `${pad(year, 4)}-${pad(month)}-${pad(day)}`
  return { date, weekday: weekdayOf(date), minutes: hour * 60 + minute }
}

/** ISO 8601 with the local offset, e.g. 2030-01-07T09:00:00-03:00. */
export function formatZoned(instant: Date, timeZone: string): string {
  const { year, month, day, hour, minute, second } = wallClock(instant, timeZone)
  const offset = offsetMinutes(instant, timeZone)
  const sign = offset < 0 ? '-' : '+'
  const abs = Math.abs(offset)
  return (
    `${pad(year, 4)}-${pad(month)}-${pad(day)}T${pad(hour)}:${pad(minute)}:${pad(second)}` +
    `${sign}${pad(Math.floor(abs / 60))}:${pad(abs % 60)}`
  )
}

export function weekdayOf(date: LocalDate): number {
  const [year, month, day] = parseDate(date)
  return new Date(Date.UTC(year, month - 1, day)).getUTCDay()
}

export function addDays(date: LocalDate, days: number): LocalDate {
  const [year, month, day] = parseDate(date)
  return new Date(Date.UTC(year, month - 1, day + days)).toISOString().slice(0, 10)
}

/** The instants a local date covers in `timeZone`: [from, to). */
export function dayBounds(date: LocalDate, timeZone: string): { from: Date; to: Date } {
  return { from: zonedToInstant(date, 0, timeZone), to: zonedToInstant(addDays(date, 1), 0, timeZone) }
}

export function addMinutes(instant: Date, minutes: number): Date {
  return new Date(instant.getTime() + minutes * MINUTE_MS)
}

/** True for a well-formed YYYY-MM-DD that exists in the calendar. Never throws. */
export function isCalendarDate(value: string): boolean {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value)
  if (!match) return false
  const [year, month, day] = [Number(match[1]), Number(match[2]), Number(match[3])]
  const date = new Date(Date.UTC(year, month - 1, day))
  return date.getUTCFullYear() === year && date.getUTCMonth() === month - 1 && date.getUTCDate() === day
}
