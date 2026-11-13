import { format } from 'node:util'
import { Client, StreamableHTTPClientTransport } from '@modelcontextprotocol/client'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { Barbershop } from '../../server/app/barbershop.js'
import type { Catalog } from '../../server/db/schedule.js'
import { SHOP_RULES } from '../../server/domain/rules.js'
import type { EventRow } from '../../server/events/trace.js'
import { createMcpRequestHandler } from '../../server/mcp/server.js'

// What the MCP server records for the inspector, without a database: the shop is a stub and the event sink
// keeps the rows in memory.
const CATALOG: Catalog = {
  services: [{ id: 'barba', name: 'Barba', description: null, durationMin: 30, priceCents: 4000, active: true }],
  professionals: [{ id: 'rafael', name: 'Rafael', bio: null, active: true, serviceIds: ['barba'] }],
  workingHours: [],
}
const shop = { rules: SHOP_RULES, catalog: async () => CATALOG } as unknown as Barbershop

type Options = { era?: 'modern' | 'legacy'; name?: string; userAgent?: string; events?: (rows: EventRow[]) => Promise<void> }

async function connect({ era = 'modern', name = 'test-client', userAgent, events }: Options = {}) {
  const batches: EventRow[][] = []
  const handler = createMcpRequestHandler({
    shop,
    events: events ?? (async (rows) => void batches.push(rows)),
    visitorKey: () => 'test-visitor',
  })
  const client = new Client(
    { name, version: '1.0.0' },
    era === 'modern' ? { versionNegotiation: { mode: { pin: '2026-07-28' } } } : {},
  )
  await client.connect(
    new StreamableHTTPClientTransport(new URL('http://barber.test/mcp'), {
      fetch: (url, init) => handler(new Request(url, init)),
      ...(userAgent && { requestInit: { headers: { 'user-agent': userAgent } } }),
    }),
  )
  return { client, batches }
}

describe('MCP server: inspector events', () => {
  afterEach(() => vi.restoreAllMocks())

  it('records each step of a call in one batch, under one request id', async () => {
    const { client, batches } = await connect()

    await client.callTool({ name: 'list_services', arguments: {} })

    expect(batches).toHaveLength(1)
    const rows = batches[0] ?? []
    expect(rows.map((r) => r.step)).toEqual(['received', 'validated', 'processed', 'responded'])
    expect(rows.map((r) => r.detail)).toEqual([
      { args: {} },
      { checks: [{ rule: 'input', passed: true }] },
      { kind: 'services', count: 1 },
      { is_error: false },
    ])
    expect(new Set(rows.map((r) => r.requestId)).size).toBe(1)
    expect(rows[0]?.requestId).toMatch(/^[0-9a-f-]{36}$/)
    expect(rows.every((r) => r.toolName === 'list_services')).toBe(true)
  })

  it('records nothing for requests that are not tool calls', async () => {
    const { client, batches } = await connect()

    await client.listTools()

    expect(batches).toHaveLength(0)
  })

  it('labels the call with the name the client declares in the request (2026-07-28)', async () => {
    const { client, batches } = await connect({ name: 'claude-ai', userAgent: 'openai-mcp/1.0.0' })

    await client.callTool({ name: 'list_professionals', arguments: {} })

    expect(batches[0]?.every((r) => r.clientLabel === 'Claude')).toBe(true)
  })

  it('labels a 2025-era call by its User-Agent, since those requests declare no client', async () => {
    const { client, batches } = await connect({ era: 'legacy', name: 'claude-ai', userAgent: 'openai-mcp/1.0.0' })

    await client.callTool({ name: 'list_professionals', arguments: {} })

    expect(batches[0]?.[0]?.clientLabel).toBe('ChatGPT')
  })

  it('labels a call with no known client as "Cliente MCP"', async () => {
    const { client, batches } = await connect({ era: 'legacy' })

    await client.callTool({ name: 'list_services', arguments: {} })

    expect(batches[0]?.[0]?.clientLabel).toBe('Cliente MCP')
  })

  it('records an invalid input as a failed check, with the arguments hidden', async () => {
    const { client, batches } = await connect()

    await client.callTool({ name: 'check_availability', arguments: { service_id: 'barba', date: 'amanhã às 14h' } })

    const rows = batches[0] ?? []
    expect(rows.map((r) => r.step)).toEqual(['received', 'validated', 'responded'])
    expect(rows[0]?.detail).toEqual({ args: { service_id: 'barba', date: '•••' } })
    expect(rows[1]?.detail).toEqual({ checks: [{ rule: 'input', passed: false }] })
    expect(rows[2]?.detail).toEqual({ is_error: true, code: 'INVALID_INPUT' })
  })

  it('records an unexpected failure as an error step', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {})
    const broken = { rules: SHOP_RULES, catalog: () => Promise.reject(new Error('db down')) } as unknown as Barbershop
    const batches: EventRow[][] = []
    const handler = createMcpRequestHandler({
      shop: broken,
      events: async (rows) => void batches.push(rows),
      visitorKey: () => 'test-visitor',
    })
    const client = new Client({ name: 'test-client', version: '1.0.0' }, { versionNegotiation: { mode: { pin: '2026-07-28' } } })
    await client.connect(
      new StreamableHTTPClientTransport(new URL('http://barber.test/mcp'), { fetch: (url, init) => handler(new Request(url, init)) }),
    )

    const result = await client.callTool({ name: 'list_services', arguments: {} })

    expect(result.structuredContent).toMatchObject({ code: 'INTERNAL_ERROR' })
    expect(batches[0]?.map((r) => r.step)).toEqual(['received', 'validated', 'error'])
    expect(batches[0]?.[2]?.detail).toEqual({ code: 'INTERNAL_ERROR' })
  })

  it('still answers when the events cannot be written, and logs why without the error details', async () => {
    const logged = vi.spyOn(console, 'error').mockImplementation(() => {})
    const failure = Object.assign(new Error('connect ECONNREFUSED'), { code: 'ECONNREFUSED', url: 'postgresql://u:S3cretPw@db/x' })
    const { client } = await connect({ events: () => Promise.reject(failure) })

    const result = await client.callTool({ name: 'list_services', arguments: {} })

    expect(result.isError).not.toBe(true)
    expect(result.structuredContent).toMatchObject({ services: [{ id: 'barba' }] })
    expect(logged).toHaveBeenCalledTimes(1)
    const line = format(...(logged.mock.calls[0] ?? []))
    expect(line).toContain('[mcp] event log failed')
    expect(line).toContain('ECONNREFUSED')
    expect(line).not.toContain('S3cretPw')
  })
})
