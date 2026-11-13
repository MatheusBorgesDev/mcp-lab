import { describe, expect, it } from 'vitest'
import { createSupabase } from './supabase'

const VALID = {
  VITE_SUPABASE_URL: 'https://xaarmzvbrmxwgixqnfzx.supabase.co',
  VITE_SUPABASE_PUBLISHABLE_KEY: 'sb_publishable_0123456789abcdefghijklmn',
}

describe('createSupabase', () => {
  it('creates a client from the public URL and key', () => {
    expect(createSupabase(VALID)?.channel).toBeTypeOf('function')
  })

  it.each([
    ['without the variables', {}],
    ['with a URL that is not a URL', { ...VALID, VITE_SUPABASE_URL: 'xaarmzvbrmxwgixqnfzx' }],
    ['with an empty key', { ...VALID, VITE_SUPABASE_PUBLISHABLE_KEY: '' }],
  ])('returns null %s, so the page still renders without live data', (_case, env) => {
    expect(createSupabase(env)).toBeNull()
  })
})
