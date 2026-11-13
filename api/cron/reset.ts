import { createDailyResetHandler, runDailyReset } from '../../server/app/daily-reset.js'
import { getSql } from '../../server/db/client.js'
import { createCronGuard } from '../../server/security/cron.js'

let handler: ((request: Request) => Promise<Response>) | undefined

// Vercel Cron calls GET /api/cron/reset once a day ("crons" in vercel.json), with CRON_SECRET as a bearer token.
// Built on the first request, so a missing CRON_SECRET fails that request, not the module import. The database
// is reached only after the secret checks out.
export default {
  fetch(request: Request): Promise<Response> {
    handler ??= createDailyResetHandler({
      isCron: createCronGuard(process.env.CRON_SECRET),
      run: () => runDailyReset({ sql: getSql() }),
    })
    return handler(request)
  },
}
