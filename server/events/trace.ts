import type { CallToolResult } from '@modelcontextprotocol/server'
import type { CheckRule } from '../domain/booking.js'
import type { Outcome } from './outcomes.js'
import { publicArgs } from './sanitize.js'

export type Step = 'received' | 'validated' | 'processed' | 'responded' | 'error'

/** One row of mcp_events. */
export type EventRow = {
  requestId: string
  toolName: string
  clientLabel: string
  step: Step
  detail: Record<string, unknown>
  /** Time since the call was received. On the last step, the call's total time. */
  durationMs: number
  createdAt: Date
}

/** "input" is the tool's own schema validation; the other rules come from the domain. */
export type CheckResult = { rule: CheckRule | 'input'; passed: boolean }

export type Trace = {
  checked(checks: readonly CheckResult[]): void
  processed(outcome: Outcome): void
  responded(result: CallToolResult): void
  failed(): void
  rows(): EventRow[]
}

const ERROR_CODE = /^[A-Z_]{1,40}$/
const SLUG = /^[a-z0-9-]{1,40}$/
const INSTANT = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2}(\.\d{1,3})?)?(Z|[+-]\d{2}:\d{2})$/

/**
 * The "processed" step of a refusal (a time taken, a closed day), read from the tool's structured error.
 * Only the code and the suggested times are kept: the message is meant for the AI, not the public page.
 */
function refusal(result: CallToolResult): Outcome | undefined {
  const error = result.structuredContent as { code?: unknown; suggestions?: unknown } | undefined
  if (!result.isError || typeof error?.code !== 'string' || !ERROR_CODE.test(error.code)) return undefined
  if (error.code === 'INVALID_INPUT' || error.code === 'INTERNAL_ERROR') return undefined

  const suggestions = Array.isArray(error.suggestions)
    ? error.suggestions.flatMap((s: { start?: unknown; professional_id?: unknown }) =>
        typeof s.start === 'string' && INSTANT.test(s.start) &&
        typeof s.professional_id === 'string' && SLUG.test(s.professional_id)
          ? [{ start: s.start, professional_id: s.professional_id }]
          : [],
      )
    : []
  return { kind: 'refused', code: error.code, ...(suggestions.length > 0 && { suggestions }) }
}

function errorCode(result: CallToolResult): string | undefined {
  const code = (result.structuredContent as { code?: unknown } | undefined)?.code
  return typeof code === 'string' && ERROR_CODE.test(code) ? code : undefined
}

/**
 * Collects the inspector steps of one tool call as it runs. The rows are written at the end, in one go
 * (server/db/events.ts); each keeps the time it happened, so the page can replay them in order.
 */
export function startTrace(call: {
  requestId: string
  toolName: string
  clientLabel: string
  args: unknown
  clock?: () => Date
}): Trace {
  const { requestId, toolName, clientLabel, clock = () => new Date() } = call
  const startedAt = clock()
  const row = (step: Step, detail: Record<string, unknown>, at = clock()): EventRow => ({
    requestId,
    toolName,
    clientLabel,
    step,
    detail,
    durationMs: Math.max(0, Math.round(at.getTime() - startedAt.getTime())),
    createdAt: at,
  })

  const received = row('received', publicArgs(call.args), startedAt)
  const checks: CheckResult[] = []
  let validated: EventRow | undefined
  let processed: EventRow | undefined
  let last: EventRow | undefined

  return {
    checked(list) {
      checks.push(...list.map(({ rule, passed }) => ({ rule, passed })))
      validated = row('validated', { checks: [...checks] })
    },
    processed(outcome) {
      processed = row('processed', outcome)
    },
    responded(result) {
      const outcome = processed ? undefined : refusal(result)
      if (outcome) processed = row('processed', outcome)
      const code = result.isError ? errorCode(result) : undefined
      last = row('responded', result.isError ? { is_error: true, ...(code && { code }) } : { is_error: false })
    },
    failed() {
      last = row('error', { code: 'INTERNAL_ERROR' })
    },
    rows() {
      return [received, validated, processed, last].filter((r): r is EventRow => r !== undefined)
    },
  }
}
