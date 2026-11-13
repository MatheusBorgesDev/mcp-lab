import { useCatalog } from '../data/catalog-context'
import { formatDuration, formatPrice, formatWeekdays } from '../data/format'
import styles from './Menu.module.css'

function Status({ status }: { status: 'loading' | 'error' }) {
  return status === 'loading' ? (
    <p className={styles.note} aria-busy="true">
      Carregando…
    </p>
  ) : (
    <p className={styles.note}>Não deu para carregar agora. Tente recarregar a página em instantes.</p>
  )
}

/** The price list and the team, like the board on the shop wall. */
export function Menu() {
  const state = useCatalog()
  return (
    <div className={styles.menu}>
      <section id="servicos" aria-labelledby="servicos-titulo">
        <h2 id="servicos-titulo" className={styles.title}>
          Serviços
        </h2>
        {state.status === 'ready' ? (
          <ul className={styles.prices} aria-label="Serviços">
            {state.catalog.services.map((s) => (
              <li key={s.id}>
                <div className={styles.line}>
                  <span className={styles.name}>{s.name}</span>
                  <span className={styles.leader} aria-hidden="true" />
                  <span className={styles.duration}>{formatDuration(s.durationMin)}</span>
                  <span className={styles.price}>{formatPrice(s.priceCents)}</span>
                </div>
                {s.description && <p className={styles.description}>{s.description}</p>}
              </li>
            ))}
          </ul>
        ) : (
          <Status status={state.status} />
        )}
      </section>

      <section id="equipe" aria-labelledby="equipe-titulo">
        <h2 id="equipe-titulo" className={styles.title}>
          Equipe
        </h2>
        {state.status === 'ready' ? (
          <ul className={styles.team} aria-label="Equipe">
            {state.catalog.professionals.map((p) => (
              <li key={p.id} className={styles.pro}>
                <h3>{p.name}</h3>
                {p.bio && <p>{p.bio}</p>}
                <span className={styles.days}>{formatWeekdays(p.hours.map((h) => h.weekday))}</span>
              </li>
            ))}
          </ul>
        ) : (
          <Status status={state.status} />
        )}
      </section>
    </div>
  )
}
