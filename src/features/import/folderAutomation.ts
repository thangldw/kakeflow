import type { WatchedFileMetadataDto } from '../../platform/types'

export const DEFAULT_FOLDER_SCAN_INTERVAL_MS = 60_000

export interface WatchedFileCheckpoint {
  readonly fingerprint: string
  readonly firstSeenAt: string
  readonly lastSeenAt: string
  readonly state: 'DISCOVERED' | 'PREVIEWED'
}

export type WatchedFileCheckpoints = Readonly<Record<string, WatchedFileCheckpoint>>

export function watchedFileKey(folderId: string, file: Pick<WatchedFileMetadataDto, 'relativePath'>): string {
  return `${folderId}:${file.relativePath}`
}

export function watchedFileFingerprint(file: WatchedFileMetadataDto): string {
  return `${file.relativePath}\u0000${file.byteSize}\u0000${file.modifiedUnixMs ?? 'unknown'}`
}

export function discoverWatchedFiles(
  current: WatchedFileCheckpoints,
  folderId: string,
  files: readonly WatchedFileMetadataDto[],
  now = new Date().toISOString(),
): { readonly checkpoints: WatchedFileCheckpoints; readonly discovered: readonly WatchedFileMetadataDto[] } {
  const next: Record<string, WatchedFileCheckpoint> = { ...current }
  const discovered: WatchedFileMetadataDto[] = []
  for (const file of files) {
    const key = watchedFileKey(folderId, file)
    const fingerprint = watchedFileFingerprint(file)
    const existing = current[key]
    if (!existing || existing.fingerprint !== fingerprint) {
      discovered.push(file)
      next[key] = { fingerprint, firstSeenAt: now, lastSeenAt: now, state: 'DISCOVERED' }
    } else {
      next[key] = { ...existing, lastSeenAt: now }
    }
  }
  return { checkpoints: next, discovered }
}

export function markWatchedFilePreviewed(
  current: WatchedFileCheckpoints,
  folderId: string,
  file: WatchedFileMetadataDto,
  now = new Date().toISOString(),
): WatchedFileCheckpoints {
  const key = watchedFileKey(folderId, file)
  const fingerprint = watchedFileFingerprint(file)
  const existing = current[key]
  return {
    ...current,
    [key]: {
      fingerprint,
      firstSeenAt: existing?.fingerprint === fingerprint ? existing.firstSeenAt : now,
      lastSeenAt: now,
      state: 'PREVIEWED',
    },
  }
}

export function readWatchedFileCheckpoints(storage: Pick<Storage, 'getItem'>, householdId: string): WatchedFileCheckpoints {
  try {
    const value = storage.getItem(`kakeflow.folder-checkpoints.${householdId}`)
    if (!value) return {}
    const parsed: unknown = JSON.parse(value)
    if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) return {}
    return parsed as WatchedFileCheckpoints
  } catch {
    return {}
  }
}

export function writeWatchedFileCheckpoints(storage: Pick<Storage, 'setItem'>, householdId: string, checkpoints: WatchedFileCheckpoints): void {
  storage.setItem(`kakeflow.folder-checkpoints.${householdId}`, JSON.stringify(checkpoints))
}
