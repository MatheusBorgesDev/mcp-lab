import { describe, expect, it } from 'vitest'
import { failure, success } from '../../server/mcp/format.js'
import { startTrace } from '../../server/events/trace.js'

const REQUEST_ID = '00000000-0000-4000-8000-000000000001'
const T0 = new Date('2026-11-20T15:00:00.000Z').getTime()

/** A clock that advances 10 ms on each reading. */
function tickingClock() {
  let ms = T0
  return () => {
    const now = new Date(ms)
    ms += 10
    return now
  }
}

function trace(toolName = 'book_appointment', args: unknown = { service_id: 'barba', client_name: 'Maria' }) {
  return startTrace({ requestId: REQUEST_ID, toolName, clientLabel: 'Claude', args, clock: tickingClock() })
}

describe('tool call trace (inspector steps)', () => {
  it('records received, validated, processed and responded, in order, with the time since the call started', () => {
    const t = trace()
    t.checked([{ rule: 'input', passed: true }])
    t.checked([{ rule: 'slot_free', passed: true }])
    t.processed({ kind: 'services', count: 8 })
    t.responded(success('ok', {}))

    const rows = t.rows()
    expect(rows.map((r) => r.step)).toEqual(['received', 'validated', 'processed', 'responded'])
    expect(rows.map((r) => r.durationMs)).toEqual([0, 20, 30, 40])
    expect(rows.map((r) => r.createdAt.getTime() - T0)).toEqual([0, 20, 30, 40])
    for (const row of rows) {
      expect(row).toMatchObject({ requestId: REQUEST_ID, toolName: 'book_appointment', clientLabel: 'Claude' })
    }
  })

  it('shows the sanitized arguments and every check with its result', () => {
    const t = trace()
    t.checked([{ rule: 'input', passed: true }])
    t.checked([{ rule: 'professional_offers_service', passed: true }, { rule: 'slot_free', passed: false }])
    t.responded(failure({ code: 'SLOT_UNAVAILABLE', message: 'Taken.' }, 'America/Sao_Paulo'))

    const [received, validated] = t.rows()
    expect(received?.detail).toEqual({ args: { service_id: 'barba' }, redacted: ['client_name'] })
    expect(validated?.detail).toEqual({
      checks: [
        { rule: 'input', passed: true },
        { rule: 'professional_offers_service', passed: true },
        { rule: 'slot_free', passed: false },
      ],
    })
  })

  it('summarizes a refusal from the error code and the suggested times, without the message', () => {
    const t = trace()
    t.checked([{ rule: 'input', passed: true }])
    t.responded(
      failure(
        {
          code: 'SLOT_UNAVAILABLE',
          message: 'That time was just taken.',
          suggestions: [{ professionalId: 'rafael', professionalName: 'Rafael', startsAt: new Date('2026-11-20T18:15:00Z') }],
        },
        'America/Sao_Paulo',
      ),
    )

    const rows = t.rows()
    expect(rows.map((r) => r.step)).toEqual(['received', 'validated', 'processed', 'responded'])
    expect(rows[2]?.detail).toEqual({
      kind: 'refused',
      code: 'SLOT_UNAVAILABLE',
      suggestions: [{ start: '2026-11-20T15:15:00-03:00', professional_id: 'rafael' }],
    })
    expect(rows[3]?.detail).toEqual({ is_error: true, code: 'SLOT_UNAVAILABLE' })
  })

  it('stops after validation when the input is invalid', () => {
    const t = trace('check_availability', { date: 'amanhã' })
    t.checked([{ rule: 'input', passed: false }])
    t.responded(failure({ code: 'INVALID_INPUT', message: 'date: date must be YYYY-MM-DD' }, 'America/Sao_Paulo'))

    const rows = t.rows()
    expect(rows.map((r) => r.step)).toEqual(['received', 'validated', 'responded'])
    expect(rows[2]?.detail).toEqual({ is_error: true, code: 'INVALID_INPUT' })
  })

  it('ends with an error step, without details, when the tool failed unexpectedly', () => {
    const t = trace()
    t.checked([{ rule: 'input', passed: true }])
    t.failed()

    const rows = t.rows()
    expect(rows.map((r) => r.step)).toEqual(['received', 'validated', 'error'])
    expect(rows[2]).toMatchObject({ detail: { code: 'INTERNAL_ERROR' }, durationMs: 20 })
  })
})
