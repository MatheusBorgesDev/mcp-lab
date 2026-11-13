import { Ratelimit } from '@upstash/ratelimit'
import { Redis } from '@upstash/redis'
import { memoryCounter, upstashCounter, type Limit, type WindowCounter } from './rate-limit.js'

const PREFIX = 'mcp-barber:rate'

function redisCounter(url: string, token: string): WindowCounter {
  // One quick retry at most: the limiter gives up after a second anyway and lets the call through.
  const redis = new Redis({ url, token, retry: { retries: 1, backoff: () => 100 }, enableTelemetry: false })
  // Built once per server instance, so the limiter's cache of refused visitors outlives a request.
  const limiters = new Map<string, Ratelimit>()
  const limiterFor = ({ name, max, windowSec }: Limit) => {
    let limiter = limiters.get(name)
    if (!limiter) {
      limiter = new Ratelimit({
        redis,
        prefix: `${PREFIX}:${name}`,
        limiter: Ratelimit.fixedWindow(max, `${windowSec} s`),
        timeout: 0,
        analytics: false,
      })
      limiters.set(name, limiter)
    }
    return limiter
  }
  return upstashCounter({
    limiterFor,
    markRefused: async (id, resetAt) => (await redis.set(`${PREFIX}:refused:${id}`, 1, { nx: true, pxat: resetAt })) === 'OK',
  })
}

/**
 * Where calls are counted. On Vercel, in the Upstash Redis the Marketplace integration connects (its variables
 * are KV_REST_API_URL and KV_REST_API_TOKEN); a deploy without them refuses to run rather than run unlimited.
 * Locally, without them, in memory.
 */
export function counterFromEnv(env: Record<string, string | undefined>): { store: 'redis' | 'memory'; counter: WindowCounter } {
  const { KV_REST_API_URL: url, KV_REST_API_TOKEN: token } = env
  if (url && token) return { store: 'redis', counter: redisCounter(url, token) }
  if (env.VERCEL) {
    throw new Error('KV_REST_API_URL and KV_REST_API_TOKEN are missing: connect the Upstash Redis integration to the project.')
  }
  return { store: 'memory', counter: memoryCounter() }
}
