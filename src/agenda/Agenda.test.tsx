import type { SupabaseClient } from '@supabase/supabase-js'
import { act, render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { parseCatalog } from '../data/catalog'
import { CatalogProvider } from '../data/CatalogProvider'
import { createLiveConnection } from '../live/connection'
import { LiveProvider } from '../live/LiveProvider'
import type { SubscribeStatus } from '../live/status'
import { AGENDA_RAW } from '../test/fixtures'
import { Agenda } from './Agenda'
import type { AgendaSource } from './load'
import type { Appointment } from './types'

const at = (hhmm: string, date = '2026-11-12') => new Date(`${date}T${hhmm}:00-03:00`)
const appt = (over: Partial<Appointment> = {}): Appointment => ({
  id: 'a1',
  professionalId: 'rafael',
  serviceId: 'barba',
  startsAt: at('14:00'),
  endsAt: at('14:30'),
  status: 'confirmed',
  alias: 'Cliente #2268',
  ...over,
})
const row = (a: Appointment) => ({
  id: a.id,
  professional_id: a.professionalId,
  service_id: a.serviceId,
  starts_at: a.startsAt.toISOString(),
  ends_at: a.endsAt.toISOString(),
  status: a.status,
  public_alias: a.alias,
})

/** A Supabase client whose channels the test drives: statuses and broadcasts. */
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
    live: () => act(() => channels.forEach((c) => c.status?.('SUBSCRIBED'))),
    drop: () => act(() => channels.forEach((c) => c.status?.('CHANNEL_ERROR'))),
    send: (op: string, a: Appointment) => act(() => channels.get('agenda')?.broadcast?.({ event: 'appointment', payload: { op, appointment: row(a) } })),
  }
}

function source(days: Record<string, Appointment[]> = {}, find: Appointment | null = null) {
  return {
    loadDay: vi.fn(async (date: string) => ({ appointments: days[date] ?? [], closures: [] })),
    findAppointment: vi.fn(async () => find),
  } satisfies AgendaSource
}

function renderAgenda(src: AgendaSource, realtime = fakeRealtime(), targetId: string | null = null) {
  render(
    <LiveProvider connection={realtime.connection}>
      <CatalogProvider load={() => Promise.resolve(parseCatalog(AGENDA_RAW))}>
        <Agenda source={src} targetId={targetId} />
      </CatalogProvider>
    </LiveProvider>,
  )
  return realtime
}

describe('Agenda', () => {
  beforeEach(() => {
    vi.useFakeTimers({ toFake: ['Date'] })
    vi.setSystemTime(at('12:30'))
  })
  afterEach(() => vi.useRealTimers())

  it("shows the day's taken times in each barber's column", async () => {
    renderAgenda(source({ '2026-11-12': [appt()] }))

    const rafael = await screen.findByRole('list', { name: 'Rafael' })
    expect(within(rafael).getByRole('listitem')).toHaveTextContent('Cliente #2268, Barba, das 14h às 14h30')
    expect(within(screen.getByRole('list', { name: 'Lucas' })).queryAllByRole('listitem')).toHaveLength(0)
  })

  it('loads another day when the visitor picks it', async () => {
    const src = source({ '2026-11-13': [appt({ id: 'a2', startsAt: at('10:00', '2026-11-13'), endsAt: at('10:30', '2026-11-13') })] })
    const user = userEvent.setup()
    renderAgenda(src)

    await user.click(await screen.findByRole('button', { name: 'Amanhã' }))

    expect(await screen.findByText('Cliente #2268, Barba, das 10h às 10h30')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Amanhã' })).toHaveAttribute('aria-pressed', 'true')
    expect(src.loadDay).toHaveBeenLastCalledWith('2026-11-13')
  })

  it('adds a booking as it happens and tells it in the feed', async () => {
    const realtime = renderAgenda(source())
    await screen.findByRole('list', { name: 'Rafael' })

    realtime.send('insert', appt())

    expect(within(screen.getByRole('list', { name: 'Rafael' })).getByRole('listitem')).toHaveAttribute('data-flash', 'new')
    expect(within(screen.getByRole('list', { name: 'Últimas mudanças' })).getByRole('listitem')).toHaveTextContent(
      'Cliente #2268 marcou Barba com o Rafael às 14h',
    )
  })

  it('ends each flash when its animation ends, even while other changes keep coming', async () => {
    const realtime = renderAgenda(source())
    await screen.findByRole('list', { name: 'Rafael' })
    vi.useFakeTimers({ toFake: ['Date', 'setTimeout', 'clearTimeout'] })
    vi.setSystemTime(at('12:30'))
    const flashOf = (alias: string) =>
      within(screen.getByRole('list', { name: 'Rafael' })).getByText(new RegExp(alias)).closest('li')?.getAttribute('data-flash')

    realtime.send('insert', appt())
    act(() => vi.advanceTimersByTime(1000))
    realtime.send('insert', appt({ id: 'a2', alias: 'Cliente #5555', startsAt: at('16:00'), endsAt: at('16:30') }))
    act(() => vi.advanceTimersByTime(900))

    expect(flashOf('Cliente #2268')).toBeNull()
    expect(flashOf('Cliente #5555')).toBe('new')
  })

  it('reloads the day when the live connection comes back, since it may have missed changes', async () => {
    const src = source()
    const realtime = renderAgenda(src)
    await screen.findByRole('list', { name: 'Rafael' })
    realtime.live()
    const calls = src.loadDay.mock.calls.length

    realtime.drop()
    realtime.live()

    await vi.waitFor(() => expect(src.loadDay.mock.calls.length).toBeGreaterThan(calls))
  })

  it('opens on the day of the appointment in the link and marks it', async () => {
    const target = appt({ id: 'mine', startsAt: at('10:00', '2026-11-13'), endsAt: at('10:30', '2026-11-13') })
    renderAgenda(source({ '2026-11-13': [target] }, target), fakeRealtime(), 'mine')

    const item = await screen.findByText(/\(sua reserva\)/)
    expect(item.closest('li')).toHaveAttribute('aria-current', 'true')
    expect(screen.getByRole('button', { name: 'Amanhã' })).toHaveAttribute('aria-pressed', 'true')
  })

  it('says so when the appointment in the link is no longer on the agenda', async () => {
    renderAgenda(source(), fakeRealtime(), 'gone')

    expect(await screen.findByText(/não está mais na agenda/)).toBeInTheDocument()
  })

  it('says the agenda is unavailable without a data source', () => {
    render(<Agenda source={null} targetId={null} />)

    expect(screen.getByText(/não deu para carregar/i)).toBeInTheDocument()
  })
})
