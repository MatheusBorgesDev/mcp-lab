import { describe, expect, it } from 'vitest'
import type { Call, EventRow } from './calls'
import { ticketView } from './ticket'

const STARTED = new Date('2026-11-13T17:31:07-03:00')
const step = (s: EventRow['step'], detail: unknown, durationMs = 0): EventRow => ({
  id: 0,
  requestId: '7f3a9c1e-0000-4000-8000-000000000000',
  toolName: 'book_appointment',
  step: s,
  detail,
  durationMs,
  clientLabel: 'Claude',
  createdAt: STARTED,
})
const call = (steps: EventRow[], toolName = 'book_appointment'): Call => ({
  requestId: '7f3a9c1e-0000-4000-8000-000000000000',
  toolName,
  clientLabel: 'Claude',
  startedAt: STARTED,
  steps,
})
const NOW = new Date('2026-11-13T17:40:00-03:00')

describe('ticketView', () => {
  it('heads the ticket with the tool, the AI, a short request id and the time', () => {
    expect(ticketView(call([]), NOW)).toMatchObject({ tool: 'book_appointment', client: 'Claude', meta: 'req 7f3a · 17:31:07' })
  })

  it('shows the arguments in a fixed order, the removed name and the dropped fields', () => {
    // jsonb stores keys shortest first, so they arrive as start, service_id, professional_id.
    const view = ticketView(
      call([
        step('received', {
          args: { start: '2026-11-13T16:00:00-03:00', service_id: 'corte-e-barba', professional_id: 'rafael' },
          redacted: ['client_name'],
          dropped: 2,
        }),
      ]),
      NOW,
    )

    expect(view.steps[0]).toMatchObject({
      label: 'recebida',
      text: 'service_id corte-e-barba · professional_id rafael · start 16:00 · client_name removido · 2 campos ignorados',
      ok: true,
    })
  })

  it('writes dates of other days with the day', () => {
    const view = ticketView(call([step('received', { args: { new_start: '2026-11-19T10:30:00-03:00', code: 'R1•••-•••••' } })]), NOW)

    expect(view.steps[0]?.text).toBe('code R1•••-••••• · new_start 19/11 10:30')
  })

  it('lists each rule checked with its result, in words', () => {
    const view = ticketView(
      call([
        step('validated', {
          checks: [
            { rule: 'input', passed: true },
            { rule: 'professional_offers_service', passed: true },
            { rule: 'slot_free', passed: false },
          ],
        }),
      ]),
      NOW,
    )

    expect(view.steps[0]).toMatchObject({
      label: 'validada',
      ok: false,
      checks: [
        { label: 'entrada válida', passed: true },
        { label: 'faz o serviço', passed: true },
        { label: 'horário livre', passed: false },
      ],
    })
  })

  it('names the limit checks in words', () => {
    const view = ticketView(
      call([
        step('validated', {
          checks: [
            { rule: 'rate_limit', passed: true },
            { rule: 'visitor_bookings', passed: true },
            { rule: 'daily_capacity', passed: false },
          ],
        }),
      ]),
      NOW,
    )

    expect(view.steps[0]?.checks).toEqual([
      { label: 'limite de chamadas', passed: true },
      { label: 'até 2 por visitante', passed: true },
      { label: 'dia até 70%', passed: false },
    ])
  })

  it.each([
    [{ kind: 'booked', code: 'R1•••-•••••', appointment: {} }, 'reserva criada · R1•••-•••••', true],
    [{ kind: 'refused', code: 'SLOT_UNAVAILABLE', suggestions: [{ start: '2026-11-13T15:15:00-03:00', professional_id: 'rafael' }, { start: '2026-11-13T15:30:00-03:00', professional_id: 'bruno' }] }, 'conflito · sugere 15:15, 15:30', false],
    [{ kind: 'refused', code: 'CHANGE_WINDOW_PASSED' }, 'passou do prazo de 2 h', false],
    [{ kind: 'cancelled', already_cancelled: false, appointment: {} }, 'cancelada · horário liberado', true],
    [{ kind: 'cancelled', already_cancelled: true, appointment: {} }, 'já estava cancelada', true],
    [{ kind: 'rescheduled', appointment: { starts_at: '2026-11-13T20:00:00+00:00' } }, 'remarcada para 17:00', true],
    [{ kind: 'availability', date: '2026-11-13', service_id: 'barba', professionals: [{ id: 'rafael', free: 20 }, { id: 'bruno', free: 3 }] }, '2 barbeiros · 23 inícios livres', true],
    [{ kind: 'services', count: 8 }, '8 serviços', true],
    [{ kind: 'professionals', count: 1 }, '1 barbeiro', true],
    [{ kind: 'appointment', appointment: { public_alias: 'Cliente #2807', starts_at: '2026-11-13T20:00:00+00:00' } }, 'encontrada · Cliente #2807, 17:00', true],
  ])('summarizes what was done: %j', (detail, text, ok) => {
    expect(ticketView(call([step('processed', detail)]), NOW).steps[0]).toMatchObject({ label: 'processada', text, ok })
  })

  it('ends with the answer and the total time', () => {
    expect(ticketView(call([step('responded', { is_error: false }, 84)]), NOW).steps[0]).toMatchObject({ label: 'respondida', text: 'ok · 84 ms', ok: true })
    expect(ticketView(call([step('responded', { is_error: true, code: 'SLOT_UNAVAILABLE' }, 61)]), NOW).steps[0]).toMatchObject({
      label: 'respondida',
      text: 'SLOT_UNAVAILABLE · 61 ms',
      ok: false,
    })
    expect(ticketView(call([step('error', { code: 'INTERNAL_ERROR' }, 120)]), NOW).steps[0]).toMatchObject({
      label: 'erro',
      text: 'INTERNAL_ERROR · 120 ms',
      ok: false,
    })
  })

  it('shows a dash for a detail it does not understand, never the raw data', () => {
    expect(ticketView(call([step('processed', { kind: 'secret', client_name: 'Maria' })]), NOW).steps[0]?.text).toBe('—')
  })
})
