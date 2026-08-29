import { useCallback, useMemo, useRef, useState } from 'react'

import { PwaLedgerClient } from '../platform/pwa/client'

export type VaultMode = 'new' | 'locked' | 'unlocked'

export interface PwaClientSession {
  readonly client: PwaLedgerClient | null
  readonly mode: VaultMode
  readonly busy: boolean
  readonly error: string | null
  readonly createVault: (passphrase: string) => Promise<PwaLedgerClient>
  readonly unlockVault: (passphrase: string) => Promise<PwaLedgerClient>
  readonly restoreVault: (archive: Uint8Array, passphrase: string) => Promise<PwaLedgerClient>
  readonly lockVault: () => void
  readonly clearError: () => void
}

export class PwaClientOperationSupersededError extends Error {
  constructor() {
    super('Vault operation was superseded')
    this.name = 'PwaClientOperationSupersededError'
  }
}

export function isPwaClientOperationSuperseded(cause: unknown): boolean {
  return cause instanceof PwaClientOperationSupersededError
}

export function usePwaClient(databaseName: string): PwaClientSession {
  const markerKey = useMemo(() => `kakeflow.pwa.vault.${databaseName}`, [databaseName])
  const [client, setClient] = useState<PwaLedgerClient | null>(null)
  const [mode, setMode] = useState<VaultMode>(() => (
    globalThis.localStorage?.getItem(markerKey) === '1' ? 'locked' : 'new'
  ))
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const generation = useRef(0)

  const run = useCallback(async (
    action: () => Promise<PwaLedgerClient>,
  ): Promise<PwaLedgerClient> => {
    const operationGeneration = ++generation.current
    setBusy(true)
    setError(null)
    try {
      const nextClient = await action()
      if (operationGeneration !== generation.current) {
        nextClient.lock()
        nextClient.close()
        throw new PwaClientOperationSupersededError()
      }
      globalThis.localStorage?.setItem(markerKey, '1')
      setClient(nextClient)
      setMode('unlocked')
      return nextClient
    } catch (cause) {
      if (operationGeneration !== generation.current) {
        if (isPwaClientOperationSuperseded(cause)) throw cause
        throw new PwaClientOperationSupersededError()
      }
      const message = cause instanceof Error ? cause.message : String(cause)
      setError(message)
      throw cause
    } finally {
      if (operationGeneration === generation.current) setBusy(false)
    }
  }, [markerKey])

  const createVault = useCallback((passphrase: string) => (
    run(() => PwaLedgerClient.createVault(databaseName, passphrase))
  ), [databaseName, run])

  const unlockVault = useCallback((passphrase: string) => (
    run(() => PwaLedgerClient.unlock(databaseName, passphrase))
  ), [databaseName, run])

  const restoreVault = useCallback((archive: Uint8Array, passphrase: string) => (
    run(() => PwaLedgerClient.restoreVault(databaseName, archive, passphrase))
      .then((restored) => {
        client?.close()
        return restored
      })
  ), [client, databaseName, run])

  const lockVault = useCallback(() => {
    generation.current += 1
    client?.lock()
    client?.close()
    setClient(null)
    setMode('locked')
    setBusy(false)
    setError(null)
  }, [client])

  return {
    client,
    mode,
    busy,
    error,
    createVault,
    unlockVault,
    restoreVault,
    lockVault,
    clearError: useCallback(() => setError(null), []),
  }
}
