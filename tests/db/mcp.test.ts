import { Client, StreamableHTTPClientTransport } from '@modelcontextprotocol/client'
import postgres from 'postgres'
import { afterAll, afterEach, describe, expect, it, vi } from 'vitest'
import { createBarbershop } from '../../server/app/barbershop.js'
import { createMcpRequestHandler } from '../../server/mcp/server.js'
import { connectLocalDb } from './helpers.js'

// The MCP server end to end: the SDK's own client talks to our handler in memory, against the seed data
// (pnpm db:reset). The clock is pinned to Sunday 2030-01-06 12:00 in São Paulo; appointments these tests
// create are on seed professionals in 2030 and are deleted after each test.
const sql = connectLocalDb()
const SEED_PROFESSIONALS = ['rafael', 'bruno', 'diego', 'lucas']
afterEach(() => sql`
  delete from appointments where professional_id in ${sql(SEED_PROFESSIONALS)} and starts_at >= '2030-01-01'
`)
afterAll(() => sql.end())

const NOW = new Date('2030-01-06T12:00:00-03:00')
const handler = createMcpRequestHandler({ shop: createBarbershop({ sql, now: () => NOW }) })

async function connect(era: 'modern' | 'legacy' = 'modern', to = handler): Promise<Client> {
  const client = new Client(
    { name: 'test-client', version: '1.0.0' },
    era === 'modern' ? { versionNegotiation: { mode: { pin: '2026-07-28' } } } : {},
  )
  const transport = new StreamableHTTPClientTransport(new URL('http://barber.test/mcp'), {
    fetch: (url, init) => to(new Request(url, init)),
  })
  await client.connect(transport)
  return client
}

type Structured = Record<string, unknown>

// Other test files commit fixtures with ids starting with "test-" while this one runs.
const seedOnly = (items: Structured[]) => items.filter((i) => !String(i.id).startsWith('test-'))

async function call(client: Client, name: string, args: Record<string, unknown> = {}) {
  const result = await client.callTool({ name, arguments: args })
  return { isError: result.isError === true, data: (result.structuredContent ?? {}) as Structured, result }
}

describe('MCP server: read tools', () => {
  it('advertises the read tools as read-only, with their input schemas', async () => {
    const client = await connect()
    const { tools } = await client.listTools()
    const byName = new Map(tools.map((t) => [t.name, t]))

    for (const name of ['list_services', 'list_professionals', 'check_availability', 'get_appointment']) {
      expect(byName.get(name)?.annotations?.readOnlyHint, name).toBe(true)
    }
    expect(byName.get('check_availability')?.inputSchema).toMatchObject({
      properties: { service_id: { type: 'string' }, date: { type: 'string' } },
      required: ['service_id', 'date'],
    })
  })

  it('list_services returns the catalogue with prices in reais and who does each service', async () => {
    const { isError, data } = await call(await connect(), 'list_services')

    expect(isError).toBe(false)
    const services = seedOnly(data.services as Array<Structured>)
    expect(services).toHaveLength(8)
    expect(services.find((s) => s.id === 'platinado')).toMatchObject({
      name: 'Platinado',
      duration_min: 120,
      price: 'R$ 180,00',
      price_cents: 18000,
      professionals: [{ id: 'diego', name: 'Diego' }],
    })
  })

  it('list_professionals returns services and weekly working hours', async () => {
    const { data } = await call(await connect(), 'list_professionals')

    const rafael = (data.professionals as Array<Structured>).find((p) => p.id === 'rafael')
    expect(rafael?.working_hours).toMatchObject({ tuesday: ['09:00-12:00', '13:00-19:00'] })
    expect(rafael?.working_hours).not.toHaveProperty('monday')
    expect(rafael?.services).toContainEqual({ id: 'barba', name: 'Barba' })
  })

  it('check_availability returns free starts as ISO 8601 with the shop offset', async () => {
    const { isError, data } = await call(await connect(), 'check_availability', {
      service_id: 'corte-masculino',
      date: '2030-01-07',
    })

    expect(isError).toBe(false)
    const starts = Object.fromEntries(
      (data.professionals as Array<{ id: string; free_starts: string[] }>).map((p) => [p.id, p.free_starts]),
    )
    // Monday: Rafael and Bruno are off; Diego starts at 11:00, Lucas at 09:00.
    expect(starts.rafael).toEqual([])
    expect(starts.bruno).toEqual([])
    expect(starts.diego?.[0]).toBe('2030-01-07T11:00:00-03:00')
    expect(starts.lucas?.[0]).toBe('2030-01-07T09:00:00-03:00')
  })

  it.each([
    ['a date in another format', { service_id: 'corte-masculino', date: '07/01/2030' }],
    ['a date that does not exist', { service_id: 'corte-masculino', date: '2030-02-30' }],
    ['a missing service', { date: '2030-01-07' }],
    ['an oversized id', { service_id: 'x'.repeat(200), date: '2030-01-07' }],
  ])('answers INVALID_INPUT as structured content for %s', async (_label, args) => {
    const { isError, data } = await call(await connect(), 'check_availability', args)

    expect(isError).toBe(true)
    expect(data).toMatchObject({ code: 'INVALID_INPUT', message: expect.any(String) })
  })

  it('answers domain errors with their code', async () => {
    const { isError, data } = await call(await connect(), 'check_availability', {
      service_id: 'platinado',
      date: '2030-01-07',
      professional_id: 'rafael',
    })

    expect(isError).toBe(true)
    expect(data).toMatchObject({ code: 'PROFESSIONAL_DOES_NOT_OFFER_SERVICE' })
  })

  it('get_appointment does not find an unknown code', async () => {
    const { isError, data } = await call(await connect(), 'get_appointment', { code: 'ABCDE-FGHJK' })

    expect(isError).toBe(true)
    expect(data).toMatchObject({ code: 'APPOINTMENT_NOT_FOUND' })
  })

  it('serves 2025-era clients through the same handler', async () => {
    const { isError, data } = await call(await connect('legacy'), 'list_services')

    expect(isError).toBe(false)
    expect(seedOnly(data.services as Array<Structured>)).toHaveLength(8)
  })
})

describe('MCP server: failures', () => {
  it('reports an unreachable database as INTERNAL_ERROR without internal details', async () => {
    const unreachable = postgres('postgresql://nobody:secret@127.0.0.1:1/none', { max: 1, connect_timeout: 2 })
    const broken = createMcpRequestHandler({ shop: createBarbershop({ sql: unreachable, now: () => NOW }) })
    const errors: unknown[] = []
    const originalError = console.error
    console.error = (...args: unknown[]) => errors.push(args)

    try {
      const { isError, data, result } = await call(await connect('modern', broken), 'list_services')

      expect(isError).toBe(true)
      expect(data).toMatchObject({ code: 'INTERNAL_ERROR' })
      expect(JSON.stringify(result)).not.toMatch(/127\.0\.0\.1|ECONNREFUSED|secret/)
      expect(errors).toHaveLength(1)
    } finally {
      console.error = originalError
      await unreachable.end()
    }
  })
})

describe('MCP server: write tools', () => {
  afterEach(() => vi.unstubAllEnvs())

  // Monday 2030-01-07 at 09:00 only Lucas works (Diego starts at 11:00), so the shop picks him.
  const NINE = '2030-01-07T09:00:00-03:00'

  async function book(client: Client, args: Record<string, unknown> = {}) {
    const booked = await call(client, 'book_appointment', { service_id: 'corte-masculino', start: NINE, ...args })
    if (booked.isError) throw new Error(`booking failed: ${JSON.stringify(booked.data)}`)
    return booked.data as { code: string; appointment: Structured & { id: string }; watch_url: string }
  }

  it('advertises booking and rescheduling as writes and cancelling as destructive', async () => {
    const { tools } = await (await connect()).listTools()
    const hints = Object.fromEntries(tools.map((t) => [t.name, t.annotations]))

    expect(hints.book_appointment).toMatchObject({ readOnlyHint: false, destructiveHint: false })
    expect(hints.reschedule_appointment).toMatchObject({ readOnlyHint: false, destructiveHint: false })
    expect(hints.cancel_appointment).toMatchObject({ readOnlyHint: false, destructiveHint: true })
  })

  it('books a time and returns the code, the appointment and a link to watch it live', async () => {
    const client = await connect()

    const { code, appointment, watch_url } = await book(client)

    expect(code).toMatch(/^[0-9A-Z]{5}-[0-9A-Z]{5}$/)
    expect(appointment).toMatchObject({
      status: 'confirmed',
      start: NINE,
      end: '2030-01-07T09:30:00-03:00',
      professional: { id: 'lucas', name: 'Lucas' },
      service: { id: 'corte-masculino', price: 'R$ 50,00' },
    })
    expect(watch_url).toBe(`http://barber.test/?appointment=${appointment.id}`)
    expect(await call(client, 'get_appointment', { code })).toMatchObject({
      isError: false,
      data: { appointment: { id: appointment.id } },
    })
  })

  it('links to the production site when Vercel provides its URL', async () => {
    vi.stubEnv('VERCEL_PROJECT_PRODUCTION_URL', 'mcp-barber-shop.vercel.app')

    const { appointment, watch_url } = await book(await connect())

    expect(watch_url).toBe(`https://mcp-barber-shop.vercel.app/?appointment=${appointment.id}`)
  })

  it('never echoes the client name back', async () => {
    const client = await connect()
    const booked = await client.callTool({
      name: 'book_appointment',
      arguments: { service_id: 'corte-masculino', start: NINE, client_name: 'Maria Privada' },
    })

    expect(booked.isError).toBeFalsy()
    expect(JSON.stringify(booked)).not.toContain('Maria Privada')
  })

  it('refuses a taken time with suggestions in shop time', async () => {
    const client = await connect()
    await book(client)

    const { isError, data } = await call(client, 'book_appointment', {
      service_id: 'corte-masculino',
      start: NINE,
      professional_id: 'lucas',
    })

    expect(isError).toBe(true)
    expect(data).toMatchObject({ code: 'SLOT_UNAVAILABLE' })
    // Lucas starts at 09:00 and 09:00-09:30 is taken: the nearest free starts are all after it.
    expect(data.suggestions).toEqual([
      { start: '2030-01-07T09:30:00-03:00', professional_id: 'lucas', professional_name: 'Lucas' },
      { start: '2030-01-07T09:45:00-03:00', professional_id: 'lucas', professional_name: 'Lucas' },
      { start: '2030-01-07T10:00:00-03:00', professional_id: 'lucas', professional_name: 'Lucas' },
    ])
  })

  it('reschedules with the code, keeping the professional', async () => {
    const client = await connect()
    const { code } = await book(client)

    const { isError, data } = await call(client, 'reschedule_appointment', {
      code,
      new_start: '2030-01-07T10:00:00-03:00',
    })

    expect(isError).toBe(false)
    expect(data.appointment).toMatchObject({ start: '2030-01-07T10:00:00-03:00', professional: { id: 'lucas' } })
  })

  it('cancels with the code and frees the time', async () => {
    const client = await connect()
    const { code } = await book(client)

    const cancelled = await call(client, 'cancel_appointment', { code })

    expect(cancelled).toMatchObject({ isError: false, data: { appointment: { status: 'cancelled' }, already_cancelled: false } })
    await book(client)
  })

  it('rejects a start without a UTC offset as INVALID_INPUT', async () => {
    const { isError, data } = await call(await connect(), 'book_appointment', {
      service_id: 'corte-masculino',
      start: '2030-01-07T09:00:00',
    })

    expect(isError).toBe(true)
    expect(data).toMatchObject({ code: 'INVALID_INPUT' })
  })
})

