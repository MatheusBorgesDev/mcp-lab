import { randomUUID } from 'node:crypto'
import type { CallToolResult, McpServer, ServerContext, ToolAnnotations } from '@modelcontextprotocol/server'
import { getPublicOrigin } from 'mcp-handler'
import type { z } from 'zod'
import type { Barbershop } from '../app/barbershop.js'
import { formatZoned } from '../domain/time.js'
import type { Visitor } from '../security/ip.js'
import type { CallKind, RateLimiter } from '../security/rate-limit.js'
import { clientLabel } from '../events/client-label.js'
import { booked, publicAppointment } from '../events/outcomes.js'
import { startTrace, type EventRow, type Trace } from '../events/trace.js'
import {
  appointmentView,
  failure,
  formatMinutes,
  formatPrice,
  invalidInput,
  rateLimited,
  startRanges,
  success,
  WEEKDAY_NAMES,
} from './format.js'
import { advertise, inputs } from './schemas.js'

/** Writes the inspector steps of one tool call (server/db/events.ts in production). */
export type EventSink = (rows: EventRow[]) => Promise<void>

export type ToolDeps = {
  shop: Barbershop
  events: EventSink
  /** Who a request comes from, for the per-visitor limits (server/security/ip.ts in production). */
  identifyVisitor: (request: Request | undefined) => Visitor
  /** Tool calls per visitor (server/security/rate-limit.ts). */
  rateLimit: RateLimiter
}

/**
 * The log line for an unexpected error: stack (type and message first) and code. Not the error's other
 * properties, which may hold secrets: Node's URL errors, for one, carry the whole connection string.
 */
export function describeError(error: unknown): string {
  if (!(error instanceof Error)) return `non-Error value thrown (${typeof error})`
  const code = (error as { code?: unknown }).code
  return `${error.stack ?? `${error.name}: ${error.message}`}${typeof code === 'string' ? ` [code ${code}]` : ''}`
}

type ToolConfig = { title: string; description: string; annotations: ToolAnnotations }

type Run<S extends z.ZodType> = (input: z.output<S>, ctx: ServerContext, trace: Trace) => Promise<CallToolResult>

/**
 * Registers a tool that checks the caller's rate limit, validates its arguments with `schema`, then runs. A
 * tool not marked read-only counts as a write. Unexpected errors (database down, a bug) are logged on the
 * server and reach the AI only as INTERNAL_ERROR, without internal details. Every call is traced for the
 * inspector and its steps written before the answer; a failure to write them is logged and never changes
 * the answer.
 */
function defineTool<S extends z.ZodType>(
  server: McpServer,
  { shop, events, identifyVisitor, rateLimit }: ToolDeps,
  name: string,
  config: ToolConfig,
  schema: S,
  run: Run<S>,
): void {
  const { timeZone } = shop.rules
  const kind: CallKind = config.annotations.readOnlyHint ? 'read' : 'write'

  async function record(trace: Trace): Promise<void> {
    try {
      await events(trace.rows())
    } catch (error) {
      console.error('[mcp] event log failed', describeError(error))
    }
  }

  async function execute(args: unknown, ctx: ServerContext, trace: Trace): Promise<CallToolResult> {
    try {
      const parsed = schema.safeParse(args ?? {})
      trace.checked([{ rule: 'input', passed: parsed.success }])
      const result = parsed.success ? await run(parsed.data, ctx, trace) : invalidInput(parsed.error, timeZone)
      trace.responded(result)
      return result
    } catch (error) {
      console.error('[mcp] tool failed', describeError(error))
      trace.failed()
      return failure({ code: 'INTERNAL_ERROR', message: 'Something went wrong on our side. Try again shortly.' }, timeZone)
    }
  }

  server.registerTool(name, { ...config, inputSchema: advertise(schema) }, async (args: unknown, ctx: ServerContext) => {
    const hints = {
      // A per-request server: the SDK fills it from the request's _meta envelope (2026-07-28 clients).
      clientInfo: server.server.getClientVersion(),
      userAgent: ctx.http?.req?.headers.get('user-agent'),
    }
    const visitor = identifyVisitor(ctx.http?.req)
    // TEMPORARY (phase 3, step 6): what each client declares, to fix the label of claude.ai's calls. No address,
    // only whether it is an AI platform's. Remove once the label is fixed.
    console.info('[mcp] client hints', JSON.stringify({ ...hints, platform: visitor.shared }))
    const trace = startTrace({ requestId: randomUUID(), toolName: name, args, clientLabel: clientLabel(hints) })
    const verdict = await rateLimit(visitor, kind)
    trace.checked([{ rule: 'rate_limit', passed: verdict.allowed }])
    if (!verdict.allowed) {
      const refused = rateLimited(verdict.retryAfterSec)
      trace.responded(refused)
      // Only the first refusal of a window reaches the public inspector: a script cannot flood it.
      if (verdict.firstRefusal) await record(trace)
      return refused
    }
    const result = await execute(args, ctx, trace)
    await record(trace)
    return result
  })
}

export function registerReadTools(server: McpServer, deps: ToolDeps): void {
  const { shop } = deps
  const { timeZone, slotMinutes } = shop.rules

  defineTool(
    server,
    deps,
    'list_services',
    {
      title: 'List services',
      description: 'Lists the services of MCP Barber Shop with duration, price in BRL and the professionals who do each one.',
      annotations: { readOnlyHint: true, openWorldHint: false },
    },
    inputs.list_services,
    async (_input, _ctx, trace) => {
      const catalog = await shop.catalog()
      const professionals = catalog.professionals.filter((p) => p.active)
      const services = catalog.services
        .filter((s) => s.active)
        .map((s) => ({
          id: s.id,
          name: s.name,
          description: s.description,
          duration_min: s.durationMin,
          price: formatPrice(s.priceCents),
          price_cents: s.priceCents,
          professionals: professionals
            .filter((p) => p.serviceIds.includes(s.id))
            .map((p) => ({ id: p.id, name: p.name })),
        }))
      trace.processed({ kind: 'services', count: services.length })
      const text = services.map((s) => `${s.name} (${s.id}): ${s.duration_min} min, ${s.price}`).join('\n')
      return success(`${services.length} services:\n${text}`, { services, currency: 'BRL' })
    },
  )

  defineTool(
    server,
    deps,
    'list_professionals',
    {
      title: 'List professionals',
      description: 'Lists the professionals with the services each one does and their weekly working hours (shop time).',
      annotations: { readOnlyHint: true, openWorldHint: false },
    },
    inputs.list_professionals,
    async (_input, _ctx, trace) => {
      const catalog = await shop.catalog()
      const serviceNames = new Map(catalog.services.filter((s) => s.active).map((s) => [s.id, s.name]))
      const professionals = catalog.professionals
        .filter((p) => p.active)
        .map((p) => {
          const workingHours: Record<string, string[]> = {}
          for (const interval of catalog.workingHours.filter((w) => w.professionalId === p.id)) {
            const day = WEEKDAY_NAMES[interval.weekday] ?? String(interval.weekday)
            ;(workingHours[day] ??= []).push(`${formatMinutes(interval.startMin)}-${formatMinutes(interval.endMin)}`)
          }
          return {
            id: p.id,
            name: p.name,
            bio: p.bio,
            services: p.serviceIds.flatMap((id) => {
              const name = serviceNames.get(id)
              return name ? [{ id, name }] : []
            }),
            working_hours: workingHours,
          }
        })
      trace.processed({ kind: 'professionals', count: professionals.length })
      const text = professionals
        .map((p) => `${p.name} (${p.id}): ${p.services.map((s) => s.name).join(', ')}`)
        .join('\n')
      return success(`${professionals.length} professionals:\n${text}`, { professionals, time_zone: timeZone })
    },
  )

  defineTool(
    server,
    deps,
    'check_availability',
    {
      title: 'Check availability',
      description:
        'Free start times for a service on one day, per professional who does it (or only the chosen one). ' +
        'Times are ISO 8601 in shop time. A day can be empty because of a day off or a holiday (see closures), ' +
        'or because it is full for new bookings (day_full).',
      annotations: { readOnlyHint: true, openWorldHint: false },
    },
    inputs.check_availability,
    async (input, _ctx, trace) => {
      const result = await shop.checkAvailability({
        serviceId: input.service_id,
        date: input.date,
        ...(input.professional_id === undefined ? {} : { professionalId: input.professional_id }),
      })
      if (!result.ok) return failure(result.error, timeZone)

      const { service, professionals, closures, date, dayFull } = result.value
      trace.processed({
        kind: 'availability',
        date,
        service_id: service.id,
        professionals: professionals.map(({ professional, starts }) => ({ id: professional.id, free: starts.length })),
      })
      const structured = {
        date,
        time_zone: timeZone,
        service: {
          id: service.id,
          name: service.name,
          duration_min: service.durationMin,
          price: formatPrice(service.priceCents),
        },
        professionals: professionals.map(({ professional, starts }) => ({
          id: professional.id,
          name: professional.name,
          free_starts: starts.map((s) => formatZoned(s, timeZone)),
        })),
        closures: closures.map((c) => ({
          professional_id: c.professionalId,
          reason: c.reason,
          start: formatZoned(c.startsAt, timeZone),
          end: formatZoned(c.endsAt, timeZone),
        })),
        day_full: dayFull,
      }
      const lines = professionals.map(
        ({ professional, starts }) => `${professional.name}: ${startRanges(starts, timeZone, slotMinutes)}`,
      )
      const closed = closures.map((c) => `Closed: ${c.reason ?? 'closure'}`)
      const full = dayFull
        ? [`${date} is full for new bookings: the shop keeps ${100 - shop.rules.maxDailyOccupancyPercent}% of each day free. Try another day.`]
        : []
      return success(
        [`Free start times on ${date} for ${service.name} (${service.durationMin} min):`, ...lines, ...closed, ...full].join('\n'),
        structured,
      )
    },
  )

  defineTool(
    server,
    deps,
    'get_appointment',
    {
      title: 'Get appointment',
      description: 'Looks up an appointment by its booking code.',
      annotations: { readOnlyHint: true, openWorldHint: false },
    },
    inputs.get_appointment,
    async (input, _ctx, trace) => {
      const result = await shop.getAppointment(input.code)
      trace.checked([{ rule: 'appointment_exists', passed: result.ok }])
      if (!result.ok) return failure(result.error, timeZone)

      trace.processed({ kind: 'appointment', appointment: publicAppointment(result.value) })
      const appointment = appointmentView(result.value, timeZone)
      return success(
        `${appointment.service.name} with ${appointment.professional.name}, ${appointment.start} ` +
          `(${appointment.status}).`,
        { appointment },
      )
    },
  )
}

/**
 * Origin of the public page. In production, Vercel's own variable gives the stable domain; elsewhere (pnpm dev,
 * tests) the origin of the request is used.
 */
export function publicOrigin(ctx: ServerContext): string {
  const productionHost = process.env.VERCEL_PROJECT_PRODUCTION_URL
  const request = ctx.http?.req
  return productionHost ? `https://${productionHost}` : request ? getPublicOrigin(request) : 'http://localhost:5173'
}

/** Link to the public page with the appointment highlighted. */
function watchUrl(appointmentId: string, ctx: ServerContext): string {
  return `${publicOrigin(ctx)}/?appointment=${encodeURIComponent(appointmentId)}`
}

export function registerWriteTools(server: McpServer, deps: ToolDeps): void {
  const { shop, identifyVisitor } = deps
  const { timeZone } = shop.rules

  defineTool(
    server,
    deps,
    'book_appointment',
    {
      title: 'Book appointment',
      description:
        'Books a service at a start time from check_availability. Without professional_id the shop picks a free ' +
        'professional who does the service. Returns the booking code: show it to the user and ask them to keep it.',
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: false },
    },
    inputs.book_appointment,
    async (input, ctx, trace) => {
      const result = await shop.book({
        serviceId: input.service_id,
        start: new Date(input.start),
        ...(input.professional_id === undefined ? {} : { professionalId: input.professional_id }),
        ...(input.client_name === undefined ? {} : { clientName: input.client_name }),
        visitor: identifyVisitor(ctx.http?.req),
      })
      trace.checked(result.checks)
      if (!result.ok) return failure(result.error, timeZone)

      const { code, appointment } = result.value
      trace.processed(booked(appointment, code))
      const view = appointmentView(appointment, timeZone)
      const watch_url = watchUrl(appointment.id, ctx)
      return success(
        `Booked ${view.service.name} with ${view.professional.name} at ${view.start}. ` +
          `Booking code: ${code} (the user must keep it to view, reschedule or cancel). Live agenda: ${watch_url}`,
        { code, appointment: view, watch_url },
      )
    },
  )

  defineTool(
    server,
    deps,
    'reschedule_appointment',
    {
      title: 'Reschedule appointment',
      description:
        'Moves an appointment to a new start time, identified by its booking code. Keeps the professional unless ' +
        'professional_id is given. Allowed up to 2 hours before the current start.',
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: false },
    },
    inputs.reschedule_appointment,
    async (input, ctx, trace) => {
      const result = await shop.reschedule({
        code: input.code,
        newStart: new Date(input.new_start),
        ...(input.professional_id === undefined ? {} : { professionalId: input.professional_id }),
      })
      trace.checked(result.checks)
      if (!result.ok) return failure(result.error, timeZone)

      trace.processed({ kind: 'rescheduled', appointment: publicAppointment(result.value) })
      const view = appointmentView(result.value, timeZone)
      const watch_url = watchUrl(result.value.id, ctx)
      return success(
        `Rescheduled: ${view.service.name} with ${view.professional.name} at ${view.start}. The booking code stays the same.`,
        { appointment: view, watch_url },
      )
    },
  )

  defineTool(
    server,
    deps,
    'cancel_appointment',
    {
      title: 'Cancel appointment',
      description:
        'Cancels an appointment identified by its booking code, freeing the time. Allowed up to 2 hours before ' +
        'the start. Cancelling twice is harmless.',
      annotations: { readOnlyHint: false, destructiveHint: true, idempotentHint: true, openWorldHint: false },
    },
    inputs.cancel_appointment,
    async (input, _ctx, trace) => {
      const result = await shop.cancel(input.code)
      trace.checked(result.checks)
      if (!result.ok) return failure(result.error, timeZone)

      const { appointment, alreadyCancelled } = result.value
      trace.processed({
        kind: 'cancelled',
        appointment: publicAppointment(appointment),
        already_cancelled: alreadyCancelled,
      })
      const view = appointmentView(appointment, timeZone)
      return success(
        alreadyCancelled
          ? `This appointment was already cancelled (${view.service.name}, ${view.start}).`
          : `Cancelled ${view.service.name} with ${view.professional.name} at ${view.start}. The time is free again.`,
        { appointment: view, already_cancelled: alreadyCancelled },
      )
    },
  )
}
