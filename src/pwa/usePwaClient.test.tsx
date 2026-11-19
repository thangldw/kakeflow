import 'fake-indexeddb/auto'
import { act, renderHook, waitFor } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { PwaLedgerClient } from '../platform/pwa/client'
import type { PasskeyAuthenticator } from '../platform/pwa/passkey'
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

describe('usePwaClient passkey unlock', () => {
  const authenticator: PasskeyAuthenticator = {
    create: vi.fn(),
    get: vi.fn(),
  }

  afterEach(() => {
    localStorage.clear()
    vi.restoreAllMocks()
  })

  it('moves a locked session to unlocked with the passkey', async () => {
    localStorage.setItem('kakeflow.pwa.vault.passkey-unlock', '1')
    const unlocked = fakeClient()
    const spy = vi.spyOn(PwaLedgerClient, 'unlockWithPasskey').mockResolvedValue(unlocked)
    const { result } = renderHook(() => usePwaClient('passkey-unlock'))
    expect(result.current.mode).toBe('locked')

    let returned: PwaLedgerClient | undefined
    await act(async () => { returned = await result.current.unlockVaultWithPasskey(authenticator) })

    expect(spy).toHaveBeenCalledWith('passkey-unlock', authenticator)
    expect(returned).toBe(unlocked)
    expect(result.current.mode).toBe('unlocked')
    expect(result.current.client).toBe(unlocked)
    expect(result.current.busy).toBe(false)
    expect(result.current.error).toBeNull()
  })

  it('keeps the vault locked and sets the error when the passkey unlock fails', async () => {
    localStorage.setItem('kakeflow.pwa.vault.passkey-unlock-fails', '1')
    vi.spyOn(PwaLedgerClient, 'unlockWithPasskey').mockRejectedValue(new Error('Vault authentication failed'))
    const { result } = renderHook(() => usePwaClient('passkey-unlock-fails'))

    await act(async () => {
      await expect(result.current.unlockVaultWithPasskey(authenticator)).rejects.toThrow('Vault authentication failed')
    })

    expect(result.current.mode).toBe('locked')
    expect(result.current.client).toBeNull()
    expect(result.current.error).toBe('Vault authentication failed')
    expect(result.current.busy).toBe(false)
  })

  it('keeps the vault locked when a pending passkey unlock resolves late', async () => {
    localStorage.setItem('kakeflow.pwa.vault.passkey-unlock-late', '1')
    const pending = deferred<PwaLedgerClient>()
    const lateClient = fakeClient()
    vi.spyOn(PwaLedgerClient, 'unlockWithPasskey').mockReturnValue(pending.promise)
    const { result } = renderHook(() => usePwaClient('passkey-unlock-late'))

    let unlock!: Promise<PwaLedgerClient>
    act(() => { unlock = result.current.unlockVaultWithPasskey(authenticator) })
    act(() => { result.current.lockVault() })
    pending.resolve(lateClient)

    await expect(unlock).rejects.toThrow('Vault operation was superseded')
    expect(result.current.mode).toBe('locked')
    expect(lateClient.lock).toHaveBeenCalledOnce()
    expect(lateClient.close).toHaveBeenCalledOnce()
  })
})
