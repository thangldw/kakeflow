import { configDefaults, defineConfig } from 'vitest/config'
import react from '@vitejs/plugin-react'

export default defineConfig({
  plugins: [react()],
  test: {
    environment: 'jsdom',
    globals: true,
    setupFiles: ['./src/test/setup.ts'],
    css: true,
    // Long end-to-end journeys in App.desktop.test.tsx exceed the 5s default on shared CI runners, especially under V8 coverage.
    testTimeout: 20000,
    exclude: [...configDefaults.exclude, 'relay-service/**', 'e2e/**'],
    coverage: {
      provider: 'v8',
      reporter: ['text-summary', 'json-summary'],
      // Measured 2026-11: 81.4% statements, 75.9% branches, 81.9% functions, 88.4% lines. Floors sit just below so coverage cannot quietly erode.
      thresholds: { statements: 80, branches: 74, functions: 80, lines: 86 },
      include: ['src/**/*.{ts,tsx}'],
      exclude: ['src/**/*.test.{ts,tsx}', 'src/test/**', 'src/**/*.d.ts', 'src/locales/**', 'src/platform/pwa/core-wasm/**'],
    },
  },
})
