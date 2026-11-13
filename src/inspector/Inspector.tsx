import { useEffect, useRef, useState } from 'react'
import { useNow } from '../lib/useNow'
import { useBroadcast, useLive } from '../live/hooks'
import { groupCalls, parseInspectorMessage, type Call } from './calls'
import type { InspectorSource } from './load'
import { ticketView, type TicketStep } from './ticket'
import styles from './Inspector.module.css'

export type { InspectorSource } from './load'

const TICKETS = 4
// The steps of a call happen within milliseconds; the ticket prints them at a pace people can follow.
const FIRST_STEP_MS = 300
const NEXT_STEP_MS = 480

const prefersReducedMotion = () => window.matchMedia?.('(prefers-reduced-motion: reduce)').matches ?? false

/** Every MCP call, from arrival to answer, printed as a ticket on the board. */
export function Inspector({ source }: { source: InspectorSource | null }) {
  const { generation } = useLive()
  const now = useNow()
  const [calls, setCalls] = useState<Call[] | null>(null)
  const [failed, setFailed] = useState(false)
  /** How many steps of each live call are printed so far; calls loaded at once are printed whole. */
  const [printed, setPrinted] = useState<Record<string, number>>({})
  const timers = useRef<Array<ReturnType<typeof setTimeout>>>([])

  useEffect(() => {
    if (!source) return
    let current = true
    source.loadRecent().then(
      (rows) => {
        if (!current) return
        setCalls(groupCalls(rows, TICKETS))
        setPrinted({})
        setFailed(false)
      },
      (error: unknown) => {
        console.error('[inspector]', error)
        if (current) setFailed(true)
      },
    )
    return () => {
      current = false
    }
  }, [source, generation])

  useEffect(() => {
    const pending = timers.current
    return () => pending.forEach(clearTimeout)
  }, [])

  useBroadcast('inspector', ({ payload }) => {
    const rows = parseInspectorMessage(payload)
    const call = rows && groupCalls(rows, 1)[0]
    if (!call) return
    setCalls((list) => [call, ...(list ?? []).filter((c) => c.requestId !== call.requestId)].slice(0, TICKETS))
    if (prefersReducedMotion()) return
    setPrinted((p) => ({ ...p, [call.requestId]: 0 }))
    call.steps.forEach((_, index) => {
      timers.current.push(
        setTimeout(() => setPrinted((p) => ({ ...p, [call.requestId]: index + 1 })), FIRST_STEP_MS + index * NEXT_STEP_MS),
      )
    })
  })

  return (
    <section id="inspector" aria-labelledby="inspector-titulo" className={styles.inspector}>
      <h2 id="inspector-titulo">Inspector</h2>
      <p className={styles.sub}>cada chamada MCP, da chegada à resposta</p>

      {!source || failed ? (
        <p className={styles.note}>Não deu para carregar as chamadas agora.</p>
      ) : calls === null ? (
        <p className={styles.note}>Carregando…</p>
      ) : calls.length === 0 ? (
        <p className={styles.note}>Nenhuma chamada ainda. Conecte a sua IA e peça um horário: a chamada aparece aqui.</p>
      ) : (
        <ol className={styles.tape} aria-label="Chamadas recentes">
          {calls.map((call) => {
            const view = ticketView(call, now)
            const shown = printed[call.requestId] ?? view.steps.length
            return (
              <li key={call.requestId}>
                <article className={styles.ticketWrap} aria-label={`${view.tool}, ${view.client}`}>
                  <div className={styles.ticket}>
                    <div className={styles.head}>
                      <span className={styles.tool}>{view.tool}</span>
                      <span className={styles.client}>{view.client}</span>
                    </div>
                    <div className={styles.meta}>{view.meta}</div>
                    <ol className={styles.steps}>
                      {view.steps.map((step, index) => (
                        <StepLine key={step.step} step={step} printed={index < shown} />
                      ))}
                    </ol>
                  </div>
                </article>
              </li>
            )
          })}
        </ol>
      )}
      <p className={styles.foot}>sem IP, sem nome, sem código completo · só o que é público</p>
    </section>
  )
}

function StepLine({ step, printed }: { step: TicketStep; printed: boolean }) {
  const state = !printed ? 'pending' : step.ok ? 'done' : 'fail'
  return (
    <li data-state={state} aria-hidden={!printed || undefined}>
      <span className={styles.k}>{step.label}</span>
      {step.checks ? (
        <span>
          {step.checks.map((c) => (
            <span key={c.label} className={styles.check}>
              <span className={c.passed ? styles.ok : styles.no}>{c.passed ? '✓' : '✗'}</span> {c.label}
            </span>
          ))}
        </span>
      ) : (
        <span className={step.step === 'responded' || step.step === 'error' ? (step.ok ? styles.ok : styles.no) : undefined}>
          {step.text}
        </span>
      )}
    </li>
  )
}
