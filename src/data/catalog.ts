import type { SupabaseClient } from '@supabase/supabase-js'
import * as z from 'zod/mini'
import { formatWeekdays } from './format'

// Rows read by the page with the anon role (RLS: read-only). Validated: they are input from outside the page.
const service = z.object({
  id: z.string(),
  name: z.string(),
  description: z.nullable(z.string()),
  duration_min: z.number(),
  price_cents: z.number(),
  active: z.boolean(),
})
const professional = z.object({ id: z.string(), name: z.string(), bio: z.nullable(z.string()), active: z.boolean() })
const professionalService = z.object({ professional_id: z.string(), service_id: z.string() })
const time = z.string().check(z.regex(/^\d{2}:\d{2}(:\d{2})?$/))
const workingHour = z.object({ professional_id: z.string(), weekday: z.number(), start_time: time, end_time: time })

const rows = z.object({
  services: z.array(service),
  professionals: z.array(professional),
  professionalServices: z.array(professionalService),
  workingHours: z.array(workingHour),
})

export type Service = { id: string; name: string; description: string | null; durationMin: number; priceCents: number }

/** A working interval on a weekday (0 = Sunday), in minutes since midnight, shop time. */
export type WorkingInterval = { weekday: number; startMin: number; endMin: number }

export type Professional = {
  id: string
  name: string
  bio: string | null
  serviceIds: string[]
  hours: WorkingInterval[]
}

export type Catalog = { services: Service[]; professionals: Professional[] }

const minutes = (hhmm: string) => Number(hhmm.slice(0, 2)) * 60 + Number(hhmm.slice(3, 5))

/** The active services and professionals, each professional with the services they do and their hours. */
export function parseCatalog(raw: unknown): Catalog {
  const data = rows.parse(raw)
  const services = data.services
    .filter((s) => s.active)
    .map((s) => ({ id: s.id, name: s.name, description: s.description, durationMin: s.duration_min, priceCents: s.price_cents }))
  const offered = new Set(services.map((s) => s.id))
  const professionals = data.professionals
    .filter((p) => p.active)
    .map((p) => ({
      id: p.id,
      name: p.name,
      bio: p.bio,
      serviceIds: data.professionalServices
        .filter((ps) => ps.professional_id === p.id && offered.has(ps.service_id))
        .map((ps) => ps.service_id),
      hours: data.workingHours
        .filter((w) => w.professional_id === p.id)
        .map((w) => ({ weekday: w.weekday, startMin: minutes(w.start_time), endMin: minutes(w.end_time) }))
        .sort((a, b) => a.weekday - b.weekday || a.startMin - b.startMin),
    }))
  return { services, professionals }
}

export function shopFacts(catalog: Catalog) {
  return {
    professionals: catalog.professionals.length,
    services: catalog.services.length,
    days: formatWeekdays(catalog.professionals.flatMap((p) => p.hours.map((h) => h.weekday))),
  }
}

/** Reads the catalogue from Supabase (four small queries, in parallel). */
export async function loadCatalog(client: SupabaseClient): Promise<Catalog> {
  const [services, professionals, professionalServices, workingHours] = await Promise.all([
    client.from('services').select('id, name, description, duration_min, price_cents, active').order('name'),
    client.from('professionals').select('id, name, bio, active').order('name'),
    client.from('professional_services').select('professional_id, service_id'),
    client.from('working_hours').select('professional_id, weekday, start_time, end_time'),
  ])
  for (const result of [services, professionals, professionalServices, workingHours]) {
    if (result.error) throw new Error(`Could not load the catalogue: ${result.error.message}`)
  }
  return parseCatalog({
    services: services.data,
    professionals: professionals.data,
    professionalServices: professionalServices.data,
    workingHours: workingHours.data,
  })
}
