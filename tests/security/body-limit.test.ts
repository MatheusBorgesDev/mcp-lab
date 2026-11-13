import { describe, expect, it } from 'vitest'
import { limitBody } from '../../server/security/body-limit.js'

const URL_ = 'https://barber.test/mcp'
const post = (body: NonNullable<RequestInit['body']>, headers: Record<string, string> = {}) =>
  new Request(URL_, { method: 'POST', body, headers, duplex: 'half' } as RequestInit)

function streamOf(totalBytes: number, chunkBytes = 1024): ReadableStream<Uint8Array> {
  let sent = 0
  return new ReadableStream({
    pull(controller) {
      if (sent >= totalBytes) return controller.close()
      const size = Math.min(chunkBytes, totalBytes - sent)
      sent += size
      controller.enqueue(new Uint8Array(size))
    },
  })
}

describe('limitBody', () => {
  it('passes a body under the limit through, intact', async () => {
    const limited = await limitBody(post('{"jsonrpc":"2.0"}', { 'content-type': 'application/json' }), 100)

    expect(limited).toBeInstanceOf(Request)
    const request = limited as Request
    expect(await request.text()).toBe('{"jsonrpc":"2.0"}')
    expect(request.headers.get('content-type')).toBe('application/json')
    expect(request.method).toBe('POST')
  })

  it('refuses by the declared length without reading the body', async () => {
    const original = post(streamOf(10), { 'content-length': '101' })

    const limited = await limitBody(original, 100)

    expect(limited).toBeInstanceOf(Response)
    expect((limited as Response).status).toBe(413)
    expect(original.bodyUsed).toBe(false)
  })

  it('refuses a streamed body once it passes the limit', async () => {
    const limited = await limitBody(post(streamOf(64 * 1024 + 1)), 64 * 1024)

    expect((limited as Response).status).toBe(413)
    expect(await (limited as Response).json()).toMatchObject({ jsonrpc: '2.0', error: { code: -32600 }, id: null })
  })

  it('accepts a body of exactly the limit', async () => {
    expect(await limitBody(post(streamOf(100)), 100)).toBeInstanceOf(Request)
  })

  it('leaves requests without a body alone', async () => {
    const get = new Request(URL_)
    expect(await limitBody(get, 100)).toBe(get)
  })
})
