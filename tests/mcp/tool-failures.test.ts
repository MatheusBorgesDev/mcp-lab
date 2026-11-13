import { format } from 'node:util'
import { Client, StreamableHTTPClientTransport } from '@modelcontextprotocol/client'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { Barbershop } from '../../server/app/barbershop.js'
import { SHOP_RULES } from '../../server/domain/rules.js'
import { createMcpRequestHandler } from '../../server/mcp/server.js'

// No database: the shop is a stub whose catalogue fails, to see what an unexpected error leaves in the log.
async function connect(shop: Barbershop): Promise<Client> {
  const handler = createMcpRequestHandler({ shop, events: async () => {}, identifyVisitor: () => ({ key: 'test-visitor', shared: false }) })
  const client = new Client({ name: 'test-client', version: '1.0.0' }, { versionNegotiation: { mode: { pin: '2026-07-28' } } })
  await client.connect(
    new StreamableHTTPClientTransport(new URL('http://barber.test/mcp'), { fetch: (url, init) => handler(new Request(url, init)) }),
  )
  return client
}

describe('MCP server: unexpected failures', () => {
  afterEach(() => vi.restoreAllMocks())

  it('logs the error type, message and code, but not the other properties the error carries', async () => {
    // Node's URL errors carry the whole input: for a connection string, that includes the password.
    const error = Object.assign(new TypeError('Invalid URL'), { code: 'ERR_INVALID_URL', input: 'postgresql://u:S3cretPw@db/x' })
    const shop = { rules: SHOP_RULES, catalog: () => Promise.reject(error) } as unknown as Barbershop
    const logged = vi.spyOn(console, 'error').mockImplementation(() => {})

    const result = await (await connect(shop)).callTool({ name: 'list_services', arguments: {} })

    expect(result.structuredContent).toMatchObject({ code: 'INTERNAL_ERROR' })
    expect(logged).toHaveBeenCalledTimes(1)
    const line = format(...(logged.mock.calls[0] ?? []))
    expect(line).toContain('[mcp] tool failed')
    expect(line).toContain('TypeError: Invalid URL')
    expect(line).toContain('ERR_INVALID_URL')
    expect(line).not.toContain('S3cretPw')
  })
})
