import type { RealtimeChannel, SupabaseClient } from '@supabase/supabase-js'
import type postgres from 'postgres'
import { afterAll, afterEach, describe, expect, it } from 'vitest'
import { connectLocalDb, connectLocalSupabase, inRolledBackTransaction, insertAppointment, insertCatalogFixture } from './helpers.js'

// The live updates. The database broadcasts each change itself (realtime.send, in the same transaction), on
// private channels that a visitor (role anon, publishable key) may only listen to. Public channels would let
// anyone with the key broadcast fake bookings to every visitor.
const sql = connectLocalDb()
const visitors: SupabaseClient[] = []
const channels: RealtimeChannel[] = []
afterEach(async () => {
  await Promise.all(channels.splice(0).map((c) => c.unsubscribe()))
})
afterAll(async () => {
  for (const v of visitors) v.realtime.disconnect()
  await sql.end()
})

type Message = { event: string; payload: Record<string, unknown> }

/** A visitor listening to one private channel; resolves once subscribed, or rejects with the server's reason. */
async function listen(topic: string, client?: SupabaseClient) {
  const visitor = client ?? connectLocalSupabase()
  if (!client) visitors.push(visitor)
  const messages: Message[] = []
  const waiters: Array<() => void> = []
  const channel = visitor.channel(topic, { config: { private: true } })
  channel.on('broadcast', { event: '*' }, ({ event, payload }) => {
    messages.push({ event, payload })
    for (const wake of waiters.splice(0)) wake()
  })
  channels.push(channel)
  await new Promise<void>((resolve, reject) => {
    channel.subscribe((status, error) => {
      if (status === 'SUBSCRIBED') resolve()
      else if (status !== 'CLOSED') reject(new Error(`${status}: ${error?.message ?? 'no reason'}`))
    })
  })

  /** Waits for the first message that matches, failing after `ms`. */
  async function next(match: (m: Message) => boolean, ms = 5000): Promise<Message> {
    const deadline = Date.now() + ms
    for (;;) {
      const found = messages.find(match)
      if (found) return found
      const left = deadline - Date.now()
      if (left <= 0) throw new Error(`no matching message on "${topic}" within ${ms} ms; got ${JSON.stringify(messages)}`)
      await new Promise<void>((resolve) => {
        waiters.push(resolve)
        setTimeout(resolve, left)
      })
    }
  }
  return { visitor, channel, messages, next }
}

/** A marker broadcast by the server, to know that everything sent before it has been delivered. */
async function serverPing(topic: string) {
  const nonce = crypto.randomUUID()
  await sql`select realtime.send(${sql.json({ nonce })}, 'ping', ${topic}, true)`
  return (m: Message) => m.event === 'ping' && m.payload.nonce === nonce
}

describe('realtime: private channels, listen-only for visitors', () => {
  it.each(['agenda', 'inspector'])('delivers what the server broadcasts on "%s" to an anonymous visitor', async (topic) => {
    const visitor = await listen(topic)

    const isPing = await serverPing(topic)

    expect(await visitor.next(isPing)).toMatchObject({ event: 'ping' })
  })

  // The server takes about 4 s to refuse a join (seen locally, 13/11/2026), more than the default timeout.
  it('refuses to let a visitor join a private channel other than the public ones', { timeout: 15_000 }, async () => {
    await expect(listen('backoffice')).rejects.toThrow(/Unauthorized/)
  })

  it('does not deliver a broadcast sent by a visitor (no fake bookings)', async () => {
    const watcher = await listen('agenda')
    const forger = await listen('agenda')

    await forger.channel.send({ type: 'broadcast', event: 'appointment', payload: { forged: true } })
    const isPing = await serverPing('agenda')
    await watcher.next(isPing)

    expect(watcher.messages.filter((m) => m.payload.forged)).toEqual([])
  })
})

describe('realtime: what the database broadcasts', () => {
  const lastMessage = (tx: postgres.TransactionSql, topic: string) => tx<
    Array<{ event: string; payload: Record<string, unknown>; private: boolean }>
  >`select event, payload, private from realtime.messages where topic = ${topic} order by inserted_at desc, id desc limit 1`

  it('broadcasts a new appointment on "agenda" with its public columns only', () =>
    inRolledBackTransaction(sql, async (tx) => {
      await insertCatalogFixture(tx)
      const [row] = await insertAppointment(tx, { startsAt: '2030-01-07T10:00:00-03:00', endsAt: '2030-01-07T10:30:00-03:00' })
        .then(() => tx`select id from appointments where professional_id = 'test-ana'`)

      const [message] = await lastMessage(tx, 'agenda')
      expect(message).toMatchObject({ event: 'appointment', private: true })
      expect(message?.payload).toMatchObject({
        op: 'insert',
        appointment: {
          id: row?.id,
          professional_id: 'test-ana',
          service_id: 'test-corte',
          starts_at: '2030-01-07T13:00:00+00:00',
          ends_at: '2030-01-07T13:30:00+00:00',
          status: 'confirmed',
          public_alias: 'Cliente #0001',
        },
      })
      expect(Object.keys(message?.payload.appointment as object).sort()).toEqual(
        ['ends_at', 'id', 'professional_id', 'public_alias', 'service_id', 'starts_at', 'status'],
      )
      expect(JSON.stringify(message?.payload)).not.toMatch(/Private Name|private-ip-hash|code_hash/)
    }))

  it('broadcasts a cancellation as an update with the new status', () =>
    inRolledBackTransaction(sql, async (tx) => {
      await insertCatalogFixture(tx)
      await insertAppointment(tx, { startsAt: '2030-01-07T10:00:00-03:00', endsAt: '2030-01-07T10:30:00-03:00' })

      await tx`update appointments set status = 'cancelled' where professional_id = 'test-ana'`

      const [message] = await lastMessage(tx, 'agenda')
      expect(message?.payload).toMatchObject({ op: 'update', appointment: { status: 'cancelled' } })
    }))

  it('broadcasts the steps of one tool call as one message on "inspector"', () =>
    inRolledBackTransaction(sql, async (tx) => {
      const requestId = crypto.randomUUID()
      await tx`
        insert into mcp_events (request_id, tool_name, step, detail, duration_ms, client_label)
        values (${requestId}, 'list_services', 'received', '{"args":{}}', 0, 'Claude'),
               (${requestId}, 'list_services', 'responded', '{"is_error":false}', 12, 'Claude')
      `

      const [message] = await lastMessage(tx, 'inspector')
      expect(message).toMatchObject({ event: 'call', private: true })
      expect(message?.payload.events).toMatchObject([
        { request_id: requestId, step: 'received', detail: { args: {} }, client_label: 'Claude', tool_name: 'list_services' },
        { request_id: requestId, step: 'responded', duration_ms: 12 },
      ])
    }))

  it('broadcasts nothing when the write is rolled back', async () => {
    const visitor = await listen('agenda')

    await inRolledBackTransaction(sql, async (tx) => {
      await insertCatalogFixture(tx)
      await insertAppointment(tx, { startsAt: '2030-01-07T10:00:00-03:00', endsAt: '2030-01-07T10:30:00-03:00' })
    })
    const isPing = await serverPing('agenda')
    await visitor.next(isPing)

    expect(visitor.messages.filter((m) => m.event === 'appointment')).toEqual([])
  })
})
