import { describe, expect, it } from 'vitest'
import { clientIp, createVisitorIdentifier } from '../../server/security/ip.js'

const SALT = 'test-salt-0123456789abcdef'
const request = (headers: Record<string, string>) => new Request('https://barber.test/mcp', { method: 'POST', headers })
const key = (r: Request | undefined) => createVisitorIdentifier(SALT)(r).key

describe('clientIp', () => {
  it('reads the address the Vercel proxy sets', () => {
    expect(clientIp(new Headers({ 'x-real-ip': '203.0.113.7' }))).toBe('203.0.113.7')
    expect(clientIp(new Headers({ 'x-forwarded-for': '203.0.113.7, 10.0.0.1' }))).toBe('203.0.113.7')
    expect(clientIp(new Headers())).toBeUndefined()
  })
})

describe('createVisitorIdentifier', () => {
  it('refuses a missing or short salt, without echoing it', () => {
    expect(() => createVisitorIdentifier(undefined)).toThrow(/IP_HASH_SALT/)
    expect(() => createVisitorIdentifier('short-salt')).toThrow(/at least 16/)
    expect(() => createVisitorIdentifier('short-salt')).not.toThrow(/short-salt/)
  })

  it('gives the same address the same key, and never the address itself', () => {
    const first = key(request({ 'x-real-ip': '203.0.113.7' }))

    expect(first).toMatch(/^[0-9a-f]{64}$/)
    expect(key(request({ 'x-real-ip': '203.0.113.7' }))).toBe(first)
    expect(key(request({ 'x-real-ip': '203.0.113.8' }))).not.toBe(first)
    expect(createVisitorIdentifier(`${SALT}-other`)(request({ 'x-real-ip': '203.0.113.7' })).key).not.toBe(first)
  })

  it('treats every IPv6 address of one /64 network as one visitor', () => {
    // A home connection gets a whole /64 and can switch addresses inside it at will.
    const home = key(request({ 'x-real-ip': '2001:db8:aa:1::1' }))

    expect(key(request({ 'x-real-ip': '2001:0db8:00aa:0001:ffff:1:2:3' }))).toBe(home)
    expect(key(request({ 'x-real-ip': '2001:db8:aa:2::1' }))).not.toBe(home)
  })

  it('treats an IPv4 address written as IPv6 as the IPv4 address', () => {
    expect(key(request({ 'x-real-ip': '::ffff:203.0.113.7' }))).toBe(key(request({ 'x-real-ip': '203.0.113.7' })))
  })

  it('puts requests without an address in one shared bucket', () => {
    expect(key(request({}))).toBe(key(undefined))
  })

  it("marks an AI platform's address as shared by many visitors", () => {
    const identify = createVisitorIdentifier(SALT)

    expect(identify(request({ 'x-real-ip': '160.79.104.1' })).shared).toBe(true)
    expect(identify(request({ 'x-real-ip': '203.0.113.7' })).shared).toBe(false)
    expect(identify(undefined).shared).toBe(false)
  })
})
