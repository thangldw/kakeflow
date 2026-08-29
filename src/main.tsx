import { createElement, lazy, StrictMode, Suspense } from 'react'
import { createRoot } from 'react-dom/client'
import './styles.css'
import './theme.css'
import './features/import/importReview.css'
import './ui-polish.css'

const runtimeOverride = import.meta.env.VITE_KAKEFLOW_RUNTIME
const isPwaBuild = runtimeOverride === 'pwa'
const runtimeRoot = lazy(() => import('@runtime-root'))
const runtimeElement = <Suspense fallback={null}>{createElement(runtimeRoot)}</Suspense>
if (isPwaBuild) document.documentElement.lang = 'en'

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    {runtimeElement}
  </StrictMode>,
)
