import { listen as tauriListen, type Event, type UnlistenFn } from '@tauri-apps/api/event'

import type { GoogleDriveSyncResultDto } from '../../platform'

export const GOOGLE_DRIVE_SYNCED_EVENT = 'kakeflow://google-drive-synced'

const SYNC_RESULTS = new Set<GoogleDriveSyncResultDto>([
  'NO_CHANGES', 'DISCOVERED', 'FAILED_RETRYABLE', 'LEASE_EXPIRED', 'TERMINAL_SUSPENDED',
])

export interface GoogleDriveSyncedEventDto {
  readonly householdId: string
  readonly connectionId: string
  readonly discoveredCount: number
  readonly result: Exclude<GoogleDriveSyncResultDto, 'NEVER' | 'RUNNING' | 'DISABLED'>
}

type Listen = <T>(event: string, handler: (event: Event<T>) => void) => Promise<UnlistenFn>

export interface GoogleDriveSyncEventPlatform {
  subscribe(listener: (event: GoogleDriveSyncedEventDto) => void): Promise<UnlistenFn>
}

export function createGoogleDriveSyncEventPlatform(
  listen: Listen = tauriListen,
): GoogleDriveSyncEventPlatform {
  return {
    subscribe: (listener) => listen<unknown>(GOOGLE_DRIVE_SYNCED_EVENT, (event) => {
      listener(parseGoogleDriveSyncedEvent(event.payload))
    }),
  }
}

function parseGoogleDriveSyncedEvent(value: unknown): GoogleDriveSyncedEventDto {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) throw new TypeError('google drive synced event')
  const record = value as Record<string, unknown>
  if (!SYNC_RESULTS.has(record.result as GoogleDriveSyncResultDto)) throw new TypeError('google drive sync result')
  return {
    householdId: identifier(record.householdId, 'household id'),
    connectionId: identifier(record.connectionId, 'connection id'),
    discoveredCount: nonNegativeSafeInteger(record.discoveredCount, 'discovered count'),
    result: record.result as GoogleDriveSyncedEventDto['result'],
  }
}

function identifier(value: unknown, label: string): string {
  if (typeof value !== 'string' || value.length === 0 || value.length > 128 || !/^[A-Za-z0-9_-]+$/.test(value)) throw new TypeError(label)
  return value
}

function nonNegativeSafeInteger(value: unknown, label: string): number {
  if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < 0) throw new TypeError(label)
  return value
}

export const googleDriveSyncEventPlatform = createGoogleDriveSyncEventPlatform()
