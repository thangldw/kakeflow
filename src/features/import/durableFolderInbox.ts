import type { ImportPreview } from './importService'
import type { WatchedFileInboxItemDto } from '../../platform'

export const MAX_BACKGROUND_FOLDER_PREVIEWS = 4

const REHYDRATABLE_STATES = new Set(['DISCOVERED', 'READY', 'NEEDS_MAPPING'])

/** Selects a bounded, deterministic batch. `hydrated` is process memory only;
 * durable state remains native SQLite and is re-read after every restart. */
export function selectFolderInboxHydrationBatch(
  items: readonly WatchedFileInboxItemDto[],
  hydrated: ReadonlySet<string>,
  limit = MAX_BACKGROUND_FOLDER_PREVIEWS,
): readonly WatchedFileInboxItemDto[] {
  if (!Number.isSafeInteger(limit) || limit < 1) return []
  return items
    .filter((item) => REHYDRATABLE_STATES.has(item.state) && !hydrated.has(item.id))
    .sort((left, right) => left.discoveredAt.localeCompare(right.discoveredAt) || left.id.localeCompare(right.id))
    .slice(0, Math.min(limit, MAX_BACKGROUND_FOLDER_PREVIEWS))
}

export function attachFolderInboxIdentity(preview: ImportPreview, item: WatchedFileInboxItemDto): ImportPreview {
  return {
    ...preview,
    sourceType: 'LOCAL_FOLDER',
    folderInboxItemId: item.id,
    watchedFolderId: item.watchedFolderId,
    relativePath: item.relativePath,
  }
}

export function folderInboxPreviewOutcome(preview: ImportPreview): 'READY' | 'NEEDS_MAPPING' | 'FAILED' {
  if (preview.status === 'unsupported') return 'NEEDS_MAPPING'
  if (preview.status === 'error') return 'FAILED'
  return 'READY'
}

export function folderInboxFailureCode(preview: ImportPreview): string {
  const issue = preview.issues.find((candidate) => candidate.severity === 'error')
  return issue?.code && /^[A-Z][A-Z0-9_]{1,63}$/.test(issue.code) ? issue.code : 'PREVIEW_FAILED'
}

export function recordClaimedFolderItems(hydrated: Set<string>, items: readonly Pick<WatchedFileInboxItemDto, 'id'>[]): void {
  items.forEach((item) => hydrated.add(item.id))
}

export function retainActiveFolderPreviews(previews: readonly ImportPreview[], items: readonly WatchedFileInboxItemDto[]): ImportPreview[] {
  const active = new Set(items.filter((item) => REHYDRATABLE_STATES.has(item.state) || item.state === 'PROCESSING').map((item) => item.id))
  return previews.filter((preview) => !preview.folderInboxItemId || active.has(preview.folderInboxItemId))
}
