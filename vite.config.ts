import react from '@vitejs/plugin-react'
import { defineConfig } from 'vitest/config'
import { vercelApiDev } from './dev/vercel-api-plugin.js'

// https://vite.dev/config/
export default defineConfig({
  plugins: [react(), vercelApiDev()],
  build: {
    rolldownOptions: {
      output: {
        // Libraries in their own files: they change less often than the page, so browsers keep them cached
        // across deploys, and no single file passes Vite's 500 kB warning.
        codeSplitting: {
          groups: [
            { name: 'react', test: /node_modules[\\/](react|react-dom|scheduler)[\\/]/ },
            { name: 'supabase', test: /node_modules[\\/](@supabase|tslib|@noble)[\\/]/ },
          ],
        },
      },
    },
  },
  test: {
    environment: 'node',
    projects: [
      {
        extends: true,
        test: { name: 'unit', include: ['tests/**/*.test.ts'], exclude: ['tests/db/**'] },
      },
      {
        // The page (src/): React components and front logic, in a simulated browser.
        extends: true,
        test: {
          name: 'web',
          environment: 'jsdom',
          include: ['src/**/*.test.{ts,tsx}'],
          setupFiles: ['src/test/setup.ts'],
        },
      },
      {
        // Needs the local Supabase running (pnpm db:start). Files may run in parallel: each one either
        // rolls its transaction back or uses committed rows with its own id prefix (tests/db/helpers.ts).
        extends: true,
        test: { name: 'db', include: ['tests/db/**/*.test.ts'] },
      },
    ],
  },
})
