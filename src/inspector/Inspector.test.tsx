import type { SupabaseClient } from '@supabase/supabase-js'
import { act, render, screen, within } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { createLiveConnection } from '../live/connection'
import { LiveProvider } from '../live/LiveProvider'
import type { SubscribeStatus } from '../live/status'
import { parseEventRows } from './calls'
import { Inspector, type InspectorSource } from './Inspector'

let nextId = 1
/** The rows of one call, as Supabase sends them. */
function callRows(requestId: string, tool = 'list_services', client = 'Claude') {
  return [
    { step: 'received', detail: { args: {} }, duration_ms: 0 },
    { step: 'validated', detail: { checks: [{ rule: 'input', passed: true }] }, duration_ms: 0 },
    { step: 'processed', detail: { kind: 'services', count: 8 }, duration_ms: 60 },
    { step: 'responded', detail: { is_error: false }, duration_ms: 62 },
  ].map((s) => ({ id: nextId++, request_id: requestId, tool_name: tool, client_label: client, created_at: '2026-11-13T13:01:08.000+00:00', ...s }))
}

function fakeRealtime() {
  const channels = new Map<string, { status?: (s: SubscribeStatus) => void; broadcast?: (m: { event: string; payload: unknown }) => void }>()
  const client = {
    channel(topic: string) {
      const record: { status?: (s: SubscribeStatus) => void; broadcast?: (m: { event: string; payload: unknown }) => void } = {}
      channels.set(topic, record)
      const channel = {
        on: (_t: string, _f: unknown, cb: (m: { event: string; payload: unknown }) => void) => ((record.broadcast = cb), channel),
        subscribe: (cb: (s: SubscribeStatus) => void) => ((record.status = cb), channel),
      }
      return channel
    },
  } as unknown as SupabaseClient
  return {
    connection: createLiveConnection(client),
    setAll: (s: SubscribeStatus) => act(() => channels.forEach((c) => c.status?.(s))),
    send: (rows: unknown[]) => act(() => channels.get('inspector')?.broadcast?.({ event: 'call', payload: { events: rows } })),
  }
}

function renderInspector(rows: unknown[] = [], realtime = fakeRealtime()) {
  const source = { loadRecent: vi.fn(async () => parseEventRows(rows)) } satisfies InspectorSource
  render(
    <LiveProvider connection={realtime.connection}>
      <Inspector source={source} />
    </LiveProvider>,
  )
  return { realtime, source }
}

const tickets = () => within(screen.getByRole('list', { name: 'Chamadas recentes' })).getAllByRole('article')

describe('Inspector', () => {
  afterEach(() => vi.useRealTimers())

  it('shows the recent calls as tickets, newest first, with every step', async () => {
    renderInspector([...callRows('aaaa1111', 'list_services'), ...callRows('bbbb2222', 'check_availability', 'ChatGPT')])

    await screen.findByRole('list', { name: 'Chamadas recentes' })
    expect(tickets().map((t) => t.getAttribute('aria-label'))).toEqual(['check_availability, ChatGPT', 'list_services, Claude'])
    expect(tickets()[1]).toHaveTextContent('req aaaa')
    expect(tickets()[1]).toHaveTextContent('8 serviços')
    expect(tickets()[1]).toHaveTextContent('ok · 62 ms')
  })

  it('prints a new call on top and reveals its steps one by one', async () => {
    const { realtime } = renderInspector(callRows('aaaa1111'))
    await screen.findByRole('list', { name: 'Chamadas recentes' })
    vi.useFakeTimers()

    realtime.send(callRows('cccc3333', 'book_appointment'))

    const steps = () => within(tickets()[0]!).getAllByRole('listitem', { hidden: true }).map((li) => li.getAttribute('data-state'))
    expect(tickets()[0]).toHaveAttribute('aria-label', 'book_appointment, Claude')
    expect(steps()).toEqual(['pending', 'pending', 'pending', 'pending'])
    act(() => vi.advanceTimersByTime(300))
    expect(steps()).toEqual(['done', 'pending', 'pending', 'pending'])
    act(() => vi.advanceTimersByTime(3000))
    expect(steps()).toEqual(['done', 'done', 'done', 'done'])
  })

  it('keeps the last four calls', async () => {
    const { realtime } = renderInspector()
    await screen.findByText(/nenhuma chamada ainda/i)

    for (const id of ['r1', 'r2', 'r3', 'r4', 'r5']) realtime.send(callRows(id))

    expect(tickets()).toHaveLength(4)
    expect(tickets()[0]).toHaveTextContent('req r5')
  })

  it('reloads the recent calls when the live connection comes back', async () => {
    const { realtime, source } = renderInspector()
    await screen.findByText(/nenhuma chamada ainda/i)
    realtime.setAll('SUBSCRIBED')
    const calls = source.loadRecent.mock.calls.length

    realtime.setAll('CHANNEL_ERROR')
    realtime.setAll('SUBSCRIBED')

    await vi.waitFor(() => expect(source.loadRecent.mock.calls.length).toBeGreaterThan(calls))
  })

  it('says it is unavailable without a data source', () => {
    render(<Inspector source={null} />)

    expect(screen.getByText(/não deu para carregar/i)).toBeInTheDocument()
  })
})
