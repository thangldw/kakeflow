import type { GoogleDriveInboxItemDto } from '../../platform'
import type { ImportPreview } from './importService'

const PREVIEWABLE_STATES = new Set<GoogleDriveInboxItemDto['state']>(['READY', 'NEEDS_MAPPING'])
const RETAINED_STATES = new Set<GoogleDriveInboxItemDto['state']>(['READY', 'NEEDS_MAPPING', 'STAGED'])

export function isGoogleDriveInboxPreviewable(item: GoogleDriveInboxItemDto): boolean {
  return PREVIEWABLE_STATES.has(item.state) && item.contentSha256 !== null
}

export function googleDriveInboxFileIsImmutable(
  expected: GoogleDriveInboxItemDto,
  actual: GoogleDriveInboxItemDto,
  byteLength: number,
): boolean {
  return expected.id === actual.id
    && expected.householdId === actual.householdId
    && expected.generationFingerprint === actual.generationFingerprint
    && expected.contentSha256 !== null
    && expected.contentSha256 === actual.contentSha256
    && (actual.remoteByteSize === null || actual.remoteByteSize === byteLength)
    && isGoogleDriveInboxPreviewable(actual)
}

export function attachGoogleDriveInboxIdentity(preview: ImportPreview, item: GoogleDriveInboxItemDto): ImportPreview {
  return {
    ...preview,
    sourceType: 'GOOGLE_DRIVE',
    driveInboxItemId: item.id,
    sourceModifiedAt: item.remoteModifiedAt ?? preview.sourceModifiedAt,
  }
}

export function retainActiveGoogleDrivePreviews(
  previews: readonly ImportPreview[],
  items: readonly GoogleDriveInboxItemDto[],
): ImportPreview[] {
  const retainedIds = new Set(items.filter((item) => RETAINED_STATES.has(item.state)).map((item) => item.id))
  return previews.filter((preview) => !preview.driveInboxItemId || retainedIds.has(preview.driveInboxItemId))
}

export function googleDriveInboxStateLabel(state: GoogleDriveInboxItemDto['state']): string {
  return {
    DISCOVERED: '同期済み', PROCESSING: '取込準備中', READY: 'プレビュー可能', NEEDS_MAPPING: '形式の対応付けが必要',
    STAGED: 'レビュー待ち', FAILED: '失敗', IGNORED: '無視', REMOVED: '削除済み', TOO_LARGE: 'サイズ上限超過', UNSUPPORTED: '未対応',
  }[state]
}
