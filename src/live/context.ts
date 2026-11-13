import { createContext } from 'react'
import { createLiveConnection, type LiveConnection } from './connection'

/** Defaults to a connection with no Supabase client: "sem tempo real". */
export const LiveContext = createContext<LiveConnection>(createLiveConnection(null))
