import { randomUUID } from 'node:crypto'
import { afterAll, describe, expect, it } from 'vitest'
import { insertEvents } from '../../server/db/events.js'
import { startTrace } from '../../server/events/trace.js'
import { success } from '../../server/mcp/format.js'
import { connectLocalDb, inRolledBackTransaction } from './helpers.js'

const sql = connectLocalDb()
afterAll(() => sql.end())

describe('mcp_events: writing the inspector steps', () => {
  it('stores every step of a call with its own time and detail', () =>
    inRolledBackTransaction(sql, async (tx) => {
      const requestId = randomUUID()
      let ms = new Date('2030-01-07T13:00:00.000Z').getTime()
      const trace = startTrace({
        requestId,
        toolName: 'list_services',
        clientLabel: 'Claude',
        args: {},
        clock: () => new Date((ms += 7)),
      })
      trace.checked([{ rule: 'input', passed: true }])
      trace.processed({ kind: 'services', count: 8 })
      trace.responded(success('ok', {}))

      await insertEvents(tx, trace.rows())

      const stored = await tx`
        select tool_name, step, detail, duration_ms, client_label, created_at
        from mcp_events where request_id = ${requestId} order by id
      `
      expect(stored).toEqual([
        { tool_name: 'list_services', step: 'received', detail: { args: {} }, duration_ms: 0, client_label: 'Claude', created_at: new Date('2030-01-07T13:00:00.007Z') },
        { tool_name: 'list_services', step: 'validated', detail: { checks: [{ rule: 'input', passed: true }] }, duration_ms: 7, client_label: 'Claude', created_at: new Date('2030-01-07T13:00:00.014Z') },
        { tool_name: 'list_services', step: 'processed', detail: { kind: 'services', count: 8 }, duration_ms: 14, client_label: 'Claude', created_at: new Date('2030-01-07T13:00:00.021Z') },
        { tool_name: 'list_services', step: 'responded', detail: { is_error: false }, duration_ms: 21, client_label: 'Claude', created_at: new Date('2030-01-07T13:00:00.028Z') },
      ])
    }))

  it('writes nothing for an empty list', () =>
    inRolledBackTransaction(sql, async (tx) => {
      const [before] = await tx`select count(*)::int as n from mcp_events`
      await insertEvents(tx, [])
      const [after] = await tx`select count(*)::int as n from mcp_events`
      expect(after?.n).toBe(before?.n)
    }))
})
