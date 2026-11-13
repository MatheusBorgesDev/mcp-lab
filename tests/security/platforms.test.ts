import { describe, expect, it } from 'vitest'
import { isPlatformAddress } from '../../server/security/platforms.js'

// claude.ai and ChatGPT call MCP servers from their own clouds: one of their addresses stands for many visitors.
describe('isPlatformAddress', () => {
  it("recognizes Anthropic's outbound addresses (claude.ai connectors)", () => {
    for (const ip of ['160.79.104.1', '160.79.111.254', '153.61.208.10', '153.61.223.255']) {
      expect(isPlatformAddress(ip), ip).toBe(true)
    }
  })

  it("recognizes the addresses OpenAI publishes for ChatGPT connectors", () => {
    for (const ip of ['104.210.139.193', '12.12.47.194']) {
      expect(isPlatformAddress(ip), ip).toBe(true)
    }
  })

  it('recognizes a platform address written as IPv6', () => {
    expect(isPlatformAddress('::ffff:160.79.104.1')).toBe(true)
  })

  it('treats every other address as a single visitor', () => {
    for (const ip of ['160.79.112.0', '153.61.224.1', '203.0.113.9', '2001:db8::1', 'not-an-address', '']) {
      expect(isPlatformAddress(ip), ip).toBe(false)
    }
  })
})
