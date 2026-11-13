import type { ReactNode } from 'react'
import type { LiveConnection } from './connection'
import { LiveContext } from './context'

export function LiveProvider({ connection, children }: { connection: LiveConnection; children: ReactNode }) {
  return <LiveContext.Provider value={connection}>{children}</LiveContext.Provider>
}
