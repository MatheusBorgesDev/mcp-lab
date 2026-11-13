import { createHmac } from 'node:crypto'

const MIN_SALT_LENGTH = 16

/**
 * The visitor's address, as the Vercel proxy reports it. Vercel sets both headers itself and overwrites what
 * the client sent, so they cannot be spoofed in production. Locally they are absent or whatever the caller sends.
 */
export function clientIp(headers: Headers): string | undefined {
  const real = headers.get('x-real-ip')?.trim()
  if (real) return real
  return headers.get('x-forwarded-for')?.split(',')[0]?.trim() || undefined
}

/**
 * What identifies one visitor for the limits. IPv6 is cut to its /64 network: a home connection gets a whole
 * /64 and can switch addresses inside it at will. An IPv4 address written as IPv6 counts as the IPv4 address.
 */
function networkOf(ip: string): string {
  const address = ip.split('%')[0] ?? ip
  const mapped = /^::ffff:(\d{1,3}(?:\.\d{1,3}){3})$/i.exec(address)
  if (mapped?.[1]) return mapped[1]
  if (!address.includes(':')) return address

  const [head = '', tail] = address.split('::')
  const headParts = head ? head.split(':') : []
  const tailParts = tail ? tail.split(':') : []
  const tailGroups = tailParts.reduce((n, part) => n + (part.includes('.') ? 2 : 1), 0)
  const groups =
    tail === undefined ? headParts : [...headParts, ...Array<string>(8 - headParts.length - tailGroups).fill('0'), ...tailParts]
  return `${groups
    .slice(0, 4)
    .map((g) => Number.parseInt(g, 16).toString(16))
    .join(':')}::/64`
}

/**
 * Builds the function that turns a request into the visitor's key: an HMAC of their network with a secret
 * salt, so the stored value (appointments.ip_hash) cannot be turned back into an address by trying them all.
 * Requests without an address share one key.
 */
export function createVisitorKey(salt: string | undefined): (request: Request | undefined) => string {
  if (!salt || salt.length < MIN_SALT_LENGTH) {
    throw new Error(`IP_HASH_SALT is missing or too short (at least ${MIN_SALT_LENGTH} characters).`)
  }
  return (request) => {
    const ip = request ? clientIp(request.headers) : undefined
    return createHmac('sha256', salt)
      .update(ip ? networkOf(ip) : 'unknown')
      .digest('hex')
  }
}
