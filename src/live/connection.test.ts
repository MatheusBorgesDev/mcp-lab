import type { SupabaseClient } from '@supabase/supabase-js'
import { describe, expect, it, vi } from 'vitest'
import { createLiveConnection } from './connection'
import type { SubscribeStatus } from './status'

/** Stands in for the Supabase client: records each channel so the test can play the server's part. */
function fakeClient() {
  const channels = new Map<
    string,
    { options: unknown; onBroadcast?: (m: { event: string; payload: unknown }) => void; onStatus?: (s: SubscribeStatus) => void }
  >()
  const client = {
    channel(topic: string, options: unknown) {
      const record: (typeof channels extends Map<string, infer V> ? V : never) = { options }
      channels.set(topic, record)
      const channel = {
        on(_type: string, _filter: unknown, callback: (m: { event: string; payload: unknown }) => void) {
          record.onBroadcast = callback
          return channel
        },
        subscribe(callback: (s: SubscribeStatus) => void) {
          record.onStatus = callback
          return channel
        },
      }
      return channel
    },
  }
  return { client: client as unknown as SupabaseClient, channels }
}

describe('live connection', () => {
  it('listens to the agenda and inspector channels as private channels', () => {
    const { client, channels } = fakeClient()

    createLiveConnection(client)

    expect([...channels.keys()]).toEqual(['agenda', 'inspector'])
    for (const { options } of channels.values()) expect(options).toEqual({ config: { private: true } })
  })

  it('is live once both channels are subscribed, and tells its listeners', () => {
    const { client, channels } = fakeClient()
    const live = createLiveConnection(client)
    const listener = vi.fn()
    live.subscribe(listener)

    expect(live.getSnapshot().status).toBe('connecting')
    channels.get('agenda')?.onStatus?.('SUBSCRIBED')
    channels.get('inspector')?.onStatus?.('SUBSCRIBED')

    expect(live.getSnapshot().status).toBe('live')
    expect(listener).toHaveBeenCalled()
  })

  it('counts each time it becomes live again, so the page knows when to reload what it may have missed', () => {
    const { client, channels } = fakeClient()
    const live = createLiveConnection(client)
    const all = (s: SubscribeStatus) => {
      for (const c of channels.values()) c.onStatus?.(s)
    }

    all('SUBSCRIBED')
    expect(live.getSnapshot()).toEqual({ status: 'live', generation: 1 })

    channels.get('agenda')?.onStatus?.('CHANNEL_ERROR')
    expect(live.getSnapshot()).toEqual({ status: 'reconnecting', generation: 1 })

    all('SUBSCRIBED')
    expect(live.getSnapshot()).toEqual({ status: 'live', generation: 2 })
  })

  it('keeps the same snapshot while nothing changes', () => {
    const { client, channels } = fakeClient()
    const live = createLiveConnection(client)
    channels.get('agenda')?.onStatus?.('SUBSCRIBED')

    const before = live.getSnapshot()
    channels.get('agenda')?.onStatus?.('SUBSCRIBED')

    expect(live.getSnapshot()).toBe(before)
  })

  it('hands each broadcast to the handlers of its channel only', () => {
    const { client, channels } = fakeClient()
    const live = createLiveConnection(client)
    const agenda = vi.fn()
    const inspector = vi.fn()
    live.onMessage('agenda', agenda)
    const stop = live.onMessage('inspector', inspector)

    channels.get('agenda')?.onBroadcast?.({ event: 'appointment', payload: { op: 'insert' } })
    stop()
    channels.get('inspector')?.onBroadcast?.({ event: 'call', payload: { events: [] } })

    expect(agenda).toHaveBeenCalledWith({ event: 'appointment', payload: { op: 'insert' } })
    expect(inspector).not.toHaveBeenCalled()
  })

  it('is unavailable without a Supabase client, and opens nothing', () => {
    const live = createLiveConnection(null)

    expect(live.getSnapshot()).toEqual({ status: 'unavailable', generation: 0 })
    expect(() => live.onMessage('agenda', () => {})()).not.toThrow()
  })
})
