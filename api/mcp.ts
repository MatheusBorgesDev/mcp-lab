import { createBarbershop } from '../server/app/barbershop.js'
import { getSql } from '../server/db/client.js'
import { insertEvents } from '../server/db/events.js'
import { createMcpRequestHandler } from '../server/mcp/server.js'
import { createVisitorIdentifier } from '../server/security/ip.js'
import { createRateLimiter } from '../server/security/rate-limit.js'
import { counterFromEnv } from '../server/security/rate-limit-store.js'

let handler: ((request: Request) => Promise<Response>) | undefined

// Public URL: /mcp (rewrite in vercel.json). Built on the first request so a missing DATABASE_URL,
// IP_HASH_SALT or Redis variable (KV_REST_API_URL, KV_REST_API_TOKEN) fails that request, not the module import.
// Built once per server instance: the rate limiter keeps a cache of refused visitors between requests.
export default {
  fetch(request: Request): Promise<Response> {
    if (!handler) {
      const sql = getSql()
      handler = createMcpRequestHandler({
        shop: createBarbershop({ sql }),
        events: (rows) => insertEvents(sql, rows),
        identifyVisitor: createVisitorIdentifier(process.env.IP_HASH_SALT),
        rateLimit: createRateLimiter({ counter: counterFromEnv(process.env).counter }),
      })
    }
    return handler(request)
  },
}
