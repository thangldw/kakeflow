import App from './App'
import { I18nProvider } from './i18n'
import { runtimeFromEnvironment } from './runtime'

const runtime = runtimeFromEnvironment(import.meta.env.VITE_KAKEFLOW_RUNTIME)
if (runtime === 'pwa') throw new Error('PWA runtime requires a dedicated PWA build')

export default function RuntimeRoot() {
  return <I18nProvider><App /></I18nProvider>
}
