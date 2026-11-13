import type { SupabaseClient } from '@supabase/supabase-js'
import { act, render, screen, within } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import App from './App'
import { createLiveConnection } from './live/connection'
import { LiveProvider } from './live/LiveProvider'
import type { SubscribeStatus } from './live/status'

/** A Supabase client whose channels report the statuses the test chooses. */
function fakeClient() {
  const report: Array<(s: SubscribeStatus) => void> = []
  const client = {
    channel() {
      const channel = {
        on: () => channel,
        subscribe: (callback: (s: SubscribeStatus) => void) => {
          report.push(callback)
          return channel
        },
      }
      return channel
    },
  } as unknown as SupabaseClient
  return { client, setAll: (s: SubscribeStatus) => act(() => report.forEach((r) => r(s))) }
}

function renderApp(client: SupabaseClient | null) {
  return render(
    <LiveProvider connection={createLiveConnection(client)}>
      <App />
    </LiveProvider>,
  )
}

describe('App shell', () => {
  it('has one page title', () => {
    renderApp(null)

    expect(screen.getAllByRole('heading', { level: 1 })).toHaveLength(1)
  })

  it('links every navigation item to a section on the page', () => {
    const { container } = renderApp(null)

    const links = within(screen.getByRole('navigation', { name: 'Seções' })).getAllByRole('link')
    expect(links.length).toBeGreaterThanOrEqual(4)
    for (const link of links) {
      const id = link.getAttribute('href')?.replace(/^#/, '') ?? ''
      expect(container.querySelector(`[id="${id}"]`), `${link.textContent} → #${id}`).not.toBeNull()
    }
  })

  it('shows the live connection in the header as it changes', () => {
    const { client, setAll } = fakeClient()
    renderApp(client)
    const header = screen.getByRole('banner')

    expect(within(header).getByRole('status')).toHaveTextContent('conectando')
    setAll('SUBSCRIBED')
    expect(within(header).getByRole('status')).toHaveTextContent('ao vivo')
    setAll('CHANNEL_ERROR')
    expect(within(header).getByRole('status')).toHaveTextContent('reconectando')
  })

  it('says there is no live data when the page has no Supabase settings', () => {
    renderApp(null)

    expect(within(screen.getByRole('banner')).getByRole('status')).toHaveTextContent('sem tempo real')
  })
})
