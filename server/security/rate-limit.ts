import type { Visitor } from './ip.js'

/** One fixed window: `max` hits per `windowSec`, windows aligned to the clock (as in Upstash). */
export type Limit = { name: string; max: number; windowSec: number }

/**
 * Tool calls per visitor (docs/SPEC.md, section 8): any call, plus writes on top. An AI platform's address
 * stands for many visitors (server/security/platforms.ts), so it gets more room.
 */
export const RATE_LIMITS = {
  direct: {
    calls: { name: 'direct-calls', max: 30, windowSec: 60 },
    writes: { name: 'direct-writes', max: 10, windowSec: 60 * 60 },
  },
  shared: {
    calls: { name: 'shared-calls', max: 120, windowSec: 60 },
    writes: { name: 'shared-writes', max: 40, windowSec: 60 * 60 },
  },
} as const satisfies Record<'direct' | 'shared', Record<'calls' | 'writes', Limit>>

export type CallKind = 'read' | 'write'

export type RateVerdict =
  | { allowed: true }
  /** `firstRefusal`: the first of this visitor's window, the only one the public inspector shows. */
  | { allowed: false; retryAfterSec: number; firstRefusal: boolean }

export type RateLimiter = (visitor: Visitor, kind: CallKind) => Promise<RateVerdict>

/** One hit counted against a window. */
export type Hit = { allowed: boolean; resetAt: number; firstRefusal: boolean }
export type WindowCounter = (limit: Limit, key: string) => Promise<Hit>

const COUNTER_TIMEOUT_MS = 1000

function withTimeout<T>(promise: Promise<T>, ms: number): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new Error(`no answer in ${ms} ms`)), ms)
  })
  return Promise.race([promise, timeout]).finally(() => clearTimeout(timer))
}

/**
 * The limits as the MCP server applies them. When the counter fails or takes over a second (Redis down), the
 * call goes through and the failure is logged: the business limits in Postgres still hold.
 */
export function createRateLimiter({
  counter,
  limits = RATE_LIMITS,
  now = Date.now,
  log = console.error,
}: {
  counter: WindowCounter
  limits?: typeof RATE_LIMITS
  now?: () => number
  log?: (message: string) => void
}): RateLimiter {
  return async (visitor, kind) => {
    const tier = visitor.shared ? limits.shared : limits.direct
    const windows: Limit[] = kind === 'write' ? [tier.calls, tier.writes] : [tier.calls]
    for (const limit of windows) {
      let hit: Hit
      try {
        hit = await withTimeout(counter(limit, visitor.key), COUNTER_TIMEOUT_MS)
      } catch (error) {
        log(`[rate-limit] counter unavailable, letting the call through: ${error instanceof Error ? error.message : typeof error}`)
        return { allowed: true }
      }
      if (!hit.allowed) {
        const retryAfterSec = Math.max(1, Math.ceil((hit.resetAt - now()) / 1000))
        return { allowed: false, retryAfterSec, firstRefusal: hit.firstRefusal }
      }
    }
    return { allowed: true }
  }
}

/** Counts in this process: for local runs and tests, where there is one process and no Redis. */
export function memoryCounter(now: () => number = Date.now): WindowCounter {
  const windows = new Map<string, { resetAt: number; hits: number; refused: boolean }>()
  return async ({ name, max, windowSec }, key) => {
    const at = now()
    const windowMs = windowSec * 1000
    const resetAt = (Math.floor(at / windowMs) + 1) * windowMs
    const id = `${name}:${key}`
    let window = windows.get(id)
    if (window?.resetAt !== resetAt) {
      window = { resetAt, hits: 0, refused: false }
      windows.set(id, window)
    }
    window.hits += 1
    if (window.hits <= max) return { allowed: true, resetAt, firstRefusal: false }
    const firstRefusal = !window.refused
    window.refused = true
    return { allowed: false, resetAt, firstRefusal }
  }
}

/** The slice of @upstash/ratelimit's answer the counter reads. */
export type UpstashAnswer = { success: boolean; reset: number; reason?: string }

/**
 * Counts in Upstash Redis, shared by every server instance (server/security/rate-limit-store.ts builds the
 * clients). The limiter keeps refused visitors in an in-memory cache until their window ends; a refusal it
 * answers from there was already reported. Otherwise Redis says whether it is the window's first.
 */
export function upstashCounter(deps: {
  limiterFor: (limit: Limit) => { limit: (key: string) => Promise<UpstashAnswer> }
  /** Records the refusal; true when no other refusal of that window was recorded before. */
  markRefused: (id: string, resetAt: number) => Promise<boolean>
}): WindowCounter {
  return async (limit, key) => {
    const answer = await deps.limiterFor(limit).limit(key)
    if (answer.success) return { allowed: true, resetAt: answer.reset, firstRefusal: false }
    const firstRefusal =
      answer.reason !== 'cacheBlock' && (await deps.markRefused(`${limit.name}:${key}:${answer.reset}`, answer.reset))
    return { allowed: false, resetAt: answer.reset, firstRefusal }
  }
}
