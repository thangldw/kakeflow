import type { Event, UnlistenFn } from '@tauri-apps/api/event'
import { describe, expect, it, vi } from 'vitest'

import { createGoogleDriveSyncEventPlatform, GOOGLE_DRIVE_SYNCED_EVENT } from './googleDriveSyncEventPlatform'

describe('Google Drive sync event platform', () => {
  it('subscribes to the native event and exposes only its validated redacted DTO', async () => {
    let handler: ((event: Event<unknown>) => void) | undefined
    const unlisten = vi.fn()
    const listen = async <T>(name: string, next: (event: Event<T>) => void): Promise<UnlistenFn> => {
      expect(name).toBe(GOOGLE_DRIVE_SYNCED_EVENT)
      handler = next as (event: Event<unknown>) => void
      return unlisten
    }
    const listener = vi.fn()
    const stop = await createGoogleDriveSyncEventPlatform(listen).subscribe(listener)

    handler?.({ id: 1, event: GOOGLE_DRIVE_SYNCED_EVENT, payload: {
      householdId: 'family', connectionId: 'drive-1', discoveredCount: 3, result: 'DISCOVERED',
      accessToken: 'must-not-cross-the-validated-boundary',
    } })

    expect(listener).toHaveBeenCalledWith({ householdId: 'family', connectionId: 'drive-1', discoveredCount: 3, result: 'DISCOVERED' })
    stop()
    expect(unlisten).toHaveBeenCalledOnce()
  })

  it.each([
    null,
    { householdId: '../family', connectionId: 'drive-1', discoveredCount: 0, result: 'NO_CHANGES' },
    { householdId: 'family', connectionId: 'drive-1', discoveredCount: -1, result: 'DISCOVERED' },
    { householdId: 'family', connectionId: 'drive-1', discoveredCount: 1, result: 'RUNNING' },
  ])('rejects malformed or non-terminal payloads %#', async (payload) => {
    let handler: ((event: Event<unknown>) => void) | undefined
    const listen = async <T>(_name: string, next: (event: Event<T>) => void): Promise<UnlistenFn> => {
      handler = next as (event: Event<unknown>) => void
      return () => undefined
    }
    const listener = vi.fn()
    await createGoogleDriveSyncEventPlatform(listen).subscribe(listener)

    expect(() => handler?.({ id: 1, event: GOOGLE_DRIVE_SYNCED_EVENT, payload })).toThrow(TypeError)
    expect(listener).not.toHaveBeenCalled()
  })
})
