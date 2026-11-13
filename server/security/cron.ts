import { createHash, timingSafeEqual } from 'node:crypto'

const MIN_SECRET_LENGTH = 16

const digest = (text: string) => createHash('sha256').update(text).digest()

/**
 * Tells the daily reset's caller apart from everyone else: Vercel Cron sends `Authorization: Bearer
 * <CRON_SECRET>`. The comparison takes the same time whatever the guess (both sides hashed to one length).
 */
export function createCronGuard(secret: string | undefined): (request: Request) => boolean {
  if (!secret || secret.length < MIN_SECRET_LENGTH) {
    throw new Error(`CRON_SECRET is missing or too short (at least ${MIN_SECRET_LENGTH} characters).`)
  }
  const expected = digest(`Bearer ${secret}`)
  return (request) => timingSafeEqual(digest(request.headers.get('authorization') ?? ''), expected)
}
