import { existsSync, readFileSync } from 'node:fs'
import path from 'node:path'
import { getRequestListener } from '@hono/node-server'
import type { Plugin } from 'vite'
import { resolveApiRoute, type Rewrite } from './api-routes.js'

type WebHandler = { fetch: (request: Request) => Response | Promise<Response> }

function isWebHandler(value: unknown): value is WebHandler {
  return typeof value === 'object' && value !== null && typeof (value as WebHandler).fetch === 'function'
}

function readRewrites(root: string): Rewrite[] {
  const file = path.join(root, 'vercel.json')
  if (!existsSync(file)) return []
  const config: unknown = JSON.parse(readFileSync(file, 'utf8'))
  const rewrites = (config as { rewrites?: unknown }).rewrites
  if (!Array.isArray(rewrites)) return []
  return rewrites.filter(
    (r): r is Rewrite => typeof r?.source === 'string' && typeof r?.destination === 'string',
  )
}

/**
 * Serves the Vercel Functions in /api from the Vite dev server, on the same port as the page.
 * Each function must use the Web signature (`export default { fetch }`), the same one Vercel runs.
 * Only exact-path rewrites from vercel.json are honoured.
 */
export function vercelApiDev(): Plugin {
  return {
    name: 'vercel-api-dev',
    apply: 'serve',
    configureServer(server) {
      const root = server.config.root

      server.middlewares.use((req, res, next) => {
        const pathname = new URL(req.url ?? '/', 'http://localhost').pathname
        const modulePath = resolveApiRoute(pathname, readRewrites(root))
        if (!modulePath) return next()

        const file = path.join(root, modulePath)
        if (!existsSync(file)) {
          res.statusCode = 404
          res.setHeader('content-type', 'application/json')
          res.end(JSON.stringify({ error: `No function at ${modulePath}` }))
          return
        }

        server
          .ssrLoadModule(file)
          .then((mod) => {
            const handler: unknown = mod.default
            if (!isWebHandler(handler)) {
              throw new Error(`${modulePath} must export default { fetch(request) }`)
            }
            // Keep Node's own Request/Response globals, as the Vercel runtime does.
            const listener = getRequestListener((request) => handler.fetch(request), {
              overrideGlobalObjects: false,
            })
            return listener(req, res)
          })
          .catch((error: unknown) => {
            if (error instanceof Error) server.ssrFixStacktrace(error)
            next(error)
          })
      })
    },
  }
}
