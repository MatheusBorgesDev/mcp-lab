import type { SupabaseClient } from '@supabase/supabase-js'
import { liveStatus, type LiveStatus, type SubscribeStatus } from './status'

/** The private channels the database broadcasts on (see supabase/migrations, realtime_broadcast). */
export const TOPICS = ['agenda', 'inspector'] as const
export type Topic = (typeof TOPICS)[number]

export type LiveMessage = { event: string; payload: unknown }

export type LiveSnapshot = {
  status: LiveStatus
  /** Increases each time the page becomes live (first time and every reconnection). Data loaded before it may
   * have missed broadcasts, so whoever shows live data reloads when it changes. */
  generation: number
}

export type LiveConnection = {
  getSnapshot(): LiveSnapshot
  /** For useSyncExternalStore. */
  subscribe(listener: () => void): () => void
  onMessage(topic: Topic, handler: (message: LiveMessage) => void): () => void
}

const UNAVAILABLE: LiveConnection = {
  getSnapshot: () => UNAVAILABLE_SNAPSHOT,
  subscribe: () => () => {},
  onMessage: () => () => {},
}
const UNAVAILABLE_SNAPSHOT: LiveSnapshot = { status: 'unavailable', generation: 0 }

/**
 * Opens the page's live channels once, for the life of the page. Kept outside React: Supabase returns the same
 * channel for the same topic while an earlier one is still closing, which breaks effects that open and close
 * channels (StrictMode runs them twice).
 */
export function createLiveConnection(client: Pick<SupabaseClient, 'channel'> | null): LiveConnection {
  if (!client) return UNAVAILABLE

  const statuses: Partial<Record<Topic, SubscribeStatus>> = {}
  const handlers = new Map<Topic, Set<(message: LiveMessage) => void>>()
  const listeners = new Set<() => void>()
  let snapshot: LiveSnapshot = { status: 'connecting', generation: 0 }

  function update(topic: Topic, status: SubscribeStatus) {
    statuses[topic] = status
    const next = liveStatus(TOPICS.map((t) => statuses[t]))
    if (next === snapshot.status) return
    snapshot = { status: next, generation: snapshot.generation + (next === 'live' ? 1 : 0) }
    for (const listener of listeners) listener()
  }

  for (const topic of TOPICS) {
    client
      .channel(topic, { config: { private: true } })
      .on('broadcast', { event: '*' }, ({ event, payload }) => {
        for (const handler of handlers.get(topic) ?? []) handler({ event, payload })
      })
      .subscribe((status) => update(topic, status))
  }

  return {
    getSnapshot: () => snapshot,
    subscribe(listener) {
      listeners.add(listener)
      return () => listeners.delete(listener)
    },
    onMessage(topic, handler) {
      const set = handlers.get(topic) ?? new Set()
      handlers.set(topic, set)
      set.add(handler)
      return () => set.delete(handler)
    },
  }
}
