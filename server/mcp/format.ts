import type { CallToolResult } from '@modelcontextprotocol/server'
import type { z } from 'zod'
import type { Appointment } from '../db/appointments.js'
import type { DomainError } from '../domain/result.js'
import { formatZoned, toZoned } from '../domain/time.js'

const brl = new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' })

/** "R$ 50,00", with a plain space (Intl puts a no-break space after the symbol). */
export const formatPrice = (cents: number) => brl.format(cents / 100).replace(/\s/g, ' ')

const pad = (value: number) => String(value).padStart(2, '0')

export const formatMinutes = (minutes: number) => `${pad(Math.floor(minutes / 60))}:${pad(minutes % 60)}`

export const WEEKDAY_NAMES = ['sunday', 'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday'] as const

/** Consecutive starts as ranges of start times, e.g. "09:00-11:30, 13:00-17:30", for the readable text. */
export function startRanges(starts: readonly Date[], timeZone: string, stepMinutes: number): string {
  if (starts.length === 0) return 'none'
  const ranges: Array<[Date, Date]> = []
  for (const start of starts) {
    const last = ranges.at(-1)
    if (last && start.getTime() - last[1].getTime() === stepMinutes * 60_000) last[1] = start
    else ranges.push([start, start])
  }
  const hhmm = (d: Date) => formatMinutes(toZoned(d, timeZone).minutes)
  return ranges.map(([from, to]) => (from === to ? hhmm(from) : `${hhmm(from)}-${hhmm(to)}`)).join(', ')
}

export function appointmentView(appointment: Appointment, timeZone: string) {
  return {
    id: appointment.id,
    status: appointment.status,
    start: formatZoned(appointment.startsAt, timeZone),
    end: formatZoned(appointment.endsAt, timeZone),
    service: {
      id: appointment.service.id,
      name: appointment.service.name,
      duration_min: appointment.service.durationMin,
      price: formatPrice(appointment.service.priceCents),
    },
    professional: appointment.professional,
    public_alias: appointment.publicAlias,
  }
}

export function success(text: string, structured: Record<string, unknown>): CallToolResult {
  return { content: [{ type: 'text', text }], structuredContent: structured }
}

export function failure(error: DomainError, timeZone: string): CallToolResult {
  const suggestions = error.suggestions?.map((s) => ({
    start: formatZoned(s.startsAt, timeZone),
    professional_id: s.professionalId,
    professional_name: s.professionalName,
  }))
  const text = suggestions?.length
    ? `${error.code}: ${error.message} Nearest free times: ${suggestions
        .map((s) => `${s.start} with ${s.professional_name}`)
        .join('; ')}.`
    : `${error.code}: ${error.message}`
  return {
    isError: true,
    content: [{ type: 'text', text }],
    structuredContent: suggestions ? { code: error.code, message: error.message, suggestions } : { ...error },
  }
}

export function invalidInput(error: z.ZodError, timeZone: string): CallToolResult {
  const details = error.issues
    .map((issue) => `${issue.path.length > 0 ? issue.path.join('.') : 'input'}: ${issue.message}`)
    .join('; ')
  return failure({ code: 'INVALID_INPUT', message: details }, timeZone)
}
