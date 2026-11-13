import { createContext, useContext } from 'react'
import type { Catalog } from './catalog'

export type CatalogState = { status: 'loading' } | { status: 'ready'; catalog: Catalog } | { status: 'error' }

export const CatalogContext = createContext<CatalogState>({ status: 'loading' })

export const useCatalog = () => useContext(CatalogContext)
