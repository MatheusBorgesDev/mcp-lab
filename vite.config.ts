import react from '@vitejs/plugin-react'
import { defineConfig } from 'vitest/config'
import { vercelApiDev } from './dev/vercel-api-plugin.js'

// https://vite.dev/config/
export default defineConfig({
  plugins: [react(), vercelApiDev()],
  test: {
    include: ['tests/**/*.test.ts'],
    environment: 'node',
  },
})
