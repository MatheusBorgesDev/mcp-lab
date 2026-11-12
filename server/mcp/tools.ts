import type { CallToolResult, McpServer, ServerContext } from '@modelcontextprotocol/server'
import type { z } from 'zod'
import type { Barbershop } from '../app/barbershop.js'
import { formatZoned } from '../domain/time.js'
import {
  appointmentView,
  failure,
  formatMinutes,
  formatPrice,
  invalidInput,
  startRanges,
  success,
  WEEKDAY_NAMES,
} from './format.js'
import { advertise, inputs } from './schemas.js'

export type ToolDeps = { shop: Barbershop }

/**
 * Validates the arguments with `schema`, then runs the tool. Unexpected errors (database down, a bug) are
 * logged on the server and reach the AI only as INTERNAL_ERROR, without internal details.
 */
function tool<S extends z.ZodType>(
  schema: S,
  timeZone: string,
  run: (input: z.output<S>, ctx: ServerContext) => Promise<CallToolResult>,
) {
  return async (args: unknown, ctx: ServerContext): Promise<CallToolResult> => {
    try {
      const parsed = schema.safeParse(args ?? {})
      if (!parsed.success) return invalidInput(parsed.error, timeZone)
      return await run(parsed.data, ctx)
    } catch (error) {
      console.error('[mcp] tool failed', error)
      return failure({ code: 'INTERNAL_ERROR', message: 'Something went wrong on our side. Try again shortly.' }, timeZone)
    }
  }
}

export function registerReadTools(server: McpServer, { shop }: ToolDeps): void {
  const { timeZone, slotMinutes } = shop.rules

  server.registerTool(
    'list_services',
    {
      title: 'List services',
      description: 'Lists the services of MCP Barber Shop with duration, price in BRL and the professionals who do each one.',
      inputSchema: advertise(inputs.list_services),
      annotations: { readOnlyHint: true, openWorldHint: false },
    },
    tool(inputs.list_services, timeZone, async () => {
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
      const text = services.map((s) => `${s.name} (${s.id}): ${s.duration_min} min, ${s.price}`).join('\n')
      return success(`${services.length} services:\n${text}`, { services, currency: 'BRL' })
    }),
  )

  server.registerTool(
    'list_professionals',
    {
      title: 'List professionals',
      description: 'Lists the professionals with the services each one does and their weekly working hours (shop time).',
      inputSchema: advertise(inputs.list_professionals),
      annotations: { readOnlyHint: true, openWorldHint: false },
    },
    tool(inputs.list_professionals, timeZone, async () => {
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
      const text = professionals
        .map((p) => `${p.name} (${p.id}): ${p.services.map((s) => s.name).join(', ')}`)
        .join('\n')
      return success(`${professionals.length} professionals:\n${text}`, { professionals, time_zone: timeZone })
    }),
  )

  server.registerTool(
    'check_availability',
    {
      title: 'Check availability',
      description:
        'Free start times for a service on one day, per professional who does it (or only the chosen one). ' +
        'Times are ISO 8601 in shop time. A day can be empty because of a day off or a holiday (see closures).',
      inputSchema: advertise(inputs.check_availability),
      annotations: { readOnlyHint: true, openWorldHint: false },
    },
    tool(inputs.check_availability, timeZone, async (input) => {
      const result = await shop.checkAvailability({
        serviceId: input.service_id,
        date: input.date,
        ...(input.professional_id === undefined ? {} : { professionalId: input.professional_id }),
      })
      if (!result.ok) return failure(result.error, timeZone)

      const { service, professionals, closures, date } = result.value
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
      }
      const lines = professionals.map(
        ({ professional, starts }) => `${professional.name}: ${startRanges(starts, timeZone, slotMinutes)}`,
      )
      const closed = closures.map((c) => `Closed: ${c.reason ?? 'closure'}`)
      return success(
        [`Free start times on ${date} for ${service.name} (${service.durationMin} min):`, ...lines, ...closed].join('\n'),
        structured,
      )
    }),
  )

  server.registerTool(
    'get_appointment',
    {
      title: 'Get appointment',
      description: 'Looks up an appointment by its booking code.',
      inputSchema: advertise(inputs.get_appointment),
      annotations: { readOnlyHint: true, openWorldHint: false },
    },
    tool(inputs.get_appointment, timeZone, async (input) => {
      const result = await shop.getAppointment(input.code)
      if (!result.ok) return failure(result.error, timeZone)
      const appointment = appointmentView(result.value, timeZone)
      return success(
        `${appointment.service.name} with ${appointment.professional.name}, ${appointment.start} ` +
          `(${appointment.status}).`,
        { appointment },
      )
    }),
  )
}
