import { Client, StreamableHTTPClientTransport } from '@modelcontextprotocol/client'
import { describe, expect, it } from 'vitest'
import type { Barbershop, BookInput } from '../../server/app/barbershop.js'
import { fail, ok } from '../../server/domain/result.js'
import { SHOP_RULES } from '../../server/domain/rules.js'
import type { EventRow } from '../../server/events/trace.js'
import { createMcpRequestHandler } from '../../server/mcp/server.js'
import type { Visitor } from '../../server/security/ip.js'
import type { CallKind, RateVerdict } from '../../server/security/rate-limit.js'

// The protections at the MCP layer, without a database: the shop is a stub.
const SERVICE = { id: 'barba', name: 'Barba', description: null, durationMin: 30, priceCents: 4000, active: true }
const RAFAEL = { id: 'rafael', name: 'Rafael', bio: null, active: true, serviceIds: ['barba'] }
const booked: BookInput[] = []
const shop = {
  rules: SHOP_RULES,
  checkAvailability: async () =>
    ok({ date: '2030-01-07', service: SERVICE, professionals: [{ professional: RAFAEL, starts: [] }], closures: [], dayFull: true }),
  book: async (input: BookInput) => {
    booked.push(input)
    return { ...fail('BOOKING_LIMIT_REACHED', 'Each visitor can hold up to 2 upcoming appointments.'), checks: [] }
  },
} as unknown as Barbershop

const handler = createMcpRequestHandler({
  shop,
  events: async () => {},
  identifyVisitor: (request) => ({ key: `key-of-${request?.headers.get('x-real-ip') ?? 'nobody'}`, shared: false }),
  rateLimit: async () => ({ allowed: true }),
})

async function connect(ip: string, mcp = handler): Promise<Client> {
  const client = new Client({ name: 'test-client', version: '1.0.0' }, { versionNegotiation: { mode: { pin: '2026-07-28' } } })
  await client.connect(
    new StreamableHTTPClientTransport(new URL('http://barber.test/mcp'), {
      fetch: (url, init) => mcp(new Request(url, init)),
      requestInit: { headers: { 'x-real-ip': ip } },
    }),
  )
  return client
}

describe('MCP server: protections', () => {
  it('books on behalf of the visitor the request comes from', async () => {
    const client = await connect('203.0.113.9')

    const result = await client.callTool({
      name: 'book_appointment',
      arguments: { service_id: 'barba', start: '2030-01-07T10:00:00-03:00' },
    })

    expect(booked.at(-1)?.visitor).toEqual({ key: 'key-of-203.0.113.9', shared: false })
    expect(result).toMatchObject({ isError: true, structuredContent: { code: 'BOOKING_LIMIT_REACHED' } })
  })

  it('tells the AI when a day is full for new bookings', async () => {
    const client = await connect('203.0.113.9')

    const result = await client.callTool({ name: 'check_availability', arguments: { service_id: 'barba', date: '2030-01-07' } })

    expect(result.structuredContent).toMatchObject({ day_full: true })
    const text = (result.content as Array<{ type: string; text?: string }>).map((c) => c.text ?? '').join('\n')
    expect(text).toMatch(/full for new bookings/)
  })

  it('refuses an oversized request before it reaches the MCP layer', async () => {
    const response = await handler(
      new Request('http://barber.test/mcp', {
        method: 'POST',
        headers: { 'content-type': 'application/json', accept: 'application/json, text/event-stream' },
        body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/list', params: { padding: 'x'.repeat(70_000) } }),
      }),
    )

    expect(response.status).toBe(413)
  })
})

// A subscription stream stays open until the client leaves, and on Vercel a request lives at most 300 s: claude.ai
// kept one open per conversation, each ending in a timeout. The lists never change, so there is nothing to stream.
describe('MCP server: no subscription streams', () => {
  it('promises no list changes, so clients do not subscribe to them', async () => {
    const client = await connect('203.0.113.9')

    const capabilities = client.getServerCapabilities()
    expect(capabilities?.tools?.listChanged).toBe(false)
    expect(capabilities?.resources?.listChanged).toBe(false)
    expect(capabilities?.prompts?.listChanged).toBe(false)
    await client.close()
  })

  it('refuses a subscription instead of holding a stream open', async () => {
    const client = await connect('203.0.113.9')

    await expect(client.listen({ toolsListChanged: true })).rejects.toThrow()
    await client.close()
  })
})

describe('MCP server: rate limit', () => {
  function limitedTo(verdict: RateVerdict) {
    const limited: Array<{ visitor: Visitor; kind: CallKind }> = []
    const batches: EventRow[][] = []
    const mcp = createMcpRequestHandler({
      shop,
      events: async (rows) => void batches.push(rows),
      identifyVisitor: (request) => ({ key: `key-of-${request?.headers.get('x-real-ip') ?? 'nobody'}`, shared: false }),
      rateLimit: async (visitor, kind) => {
        limited.push({ visitor, kind })
        return verdict
      },
    })
    return { mcp, limited, batches }
  }

  it('counts tool calls, as reads or writes, and not the handshake', async () => {
    const { mcp, limited } = limitedTo({ allowed: true })
    const client = await connect('203.0.113.9', mcp)
    await client.listTools()
    expect(limited).toEqual([])

    await client.callTool({ name: 'check_availability', arguments: { service_id: 'barba', date: '2030-01-07' } })
    await client.callTool({ name: 'book_appointment', arguments: { service_id: 'barba', start: '2030-01-07T10:00:00-03:00' } })

    const visitor = { key: 'key-of-203.0.113.9', shared: false }
    expect(limited).toEqual([
      { visitor, kind: 'read' },
      { visitor, kind: 'write' },
    ])
  })

  it('refuses a call over the limit and tells the AI how long to wait, without running the tool', async () => {
    const { mcp } = limitedTo({ allowed: false, retryAfterSec: 42, firstRefusal: true })
    const client = await connect('203.0.113.9', mcp)
    const before = booked.length

    const result = await client.callTool({
      name: 'book_appointment',
      arguments: { service_id: 'barba', start: '2030-01-07T10:00:00-03:00' },
    })

    expect(result).toMatchObject({ isError: true, structuredContent: { code: 'RATE_LIMITED', retry_after_seconds: 42 } })
    const text = (result.content as Array<{ type: string; text?: string }>).map((c) => c.text ?? '').join('\n')
    expect(text).toMatch(/42 seconds/)
    expect(booked).toHaveLength(before)
  })

  it('shows the first refusal of a window in the inspector, and no other', async () => {
    const first = limitedTo({ allowed: false, retryAfterSec: 42, firstRefusal: true })
    await (await connect('203.0.113.9', first.mcp)).callTool({ name: 'list_services', arguments: {} })

    expect(first.batches.map((rows) => rows.map((r) => [r.step, r.detail]))).toEqual([
      [
        ['received', { args: {} }],
        ['validated', { checks: [{ rule: 'rate_limit', passed: false }] }],
        ['processed', { kind: 'refused', code: 'RATE_LIMITED' }],
        ['responded', { is_error: true, code: 'RATE_LIMITED' }],
      ],
    ])

    const later = limitedTo({ allowed: false, retryAfterSec: 41, firstRefusal: false })
    await (await connect('203.0.113.9', later.mcp)).callTool({ name: 'list_services', arguments: {} })
    expect(later.batches).toEqual([])
  })
})
