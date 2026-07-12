import { describe, expect, it } from 'vitest'

import {
  discoverWatchedFiles,
  markWatchedFilePreviewed,
  readWatchedFileCheckpoints,
  watchedFileFingerprint,
  watchedFileKey,
  writeWatchedFileCheckpoints,
} from './folderAutomation'

const file = { relativePath: 'Bank/history.csv', fileName: 'history.csv', mediaType: 'text/csv', byteSize: 42, modifiedUnixMs: 100 }

describe('folder automation checkpoints', () => {
  it('discovers a new file only once until its metadata changes', () => {
    const first = discoverWatchedFiles({}, 'folder-1', [file], '2026-07-13T00:00:00Z')
    expect(first.discovered).toEqual([file])
    const second = discoverWatchedFiles(first.checkpoints, 'folder-1', [file], '2026-07-13T00:01:00Z')
    expect(second.discovered).toEqual([])
    const changed = { ...file, byteSize: 43 }
    expect(discoverWatchedFiles(second.checkpoints, 'folder-1', [changed]).discovered).toEqual([changed])
  })

  it('tracks preview status per folder and relative path', () => {
    const discovered = discoverWatchedFiles({}, 'folder-1', [file])
    const previewed = markWatchedFilePreviewed(discovered.checkpoints, 'folder-1', file)
    expect(previewed[watchedFileKey('folder-1', file)]?.state).toBe('PREVIEWED')
    expect(previewed[watchedFileKey('folder-1', file)]?.fingerprint).toBe(watchedFileFingerprint(file))
  })

  it('persists checkpoints and rejects malformed storage', () => {
    const values = new Map<string, string>()
    const storage = { getItem: (key: string) => values.get(key) ?? null, setItem: (key: string, value: string) => values.set(key, value) }
    const checkpoints = markWatchedFilePreviewed({}, 'folder-1', file)
    writeWatchedFileCheckpoints(storage, 'home', checkpoints)
    expect(readWatchedFileCheckpoints(storage, 'home')).toEqual(checkpoints)
    values.set('kakeflow.folder-checkpoints.home', '{bad json')
    expect(readWatchedFileCheckpoints(storage, 'home')).toEqual({})
  })
})
