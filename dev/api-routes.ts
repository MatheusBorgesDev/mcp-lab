export type Rewrite = { source: string; destination: string }

// One or more path segments of letters, digits, "-" or "_": no dots, so no "..", no extensions.
const API_PATH = /^\/api((?:\/[A-Za-z0-9_-]+)+)$/

/**
 * Returns the /api function file that serves `pathname` (e.g. "api/health.ts"), or null when the
 * path is not a function and Vite should handle it. Mirrors Vercel: an exact-match rewrite from
 * vercel.json applies first, then /api/<name> maps to api/<name>.ts.
 */
export function resolveApiRoute(pathname: string, rewrites: readonly Rewrite[] = []): string | null {
  const target = rewrites.find((rewrite) => rewrite.source === pathname)?.destination ?? pathname
  const match = API_PATH.exec(target)
  return match ? `api${match[1]}.ts` : null
}
