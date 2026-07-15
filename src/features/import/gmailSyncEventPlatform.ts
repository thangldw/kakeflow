import { listen as tauriListen, type Event, type UnlistenFn } from '@tauri-apps/api/event'
import type { GmailSyncResultDto } from '../../platform'

export const GMAIL_SYNCED_EVENT = 'kakeflow://gmail-synced'
const SYNC_RESULTS = new Set<GmailSyncResultDto>(['NO_CHANGES', 'DISCOVERED', 'FAILED_RETRYABLE', 'LEASE_EXPIRED', 'TERMINAL_SUSPENDED'])
export interface GmailSyncedEventDto { readonly householdId: string; readonly connectionId: string; readonly discoveredCount: number; readonly result: Exclude<GmailSyncResultDto, 'NEVER' | 'RUNNING' | 'DISABLED'> }
type Listen = <T>(event: string, handler: (event: Event<T>) => void) => Promise<UnlistenFn>

export function createGmailSyncEventPlatform(listen: Listen = tauriListen) {
  return { subscribe: (listener: (event: GmailSyncedEventDto) => void) => listen<unknown>(GMAIL_SYNCED_EVENT, (event) => listener(parseGmailSyncedEvent(event.payload))) }
}

function parseGmailSyncedEvent(value: unknown): GmailSyncedEventDto {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) throw new TypeError('gmail synced event')
  const record = value as Record<string, unknown>
  if (!SYNC_RESULTS.has(record.result as GmailSyncResultDto)) throw new TypeError('gmail sync result')
  return { householdId: identifier(record.householdId), connectionId: identifier(record.connectionId), discoveredCount: count(record.discoveredCount), result: record.result as GmailSyncedEventDto['result'] }
}
function identifier(value: unknown): string { if (typeof value !== 'string' || value.length === 0 || value.length > 128 || !/^[A-Za-z0-9_-]+$/.test(value)) throw new TypeError('gmail event identifier'); return value }
function count(value: unknown): number { if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < 0) throw new TypeError('gmail event count'); return value }
export const gmailSyncEventPlatform = createGmailSyncEventPlatform()
