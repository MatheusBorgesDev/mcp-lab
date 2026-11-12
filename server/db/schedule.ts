import type postgres from 'postgres'
import { z } from 'zod'
import type { BusySlot, Closure, Professional, Schedule, Service, WorkingInterval } from '../domain/types.js'

const serviceRow = z.object({
  id: z.string(),
  name: z.string(),
  description: z.string().nullable(),
  duration_min: z.number().int().positive(),
  price_cents: z.number().int().nonnegative(),
  active: z.boolean(),
})

const professionalRow = z.object({
  id: z.string(),
  name: z.string(),
  bio: z.string().nullable(),
  active: z.boolean(),
  service_ids: z.array(z.string()),
})

const workingIntervalRow = z.object({
  professional_id: z.string(),
  weekday: z.number().int().min(0).max(6),
  start_min: z.number().int(),
  end_min: z.number().int(),
})

const closureRow = z.object({
  professional_id: z.string().nullable(),
  starts_at: z.date(),
  ends_at: z.date(),
  reason: z.string().nullable(),
})

const busyRow = z.object({ id: z.string(), professional_id: z.string(), starts_at: z.date(), ends_at: z.date() })

export type Catalog = Pick<Schedule, 'services' | 'professionals' | 'workingHours'>

/** Services, professionals (with the services they do) and working hours, in display order. */
export async function loadCatalog(sql: postgres.Sql): Promise<Catalog> {
  const [services, professionals, workingHours] = await Promise.all([
    sql`select id, name, description, duration_min, price_cents, active from services order by name`,
    sql`
      select p.id, p.name, p.bio, p.active,
             coalesce(array_agg(ps.service_id order by ps.service_id)
                      filter (where ps.service_id is not null), '{}') as service_ids
      from professionals p
      left join professional_services ps on ps.professional_id = p.id
      group by p.id
      order by p.name
    `,
    sql`
      select professional_id, weekday,
             (extract(epoch from start_time) / 60)::int as start_min,
             (extract(epoch from end_time) / 60)::int as end_min
      from working_hours
      order by professional_id, weekday, start_time
    `,
  ])

  return {
    services: z.array(serviceRow).parse(services).map(
      (r): Service => ({
        id: r.id,
        name: r.name,
        description: r.description,
        durationMin: r.duration_min,
        priceCents: r.price_cents,
        active: r.active,
      }),
    ),
    professionals: z.array(professionalRow).parse(professionals).map(
      (r): Professional => ({ id: r.id, name: r.name, bio: r.bio, active: r.active, serviceIds: r.service_ids }),
    ),
    workingHours: z.array(workingIntervalRow).parse(workingHours).map(
      (r): WorkingInterval => ({
        professionalId: r.professional_id,
        weekday: r.weekday,
        startMin: r.start_min,
        endMin: r.end_min,
      }),
    ),
  }
}

/** The catalogue plus closures and active appointments that touch [from, to). */
export async function loadSchedule(sql: postgres.Sql, range: { from: Date; to: Date }): Promise<Schedule> {
  const [catalog, closures, appointments] = await Promise.all([
    loadCatalog(sql),
    sql`
      select professional_id, starts_at, ends_at, reason from closures
      where starts_at < ${range.to} and ends_at > ${range.from}
    `,
    sql`
      select id, professional_id, starts_at, ends_at from appointments
      where status <> 'cancelled' and starts_at < ${range.to} and ends_at > ${range.from}
    `,
  ])

  return {
    ...catalog,
    closures: z.array(closureRow).parse(closures).map(
      (r): Closure => ({ professionalId: r.professional_id, startsAt: r.starts_at, endsAt: r.ends_at, reason: r.reason }),
    ),
    appointments: z.array(busyRow).parse(appointments).map(
      (r): BusySlot => ({
        appointmentId: r.id,
        professionalId: r.professional_id,
        startsAt: r.starts_at,
        endsAt: r.ends_at,
      }),
    ),
  }
}
