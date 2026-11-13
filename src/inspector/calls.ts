import * as z from 'zod/mini'

// The inspector's data: rows of mcp_events, read with the anon role or received on the "inspector" broadcast
// (one message per tool call). The server already removed everything private (server/events).
export const STEPS = ['received', 'validated', 'processed', 'responded', 'error'] as const
export type Step = (typeof STEPS)[number]

export type EventRow = {
  id: number
  requestId: string
  toolName: string
  step: Step
  /** Shape depends on the step (server/events/trace.ts); read by ticket.ts, never shown raw. */
  detail: unknown
  durationMs: number | null
  clientLabel: string | null
  createdAt: Date
}

export type Call = { requestId: string; toolName: string; clientLabel: string; startedAt: Date; steps: EventRow[] }

const row = z.object({
  id: z.number(),
  request_id: z.string(),
  tool_name: z.nullable(z.string()),
  step: z.enum(STEPS),
  detail: z.unknown(),
  duration_ms: z.nullable(z.number()),
  client_label: z.nullable(z.string()),
  created_at: z.string().check(z.refine((value) => !Number.isNaN(Date.parse(value)))),
})

export const EVENT_COLUMNS = 'id, request_id, tool_name, step, detail, duration_ms, client_label, created_at'

/** Valid rows only: one odd row should not hide the others. */
export function parseEventRows(rows: unknown): EventRow[] {
  if (!Array.isArray(rows)) return []
  return rows.flatMap((raw) => {
    const parsed = row.safeParse(raw)
    if (!parsed.success) return []
    const r = parsed.data
    return [
      {
        id: r.id,
        requestId: r.request_id,
        toolName: r.tool_name ?? '?',
        step: r.step,
        detail: r.detail,
        durationMs: r.duration_ms,
        clientLabel: r.client_label,
        createdAt: new Date(r.created_at),
      },
    ]
  })
}

/** The rows of one call from an "inspector" broadcast, or null when the payload is not one. */
export function parseInspectorMessage(payload: unknown): EventRow[] | null {
  const events = (payload as { events?: unknown } | null)?.events
  if (!Array.isArray(events)) return null
  const rows = parseEventRows(events)
  return rows.length > 0 ? rows : null
}

/** Rows grouped into calls, the newest call first, each call's steps in order; at most `limit` calls. */
export function groupCalls(rows: readonly EventRow[], limit: number): Call[] {
  const byRequest = new Map<string, EventRow[]>()
  for (const r of rows) byRequest.set(r.requestId, [...(byRequest.get(r.requestId) ?? []), r])
  return [...byRequest.values()]
    .map((steps) => steps.sort((a, b) => a.id - b.id || STEPS.indexOf(a.step) - STEPS.indexOf(b.step)))
    .sort((a, b) => Math.max(...b.map((s) => s.id)) - Math.max(...a.map((s) => s.id)))
    .slice(0, limit)
    .map((steps) => {
      const first = steps[0]!
      return {
        requestId: first.requestId,
        toolName: first.toolName,
        clientLabel: first.clientLabel ?? 'Cliente MCP',
        startedAt: first.createdAt,
        steps,
      }
    })
}
