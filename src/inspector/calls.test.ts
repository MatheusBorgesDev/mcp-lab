import { describe, expect, it } from 'vitest'
import { groupCalls, parseEventRows, parseInspectorMessage } from './calls'

// Rows as Supabase sends them: PostgREST (mcp_events) and the "inspector" broadcast (to_jsonb of the rows).
const row = (id: number, requestId: string, step: string, detail: unknown, durationMs = 0) => ({
  id,
  request_id: requestId,
  tool_name: 'list_services',
  step,
  detail,
  duration_ms: durationMs,
  client_label: 'Claude',
  created_at: `2026-11-13T13:01:0${id % 10}.000+00:00`,
})

describe('parseEventRows', () => {
  it('reads mcp_events rows', () => {
    expect(parseEventRows([row(1, 'r1', 'received', { args: {} })])).toEqual([
      {
        id: 1,
        requestId: 'r1',
        toolName: 'list_services',
        step: 'received',
        detail: { args: {} },
        durationMs: 0,
        clientLabel: 'Claude',
        createdAt: new Date('2026-11-13T13:01:01Z'),
      },
    ])
  })

  it('drops rows with an unknown step instead of failing the whole list', () => {
    expect(parseEventRows([row(1, 'r1', 'received', {}), row(2, 'r1', 'teleported', {})]).map((r) => r.step)).toEqual(['received'])
  })
})

describe('parseInspectorMessage', () => {
  it('reads the steps of one call', () => {
    const message = { events: [row(1, 'r1', 'received', { args: {} }), row(2, 'r1', 'responded', { is_error: false }, 62)], id: 'x' }

    expect(parseInspectorMessage(message)?.map((r) => r.step)).toEqual(['received', 'responded'])
  })

  it.each([null, {}, { events: 'nope' }])('ignores %j', (payload) => {
    expect(parseInspectorMessage(payload)).toBeNull()
  })
})

describe('groupCalls', () => {
  it('groups the steps by call, newest call first, steps in order', () => {
    const rows = parseEventRows([
      row(1, 'old', 'received', {}),
      row(3, 'new', 'received', {}),
      row(2, 'old', 'responded', { is_error: false }, 40),
      row(4, 'new', 'responded', { is_error: false }, 12),
    ])

    const calls = groupCalls(rows, 5)

    expect(calls.map((c) => [c.requestId, c.steps.map((s) => s.step)])).toEqual([
      ['new', ['received', 'responded']],
      ['old', ['received', 'responded']],
    ])
    expect(calls[0]).toMatchObject({ toolName: 'list_services', clientLabel: 'Claude', startedAt: new Date('2026-11-13T13:01:03Z') })
  })

  it('keeps only the most recent calls', () => {
    const rows = parseEventRows([1, 2, 3].map((id) => row(id, `r${id}`, 'received', {})))

    expect(groupCalls(rows, 2).map((c) => c.requestId)).toEqual(['r3', 'r2'])
  })
})
