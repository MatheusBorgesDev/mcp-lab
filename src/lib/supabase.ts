import { createClient, type SupabaseClient } from '@supabase/supabase-js'
import * as z from 'zod/mini'

// Public by design: the publishable key only reaches what RLS lets the anon role read.
const env = z.object({
  VITE_SUPABASE_URL: z.url({ protocol: /^https?$/ }),
  VITE_SUPABASE_PUBLISHABLE_KEY: z.string().check(z.minLength(20)),
})

/**
 * The page's Supabase client (read-only data and live channels), or null when the build has no Supabase
 * variables: the page then renders without live data instead of failing.
 */
export function createSupabase(values: Record<string, unknown>): SupabaseClient | null {
  const parsed = env.safeParse(values)
  if (!parsed.success) return null
  return createClient(parsed.data.VITE_SUPABASE_URL, parsed.data.VITE_SUPABASE_PUBLISHABLE_KEY, {
    // No login on this page: nothing to keep in localStorage or refresh.
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
  })
}
