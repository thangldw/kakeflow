import 'fake-indexeddb/auto'
import { act, renderHook, waitFor } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { PwaLedgerClient } from '../platform/pwa/client'
import { usePwaClient } from './usePwaClient'

function deferred<T>() {
  let resolve!: (value: T) => void
  const promise = new Promise<T>((next) => { resolve = next })
  return { promise, resolve }
}

function fakeClient() {
  return {
    lock: vi.fn(),
    close: vi.fn(),
  } as unknown as PwaLedgerClient
}

describe('usePwaClient operation fencing', () => {
  afterEach(() => {
    localStorage.clear()
    vi.restoreAllMocks()
  })

  it('keeps the vault locked when a pending unlock resolves late', async () => {
    localStorage.setItem('kakeflow.pwa.vault.deferred-unlock', '1')
    const pending = deferred<PwaLedgerClient>()
    const lateClient = fakeClient()
    vi.spyOn(PwaLedgerClient, 'unlock').mockReturnValue(pending.promise)
    const { result } = renderHook(() => usePwaClient('deferred-unlock'))

    let unlock!: Promise<PwaLedgerClient>
    act(() => { unlock = result.current.unlockVault('correct horse battery staple') })
    expect(result.current.busy).toBe(true)
    act(() => { result.current.lockVault() })
    expect(result.current.mode).toBe('locked')
    expect(result.current.busy).toBe(false)

    pending.resolve(lateClient)
    await expect(unlock).rejects.toThrow('Vault operation was superseded')
    await waitFor(() => expect(result.current.mode).toBe('locked'))
    expect(result.current.client).toBeNull()
    expect(lateClient.lock).toHaveBeenCalledOnce()
    expect(lateClient.close).toHaveBeenCalledOnce()
  })

  it('keeps the active vault locked when a pending restore resolves late', async () => {
    const activeClient = fakeClient()
    const lateClient = fakeClient()
    vi.spyOn(PwaLedgerClient, 'createVault').mockResolvedValue(activeClient)
    const pending = deferred<PwaLedgerClient>()
    vi.spyOn(PwaLedgerClient, 'restoreVault').mockReturnValue(pending.promise)
    const { result } = renderHook(() => usePwaClient('deferred-restore'))
    await act(async () => { await result.current.createVault('correct horse battery staple') })

    let restore!: Promise<PwaLedgerClient>
    act(() => { restore = result.current.restoreVault(new Uint8Array([1, 2, 3]), 'archive passphrase') })
    act(() => { result.current.lockVault() })
    pending.resolve(lateClient)

    await expect(restore).rejects.toThrow('Vault operation was superseded')
    await waitFor(() => expect(result.current.mode).toBe('locked'))
    expect(result.current.client).toBeNull()
    expect(lateClient.lock).toHaveBeenCalledOnce()
    expect(lateClient.close).toHaveBeenCalledOnce()
  })
})
