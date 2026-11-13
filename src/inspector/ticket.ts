import * as z from 'zod/mini'
import { clockLabel, clockWithSeconds, shopTime } from '../agenda/time'
import type { Call, EventRow, Step } from './calls'

export type TicketStep = {
  step: Step
  label: string
  text: string
  /** False when the step reports a refusal or an error (red mark). */
  ok: boolean
  checks?: Array<{ label: string; passed: boolean }>
  /** Time since the call was received. */
  durationMs: number
}

export type TicketView = { requestId: string; tool: string; client: string; meta: string; steps: TicketStep[] }

const LABEL: Record<Step, string> = {
  received: 'recebida',
  validated: 'validada',
  processed: 'processada',
  responded: 'respondida',
  error: 'erro',
}

const RULE: Record<string, string> = {
  rate_limit: 'limite de chamadas',
  input: 'entrada válida',
  appointment_exists: 'código existe',
  change_window: 'até 2 h antes',
  service_exists: 'serviço existe',
  professional_exists: 'barbeiro existe',
  professional_offers_service: 'faz o serviço',
  on_slot_grid: 'de 15 em 15 min',
  min_advance: '2 h de antecedência',
  max_days_ahead: 'até 14 dias',
  within_working_hours: 'no expediente',
  slot_free: 'horário livre',
  visitor_bookings: 'até 2 por visitante',
  daily_capacity: 'dia até 70%',
}

const REFUSAL: Record<string, string> = {
  SLOT_UNAVAILABLE: 'conflito',
  TOO_SOON: 'em cima da hora',
  TOO_FAR_AHEAD: 'longe demais',
  OUTSIDE_WORKING_HOURS: 'fora do expediente',
  CHANGE_WINDOW_PASSED: 'passou do prazo de 2 h',
  APPOINTMENT_NOT_FOUND: 'código não encontrado',
  SERVICE_NOT_FOUND: 'serviço não existe',
  PROFESSIONAL_NOT_FOUND: 'barbeiro não existe',
  PROFESSIONAL_DOES_NOT_OFFER_SERVICE: 'não faz o serviço',
  BOOKING_LIMIT_REACHED: 'limite de reservas',
  DAILY_CAPACITY_REACHED: 'dia lotado',
  RATE_LIMITED: 'muitas chamadas',
}

const UNKNOWN = '—'

// The order a person reads a request in. jsonb stores keys shortest first, so the stored order is not it.
const ARG_ORDER = ['service_id', 'professional_id', 'date', 'start', 'code', 'new_start']
const argRank = (key: string) => (ARG_ORDER.includes(key) ? ARG_ORDER.indexOf(key) : ARG_ORDER.length)
const plural = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`

/** "16:00" on the day of `now`, "19/11 10:30" on another day (shop time). */
function moment(iso: string, now: Date): string {
  const at = new Date(iso)
  if (Number.isNaN(at.getTime())) return iso
  const local = shopTime(at)
  const time = clockLabel(local.minutes)
  return local.date === shopTime(now).date ? time : `${local.date.slice(8, 10)}/${local.date.slice(5, 7)} ${time}`
}

const received = z.object({
  args: z.record(z.string(), z.string()),
  redacted: z.optional(z.array(z.string())),
  dropped: z.optional(z.number()),
})
const validated = z.object({ checks: z.array(z.object({ rule: z.string(), passed: z.boolean() })) })
const responded = z.object({ is_error: z.boolean(), code: z.optional(z.string()) })
const failed = z.object({ code: z.string() })
const startsAt = z.object({ starts_at: z.string() })
const processed = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('services'), count: z.number() }),
  z.object({ kind: z.literal('professionals'), count: z.number() }),
  z.object({ kind: z.literal('availability'), professionals: z.array(z.object({ free: z.number() })) }),
  z.object({ kind: z.literal('appointment'), appointment: z.object({ public_alias: z.string(), starts_at: z.string() }) }),
  z.object({ kind: z.literal('booked'), code: z.string() }),
  z.object({ kind: z.literal('rescheduled'), appointment: startsAt }),
  z.object({ kind: z.literal('cancelled'), already_cancelled: z.boolean() }),
  z.object({
    kind: z.literal('refused'),
    code: z.string(),
    suggestions: z.optional(z.array(z.object({ start: z.string() }))),
  }),
])

function describe(row: EventRow, now: Date): Pick<TicketStep, 'text' | 'ok' | 'checks'> {
  const total = `${row.durationMs ?? 0} ms`
  switch (row.step) {
    case 'received': {
      const d = received.safeParse(row.detail)
      if (!d.success) return { text: UNKNOWN, ok: true }
      const parts = Object.entries(d.data.args)
        .sort(([a], [b]) => argRank(a) - argRank(b))
        .map(([key, value]) =>
        `${key} ${key === 'start' || key === 'new_start' ? moment(value, now) : value}`,
      )
      for (const key of d.data.redacted ?? []) parts.push(`${key} removido`)
      if (d.data.dropped) parts.push(plural(d.data.dropped, 'campo ignorado', 'campos ignorados'))
      return { text: parts.join(' · ') || 'sem argumentos', ok: true }
    }
    case 'validated': {
      const d = validated.safeParse(row.detail)
      if (!d.success) return { text: UNKNOWN, ok: true }
      const checks = d.data.checks.map((c) => ({ label: RULE[c.rule] ?? c.rule, passed: c.passed }))
      return { text: checks.map((c) => `${c.passed ? '✓' : '✗'} ${c.label}`).join(' · '), ok: checks.every((c) => c.passed), checks }
    }
    case 'processed': {
      const d = processed.safeParse(row.detail)
      if (!d.success) return { text: UNKNOWN, ok: true }
      const p = d.data
      switch (p.kind) {
        case 'services':
          return { text: plural(p.count, 'serviço', 'serviços'), ok: true }
        case 'professionals':
          return { text: plural(p.count, 'barbeiro', 'barbeiros'), ok: true }
        case 'availability': {
          const free = p.professionals.reduce((sum, x) => sum + x.free, 0)
          return { text: `${plural(p.professionals.length, 'barbeiro', 'barbeiros')} · ${plural(free, 'início livre', 'inícios livres')}`, ok: true }
        }
        case 'appointment':
          return { text: `encontrada · ${p.appointment.public_alias}, ${moment(p.appointment.starts_at, now)}`, ok: true }
        case 'booked':
          return { text: `reserva criada · ${p.code}`, ok: true }
        case 'rescheduled':
          return { text: `remarcada para ${moment(p.appointment.starts_at, now)}`, ok: true }
        case 'cancelled':
          return { text: p.already_cancelled ? 'já estava cancelada' : 'cancelada · horário liberado', ok: true }
        case 'refused': {
          const reason = REFUSAL[p.code] ?? p.code
          const times = p.suggestions?.map((s) => moment(s.start, now)) ?? []
          return { text: times.length ? `${reason} · sugere ${times.join(', ')}` : reason, ok: false }
        }
      }
      return { text: UNKNOWN, ok: true }
    }
    case 'responded': {
      const d = responded.safeParse(row.detail)
      if (!d.success) return { text: total, ok: true }
      return d.data.is_error ? { text: `${d.data.code ?? 'erro'} · ${total}`, ok: false } : { text: `ok · ${total}`, ok: true }
    }
    case 'error': {
      const d = failed.safeParse(row.detail)
      return { text: `${d.success ? d.data.code : 'erro'} · ${total}`, ok: false }
    }
  }
}

/** A tool call as a printed ticket: header, then one line per step, in words. */
export function ticketView(call: Call, now: Date): TicketView {
  return {
    requestId: call.requestId,
    tool: call.toolName,
    client: call.clientLabel,
    meta: `req ${call.requestId.slice(0, 4)} · ${clockWithSeconds(call.startedAt)}`,
    steps: call.steps.map((row) => ({ step: row.step, label: LABEL[row.step], durationMs: row.durationMs ?? 0, ...describe(row, now) })),
  }
}
