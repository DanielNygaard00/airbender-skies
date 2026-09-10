import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    include: ['src/**/*.test.ts'],
    environment: 'node',
    // Loads the browser globals three.js needs to decode the character model's embedded
    // texture; see src/test-setup.ts for why the decode is stubbed rather than performed.
    setupFiles: ['src/test-setup.ts'],
  },
})
