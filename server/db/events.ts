import type postgres from 'postgres'
import type { EventRow } from '../events/trace.js'

/**
 * Writes the inspector steps of one tool call in a single statement. The rows are already public
 * (server/events): no client name, no full booking code, no IP.
 */
export async function insertEvents(sql: postgres.Sql | postgres.TransactionSql, rows: readonly EventRow[]): Promise<void> {
  if (rows.length === 0) return
  const values = rows.map((r) => ({
    request_id: r.requestId,
    tool_name: r.toolName,
    step: r.step,
    detail: r.detail as postgres.JSONValue,
    duration_ms: r.durationMs,
    client_label: r.clientLabel,
    created_at: r.createdAt,
  }))
  await sql`
    insert into mcp_events
    ${sql(values, 'request_id', 'tool_name', 'step', 'detail', 'duration_ms', 'client_label', 'created_at')}
  `
}

/** Deletes the inspector events written before `cutoff`. */
export async function deleteEventsBefore(tx: postgres.TransactionSql, cutoff: Date): Promise<number> {
  return (await tx`delete from mcp_events where created_at < ${cutoff}`).count
}
