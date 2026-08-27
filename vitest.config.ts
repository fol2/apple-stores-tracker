import { defineConfig } from 'vitest/config'

// Separate from vite.config.ts, whose `root` points at the SPA source.
export default defineConfig({
  test: { include: ['tests/**/*.test.ts'] },
})
