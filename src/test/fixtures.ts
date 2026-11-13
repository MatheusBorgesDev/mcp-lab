/** Catalog rows as Supabase returns them, for tests. */
export const RAW = {
  services: [
    { id: 'barba', name: 'Barba', description: 'Na navalha.', duration_min: 30, price_cents: 4000, active: true },
    { id: 'corte', name: 'Corte', description: null, duration_min: 30, price_cents: 5000, active: true },
    { id: 'antigo', name: 'Antigo', description: null, duration_min: 30, price_cents: 1000, active: false },
  ],
  professionals: [
    { id: 'ana', name: 'Ana', bio: 'Barba.', active: true },
    { id: 'bia', name: 'Bia', bio: null, active: true },
    { id: 'ex', name: 'Ex', bio: null, active: false },
  ],
  professionalServices: [
    { professional_id: 'ana', service_id: 'barba' },
    { professional_id: 'ana', service_id: 'corte' },
    { professional_id: 'bia', service_id: 'corte' },
    { professional_id: 'ana', service_id: 'antigo' },
  ],
  workingHours: [
    { professional_id: 'ana', weekday: 2, start_time: '09:00:00', end_time: '12:00:00' },
    { professional_id: 'ana', weekday: 2, start_time: '13:00:00', end_time: '19:00:00' },
    { professional_id: 'ana', weekday: 3, start_time: '09:00:00', end_time: '19:00:00' },
    { professional_id: 'bia', weekday: 6, start_time: '10:00:00', end_time: '14:00:00' },
  ],
}
