import { describe, expect, it } from 'vitest'
import type { GmailInboxItemDto } from '../../platform'
import { attachGmailInboxIdentity, gmailInboxFileIsImmutable, isGmailInboxPreviewable, retainActiveGmailPreviews } from './gmailInbox'

const item = (state: GmailInboxItemDto['state'] = 'READY'): GmailInboxItemDto => ({ id: 'a'.repeat(64), householdId: 'family', connectionId: 'gmail-1', fileName: 'statement.eml', mediaType: 'message/rfc822', internalDateMs: 1_752_537_600_000, estimatedByteSize: 42, contentReady: !['DISCOVERED', 'REMOVED'].includes(state), state, attemptCount: 1, importRunId: state === 'STAGED' ? 'run-1' : null, lastErrorCode: state === 'FAILED' ? 'READ_FAILED' : null, discoveredAt: '2026-07-15T00:00:00Z', updatedAt: '2026-07-15T00:00:00Z' })

describe('Gmail canonical Inbox helpers', () => {
  it('accepts only the same hydrated previewable evidence', () => { expect(isGmailInboxPreviewable(item())).toBe(true); expect(gmailInboxFileIsImmutable(item(), item())).toBe(true); expect(gmailInboxFileIsImmutable(item(), { ...item(), internalDateMs: 2 })).toBe(false); expect(gmailInboxFileIsImmutable(item(), item('STAGED'))).toBe(false) })
  it('attaches Gmail identity and removes terminal previews', () => { const preview = attachGmailInboxIdentity({ id: 'b'.repeat(64), filename: 'statement.eml', adapterId: 'paypay-history-v1', encoding: 'eml', recordCount: 1, issues: [], status: 'ready', parsedAt: '2026-07-15T00:00:00Z' }, item()); expect(preview).toMatchObject({ sourceType: 'GMAIL', gmailInboxItemId: item().id }); expect(retainActiveGmailPreviews([preview], [item('STAGED')])).toEqual([preview]); expect(retainActiveGmailPreviews([preview], [item('IGNORED')])).toEqual([]) })
})
