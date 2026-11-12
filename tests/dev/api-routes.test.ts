import { describe, expect, it } from 'vitest'
import { resolveApiRoute } from '../../dev/api-routes.js'

describe('resolveApiRoute', () => {
  it('maps an /api path to its function file', () => {
    expect(resolveApiRoute('/api/health')).toBe('api/health.ts')
  })

  it('maps nested /api paths', () => {
    expect(resolveApiRoute('/api/cron/reset')).toBe('api/cron/reset.ts')
  })

  it('applies an exact rewrite before mapping', () => {
    const rewrites = [{ source: '/mcp', destination: '/api/mcp' }]
    expect(resolveApiRoute('/mcp', rewrites)).toBe('api/mcp.ts')
  })

  it('ignores paths outside /api so Vite keeps serving them', () => {
    expect(resolveApiRoute('/')).toBeNull()
    expect(resolveApiRoute('/src/main.tsx')).toBeNull()
    expect(resolveApiRoute('/api')).toBeNull()
    expect(resolveApiRoute('/api/')).toBeNull()
  })

  it('ignores rewrites whose destination is not a function', () => {
    const rewrites = [{ source: '/', destination: '/index.html' }]
    expect(resolveApiRoute('/', rewrites)).toBeNull()
  })

  it('rejects anything that could escape the api folder', () => {
    expect(resolveApiRoute('/api/../vite.config')).toBeNull()
    expect(resolveApiRoute('/api/%2e%2e/vite.config')).toBeNull()
    expect(resolveApiRoute('/api/health.ts')).toBeNull()
  })
})
