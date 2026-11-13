import { Mark } from './Mark'
import styles from './Lockup.module.css'

/** Mark plus name. The visible name is the brand; screen readers get it once, as plain text. */
export function Lockup({ className }: { className?: string }) {
  return (
    <span className={[styles.lockup, className].filter(Boolean).join(' ')}>
      <Mark className={styles.mark} />
      <span className={styles.name}>
        <span className={styles.mcp}>MCP</span> <span className={styles.sub}>Barber Shop</span>
      </span>
    </span>
  )
}
