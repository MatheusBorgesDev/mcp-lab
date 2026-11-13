import { Lockup } from '../brand/Lockup'
import { LiveIndicator } from '../live/LiveIndicator'
import { useLive } from '../live/hooks'
import { SECTIONS } from './sections'
import styles from './SiteHeader.module.css'

export function SiteHeader() {
  const { status } = useLive()
  return (
    <header className={styles.header}>
      <div className={styles.band} aria-hidden="true" />
      <div className={`wrap ${styles.bar}`}>
        <a href="#top" className={styles.home} aria-label="MCP Barber Shop, início">
          <Lockup />
        </a>
        <nav aria-label="Seções" className={styles.nav}>
          {SECTIONS.map((s) => (
            <a key={s.id} href={`#${s.id}`}>
              {s.label}
            </a>
          ))}
        </nav>
        <LiveIndicator status={status} className={styles.live} />
      </div>
    </header>
  )
}
