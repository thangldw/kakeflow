import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { fileURLToPath } from 'node:url'
import { VitePWA } from 'vite-plugin-pwa'

const isPwaBuild = process.env.VITE_KAKEFLOW_RUNTIME === 'pwa'

export default defineConfig({
  base: isPwaBuild ? '/kakeflow/app/' : '/',
  plugins: [
    react(),
    ...(isPwaBuild ? [VitePWA({
      registerType: 'prompt',
      injectRegister: false,
      filename: 'sw.js',
      manifest: {
        id: '/kakeflow/app/',
        name: 'KakeFlow Local Ledger',
        short_name: 'KakeFlow',
        description: 'Account-free, encrypted household ledger with local receipt OCR.',
        lang: 'en',
        start_url: '/kakeflow/app/',
        scope: '/kakeflow/app/',
        display: 'standalone',
        background_color: '#f4f1e9',
        theme_color: '#165c3a',
        categories: ['finance', 'productivity'],
        icons: [
          { src: 'pwa/icon-192.png', sizes: '192x192', type: 'image/png' },
          { src: 'pwa/icon-512.png', sizes: '512x512', type: 'image/png' },
          { src: 'pwa/icon-maskable-512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
        ],
      },
      workbox: {
        globPatterns: ['**/*.{js,css,html,wasm,mjs,tar,png,webmanifest}'],
        globIgnores: [
          'pwa/*.png',
          'ocr/paddleocr/ort/ort-wasm-simd-threaded.wasm',
          'ocr/paddleocr/ort/ort-wasm-simd-threaded.mjs',
          'ocr/paddleocr/ort/*.jspi.*',
          'ocr/paddleocr/ort/*.asyncify.*',
          'assets/ort-wasm-simd-threaded.jsep-*.wasm',
        ],
        maximumFileSizeToCacheInBytes: 30 * 1024 * 1024,
        navigateFallback: '/kakeflow/app/index.html',
        navigateFallbackAllowlist: [/^\/kakeflow\/app(?:\/|$)/],
        runtimeCaching: [],
        cleanupOutdatedCaches: true,
        skipWaiting: false,
        clientsClaim: false,
      },
    })] : []),
  ],
  resolve: {
    alias: {
      '@runtime-root': fileURLToPath(new URL(
        isPwaBuild
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
