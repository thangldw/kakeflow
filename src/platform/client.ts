import { invoke as tauriInvoke } from '@tauri-apps/api/core'

import type {
  AppBootstrapDto,
  AppCommand,
  AppHealthDto,
  AppStatusDto,
  DatabaseStatusDto,
  HouseholdDto,
  Invoke,
  PlatformClient,
} from './types'

export type PlatformIpcErrorCode = 'COMMAND_FAILED' | 'INVALID_RESPONSE'

/** A deliberately sanitized error safe to show or log in the webview. */
export class PlatformIpcError extends Error {
  readonly code: PlatformIpcErrorCode
  readonly command: AppCommand

  constructor(code: PlatformIpcErrorCode, command: AppCommand) {
    super(code === 'INVALID_RESPONSE' ? 'The desktop service returned an invalid response.' : 'The desktop service is unavailable.')
    this.name = 'PlatformIpcError'
    this.code = code
    this.command = command
  }
}

const WEB_DATABASE_STATUS: DatabaseStatusDto = Object.freeze({
  healthy: false,
  schemaVersion: 0,
})

const WEB_BOOTSTRAP: AppBootstrapDto = Object.freeze({
  application: 'KakeFlow',
  database: WEB_DATABASE_STATUS,
})

const WEB_HEALTH: AppHealthDto = Object.freeze({
  status: 'degraded',
  database: WEB_DATABASE_STATUS,
})

const WEB_STATUS: AppStatusDto = Object.freeze({
  schemaVersion: 0,
  integrity: 'failed',
})

type TauriGlobal = typeof globalThis & {
  __TAURI_INTERNALS__?: unknown
}

export function isTauriRuntime(scope: typeof globalThis = globalThis): boolean {
  return typeof (scope as TauriGlobal).__TAURI_INTERNALS__ === 'object'
    && (scope as TauriGlobal).__TAURI_INTERNALS__ !== null
}

export interface PlatformClientOptions {
  readonly invoke?: Invoke
  readonly tauri?: boolean
}

export function createPlatformClient(options: PlatformClientOptions = {}): PlatformClient {
  const runtime = (options.tauri ?? isTauriRuntime()) ? 'tauri' : 'web'
  const invoke: Invoke = options.invoke ?? tauriInvoke

  if (runtime === 'web') {
    return {
      runtime,
      bootstrap: async () => WEB_BOOTSTRAP,
      health: async () => WEB_HEALTH,
      status: async () => WEB_STATUS,
      listHouseholds: async () => [],
      createHousehold: async (input) => ({ id: input.id, name: input.name, baseCurrency: 'JPY', createdAt: new Date(0).toISOString() }),
    }
  }

  return {
    runtime,
    bootstrap: () => invokeValidated(invoke, 'app_bootstrap', parseBootstrap),
    health: () => invokeValidated(invoke, 'app_health', parseHealth),
    status: () => invokeValidated(invoke, 'app_status', parseStatus),
    listHouseholds: () => invokeValidated(invoke, 'households_list', parseHouseholds),
    createHousehold: (input) => invokeValidated(invoke, 'household_create', parseHousehold, { input }),
  }
}

async function invokeValidated<T>(
  invoke: Invoke,
  command: AppCommand,
  parse: (value: unknown) => T,
  args?: Record<string, unknown>,
): Promise<T> {
  let response: unknown

  try {
    response = await invoke<unknown>(command, args)
  } catch {
    // Rust, SQL, filesystem paths, and source data must never cross this boundary.
    throw new PlatformIpcError('COMMAND_FAILED', command)
  }

  try {
    return parse(response)
  } catch {
    throw new PlatformIpcError('INVALID_RESPONSE', command)
  }
}

function parseHouseholds(value: unknown): readonly HouseholdDto[] {
  if (!Array.isArray(value)) throw new TypeError('households')
  return value.map(parseHousehold)
}

function parseHousehold(value: unknown): HouseholdDto {
  const record = asRecord(value)
  if (typeof record.id !== 'string' || typeof record.name !== 'string' || record.baseCurrency !== 'JPY' || typeof record.createdAt !== 'string') {
    throw new TypeError('household')
  }
  return { id: record.id, name: record.name, baseCurrency: record.baseCurrency, createdAt: record.createdAt }
}

function parseBootstrap(value: unknown): AppBootstrapDto {
  const record = asRecord(value)
  if (typeof record.application !== 'string') throw new TypeError('application')

  return {
    application: record.application,
    database: parseDatabaseStatus(record.database),
  }
}

function parseHealth(value: unknown): AppHealthDto {
  const record = asRecord(value)
  if (record.status !== 'ok' && record.status !== 'degraded') throw new TypeError('status')

  return {
    status: record.status,
    database: parseDatabaseStatus(record.database),
  }
}

function parseStatus(value: unknown): AppStatusDto {
  const record = asRecord(value)
  if (record.integrity !== 'ok' && record.integrity !== 'failed') throw new TypeError('integrity')

  return {
    schemaVersion: asSafeInteger(record.schemaVersion),
    integrity: record.integrity,
  }
}

function parseDatabaseStatus(value: unknown): DatabaseStatusDto {
  const record = asRecord(value)
  if (typeof record.healthy !== 'boolean') throw new TypeError('healthy')

  return {
    healthy: record.healthy,
    schemaVersion: asSafeInteger(record.schemaVersion),
  }
}

function asRecord(value: unknown): Record<string, unknown> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) throw new TypeError('object')
  return value as Record<string, unknown>
}

function asSafeInteger(value: unknown): number {
  if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < 0) throw new TypeError('integer')
  return value
}

export const platformClient = createPlatformClient()
