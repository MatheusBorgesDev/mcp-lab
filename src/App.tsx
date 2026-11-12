import { useEffect, useState } from 'react'

type ApiStatus = 'checking' | 'up' | 'down'

const statusLabel: Record<ApiStatus, string> = {
  checking: 'verificando…',
  up: 'no ar',
  down: 'fora do ar',
}

export default function App() {
  const [status, setStatus] = useState<ApiStatus>('checking')

  useEffect(() => {
    const controller = new AbortController()
    fetch('/api/health', { signal: controller.signal })
      .then((response) => response.json() as Promise<{ ok?: unknown }>)
      .then((body) => setStatus(body.ok === true ? 'up' : 'down'))
      .catch(() => {
        if (!controller.signal.aborted) setStatus('down')
      })
    return () => controller.abort()
  }, [])

  return (
    <main>
      <h1>MCP Barber Shop</h1>
      <p>Em construção.</p>
      <p role="status">API: {statusLabel[status]}</p>
    </main>
  )
}
