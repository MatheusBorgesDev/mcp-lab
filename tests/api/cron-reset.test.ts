import { afterEach, describe, expect, it, vi } from 'vitest'
import cronReset from '../../api/cron/reset.js'
import { createDailyResetHandler, type ResetSummary } from '../../server/app/daily-reset.js'

const SECRET = 'test-cron-secret-0123456789'
const SUMMARY: ResetSummary = {
  removedVisitorBookings: 3,
  removedSeeds: 1,
  addedSeeds: 18,
  completedBookings: 12,
  removedEvents: 40,
}
const call = (init: RequestInit = {}) => new Request('https://barber.test/api/cron/reset', init)
const withSecret: RequestInit = { headers: { authorization: `Bearer ${SECRET}` } }
const isCron = (request: Request) => request.headers.get('authorization') === `Bearer ${SECRET}`

describe('daily reset endpoint', () => {
  it('answers 401 and runs nothing without the secret', async () => {
    const run = vi.fn(async () => SUMMARY)
    const response = await createDailyResetHandler({ isCron, run })(call())

    expect(response.status).toBe(401)
    expect(run).not.toHaveBeenCalled()
  })

  it('answers 405 to anything but GET, even with the secret', async () => {
    const run = vi.fn(async () => SUMMARY)
    const response = await createDailyResetHandler({ isCron, run })(call({ ...withSecret, method: 'POST' }))

    expect(response.status).toBe(405)
    expect(response.headers.get('allow')).toBe('GET')
    expect(run).not.toHaveBeenCalled()
  })

  it('runs the reset once and answers what it changed', async () => {
    const run = vi.fn(async () => SUMMARY)
    const response = await createDailyResetHandler({ isCron, run })(call(withSecret))

    expect(response.status).toBe(200)
    expect(await response.json()).toEqual({ ok: true, ...SUMMARY })
    expect(run).toHaveBeenCalledTimes(1)
  })

  it('answers 500 without details when the reset fails, and logs why', async () => {
    const log = vi.fn()
    const run = vi.fn(async () => {
      throw new Error('connection refused at 10.0.0.1')
    })
    const response = await createDailyResetHandler({ isCron, run, log })(call(withSecret))

    expect(response.status).toBe(500)
    expect(JSON.stringify(await response.json())).not.toContain('10.0.0.1')
    expect(log).toHaveBeenCalledWith(expect.stringContaining('connection refused'))
  })
})

describe('GET /api/cron/reset', () => {
  afterEach(() => vi.unstubAllEnvs())

  it('refuses a call without the secret before touching the database', async () => {
    vi.stubEnv('CRON_SECRET', SECRET)
    vi.stubEnv('DATABASE_URL', '')

    expect((await cronReset.fetch(call())).status).toBe(401)
    expect((await cronReset.fetch(call({ headers: { authorization: 'Bearer wrong-secret-0123456789' } }))).status).toBe(401)
  })
})
