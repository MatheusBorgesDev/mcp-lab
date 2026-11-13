import { useContext, useEffect, useRef, useSyncExternalStore } from 'react'
import type { LiveMessage, LiveSnapshot, Topic } from './connection'
import { LiveContext } from './context'

/** The live status and its generation (see LiveSnapshot). */
export function useLive(): LiveSnapshot {
  const connection = useContext(LiveContext)
  return useSyncExternalStore(connection.subscribe, connection.getSnapshot)
}

/** Calls `handler` with every broadcast on `topic`. The latest handler is used; it need not be memoized. */
export function useBroadcast(topic: Topic, handler: (message: LiveMessage) => void): void {
  const connection = useContext(LiveContext)
  const latest = useRef(handler)
  useEffect(() => {
    latest.current = handler
  })
  useEffect(() => connection.onMessage(topic, (message) => latest.current(message)), [connection, topic])
}
