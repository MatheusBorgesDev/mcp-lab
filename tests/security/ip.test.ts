import { describe, expect, it } from 'vitest'
import { clientIp, createVisitorKey } from '../../server/security/ip.js'

const SALT = 'test-salt-0123456789abcdef'
const request = (headers: Record<string, string>) => new Request('https://barber.test/mcp', { method: 'POST', headers })

describe('clientIp', () => {
  it('reads the address the Vercel proxy sets', () => {
    expect(clientIp(new Headers({ 'x-real-ip': '203.0.113.7' }))).toBe('203.0.113.7')
    expect(clientIp(new Headers({ 'x-forwarded-for': '203.0.113.7, 10.0.0.1' }))).toBe('203.0.113.7')
    expect(clientIp(new Headers())).toBeUndefined()
  })
})

describe('createVisitorKey', () => {
  it('refuses a missing or short salt, without echoing it', () => {
    expect(() => createVisitorKey(undefined)).toThrow(/IP_HASH_SALT/)
    expect(() => createVisitorKey('short-salt')).toThrow(/at least 16/)
    expect(() => createVisitorKey('short-salt')).not.toThrow(/short-salt/)
  })

  it('gives the same address the same key, and never the address itself', () => {
    const key = createVisitorKey(SALT)
    const first = key(request({ 'x-real-ip': '203.0.113.7' }))

    expect(first).toMatch(/^[0-9a-f]{64}$/)
    expect(key(request({ 'x-real-ip': '203.0.113.7' }))).toBe(first)
    expect(key(request({ 'x-real-ip': '203.0.113.8' }))).not.toBe(first)
    expect(createVisitorKey(`${SALT}-other`)(request({ 'x-real-ip': '203.0.113.7' }))).not.toBe(first)
  })

  it('treats every IPv6 address of one /64 network as one visitor', () => {
    // A home connection gets a whole /64 and can switch addresses inside it at will.
    const key = createVisitorKey(SALT)
    const home = key(request({ 'x-real-ip': '2001:db8:aa:1::1' }))

    expect(key(request({ 'x-real-ip': '2001:0db8:00aa:0001:ffff:1:2:3' }))).toBe(home)
    expect(key(request({ 'x-real-ip': '2001:db8:aa:2::1' }))).not.toBe(home)
  })

  it('treats an IPv4 address written as IPv6 as the IPv4 address', () => {
    const key = createVisitorKey(SALT)
    expect(key(request({ 'x-real-ip': '::ffff:203.0.113.7' }))).toBe(key(request({ 'x-real-ip': '203.0.113.7' })))
  })

  it('puts requests without an address in one shared bucket', () => {
    const key = createVisitorKey(SALT)
    expect(key(request({}))).toBe(key(undefined))
  })
})
