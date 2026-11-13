import type { SupabaseClient } from '@supabase/supabase-js'
import { EVENT_COLUMNS, parseEventRows, type EventRow } from './calls'

/** Where the inspector reads the recent calls from: Supabase in the page, a fake in tests. */
export type InspectorSource = { loadRecent(): Promise<EventRow[]> }

/** Enough rows for the last few calls (a call writes up to four). */
const RECENT_ROWS = 40

export function supabaseInspectorSource(client: SupabaseClient): InspectorSource {
  return {
    async loadRecent() {
      const { data, error } = await client.from('mcp_events').select(EVENT_COLUMNS).order('id', { ascending: false }).limit(RECENT_ROWS)
      if (error) throw new Error(`Could not load the inspector: ${error.message}`)
      return parseEventRows(data)
    },
  }
}
