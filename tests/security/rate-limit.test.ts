import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  createRateLimiter,
  memoryCounter,
  upstashCounter,
  type CallKind,
  type RateLimiter,
} from '../../server/security/rate-limit.js'
import { counterFromEnv } from '../../server/security/rate-limit-store.js'

const direct = { key: 'visitor-a', shared: false }
const platform = { key: 'platform-address', shared: true }
// 15 seconds into a minute, 10 minutes into an hour (windows are aligned to the clock, as in Upstash).
const START = Date.UTC(2030, 0, 7, 15, 10, 15)

function setup(start = START) {
  let t = start
  const now = () => t
  return { limit: createRateLimiter({ counter: memoryCounter(now), now }), advance: (ms: number) => void (t += ms) }
}

async function times(limit: RateLimiter, visitor: typeof direct, kind: CallKind, n: number) {
  const verdicts = []
  for (let i = 0; i < n; i++) verdicts.push(await limit(visitor, kind))
  return verdicts
}

describe('rate limit', () => {
  it('lets a visitor make 30 calls a minute and refuses the next, saying when to try again', async () => {
    const { limit } = setup()

    expect((await times(limit, direct, 'read', 30)).every((v) => v.allowed)).toBe(true)
    expect(await limit(direct, 'read')).toEqual({ allowed: false, retryAfterSec: 45, firstRefusal: true })
    expect(await limit({ key: 'visitor-b', shared: false }, 'read')).toEqual({ allowed: true })
  })

  it('counts again from zero in the next minute', async () => {
    const { limit, advance } = setup()
    await times(limit, direct, 'read', 31)

    advance(45_000)

    expect(await limit(direct, 'read')).toEqual({ allowed: true })
  })

  it('allows 10 writes an hour on top of that, and reads go on', async () => {
    const { limit } = setup()

    expect((await times(limit, direct, 'write', 10)).every((v) => v.allowed)).toBe(true)
    expect(await limit(direct, 'write')).toEqual({ allowed: false, retryAfterSec: 50 * 60 - 15, firstRefusal: true })
    expect(await limit(direct, 'read')).toEqual({ allowed: true })
  })

  it('gives an AI platform address, which stands for many visitors, more room', async () => {
    const { limit, advance } = setup()

    expect((await times(limit, platform, 'read', 120)).every((v) => v.allowed)).toBe(true)
    expect(await limit(platform, 'read')).toMatchObject({ allowed: false })

    advance(60_000)
    expect((await times(limit, platform, 'write', 40)).every((v) => v.allowed)).toBe(true)
    expect(await limit(platform, 'write')).toMatchObject({ allowed: false })
  })

  it('marks only the first refusal of a window, so a script cannot flood the public inspector', async () => {
    const { limit, advance } = setup()
    await times(limit, direct, 'read', 30)

    const refusals = await times(limit, direct, 'read', 3)
    expect(refusals.map((v) => !v.allowed && v.firstRefusal)).toEqual([true, false, false])

    advance(60_000)
    await times(limit, direct, 'read', 30)
    expect(await limit(direct, 'read')).toMatchObject({ allowed: false, firstRefusal: true })
  })
})

describe('rate limit when the counter is unavailable', () => {
  afterEach(() => void vi.useRealTimers())

  it('lets the call through and logs why', async () => {
    const log = vi.fn()
    const limit = createRateLimiter({
      counter: async () => {
        throw new Error('fetch failed: ECONNREFUSED')
      },
      log,
    })

    expect(await limit(direct, 'write')).toEqual({ allowed: true })
    expect(log).toHaveBeenCalledWith(expect.stringContaining('ECONNREFUSED'))
  })

  it('waits at most a second for it', async () => {
    vi.useFakeTimers()
    const limit = createRateLimiter({ counter: () => new Promise(() => {}), log: () => {} })
    let verdict: unknown
    void limit(direct, 'read').then((v) => (verdict = v))

    await vi.advanceTimersByTimeAsync(999)
    expect(verdict).toBeUndefined()
    await vi.advanceTimersByTimeAsync(1)
    expect(verdict).toEqual({ allowed: true })
  })
})

describe('upstashCounter', () => {
  const LIMIT = { name: 'direct-calls', max: 30, windowSec: 60 }

  it('passes the limiter answer on', async () => {
    const counter = upstashCounter({
      limiterFor: () => ({ limit: async () => ({ success: true, reset: 60_000 }) }),
      markRefused: async () => true,
    })

    expect(await counter(LIMIT, 'visitor-a')).toEqual({ allowed: true, resetAt: 60_000, firstRefusal: false })
  })

  it('asks Redis whether a refusal is the first of its window, across all server instances', async () => {
    const marked: string[] = []
    const counter = upstashCounter({
      limiterFor: () => ({ limit: async () => ({ success: false, reset: 60_000 }) }),
      markRefused: async (id) => {
        marked.push(id)
        return marked.length === 1
      },
    })

    expect(await counter(LIMIT, 'visitor-a')).toEqual({ allowed: false, resetAt: 60_000, firstRefusal: true })
    expect(await counter(LIMIT, 'visitor-a')).toEqual({ allowed: false, resetAt: 60_000, firstRefusal: false })
    expect(marked).toEqual(['direct-calls:visitor-a:60000', 'direct-calls:visitor-a:60000'])
  })

  it('does not ask again for a refusal the limiter answered from its own cache', async () => {
    const markRefused = vi.fn(async () => true)
    const counter = upstashCounter({
      limiterFor: () => ({ limit: async () => ({ success: false, reset: 60_000, reason: 'cacheBlock' }) }),
      markRefused,
    })

    expect(await counter(LIMIT, 'visitor-a')).toMatchObject({ allowed: false, firstRefusal: false })
    expect(markRefused).not.toHaveBeenCalled()
  })
})

describe('counterFromEnv', () => {
  it('refuses to run on Vercel without the Redis variables, without echoing values', () => {
    expect(() => counterFromEnv({ VERCEL: '1' })).toThrow(/KV_REST_API_URL and KV_REST_API_TOKEN/)
    expect(() => counterFromEnv({ VERCEL: '1', KV_REST_API_URL: 'https://secret-host.upstash.io' })).toThrow(
      /KV_REST_API_URL and KV_REST_API_TOKEN/,
    )
    expect(() => counterFromEnv({ VERCEL: '1', KV_REST_API_URL: 'https://secret-host.upstash.io' })).not.toThrow(
      /secret-host/,
    )
  })

  it('uses Redis when the variables are set', () => {
    const env = { VERCEL: '1', KV_REST_API_URL: 'https://example.upstash.io', KV_REST_API_TOKEN: 'token' }
    expect(counterFromEnv(env).store).toBe('redis')
  })

  it('counts in memory when running locally without Redis', () => {
    expect(counterFromEnv({}).store).toBe('memory')
  })
})
