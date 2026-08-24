import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { fileURLToPath } from 'node:url'

export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: {
      '@runtime-root': fileURLToPath(new URL(
        process.env.VITE_KAKEFLOW_RUNTIME === 'pwa'
          ? './src/pwa/PwaRoot.tsx'
          : './src/runtimeRoot.tsx',
        import.meta.url,
      )),
    },
  },
  build: {
    rollupOptions: {
      output: {
        manualChunks(id) {
          const normalizedId = id.replaceAll('\\\\', '/')
          if (normalizedId.includes('/src/platform/')) return 'app-platform'
          if (normalizedId.includes('/src/ingestion/') || normalizedId.includes('/src/features/import/')) return 'app-import'
          if (normalizedId.includes('/src/features/investments/')) return 'app-investments'
          if (normalizedId.includes('/src/features/sync/')) return 'app-sync'
          if (
            normalizedId.includes('/src/features/reports/')
            || normalizedId.includes('/src/features/calendar/')
            || normalizedId.includes('/src/features/forecast/')
            || normalizedId.includes('/src/features/fixed-costs/')
            || normalizedId.includes('/src/features/financial-intelligence/')
          ) return 'app-analysis'
          if (normalizedId.includes('/src/features/capture/') || normalizedId.includes('/src/features/source-viewer/')) return 'app-capture'

          if (!normalizedId.includes('/node_modules/')) return undefined

          if (
            normalizedId.includes('/node_modules/@paddleocr/')
            || normalizedId.includes('/node_modules/@techstark/opencv-js/')
            || normalizedId.includes('/node_modules/onnxruntime-')
            || normalizedId.includes('/node_modules/clipper-lib/')
            || normalizedId.includes('/node_modules/js-yaml/')
          ) return 'vendor-ocr'

          if (/\/node_modules\/(react|react-dom|scheduler)\//.test(normalizedId)) return 'vendor-react'
          if (normalizedId.includes('/node_modules/lucide-react/')) return 'vendor-icons'
          if (normalizedId.includes('/node_modules/@tauri-apps/')) return 'vendor-tauri'
          if (
            normalizedId.includes('/node_modules/read-excel-file/')
            || normalizedId.includes('/node_modules/fflate/')
            || normalizedId.includes('/node_modules/postal-mime/')
          ) return 'vendor-import'

          return 'vendor'
        },
      },
    },
  },
  worker: { format: 'es' },
  server: { port: 1420, strictPort: true },
  clearScreen: false,
})
