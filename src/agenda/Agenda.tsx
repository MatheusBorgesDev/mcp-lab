import { useEffect, useMemo, useReducer, useRef, useState, type CSSProperties } from 'react'
import { useCatalog } from '../data/catalog-context'
import { useNow } from '../lib/useNow'
import { useBroadcast, useLive } from '../live/hooks'
import { agendaDays } from './days'
import { feedEntry, type FeedEntry } from './feed'
import { dayLayout, type Slot } from './layout'
import type { AgendaSource } from './load'
import { agendaReducer } from './reducer'
import { parseAgendaMessage } from './schema'
import { clockLabel, hourLabel, longDate, MAX_DAYS_AHEAD, shopTime, SLOT_MINUTES, type LocalDate } from './time'
import type { Closure } from './types'
import styles from './Agenda.module.css'

const FLASH_MS = { new: 1800, freed: 1600 }
const FEED_SIZE = 6

type Target = 'none' | 'pending' | 'found' | 'missing'

/** The shop's agenda, one day at a time, kept live by the "agenda" broadcasts. */
export function Agenda({ source, targetId }: { source: AgendaSource | null; targetId: string | null }) {
  const catalog = useCatalog()
  const { generation } = useLive()
  const now = useNow()
  const today = shopTime(now).date

  const [date, setDate] = useState<LocalDate | null>(targetId ? null : today)
  const [target, setTarget] = useState<Target>(targetId ? 'pending' : 'none')
  const [state, dispatch] = useReducer(agendaReducer, { date: today, items: [] })
  const [closures, setClosures] = useState<Closure[]>([])
  const [failed, setFailed] = useState(false)
  const [feed, setFeed] = useState<FeedEntry[]>([])

  // The appointment in the link (watch_url): open its day.
  useEffect(() => {
    if (!source || !targetId) return
    let current = true
    const fallback = () => {
      if (!current) return
      setTarget('missing')
      setDate(shopTime(new Date()).date)
    }
    source.findAppointment(targetId).then((found) => {
      if (!current) return
      if (!found || found.status === 'cancelled') return fallback()
      setTarget('found')
      setDate(shopTime(found.startsAt).date)
    }, fallback)
    return () => {
      current = false
    }
  }, [source, targetId])

  // The day, loaded again on each reconnection: broadcasts sent while offline are lost.
  useEffect(() => {
    if (!source || !date) return
    let current = true
    source.loadDay(date).then(
      ({ appointments, closures }) => {
        if (!current) return
        dispatch({ type: 'loaded', date, appointments })
        setClosures(closures)
        setFailed(false)
      },
      (error: unknown) => {
        console.error('[agenda]', error)
        if (current) setFailed(true)
      },
    )
    return () => {
      current = false
    }
  }, [source, date, generation])

  useBroadcast('agenda', ({ payload }) => {
    const change = parseAgendaMessage(payload)
    if (!change) return
    dispatch({ type: 'changed', op: change.op, appointment: change.appointment })
    if (catalog.status !== 'ready') return
    const entry = feedEntry({ ...change, catalog: catalog.catalog, now: new Date() })
    if (entry) setFeed((entries) => [entry, ...entries].slice(0, FEED_SIZE))
  })

  // A flash lasts as long as its animation; then the freed place goes away. One timer per flash, started
  // when it appears: restarting them on every change would stretch the flashes during a burst of changes.
  const timers = useRef(new Map<string, ReturnType<typeof setTimeout>>())
  useEffect(() => {
    for (const item of state.items) {
      if (!item.flash || timers.current.has(item.key)) continue
      const timer = setTimeout(() => {
        timers.current.delete(item.key)
        dispatch({ type: 'settled', key: item.key })
      }, FLASH_MS[item.flash])
      timers.current.set(item.key, timer)
    }
  }, [state.items])
  useEffect(() => {
    const pending = timers.current
    return () => pending.forEach(clearTimeout)
  }, [])

  const layout = useMemo(
    () =>
      catalog.status === 'ready' && date
        ? dayLayout({ date, catalog: catalog.catalog, appointments: state.items, closures, now })
        : null,
    [catalog, date, state.items, closures, now],
  )
  const days = useMemo(() => {
    if (catalog.status !== 'ready') return []
    const list = agendaDays(catalog.catalog, now, MAX_DAYS_AHEAD)
    return date && !list.some((d) => d.date === date) ? [{ date, label: longDate(date) }, ...list] : list
  }, [catalog, now, date])

  // Scroll to the appointment in the link once its day is on screen.
  const scrolled = useRef(false)
  useEffect(() => {
    if (target !== 'found' || scrolled.current || !layout) return
    const element = document.querySelector('[aria-current="true"]')
    if (element) {
      scrolled.current = true
      element.scrollIntoView({ block: 'center', behavior: 'smooth' })
    }
  }, [target, layout])

  const unavailable = !source || failed || catalog.status === 'error'
  return (
    <section id="agenda" aria-labelledby="agenda-titulo" className={styles.agenda}>
      <div className={styles.head}>
        <h2 id="agenda-titulo">Agenda</h2>
        {layout && (
          <span className={styles.sub}>
            {longDate(layout.date)}
            {!layout.closed && ` · ${hourLabel(layout.startMin)} às ${hourLabel(layout.endMin)}`}
          </span>
        )}
      </div>

      {unavailable ? (
        <p className={styles.note}>Não deu para carregar a agenda agora. Tente recarregar a página em instantes.</p>
      ) : (
        <>
          {days.length > 0 && (
            <div role="group" aria-label="Dia" className={styles.days}>
              {days.map((d) => (
                <button key={d.date} type="button" aria-pressed={d.date === date} onClick={() => setDate(d.date)}>
                  {d.label}
                </button>
              ))}
            </div>
          )}
          {target === 'missing' && (
            <p className={styles.note}>
              A reserva do link não está mais na agenda: foi cancelada, já passou ou saiu na limpeza diária das 3h.
            </p>
          )}
          {layout ? <DayGrid layout={layout} targetId={target === 'found' ? targetId : null} /> : <p className={styles.note}>Carregando…</p>}
          <Legend />
          <p className={styles.reset}>
            Todo dia às 3h a agenda reinicia: as reservas dos visitantes são apagadas e as fictícias, refeitas.
          </p>
          <Feed entries={feed} />
        </>
      )}
    </section>
  )
}

const rows = (minutes: number) => minutes / SLOT_MINUTES

function DayGrid({ layout, targetId }: { layout: ReturnType<typeof dayLayout>; targetId: string | null }) {
  const at = (minutes: number) => rows(minutes - layout.startMin)
  const style = { '--cols': layout.columns.length, '--rows': rows(layout.endMin - layout.startMin) } as CSSProperties
  return (
    <div className={styles.scroller}>
      {layout.closed && <p className={styles.closed}>{layout.closed}</p>}
      <div className={styles.grid} style={style}>
        <div className={styles.names} aria-hidden="true">
          <span />
          {layout.columns.map((c) => (
            <span key={c.professional.id}>
              {c.professional.name}
              <small>{c.span ? `${hourLabel(c.span.startMin)}–${hourLabel(c.span.endMin)}` : 'folga'}</small>
            </span>
          ))}
        </div>
        <div className={styles.body}>
          <div className={styles.times} aria-hidden="true">
            {layout.hours.map((h) => (
              <span key={h} style={{ '--at': at(h) } as CSSProperties}>
                {hourLabel(h)}
              </span>
            ))}
          </div>
          {layout.columns.map((c) => (
            <div key={c.professional.id} className={styles.col}>
              {c.blocks.map((b) => (
                <div
                  key={`${b.kind}-${b.startMin}`}
                  className={styles.block}
                  data-kind={b.kind}
                  aria-hidden="true"
                  style={{ '--at': at(b.startMin), '--len': rows(b.endMin - b.startMin) } as CSSProperties}
                >
                  {b.label && <span>{b.label}</span>}
                </div>
              ))}
              <ul aria-label={c.professional.name} className={styles.slots}>
                {c.slots.map((s) => (
                  <SlotItem key={s.key} slot={s} at={at(s.startMin)} isTarget={s.id === targetId && s.flash !== 'freed'} />
                ))}
              </ul>
            </div>
          ))}
          {layout.now !== null && (
            <div className={styles.now} style={{ '--at': at(layout.now) } as CSSProperties} aria-hidden="true">
              <span>{clockLabel(layout.now)}</span>
            </div>
          )}
        </div>
      </div>
    </div>
  )
}

function SlotItem({ slot, at, isTarget }: { slot: Slot; at: number; isTarget: boolean }) {
  const length = rows(slot.endMin - slot.startMin)
  const description = `${slot.alias}, ${slot.service}, das ${hourLabel(slot.startMin)} às ${hourLabel(slot.endMin)}`
  return (
    <li
      className={styles.slot}
      data-flash={slot.flash}
      data-short={length <= 1 || undefined}
      aria-current={isTarget || undefined}
      title={description}
      style={{ '--at': at, '--len': length } as CSSProperties}
    >
      <span className={styles.srOnly}>
        {description}
        {slot.flash === 'freed' && ' (acabou de ser liberado)'}
        {isTarget && ' (sua reserva)'}
      </span>
      <span className={styles.text} aria-hidden="true">
        <b>{slot.alias.replace(/^Cliente /, '')}</b> {slot.service}
      </span>
      {isTarget && (
        <span className={styles.mine} aria-hidden="true">
          sua reserva
        </span>
      )}
    </li>
  )
}

function Legend() {
  return (
    <ul className={styles.legend} aria-label="Legenda">
      <li>
        <i data-kind="taken" /> ocupado
      </li>
      <li>
        <i data-kind="closed" /> fechado
      </li>
      <li>
        <i data-kind="changed" /> acabou de mudar
      </li>
    </ul>
  )
}

function Feed({ entries }: { entries: FeedEntry[] }) {
  return (
    <div className={styles.feed}>
      <ol aria-label="Últimas mudanças" aria-live="polite">
        {entries.map((e) => (
          <li key={e.key}>
            <time>{e.time}</time>
            <span>{e.text}</span>
          </li>
        ))}
      </ol>
      {entries.length === 0 && <p className={styles.note}>As mudanças aparecem aqui assim que acontecem.</p>}
    </div>
  )
}
