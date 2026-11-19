import { createElement, lazy, StrictMode, Suspense } from 'react'
import { createRoot } from 'react-dom/client'
import './styles.css'
import './theme.css'
import './features/import/importReview.css'
import './ui-polish.css'
import './features/simple/simpleMode.css'

const runtimeRoot = lazy(() => import('@runtime-root'))
const runtimeElement = <Suspense fallback={null}>{createElement(runtimeRoot)}</Suspense>

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    {runtimeElement}
  </StrictMode>,
)
