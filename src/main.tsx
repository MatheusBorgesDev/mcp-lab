import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
// Self-hosted fonts (no request to Google). Fraunces with every axis: SOFT and WONK sign the brand.
import '@fontsource-variable/fraunces/full.css'
import '@fontsource-variable/fraunces/full-italic.css'
import '@fontsource-variable/schibsted-grotesk/index.css'
import '@fontsource/ibm-plex-mono/400.css'
import '@fontsource/ibm-plex-mono/500.css'
import '@fontsource/ibm-plex-mono/600.css'
import './styles/tokens.css'
import './styles/global.css'
import App from './App.tsx'
import { loadCatalog } from './data/catalog.ts'
import { CatalogProvider } from './data/CatalogProvider.tsx'
import { createSupabase } from './lib/supabase.ts'
import { createLiveConnection } from './live/connection.ts'
import { LiveProvider } from './live/LiveProvider.tsx'

const root = document.getElementById('root')
if (!root) throw new Error('Missing #root element in index.html')

const supabase = createSupabase(import.meta.env)
if (!supabase && import.meta.env.DEV) {
  console.warn('VITE_SUPABASE_URL / VITE_SUPABASE_PUBLISHABLE_KEY missing or invalid: no live data (see .env.example).')
}
// One live connection for the life of the page.
const live = createLiveConnection(supabase)
const loadShopCatalog = supabase ? () => loadCatalog(supabase) : null

createRoot(root).render(
  <StrictMode>
    <LiveProvider connection={live}>
      <CatalogProvider load={loadShopCatalog}>
        <App />
      </CatalogProvider>
    </LiveProvider>
  </StrictMode>,
)
