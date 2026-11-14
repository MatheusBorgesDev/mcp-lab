import { format } from 'node:util'
import { Client, StreamableHTTPClientTransport } from '@modelcontextprotocol/client'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { Barbershop } from '../../server/app/barbershop.js'
import type { Catalog } from '../../server/db/schedule.js'
import { SHOP_RULES, type ShopRules } from '../../server/domain/rules.js'
import { createMcpRequestHandler } from '../../server/mcp/server.js'

// The resource salon://info and the prompt agendar_horario (docs/SPEC.md, section 5), without a database: the
// shop is a stub. Both are shop content the visitor sees, so they are in pt-BR.
const CATALOG: Catalog = {
  services: [{ id: 'barba', name: 'Barba', description: null, durationMin: 30, priceCents: 4000, active: true }],
  professionals: [
    { id: 'ana', name: 'Ana', bio: null, active: true, serviceIds: ['barba'] },
    { id: 'bia', name: 'Bia', bio: null, active: true, serviceIds: ['barba'] },
    { id: 'caio', name: 'Caio', bio: null, active: false, serviceIds: ['barba'] },
  ],
  workingHours: [
    // Monday: Ana with a break, Bia later; the shop is open from the first start to the last end.
    { professionalId: 'ana', weekday: 1, startMin: 9 * 60, endMin: 12 * 60 },
    { professionalId: 'ana', weekday: 1, startMin: 13 * 60, endMin: 18 * 60 },
    { professionalId: 'bia', weekday: 1, startMin: 10 * 60 + 30, endMin: 19 * 60 },
    // Saturday: only Bia.
    { professionalId: 'bia', weekday: 6, startMin: 9 * 60, endMin: 14 * 60 },
    // Caio is inactive: his Tuesday does not open the shop.
    { professionalId: 'caio', weekday: 2, startMin: 9 * 60, endMin: 18 * 60 },
  ],
}

function connect(shop: Partial<Barbershop> = {}): Promise<Client> {
  const handler = createMcpRequestHandler({
    shop: { rules: SHOP_RULES, catalog: async () => CATALOG, ...shop } as Barbershop,
    events: async () => {},
    identifyVisitor: () => ({ key: 'test-visitor', shared: false }),
    rateLimit: async () => ({ allowed: true }),
  })
  const client = new Client({ name: 'test-client', version: '1.0.0' }, { versionNegotiation: { mode: { pin: '2026-07-28' } } })
  return client
    .connect(
      new StreamableHTTPClientTransport(new URL('http://barber.test/mcp'), { fetch: (url, init) => handler(new Request(url, init)) }),
    )
    .then(() => client)
}

async function readInfo(client: Client): Promise<string> {
  const { contents } = await client.readResource({ uri: 'salon://info' })
  expect(contents).toHaveLength(1)
  expect(contents[0]).toMatchObject({ uri: 'salon://info', mimeType: 'text/markdown' })
  const text = (contents[0] as { text?: string }).text
  if (text === undefined) throw new Error('salon://info has no text')
  return text
}

async function promptText(client: Client, args?: Record<string, string>): Promise<string> {
  const { messages } = await client.getPrompt({ name: 'agendar_horario', ...(args ? { arguments: args } : {}) })
  expect(messages).toHaveLength(1)
  expect(messages[0]?.role).toBe('user')
  const content = messages[0]?.content
  if (content?.type !== 'text') throw new Error('agendar_horario has no text message')
  return content.text
}

describe('MCP resource salon://info', () => {
  afterEach(() => vi.restoreAllMocks())

  it('is listed as the shop information, in Markdown', async () => {
    const { resources } = await (await connect()).listResources()

    expect(resources).toEqual([expect.objectContaining({ uri: 'salon://info', mimeType: 'text/markdown' })])
  })

  it('gives a fictitious address and the live agenda', async () => {
    const text = await readInfo(await connect())

    expect(text).toContain('# MCP Barber Shop')
    expect(text).toMatch(/endereço fictício/i)
    expect(text).toContain('http://barber.test/')
  })

  it('gives the opening hours of each weekday from the working hours of the active professionals', async () => {
    const text = await readInfo(await connect())

    expect(text).toContain('- Segunda: 09:00 às 19:00')
    expect(text).toContain('- Terça: fechado')
    expect(text).toContain('- Sábado: 09:00 às 14:00')
    expect(text).toContain('- Domingo: fechado')
    expect(text.indexOf('- Segunda')).toBeLessThan(text.indexOf('- Domingo'))
  })

  it('states the policies from the shop rules, not from a copy of them', async () => {
    const rules: ShopRules = {
      ...SHOP_RULES,
      minAdvanceMinutes: 180,
      maxDaysAhead: 7,
      minChangeAdvanceMinutes: 60,
      maxActiveBookingsPerVisitor: 3,
      maxDailyOccupancyPercent: 60,
    }
    const text = await readInfo(await connect({ rules }))

    expect(text).toContain('pelo menos 3 horas de antecedência')
    expect(text).toContain('até 7 dias à frente')
    expect(text).toContain('até 1 hora antes do início')
    expect(text).toContain('até 3 reservas ativas')
    expect(text).toContain('até 60% do tempo de trabalho')
    expect(text).toContain('Todo dia às 3h')
  })

  it('answers a failure without internal details, which go to the log', async () => {
    const error = Object.assign(new Error('connect ECONNREFUSED db.internal:6543'), { code: 'ECONNREFUSED' })
    const logged = vi.spyOn(console, 'error').mockImplementation(() => {})
    const client = await connect({ catalog: () => Promise.reject(error) })

    const failure = await client.readResource({ uri: 'salon://info' }).then(
      () => undefined,
      (reason: unknown) => reason,
    )

    expect(failure).toBeInstanceOf(Error)
    expect((failure as Error).message).toMatch(/something went wrong/i)
    expect((failure as Error).message).not.toContain('db.internal')
    expect(format(...(logged.mock.calls[0] ?? []))).toContain('ECONNREFUSED db.internal:6543')
  })
})

describe('MCP prompt agendar_horario', () => {
  it('is listed with an optional service argument', async () => {
    const { prompts } = await (await connect()).listPrompts()

    expect(prompts).toEqual([
      expect.objectContaining({
        name: 'agendar_horario',
        title: 'Agendar horário',
        arguments: [expect.objectContaining({ name: 'service', required: false })],
      }),
    ])
  })

  it('leads the booking: services and availability first, a summary to confirm, then the code', async () => {
    const text = await promptText(await connect())

    expect(text).toMatch(/^Quero agendar um horário na MCP Barber Shop\./)
    expect(text).toContain('list_services')
    expect(text).toContain('check_availability')
    expect(text).toMatch(/espere o meu ok/)
    expect(text).toMatch(/código da reserva/)
  })

  it('puts the service the visitor asked for in the request', async () => {
    const text = await promptText(await connect(), { service: '  barba com toalha quente ' })

    expect(text).toMatch(/^Quero agendar um horário na MCP Barber Shop: barba com toalha quente\./)
  })

  it('treats an empty service as none, and refuses one that is too long', async () => {
    const client = await connect()

    expect(await promptText(client, { service: '   ' })).toBe(await promptText(client))
    await expect(client.getPrompt({ name: 'agendar_horario', arguments: { service: 'x'.repeat(81) } })).rejects.toThrow()
  })
})
