import react from '@vitejs/plugin-react'
import { defineConfig } from 'vitest/config'
import { vercelApiDev } from './dev/vercel-api-plugin.js'

// https://vite.dev/config/
export default defineConfig({
  plugins: [react(), vercelApiDev()],
  test: {
    environment: 'node',
    projects: [
      {
        extends: true,
        test: { name: 'unit', include: ['tests/**/*.test.ts'], exclude: ['tests/db/**'] },
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
