import { describe, expect, it, vi } from 'vitest'

import { createPlatformClient, isTauriRuntime, PlatformIpcError } from './client'
import type { AppCommand, Invoke } from './types'

describe('platform client', () => {
  it('detects the Tauri v2 runtime without assuming window exists', () => {
    expect(isTauriRuntime({ __TAURI_INTERNALS__: {} } as unknown as typeof globalThis)).toBe(true)
    expect(isTauriRuntime({ __TAURI_INTERNALS__: null } as unknown as typeof globalThis)).toBe(false)
    expect(isTauriRuntime({} as typeof globalThis)).toBe(false)
  })

  it('provides deterministic fallback DTOs in the browser without invoking IPC', async () => {
    const invokeSpy = vi.fn()
    const invoke: Invoke = async <T>(command: AppCommand) => {
      invokeSpy(command)
      return undefined as T
    }
    const client = createPlatformClient({ tauri: false, invoke })

    await expect(client.bootstrap()).resolves.toEqual({
      application: 'KakeFlow',
      database: { healthy: false, schemaVersion: 0 },
    })
    await expect(client.health()).resolves.toEqual({
      status: 'degraded',
      database: { healthy: false, schemaVersion: 0 },
    })
    await expect(client.status()).resolves.toEqual({ schemaVersion: 0, integrity: 'failed' })
    await expect(client.listHouseholds()).resolves.toEqual([])
    expect(client.runtime).toBe('web')
    expect(invokeSpy).not.toHaveBeenCalled()
  })

  it('invokes each desktop command and returns validated camelCase DTOs', async () => {
    const responses: Record<string, unknown> = {
      app_bootstrap: { application: 'KakeFlow', database: { healthy: true, schemaVersion: 5 } },
      app_health: { status: 'ok', database: { healthy: true, schemaVersion: 5 } },
      app_status: { schemaVersion: 5, integrity: 'ok' },
      households_list: [{ id: 'family', name: 'Family', baseCurrency: 'JPY', createdAt: '2026-07-12T00:00:00Z' }],
      household_create: { id: 'family', name: 'Family', baseCurrency: 'JPY', createdAt: '2026-07-12T00:00:00Z' },
      dashboard_query: { month: '2026-07', accountingBasis: 'ACCRUAL', incomeJpy: 650000, expenseJpy: 250000, savingsJpy: 400000, postedTransactionCount: 10 },
      transactions_query: { items: [], page: 1, pageSize: 20, totalItems: 0, totalPages: 0 },
      import_summary: { totalRuns: 0, discovered: 0, extracting: 0, reviewRequired: 0, posted: 0, failed: 0, rolledBack: 0, sourceDocuments: 0, sourceRecords: 0, pendingCandidates: 0, readyCandidates: 0 },
    }
    const invokeSpy = vi.fn()
    const invoke: Invoke = async <T>(command: AppCommand, args?: Record<string, unknown>) => {
      invokeSpy(command, args)
      return responses[command] as T
    }
    const client = createPlatformClient({ tauri: true, invoke })

    await expect(client.bootstrap()).resolves.toEqual(responses.app_bootstrap)
    await expect(client.health()).resolves.toEqual(responses.app_health)
    await expect(client.status()).resolves.toEqual(responses.app_status)
    await expect(client.listHouseholds()).resolves.toEqual(responses.households_list)
    await expect(client.createHousehold({ id: 'family', name: 'Family' })).resolves.toEqual(responses.household_create)
    await expect(client.queryDashboard({ householdId: 'family', month: '2026-07', accountingBasis: 'ACCRUAL' })).resolves.toEqual(responses.dashboard_query)
    await expect(client.queryTransactions({ householdId: 'family', accountingBasis: 'ACCRUAL', page: 1, pageSize: 20 })).resolves.toEqual(responses.transactions_query)
    await expect(client.importSummary('family')).resolves.toEqual(responses.import_summary)
    expect(invokeSpy).toHaveBeenCalledWith('household_create', { input: { id: 'family', name: 'Family' } })
    expect(invokeSpy).toHaveBeenCalledTimes(8)
  })

  it('rejects malformed responses with a sanitized typed error', async () => {
    const invoke: Invoke = async <T>() => ({ schema_version: 5, integrity: 'ok' }) as T
    const client = createPlatformClient({ tauri: true, invoke })

    const error = await client.status().catch((reason: unknown) => reason)

    expect(error).toBeInstanceOf(PlatformIpcError)
    expect(error).toMatchObject({
      code: 'INVALID_RESPONSE',
      command: 'app_status',
      message: 'The desktop service returned an invalid response.',
    })
  })

  it('does not expose raw invoke errors', async () => {
    const secret = '/Users/example/private/kakeflow.db: SQLCipher key rejected'
    const invoke: Invoke = async () => { throw new Error(secret) }
    const client = createPlatformClient({ tauri: true, invoke })

    const error = await client.health().catch((reason: unknown) => reason)

    expect(error).toBeInstanceOf(PlatformIpcError)
    expect(String(error)).not.toContain(secret)
    expect(error).not.toHaveProperty('cause')
    expect(error).toMatchObject({ code: 'COMMAND_FAILED', command: 'app_health' })
  })
})
