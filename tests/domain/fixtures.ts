import type { BusySlot, Closure, Professional, Schedule, Service } from '../../server/domain/types.js'

/** A wall-clock time in São Paulo (UTC-3, no daylight saving time), written by hand for the tests. */
export const at = (date: string, hhmm: string) => new Date(`${date}T${hhmm}:00-03:00`)

/** HH:MM of an instant in São Paulo, computed with Intl rather than with the code under test. */
export const hhmm = (instant: Date) =>
  instant.toLocaleTimeString('pt-BR', { timeZone: 'America/Sao_Paulo', hour: '2-digit', minute: '2-digit' })

export const MONDAY = '2030-01-07'
export const TUESDAY = '2030-01-08'

const service = (id: string, durationMin: number, active = true): Service => ({
  id,
  name: id,
  description: null,
  durationMin,
  priceCents: 5000,
  active,
})

const professional = (id: string, serviceIds: string[], active = true): Professional => ({
  id,
  name: id,
  bio: null,
  active,
  serviceIds,
})

/**
 * ana: corte, barba. Monday 09:00-12:00 and 13:00-18:00.
 * bia: corte, platinado. Monday 14:00-18:00, Tuesday 09:00-12:00.
 * caio: inactive. retired: inactive service.
 */
export function scheduleWith(extra: { closures?: Closure[]; appointments?: BusySlot[] } = {}): Schedule {
  return {
    services: [service('corte', 30), service('barba', 30), service('platinado', 120), service('retired', 30, false)],
    professionals: [
      professional('ana', ['corte', 'barba']),
      professional('bia', ['corte', 'platinado']),
      professional('caio', ['corte'], false),
    ],
    workingHours: [
      { professionalId: 'ana', weekday: 1, startMin: 9 * 60, endMin: 12 * 60 },
      { professionalId: 'ana', weekday: 1, startMin: 13 * 60, endMin: 18 * 60 },
      { professionalId: 'bia', weekday: 1, startMin: 14 * 60, endMin: 18 * 60 },
      { professionalId: 'bia', weekday: 2, startMin: 9 * 60, endMin: 12 * 60 },
      { professionalId: 'caio', weekday: 1, startMin: 9 * 60, endMin: 18 * 60 },
    ],
    closures: extra.closures ?? [],
    appointments: extra.appointments ?? [],
  }
}
