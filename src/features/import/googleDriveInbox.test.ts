import { describe, expect, it } from 'vitest'

import type { GoogleDriveInboxItemDto } from '../../platform'
import {
  attachGoogleDriveInboxIdentity,
  googleDriveInboxFileIsImmutable,
  isGoogleDriveInboxPreviewable,
  retainActiveGoogleDrivePreviews,
} from './googleDriveInbox'

const item = (state: GoogleDriveInboxItemDto['state'] = 'READY'): GoogleDriveInboxItemDto => ({
  id: 'a'.repeat(64), householdId: 'family', connectionId: 'drive-1', fileId: 'remote-1', generationFingerprint: 'b'.repeat(64),
  fileName: 'paypay.csv', mediaType: 'text/csv', remoteByteSize: 42, remoteModifiedAt: '2026-07-15T00:00:00Z',
  remoteMd5Checksum: 'c'.repeat(32), driveVersion: '7', contentSha256: 'd'.repeat(64), state, attemptCount: 1,
  importRunId: state === 'STAGED' ? 'run-1' : null, lastErrorCode: state === 'FAILED' ? 'READ_FAILED' : null,
  discoveredAt: '2026-07-15T00:00:00Z', updatedAt: '2026-07-15T00:00:00Z',
})

describe('Google Drive canonical Inbox helpers', () => {
  it('accepts only immutable previewable generations with exact bytes', () => {
    expect(isGoogleDriveInboxPreviewable(item())).toBe(true)
    expect(googleDriveInboxFileIsImmutable(item(), item(), 42)).toBe(true)
    expect(googleDriveInboxFileIsImmutable(item(), { ...item(), generationFingerprint: 'e'.repeat(64) }, 42)).toBe(false)
    expect(googleDriveInboxFileIsImmutable(item(), item(), 41)).toBe(false)
    expect(googleDriveInboxFileIsImmutable(item(), item('STAGED'), 42)).toBe(false)
  })

  it('attaches source identity and removes previews after terminal inbox states', () => {
    const preview = attachGoogleDriveInboxIdentity({
      id: 'd'.repeat(64), filename: 'paypay.csv', adapterId: 'paypay-history-v1', encoding: 'utf-8', recordCount: 1,
      issues: [], status: 'ready', parsedAt: '2026-07-15T00:00:00Z',
    }, item())
    expect(preview).toMatchObject({ sourceType: 'GOOGLE_DRIVE', driveInboxItemId: item().id, sourceModifiedAt: item().remoteModifiedAt })
    expect(retainActiveGoogleDrivePreviews([preview], [item('STAGED')])).toEqual([preview])
    expect(retainActiveGoogleDrivePreviews([preview], [item('IGNORED')])).toEqual([])
  })
})
