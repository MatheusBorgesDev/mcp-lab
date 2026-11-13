import { createBarbershop } from '../server/app/barbershop.js'
import { getSql } from '../server/db/client.js'
import { insertEvents } from '../server/db/events.js'
import { createMcpRequestHandler } from '../server/mcp/server.js'

let handler: ((request: Request) => Promise<Response>) | undefined

// Public URL: /mcp (rewrite in vercel.json). Built on the first request so a missing DATABASE_URL
// fails that request, not the module import.
export default {
  fetch(request: Request): Promise<Response> {
    if (!handler) {
      const sql = getSql()
      handler = createMcpRequestHandler({ shop: createBarbershop({ sql }), events: (rows) => insertEvents(sql, rows) })
    }
    return handler(request)
  },
}
