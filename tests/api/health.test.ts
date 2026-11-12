import { describe, expect, it } from 'vitest'
import health from '../../api/health.js'

describe('GET /api/health', () => {
  it('answers 200 with ok: true as JSON', async () => {
    const response = await health.fetch(new Request('http://localhost/api/health'))

    expect(response.status).toBe(200)
    expect(response.headers.get('content-type')).toContain('application/json')
    expect(await response.json()).toEqual({ ok: true })
  })
})
