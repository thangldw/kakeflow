import { useCallback, useMemo, useState } from 'react'

import { PwaLedgerClient } from '../platform/pwa/client'

export type VaultMode = 'new' | 'locked' | 'unlocked'

export interface PwaClientSession {
  readonly client: PwaLedgerClient | null
  readonly mode: VaultMode
  readonly busy: boolean
  readonly error: string | null
  readonly createVault: (passphrase: string) => Promise<PwaLedgerClient>
  readonly unlockVault: (passphrase: string) => Promise<PwaLedgerClient>
  readonly lockVault: () => void
  readonly clearError: () => void
}

export function usePwaClient(databaseName: string): PwaClientSession {
  const markerKey = useMemo(() => `kakeflow.pwa.vault.${databaseName}`, [databaseName])
  const [client, setClient] = useState<PwaLedgerClient | null>(null)
  const [mode, setMode] = useState<VaultMode>(() => (
    globalThis.localStorage?.getItem(markerKey) === '1' ? 'locked' : 'new'
  ))
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const run = useCallback(async (
    action: () => Promise<PwaLedgerClient>,
  ): Promise<PwaLedgerClient> => {
    setBusy(true)
    setError(null)
    try {
      const nextClient = await action()
      globalThis.localStorage?.setItem(markerKey, '1')
      setClient(nextClient)
      setMode('unlocked')
      return nextClient
    } catch (cause) {
      const message = cause instanceof Error ? cause.message : String(cause)
      setError(message)
      throw cause
    } finally {
      setBusy(false)
    }
  }, [markerKey])

  const createVault = useCallback((passphrase: string) => (
    run(() => PwaLedgerClient.createVault(databaseName, passphrase))
  ), [databaseName, run])

  const unlockVault = useCallback((passphrase: string) => (
    run(() => PwaLedgerClient.unlock(databaseName, passphrase))
  ), [databaseName, run])

  const lockVault = useCallback(() => {
    client?.lock()
    client?.close()
    setClient(null)
    setMode('locked')
    setError(null)
  }, [client])

  return {
    client,
    mode,
    busy,
    error,
    createVault,
    unlockVault,
    lockVault,
    clearError: useCallback(() => setError(null), []),
  }
}
