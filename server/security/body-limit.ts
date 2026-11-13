/** No MCP request this server accepts comes close: the largest is a booking, well under 1 KB. */
export const MAX_BODY_BYTES = 64 * 1024

function tooLarge(maxBytes: number): Response {
  return Response.json(
    {
      jsonrpc: '2.0',
      error: { code: -32600, message: `Request body too large (limit ${Math.round(maxBytes / 1024)} KB).` },
      id: null,
    },
    { status: 413 },
  )
}

/**
 * Reads the body up to `maxBytes` and hands back an equivalent request, or a 413 response. The declared length
 * is checked first, so an honest oversized request is refused without reading it; a stream without a declared
 * length (or lying about it) is cut as soon as it passes the limit.
 */
export async function limitBody(request: Request, maxBytes = MAX_BODY_BYTES): Promise<Request | Response> {
  if (!request.body) return request

  const declared = Number(request.headers.get('content-length'))
  if (Number.isFinite(declared) && declared > maxBytes) return tooLarge(maxBytes)

  const reader = request.body.getReader()
  const chunks: Uint8Array[] = []
  let size = 0
  for (;;) {
    const { done, value } = await reader.read()
    if (done) break
    size += value.byteLength
    if (size > maxBytes) {
      await reader.cancel()
      return tooLarge(maxBytes)
    }
    chunks.push(value)
  }

  const body = new Uint8Array(size)
  let offset = 0
  for (const chunk of chunks) {
    body.set(chunk, offset)
    offset += chunk.byteLength
  }
  return new Request(request.url, { method: request.method, headers: request.headers, body, signal: request.signal })
}
