import { useCallback, useEffect, useRef, useState } from 'react'

export interface PwaUpdateSafetyState {
  readonly vaultUnlocked: boolean
  readonly activeOperation: boolean
}

export function pwaServiceWorkerUrl(baseUrl: string) {
  const normalized = `/${baseUrl}`.replaceAll(/\/{2,}/gu, '/').replace(/\/?$/u, '/')
  return `${normalized}sw.js`
}

export function canActivatePwaUpdate(state: PwaUpdateSafetyState) {
  return !state.vaultUnlocked || !state.activeOperation
}

export function usePwaServiceWorker() {
  const registration = useRef<ServiceWorkerRegistration | null>(null)
  const reloadOnControllerChange = useRef(false)
  const [updateAvailable, setUpdateAvailable] = useState(false)
  const [offlineReady, setOfflineReady] = useState(() => Boolean(navigator.serviceWorker?.controller))
  const [activating, setActivating] = useState(false)

  useEffect(() => {
    if (!import.meta.env.PROD || !('serviceWorker' in navigator)) return undefined
    let cancelled = false
    const observeInstallingWorker = (worker: ServiceWorker | null) => {
      worker?.addEventListener('statechange', () => {
        if (cancelled || worker.state !== 'installed') return
        if (navigator.serviceWorker.controller) setUpdateAvailable(true)
        else setOfflineReady(true)
      })
    }
    const controllerChanged = () => {
      if (reloadOnControllerChange.current) globalThis.location.reload()
    }
    navigator.serviceWorker.addEventListener('controllerchange', controllerChanged)
    void navigator.serviceWorker.register(pwaServiceWorkerUrl(import.meta.env.BASE_URL), {
      scope: import.meta.env.BASE_URL,
    }).then((nextRegistration) => {
      if (cancelled) return
      registration.current = nextRegistration
      setOfflineReady(Boolean(nextRegistration.active || navigator.serviceWorker.controller))
      setUpdateAvailable(Boolean(nextRegistration.waiting))
      nextRegistration.addEventListener('updatefound', () => {
        observeInstallingWorker(nextRegistration.installing)
      })
      observeInstallingWorker(nextRegistration.installing)
    })
    return () => {
      cancelled = true
      navigator.serviceWorker.removeEventListener('controllerchange', controllerChanged)
    }
  }, [])

  const activateUpdate = useCallback(() => {
    const waiting = registration.current?.waiting
    if (!waiting) return
    setActivating(true)
    reloadOnControllerChange.current = true
    waiting.postMessage({ type: 'SKIP_WAITING' })
  }, [])

  return {
    updateAvailable,
    offlineReady,
    activating,
    activateUpdate,
    dismissUpdate: useCallback(() => setUpdateAvailable(false), []),
  }
}
