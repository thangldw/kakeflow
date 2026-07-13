import { describe, expect, it } from 'vitest'

import { attachFolderInboxIdentity, folderInboxFailureCode, folderInboxPreviewOutcome, recordClaimedFolderItems, retainActiveFolderPreviews, selectFolderInboxHydrationBatch } from './durableFolderInbox'
import type { ImportPreview } from './importService'
import type { WatchedFileInboxItemDto } from '../../platform'

const item = (id: string, state: WatchedFileInboxItemDto['state'], discoveredAt = '2026-07-13T00:00:00Z'): WatchedFileInboxItemDto => ({
  id, householdId: 'family', watchedFolderId: 'folder', watchedFolderLabel: 'Inbox', relativePath: `${id}.csv`, fileName: `${id}.csv`,
  mediaType: 'text/csv', byteSize: 10, modifiedUnixMs: 1, fingerprint: `fingerprint-${id}`, state, attemptCount: 0,
  importRunId: null, lastErrorCode: null, discoveredAt, updatedAt: discoveredAt,
})
const preview = (status: ImportPreview['status']): ImportPreview => ({ id: 'sha', filename: 'bank.csv', adapterId: null, encoding: 'utf-8', recordCount: 0, issues: [], status, parsedAt: '2026-07-13T00:00:00Z' })

describe('durable folder inbox coordinator policy', () => {
  it('hydrates only durable actionable states once per process in a bounded deterministic batch', () => {
    const items = [item('staged', 'STAGED'), item('ready', 'READY', '2026-07-13T00:00:02Z'), item('new', 'DISCOVERED', '2026-07-13T00:00:01Z'), item('mapping', 'NEEDS_MAPPING', '2026-07-13T00:00:03Z'), item('failed', 'FAILED')]
    expect(selectFolderInboxHydrationBatch(items, new Set(['ready']), 20).map((candidate) => candidate.id)).toEqual(['new', 'mapping'])
    expect(selectFolderInboxHydrationBatch(items, new Set(), 0)).toEqual([])
  })

  it('maps recognized, unsupported, and failed previews to explicit durable outcomes', () => {
    expect(folderInboxPreviewOutcome(preview('ready'))).toBe('READY')
    expect(folderInboxPreviewOutcome(preview('extractable'))).toBe('READY')
    expect(folderInboxPreviewOutcome(preview('unsupported'))).toBe('NEEDS_MAPPING')
    expect(folderInboxPreviewOutcome(preview('error'))).toBe('FAILED')
    expect(folderInboxFailureCode({ ...preview('error'), issues: [{ code: 'IMPORT_READ_FAILED', message: 'x', severity: 'error' }] })).toBe('IMPORT_READ_FAILED')
  })

  it('attaches native durable identity without exposing an absolute path', () => {
    const attached = attachFolderInboxIdentity(preview('ready'), item('queue', 'DISCOVERED'))
    expect(attached).toMatchObject({ folderInboxItemId: 'queue', watchedFolderId: 'folder', relativePath: 'queue.csv', sourceType: 'LOCAL_FOLDER' })
    expect(JSON.stringify(attached)).not.toContain('/Users/')
  })

  it('suppresses only items actually returned by a successful claim', () => {
    const hydrated = new Set<string>()
    recordClaimedFolderItems(hydrated, [item('claimed', 'PROCESSING')])
    expect([...hydrated]).toEqual(['claimed'])
    recordClaimedFolderItems(hydrated, [])
    expect(hydrated.has('requested-but-not-claimed')).toBe(false)
  })

  it('removes stale previews for removed or superseded generations', () => {
    const oldPreview = attachFolderInboxIdentity(preview('ready'), item('old', 'READY'))
    const newPreview = attachFolderInboxIdentity({ ...preview('ready'), id: 'sha-new' }, item('new', 'READY'))
    expect(retainActiveFolderPreviews([oldPreview, newPreview], [item('old', 'REMOVED'), item('new', 'READY')]).map((candidate) => candidate.folderInboxItemId)).toEqual(['new'])
  })
})
