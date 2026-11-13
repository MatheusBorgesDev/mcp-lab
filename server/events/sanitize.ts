import { maskCode } from '../security/codes.js'

/** Shown in place of an argument value that is not in the format the tool expects. */
export const HIDDEN = '•••'

export type PublicArgs = {
  args: Record<string, string>
  /** Private arguments that were given and removed, e.g. the client name. */
  redacted?: string[]
  /** How many arguments the tools do not take were given (names and values are not shown). */
  dropped?: number
}

const SLUG = /^[a-z0-9-]{1,40}$/
const DATE = /^\d{4}-\d{2}-\d{2}$/
const INSTANT = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2}(\.\d{1,3})?)?(Z|[+-]\d{2}:\d{2})$/

const PRIVATE = new Set(['client_name'])

// Every argument the tools take, with the only format that may reach the public page. The tools validate
// their input after this runs, so a value can still be anything the visitor's AI sent.
const SHOWN: Record<string, (value: unknown) => string> = {
  service_id: (value) => (typeof value === 'string' && SLUG.test(value) ? value : HIDDEN),
  professional_id: (value) => (typeof value === 'string' && SLUG.test(value) ? value : HIDDEN),
  date: (value) => (typeof value === 'string' && DATE.test(value) ? value : HIDDEN),
  start: (value) => (typeof value === 'string' && INSTANT.test(value) ? value : HIDDEN),
  new_start: (value) => (typeof value === 'string' && INSTANT.test(value) ? value : HIDDEN),
  code: (value) => maskCode(typeof value === 'string' ? value : ''),
}

/** The arguments of a tool call as the public inspector may show them. */
export function publicArgs(raw: unknown): PublicArgs {
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) return { args: {} }

  const args: Record<string, string> = {}
  const redacted: string[] = []
  let dropped = 0
  for (const [key, value] of Object.entries(raw)) {
    const show = SHOWN[key]
    if (show) args[key] = show(value)
    else if (PRIVATE.has(key)) redacted.push(key)
    else dropped++
  }
  return { args, ...(redacted.length > 0 && { redacted }), ...(dropped > 0 && { dropped }) }
}
