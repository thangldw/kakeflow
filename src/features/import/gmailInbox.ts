import type { GmailInboxItemDto } from '../../platform'
import type { ImportPreview } from './importService'

const PREVIEWABLE_STATES = new Set<GmailInboxItemDto['state']>(['READY', 'NEEDS_MAPPING'])
const RETAINED_STATES = new Set<GmailInboxItemDto['state']>(['READY', 'NEEDS_MAPPING', 'STAGED'])

export function isGmailInboxPreviewable(item: GmailInboxItemDto): boolean {
  return PREVIEWABLE_STATES.has(item.state) && item.contentReady
}

export function gmailInboxFileIsImmutable(expected: GmailInboxItemDto, actual: GmailInboxItemDto): boolean {
  return expected.id === actual.id
    && expected.householdId === actual.householdId
    && expected.connectionId === actual.connectionId
    && expected.fileName === actual.fileName
    && expected.internalDateMs === actual.internalDateMs
    && isGmailInboxPreviewable(actual)
}

export function attachGmailInboxIdentity(preview: ImportPreview, item: GmailInboxItemDto): ImportPreview {
  return { ...preview, sourceType: 'GMAIL', gmailInboxItemId: item.id, sourceModifiedAt: new Date(item.internalDateMs).toISOString() }
}

export function retainActiveGmailPreviews(previews: readonly ImportPreview[], items: readonly GmailInboxItemDto[]): ImportPreview[] {
  const retainedIds = new Set(items.filter((item) => RETAINED_STATES.has(item.state)).map((item) => item.id))
  return previews.filter((preview) => !preview.gmailInboxItemId || retainedIds.has(preview.gmailInboxItemId))
}

export function gmailInboxStateLabel(state: GmailInboxItemDto['state']): string {
  return {
    DISCOVERED: '同期済み', PROCESSING: '取込準備中', READY: 'プレビュー可能', NEEDS_MAPPING: '形式の対応付けが必要',
    STAGED: 'レビュー待ち', FAILED: '失敗', IGNORED: '無視', REMOVED: '削除済み', TOO_LARGE: 'サイズ上限超過', UNSUPPORTED: '未対応',
  }[state]
}
