import { Client, StreamableHTTPClientTransport } from '@modelcontextprotocol/client'
import { describe, expect, it } from 'vitest'
import type { Barbershop, BookInput } from '../../server/app/barbershop.js'
import { fail, ok } from '../../server/domain/result.js'
import { SHOP_RULES } from '../../server/domain/rules.js'
import { createMcpRequestHandler } from '../../server/mcp/server.js'

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
})

async function connect(ip: string): Promise<Client> {
  const client = new Client({ name: 'test-client', version: '1.0.0' }, { versionNegotiation: { mode: { pin: '2026-07-28' } } })
  await client.connect(
    new StreamableHTTPClientTransport(new URL('http://barber.test/mcp'), {
      fetch: (url, init) => handler(new Request(url, init)),
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
