import type { REALTIME_SUBSCRIBE_STATES } from '@supabase/supabase-js'

/** What Supabase reports for one channel subscription. */
export type SubscribeStatus = `${REALTIME_SUBSCRIBE_STATES}`

/** What the header shows for the page's live connection. */
export type LiveStatus = 'connecting' | 'live' | 'reconnecting' | 'unavailable'

/**
 * One status for all the page's channels (undefined: no answer yet). The Supabase client retries on its own
 * after an error, so an error means "reconnecting", not "offline". A project idle for days also errors on the
 * first subscription ("MissingPartition": Realtime creates its daily partitions when a client connects) and
 * subscribes about a second later.
 */
export function liveStatus(channels: ReadonlyArray<SubscribeStatus | undefined>): LiveStatus {
  if (channels.some((s) => s === 'CHANNEL_ERROR' || s === 'TIMED_OUT' || s === 'CLOSED')) return 'reconnecting'
  if (channels.length > 0 && channels.every((s) => s === 'SUBSCRIBED')) return 'live'
  return 'connecting'
}
