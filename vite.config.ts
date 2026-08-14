import { defineConfig } from 'vite'
import { resolve } from 'node:path'

export default defineConfig({
  base: '/airbender-skies/',
  build: {
    target: 'es2022',
    // Two entries, so the bench is served by `npm run dev` and does not vanish from a
    // production build — a tool that only works in development is a tool that rots.
    rollupOptions: {
      input: {
        main: resolve(import.meta.dirname, 'index.html'),
        bench: resolve(import.meta.dirname, 'bench.html'),
      },
    },
  },
})
