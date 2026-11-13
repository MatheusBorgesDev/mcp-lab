import { describe, expect, it } from 'vitest'
import { HIDDEN, publicArgs } from '../../server/events/sanitize.js'

// What the inspector shows of a call's arguments. Everything on that screen is public, so only values in the
// format each argument expects get through; the rest is hidden.
describe('publicArgs', () => {
  it('removes the client name and says it was removed', () => {
    expect(publicArgs({ service_id: 'barba', client_name: 'Maria Souza' })).toEqual({
      args: { service_id: 'barba' },
      redacted: ['client_name'],
    })
  })

  it('masks the booking code', () => {
    expect(publicArgs({ code: 'R1ZWJ-8QM7W' })).toEqual({ args: { code: 'R1•••-•••••' } })
  })

  it('keeps ids, dates and start times in their expected format', () => {
    const args = {
      service_id: 'corte-masculino',
      professional_id: 'rafael',
      date: '2026-11-20',
      start: '2026-11-20T14:00:00-03:00',
      new_start: '2026-11-20T17:30:00.000Z',
    }
    expect(publicArgs(args)).toEqual({ args })
  })

  it('hides a value that is not in the expected format, since it may be anything the visitor typed', () => {
    expect(
      publicArgs({
        service_id: 'João Silva 11 99999-0000',
        professional_id: 'x'.repeat(41),
        date: 'amanhã',
        start: 'às 14h com o Rafael',
        code: 42,
      }),
    ).toEqual({
      args: { service_id: HIDDEN, professional_id: HIDDEN, date: HIDDEN, start: HIDDEN, code: '•••••-•••••' },
    })
  })

  it('drops arguments the tools do not take, counting them, without their names or values', () => {
    expect(publicArgs({ date: '2026-11-20', phone: '11 99999-0000', 'cpf 123': '1' })).toEqual({
      args: { date: '2026-11-20' },
      dropped: 2,
    })
  })

  it.each([undefined, null, 'list', 3, ['a']])('shows no arguments when they are not an object: %j', (args) => {
    expect(publicArgs(args)).toEqual({ args: {} })
  })
})
