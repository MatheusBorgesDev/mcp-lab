import type { LiveStatus } from './status'
import styles from './LiveIndicator.module.css'

const LABEL: Record<LiveStatus, string> = {
  live: 'ao vivo',
  connecting: 'conectando',
  reconnecting: 'reconectando',
  unavailable: 'sem tempo real',
}

/** The barber pole turns while the page is live and stops when the connection drops. */
export function LiveIndicator({ status, className }: { status: LiveStatus; className?: string }) {
  return (
    <span role="status" data-state={status} className={[styles.live, className].filter(Boolean).join(' ')}>
      <span className={styles.pole} aria-hidden="true" />
      {LABEL[status]}
    </span>
  )
}
