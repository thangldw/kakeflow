import { describe, expect, it, vi } from 'vitest'
import type { Event, UnlistenFn } from '@tauri-apps/api/event'

import {
  createWatchedFolderDiscoveryPlatform,
  WATCHED_FOLDER_DISCOVERY_EVENT,
} from './watchedFolderDiscoveryPlatform'

describe('watched-folder discovery platform', () => {
  it('subscribes to the native event and validates its DTO before delivery', async () => {
    let handler: ((event: Event<unknown>) => void) | undefined
    const unlisten = vi.fn()
    const listened = vi.fn()
    const listen = async <T>(name: string, next: (event: Event<T>) => void): Promise<UnlistenFn> => {
      listened(name, next)
      handler = next as (event: Event<unknown>) => void
      return unlisten
    }
    const listener = vi.fn()

    const stop = await createWatchedFolderDiscoveryPlatform(listen).subscribe(listener)
    expect(listened).toHaveBeenCalledWith(WATCHED_FOLDER_DISCOVERY_EVENT, expect.any(Function))
    handler?.({ id: 1, event: WATCHED_FOLDER_DISCOVERY_EVENT, payload: {
      eventVersion: 1,
      householdId: 'family',
      watchedFolderId: 'folder_1',
      detectedUnixMs: 1_783_878_400_000,
      changes: [{
        changeKind: 'CREATED', relativePath: 'PayPay/history.csv', fileName: 'history.csv',
        mediaType: 'text/csv', byteSize: 42, modifiedUnixMs: 1_783_878_399_000,
      }],
    } })

    expect(listener).toHaveBeenCalledWith(expect.objectContaining({
      householdId: 'family', watchedFolderId: 'folder_1',
      changes: [expect.objectContaining({ changeKind: 'CREATED', relativePath: 'PayPay/history.csv' })],
    }))
    stop()
    expect(unlisten).toHaveBeenCalledOnce()
  })

  it.each([
    { eventVersion: 2, householdId: 'family', watchedFolderId: 'folder', detectedUnixMs: 1, changes: [] },
    { eventVersion: 1, householdId: 'family', watchedFolderId: 'folder', detectedUnixMs: 1, changes: [{ changeKind: 'CREATED', relativePath: '../outside.csv', fileName: 'outside.csv', mediaType: 'text/csv', byteSize: 1, modifiedUnixMs: null }] },
    { eventVersion: 1, householdId: 'family', watchedFolderId: 'folder', detectedUnixMs: 1.5, changes: [] },
  ])('rejects malformed native payloads %#', async (payload) => {
    let handler: ((event: Event<unknown>) => void) | undefined
    const listen = async <T>(_name: string, next: (event: Event<T>) => void): Promise<UnlistenFn> => {
      handler = next as (event: Event<unknown>) => void
      return () => undefined
    }
    const listener = vi.fn()
    await createWatchedFolderDiscoveryPlatform(listen).subscribe(listener)

    expect(() => handler?.({ id: 1, event: WATCHED_FOLDER_DISCOVERY_EVENT, payload })).toThrow(TypeError)
    expect(listener).not.toHaveBeenCalled()
  })
})
