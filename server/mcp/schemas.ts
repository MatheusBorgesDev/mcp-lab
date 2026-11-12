import type { StandardSchemaWithJSON } from '@modelcontextprotocol/server'
import { z } from 'zod'
import { isCalendarDate } from '../domain/time.js'

// Tool inputs. Every field has a type, a format and a size limit; the descriptions are read by the AI.

const slug = z
  .string()
  .min(1)
  .max(40)
  .regex(/^[a-z0-9-]+$/, 'ids are lowercase slugs, like "corte-masculino"')

const localDate = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/, 'date must be YYYY-MM-DD')
  .refine(isCalendarDate, 'date does not exist')

const instant = z.iso.datetime({
  offset: true,
  message: 'must be ISO 8601 with a UTC offset, like 2026-11-20T14:00:00-03:00',
})

const code = z.string().min(1).max(32).describe('The booking code given when the appointment was made, like K7M2Q-9XH4T.')

const serviceId = slug.describe('Service id from list_services.')
const professionalId = slug.describe('Professional id from list_professionals. Omit to let the shop choose.')

export const inputs = {
  list_services: z.object({}),
  list_professionals: z.object({}),
  check_availability: z.object({
    service_id: serviceId,
    date: localDate.describe('Day to check, YYYY-MM-DD, in shop time (America/Sao_Paulo).'),
    professional_id: professionalId.optional(),
  }),
  get_appointment: z.object({ code }),
  book_appointment: z.object({
    service_id: serviceId,
    start: instant.describe('Start time, ISO 8601 with offset, on a 15-minute boundary. Take it from check_availability.'),
    professional_id: professionalId.optional(),
    client_name: z
      .string()
      .trim()
      .min(1)
      .max(60)
      .optional()
      .describe('Optional first name for the barber. Private: never shown on the public page.'),
  }),
  reschedule_appointment: z.object({
    code,
    new_start: instant.describe('New start time, ISO 8601 with offset, on a 15-minute boundary.'),
    professional_id: professionalId
      .optional()
      .describe('Professional id from list_professionals. Omit to keep the current professional.'),
  }),
  cancel_appointment: z.object({ code }),
}

/**
 * Advertises `schema` in tools/list but accepts every call, so the tool validates with the same schema and
 * answers INVALID_INPUT as structured content. When the SDK validates on its own, a failure comes back as
 * plain text only, without the error code the AI can rely on.
 */
export function advertise(schema: z.ZodType): StandardSchemaWithJSON {
  const standard = schema['~standard']
  return {
    '~standard': {
      version: 1,
      vendor: 'mcp-barber-shop',
      jsonSchema: standard.jsonSchema,
      validate: (value: unknown) => ({ value }),
    },
  }
}
