import { listen as tauriListen, type Event, type UnlistenFn } from '@tauri-apps/api/event'

export const WATCHED_FOLDER_DISCOVERY_EVENT = 'kakeflow://watched-folder-discovery'

export type WatchedFolderFileChangeKind = 'CREATED' | 'MODIFIED' | 'REMOVED'

export interface WatchedFolderFileChangeDto {
  readonly changeKind: WatchedFolderFileChangeKind
  readonly relativePath: string
  readonly fileName: string
  readonly mediaType: string
  readonly byteSize: number
  readonly modifiedUnixMs: number | null
}

export interface WatchedFolderDiscoveryEventDto {
  readonly eventVersion: 1
  readonly householdId: string
  readonly watchedFolderId: string
  readonly detectedUnixMs: number
  readonly changes: readonly WatchedFolderFileChangeDto[]
}

type Listen = <T>(event: string, handler: (event: Event<T>) => void) => Promise<UnlistenFn>

export interface WatchedFolderDiscoveryPlatform {
  subscribe(listener: (event: WatchedFolderDiscoveryEventDto) => void): Promise<UnlistenFn>
}

export function createWatchedFolderDiscoveryPlatform(
  listen: Listen = tauriListen,
): WatchedFolderDiscoveryPlatform {
  return {
    subscribe: (listener) => listen<unknown>(WATCHED_FOLDER_DISCOVERY_EVENT, (event) => {
      listener(parseDiscoveryEvent(event.payload))
    }),
  }
}

function parseDiscoveryEvent(value: unknown): WatchedFolderDiscoveryEventDto {
  const record = object(value, 'discovery event')
  if (record.eventVersion !== 1 || !Array.isArray(record.changes)) {
    throw new TypeError('discovery event')
  }
  return {
    eventVersion: 1,
    householdId: identifier(record.householdId, 'household id'),
    watchedFolderId: identifier(record.watchedFolderId, 'watched folder id'),
    detectedUnixMs: nonNegativeSafeInteger(record.detectedUnixMs, 'detected time'),
    changes: record.changes.map(parseFileChange),
  }
}

function parseFileChange(value: unknown): WatchedFolderFileChangeDto {
  const record = object(value, 'file change')
  if (record.changeKind !== 'CREATED' && record.changeKind !== 'MODIFIED' && record.changeKind !== 'REMOVED') {
    throw new TypeError('change kind')
  }
  return {
    changeKind: record.changeKind,
    relativePath: relativePath(record.relativePath),
    fileName: nonEmptyString(record.fileName, 'file name'),
    mediaType: nonEmptyString(record.mediaType, 'media type'),
    byteSize: nonNegativeSafeInteger(record.byteSize, 'byte size'),
    modifiedUnixMs: record.modifiedUnixMs === null
      ? null
      : nonNegativeSafeInteger(record.modifiedUnixMs, 'modified time'),
  }
}

function object(value: unknown, label: string): Record<string, unknown> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) throw new TypeError(label)
  return value as Record<string, unknown>
}

function identifier(value: unknown, label: string): string {
  const parsed = nonEmptyString(value, label)
  if (parsed.length > 128 || !/^[A-Za-z0-9_-]+$/.test(parsed)) throw new TypeError(label)
  return parsed
}

function relativePath(value: unknown): string {
  const parsed = nonEmptyString(value, 'relative path')
  if (parsed.length > 4096 || parsed.startsWith('/') || parsed.includes('\\') || parsed.split('/').some((part) => part === '..' || part === '.')) {
    throw new TypeError('relative path')
  }
  return parsed
}

function nonEmptyString(value: unknown, label: string): string {
  if (typeof value !== 'string' || value.length === 0) throw new TypeError(label)
  return value
}

function nonNegativeSafeInteger(value: unknown, label: string): number {
  if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < 0) throw new TypeError(label)
  return value
}
