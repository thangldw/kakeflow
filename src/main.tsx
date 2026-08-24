import { createElement, lazy, StrictMode, Suspense } from 'react'
import { createRoot } from 'react-dom/client'
import { I18nProvider } from './i18n'
import { runtimeFromEnvironment } from './runtime'
import './styles.css'
import './theme.css'
import './features/import/importReview.css'
import './ui-polish.css'

const runtimeOverride = import.meta.env.VITE_KAKEFLOW_RUNTIME
const runtime = runtimeFromEnvironment(runtimeOverride)
const isPwaBuild = runtimeOverride === 'pwa'
if ((runtime === 'pwa') !== isPwaBuild) {
  throw new Error('PWA runtime requires a dedicated PWA build')
}
const runtimeRoot = lazy(() => import('@runtime-root'))
const runtimeElement = <Suspense fallback={null}>{createElement(runtimeRoot)}</Suspense>
if (isPwaBuild) document.documentElement.lang = 'en'

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    {isPwaBuild ? runtimeElement : <I18nProvider>{runtimeElement}</I18nProvider>}
  </StrictMode>,
)
