import { useEffect, useState, type ReactNode } from 'react'
import type { Catalog } from './catalog'
import { CatalogContext, type CatalogState } from './catalog-context'

/** Loads the catalogue once for the whole page. `load` is null when the page has no data source. */
export function CatalogProvider({ load, children }: { load: (() => Promise<Catalog>) | null; children: ReactNode }) {
  const [state, setState] = useState<CatalogState>(load ? { status: 'loading' } : { status: 'error' })

  useEffect(() => {
    if (!load) return
    let current = true
    load().then(
      (catalog) => current && setState({ status: 'ready', catalog }),
      (error: unknown) => {
        console.error('[catalog]', error)
        if (current) setState({ status: 'error' })
      },
    )
    return () => {
      current = false
    }
  }, [load])

  return <CatalogContext.Provider value={state}>{children}</CatalogContext.Provider>
}
