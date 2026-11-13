import { shopFacts } from '../data/catalog'
import { useCatalog } from '../data/catalog-context'
import styles from './ShopFacts.module.css'

export function ShopFacts() {
  const state = useCatalog()
  if (state.status !== 'ready') return null
  const facts = shopFacts(state.catalog)
  return (
    <ul className={styles.facts} aria-label="A barbearia">
      <li>{facts.professionals} barbeiros</li>
      <li>{facts.services} serviços</li>
      {facts.days && <li>{facts.days}</li>}
    </ul>
  )
}
