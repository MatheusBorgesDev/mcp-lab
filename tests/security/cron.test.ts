import { describe, expect, it } from 'vitest'
import { createCronGuard } from '../../server/security/cron.js'

const SECRET = 'test-cron-secret-0123456789'
const request = (authorization?: string) =>
  new Request('https://barber.test/api/cron/reset', authorization ? { headers: { authorization } } : {})

describe('createCronGuard', () => {
  it('refuses a missing or short secret, without echoing it', () => {
    expect(() => createCronGuard(undefined)).toThrow(/CRON_SECRET/)
    expect(() => createCronGuard('short-secret')).toThrow(/at least 16/)
    expect(() => createCronGuard('short-secret')).not.toThrow(/short-secret/)
  })

  it('lets through only the bearer token Vercel Cron sends', () => {
    const isCron = createCronGuard(SECRET)

    expect(isCron(request(`Bearer ${SECRET}`))).toBe(true)
    expect(isCron(request())).toBe(false)
    expect(isCron(request(`Bearer ${SECRET}x`))).toBe(false)
    expect(isCron(request(`Bearer ${SECRET.slice(0, -1)}`))).toBe(false)
    expect(isCron(request(`Basic ${SECRET}`))).toBe(false)
    expect(isCron(request(SECRET))).toBe(false)
    expect(isCron(request('Bearer '))).toBe(false)
  })
})
