import { describe, expect, it, vi } from 'vitest'

import { createPlatformClient, isTauriRuntime, PlatformIpcError } from './client'
import type { AppCommand, Invoke, PostingDecisionDto, StartImportDto } from './types'

const dashboardLayouts = () => ({
  FINANCIAL_OVERVIEW: { widgetOrder: ['TREND', 'SPENDING', 'RECENT', 'CARDS'] as const, hiddenWidgets: [] as const },
  HOUSEHOLD_LEDGER: { widgetOrder: ['SPENDING', 'RECENT', 'TREND', 'CARDS'] as const, hiddenWidgets: [] as const },
  ASSETS_LIABILITIES: { widgetOrder: ['TREND', 'SPENDING', 'CARDS', 'RECENT'] as const, hiddenWidgets: [] as const },
  CARD_RECONCILIATION: { widgetOrder: ['CARDS', 'RECENT', 'TREND', 'SPENDING'] as const, hiddenWidgets: [] as const },
  CASH_FLOW: { widgetOrder: ['TREND', 'RECENT', 'CARDS', 'SPENDING'] as const, hiddenWidgets: [] as const },
})

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
    await expect(client.getDashboardPreferences('family')).resolves.toMatchObject({
      householdId: 'family', templateLayouts: dashboardLayouts(),
    })
    await expect(client.getLocalSyncFoundationStatus('family')).rejects.toMatchObject({ command: 'local_sync_foundation_status' })
    await expect(client.getDesktopRelayStatus('family')).rejects.toMatchObject({ command: 'relay_status' })
    await expect(client.listHouseholds()).resolves.toEqual([{
      id: 'demo-tanaka-family', name: '田中家', baseCurrency: 'JPY', createdAt: '2025-07-31T00:00:00.000Z',
    }])
    await expect(client.listHouseholdMembers('family')).resolves.toEqual([])
    await expect(client.createHouseholdMember({} as never)).rejects.toMatchObject({ command: 'household_member_create' })
    await expect(client.listAccounts('family')).resolves.toEqual([])
    await expect(client.createManualTransaction({} as never)).rejects.toMatchObject({ command: 'transaction_manual_create' })
    await expect(client.getTransactionDetail('family', 'tx')).rejects.toMatchObject({ command: 'transaction_detail_get' })
    await expect(client.updateTransaction({} as never)).rejects.toMatchObject({ command: 'transaction_update' })
    await expect(client.bulkUpdateTransactionMetadata({} as never)).rejects.toMatchObject({ command: 'transaction_metadata_bulk_update' })
    await expect(client.getSourceDocument('family', 'document')).rejects.toMatchObject({ command: 'source_document_get' })
    await expect(client.updateSourceDocumentAudience({} as never)).rejects.toMatchObject({ command: 'source_document_audience_update' })
    await expect(client.querySourceDocumentRecords({ householdId: 'family', sourceDocumentId: 'document', page: 1, pageSize: 20 })).rejects.toMatchObject({ command: 'source_document_records_query' })
    await expect(client.listTransactionSourceRecords('family', 'tx')).rejects.toMatchObject({ command: 'transaction_source_records_list' })
    await expect(client.listWatchedFolders('family')).resolves.toEqual([])
    await expect(client.listConnectorSummaries('family')).resolves.toEqual({
      schemaVersion: 1,
      items: [{
        schemaVersion: 1,
        connectorKind: 'MANUAL_IMPORT',
        connectionKey: 'manual-import',
        displayLabel: 'Manual import',
        availability: 'AVAILABLE',
        lifecycle: 'CONNECTED',
        health: 'MANUAL',
        capabilities: ['IMPORT_FILE', 'ACCOUNT_BINDING'],
        lastAttemptAt: null,
        lastSuccessAt: null,
        freshnessDeadlineAt: null,
        nextDueAt: null,
        pendingReviewCount: 0,
        consecutiveFailures: 0,
        lastErrorCode: null,
        bindingSummary: null,
        configurationDestination: 'IMPORT_INBOX',
      }],
      nextCursor: null,
    })
    await expect(client.listConnectorSummaries('family', { connectorKind: 'MANUAL_IMPORT', connectionKey: 'manual-import' })).resolves.toEqual({
      schemaVersion: 1,
      items: [],
      nextCursor: null,
    })
    for (const cursor of [
      'provider-cursor-secret',
      { connectorKind: 'DROPBOX', connectionKey: 'drive-primary' },
      { connectorKind: 'GMAIL', connectionKey: 'a'.repeat(129) },
      { connectorKind: 'GMAIL', connectionKey: 'gmail-primary', providerCursor: 'provider-cursor-secret' },
    ]) {
      await expect(client.listConnectorSummaries('family', cursor as never)).rejects.toThrow('connector cursor')
    }
    await expect(client.listConnectorSummaries('')).rejects.toThrow('household id')
    await expect(client.listConnectorSummaries('family', undefined, 101)).rejects.toThrow('connector limit')
    await expect(client.selectWatchedFolder('family', 'Inbox')).rejects.toMatchObject({ command: 'watched_folder_select' })
    await expect(client.selectIcloudFolder('family', 'iCloud Drive Inbox')).rejects.toMatchObject({ command: 'icloud_folder_select' })
    await expect(client.removeWatchedFolder('family', 'folder')).rejects.toMatchObject({ command: 'watched_folder_remove' })
    await expect(client.scanWatchedFolder('family', 'folder')).rejects.toMatchObject({ command: 'watched_folder_scan' })
    await expect(client.readWatchedFile('family', 'folder', 'bank.csv')).rejects.toMatchObject({ command: 'watched_folder_file_read' })
    await expect(client.listWatchedFileInbox('family')).resolves.toEqual([])
    await expect(client.countWatchedFileInbox('family')).resolves.toEqual({ discovered: 0, processing: 0, ready: 0, needsMapping: 0, staged: 0, failed: 0, ignored: 0, removed: 0, actionable: 0, total: 0 })
    await expect(client.listPendingReviews('family')).resolves.toEqual({ householdId: 'family', runs: [] })
    await expect(client.exportPendingImport({ householdId: 'family', runId: 'run-1' }, 'long secure passphrase')).rejects.toMatchObject({ command: 'pending_import_export_to_picker' })
    await expect(client.pickAndStagePendingImport('family', 'long secure passphrase')).rejects.toMatchObject({ command: 'pending_import_pick_and_stage' })
    await expect(client.applyPendingImport('family', 'package-1', { accounts: [], members: [] })).rejects.toMatchObject({ command: 'pending_import_apply' })
    await expect(client.discardPendingImport('package-1')).rejects.toMatchObject({ command: 'pending_import_discard' })
    await expect(client.claimWatchedFileInboxItems('family', ['item'])).rejects.toMatchObject({ command: 'watched_file_inbox_claim' })
    await expect(client.startImport({} as StartImportDto, new Uint8Array())).rejects.toMatchObject({ command: 'import_start' })
    await expect(client.previewImport('run-1')).rejects.toMatchObject({ command: 'import_preview' })
    await expect(client.commitImport('run-1', [])).rejects.toMatchObject({ command: 'import_commit' })
    await expect(client.rollbackImport('run-1')).rejects.toMatchObject({ command: 'import_rollback' })
    await expect(client.createBackup('long secure passphrase')).rejects.toMatchObject({ command: 'backup_create' })
    await expect(client.stageBackupRestore('long secure passphrase')).rejects.toMatchObject({ command: 'backup_restore_stage' })
    await expect(client.restartForRestore()).rejects.toMatchObject({ command: 'app_restart_for_restore' })
    await expect(client.extractDocument(new Uint8Array([1]), 'application/pdf')).rejects.toMatchObject({ command: 'document_extract' })
    await expect(client.ocrDocument(new Uint8Array([1]), 'image/png')).rejects.toMatchObject({ command: 'document_ocr' })
    await expect(client.suggestReceiptMatches('family', 'candidate')).resolves.toEqual([])
    await expect(client.confirmReceiptMatch('family', 'candidate', 'transaction')).rejects.toMatchObject({ command: 'receipt_match_confirm' })
    await expect(client.listCardSettlements('family')).resolves.toEqual([])
    await expect(client.confirmCardMatch('family', 'statement', 'payment')).rejects.toMatchObject({ command: 'card_match_confirm' })
    await expect(client.confirmCardPaymentLink('family', 'statement', 'payment')).rejects.toMatchObject({ command: 'card_payment_link_confirm' })
    await expect(client.unlinkCardPaymentLink('family', 'statement', 'payment')).rejects.toMatchObject({ command: 'card_payment_link_unlink' })
    await expect(client.updateCardStatementDueDate({ householdId: 'family', statementId: 'statement', paymentDueOn: null })).rejects.toMatchObject({ command: 'card_statement_due_date_update' })
    await expect(client.listCardSettlementBankMappings('family')).resolves.toEqual([])
    await expect(client.upsertCardSettlementBankMapping({} as never)).rejects.toMatchObject({ command: 'card_settlement_bank_mapping_upsert' })
    await expect(client.queryCardSettlementBalanceCoverage({ householdId: 'family', asOf: '2026-07-13' })).resolves.toMatchObject({ horizonDays: 45, banks: [] })
    expect(client.runtime).toBe('web')
    expect(invokeSpy).not.toHaveBeenCalled()
  })

  it('validates bounded, redacted connector summary pages at the native IPC boundary', async () => {
    const page = {
      schemaVersion: 1,
      items: [
        {
          schemaVersion: 1, connectorKind: 'GOOGLE_DRIVE', connectionKey: 'drive-primary', displayLabel: 'Household Drive',
          availability: 'AVAILABLE', lifecycle: 'CONNECTED', health: 'FRESH',
          capabilities: ['CONFIGURE', 'DISCONNECT', 'REFRESH_NOW', 'SCHEDULE', 'RETRY', 'ACCOUNT_BINDING'],
          lastAttemptAt: '2026-08-25T10:00:00Z', lastSuccessAt: '2026-08-25T10:00:00Z', freshnessDeadlineAt: '2026-08-25T11:00:00Z', nextDueAt: '2026-08-25T11:00:00Z',
          pendingReviewCount: 2, consecutiveFailures: 0, lastErrorCode: null,
          bindingSummary: { allowedAccountCount: 2, parserProfileConfigured: true, version: 4 }, configurationDestination: 'GOOGLE_DRIVE_SETTINGS',
        },
        {
          schemaVersion: 1, connectorKind: 'GMAIL', connectionKey: 'gmail-primary', displayLabel: 'Statements mailbox',
          availability: 'AVAILABLE', lifecycle: 'CONNECTED', health: 'RUNNING',
          capabilities: ['CONFIGURE', 'DISCONNECT', 'REFRESH_NOW', 'SCHEDULE', 'RETRY', 'ACCOUNT_BINDING'],
          lastAttemptAt: '2026-08-25T10:05:00Z', lastSuccessAt: null, freshnessDeadlineAt: null, nextDueAt: null,
          pendingReviewCount: 0, consecutiveFailures: 0, lastErrorCode: null,
          bindingSummary: null, configurationDestination: 'GMAIL_SETTINGS',
        },
        {
          schemaVersion: 1, connectorKind: 'WATCHED_FOLDER', connectionKey: 'watched-inbox', displayLabel: 'Inbox folder',
          availability: 'AVAILABLE', lifecycle: 'CONFIGURING', health: 'NEVER_REFRESHED',
          capabilities: ['CONFIGURE', 'DISCONNECT', 'ACCOUNT_BINDING'],
          lastAttemptAt: null, lastSuccessAt: null, freshnessDeadlineAt: null, nextDueAt: null,
          pendingReviewCount: 1, consecutiveFailures: 0, lastErrorCode: null,
          bindingSummary: null, configurationDestination: 'WATCHED_FOLDER_SETTINGS',
        },
        {
          schemaVersion: 1, connectorKind: 'MANUAL_IMPORT', connectionKey: 'manual-import', displayLabel: 'Manual import',
          availability: 'AVAILABLE', lifecycle: 'CONNECTED', health: 'MANUAL', capabilities: ['IMPORT_FILE', 'ACCOUNT_BINDING'],
          lastAttemptAt: null, lastSuccessAt: null, freshnessDeadlineAt: null, nextDueAt: null,
          pendingReviewCount: 3, consecutiveFailures: 0, lastErrorCode: null,
          bindingSummary: null, configurationDestination: 'IMPORT_INBOX',
        },
      ],
      nextCursor: { connectorKind: 'WATCHED_FOLDER', connectionKey: 'watched-inbox' },
    }
    const invokeSpy = vi.fn()
    const client = createPlatformClient({ tauri: true, invoke: async <T>(command: AppCommand, args?: Record<string, unknown>) => {
      invokeSpy(command, args)
      return page as T
    } })

    await expect(client.listConnectorSummaries('family', { connectorKind: 'GMAIL', connectionKey: 'gmail-primary' }, 25)).resolves.toEqual(page)
    expect(invokeSpy).toHaveBeenCalledWith('connector_control_list', {
      householdId: 'family', cursor: { connectorKind: 'GMAIL', connectionKey: 'gmail-primary' }, limit: 25,
    })
    await expect(client.listConnectorSummaries('family', undefined, 0)).rejects.toThrow('connector limit')
    await expect(client.listConnectorSummaries('family', undefined, 101)).rejects.toThrow('connector limit')
    for (const cursor of [
      'provider-cursor-secret',
      { connectorKind: 'DROPBOX', connectionKey: 'drive-primary' },
      { connectorKind: 'GMAIL', connectionKey: 'a'.repeat(129) },
      { connectorKind: 'GMAIL', connectionKey: 'gmail-primary', providerCursor: 'provider-cursor-secret' },
    ]) {
      await expect(client.listConnectorSummaries('family', cursor as never)).rejects.toThrow('connector cursor')
    }

    const invalidPages = [
      { name: 'unknown enum', value: { ...page, items: [{ ...page.items[0], connectorKind: 'DROPBOX' }] } },
      { name: 'unknown capability', value: { ...page, items: [{ ...page.items[0], capabilities: ['UNKNOWN_CAPABILITY'] }] } },
      { name: 'duplicate connector identity', value: { ...page, items: [...page.items, { ...page.items[0] }] } },
      { name: 'invalid UTC timestamp', value: { ...page, items: [{ ...page.items[0], lastAttemptAt: '2026-08-25T10:00:00+09:00' }] } },
      { name: 'negative count', value: { ...page, items: [{ ...page.items[0], pendingReviewCount: -1 }] } },
      { name: 'more than one hundred items', value: { ...page, items: Array.from({ length: 101 }, (_, index) => ({ ...page.items[0], connectionKey: `drive-${index}` })) } },
      { name: 'overlong UTF-8 display label', value: { ...page, items: [{ ...page.items[0], displayLabel: '日'.repeat(86) }] } },
      { name: 'overlong connection key', value: { ...page, items: [{ ...page.items[0], connectionKey: 'a'.repeat(129) }] } },
      { name: 'running without refresh capability', value: { ...page, items: [{ ...page.items[1], capabilities: ['CONFIGURE'] }] } },
      { name: 'runtime unsupported with executable capability', value: { ...page, items: [{ ...page.items[0], availability: 'RUNTIME_UNSUPPORTED', capabilities: ['REFRESH_NOW'] }] } },
      { name: 'manual health on a non-manual connector', value: { ...page, items: [{ ...page.items[0], health: 'MANUAL' }] } },
      { name: 'provider cursor field', value: { ...page, items: [{ ...page.items[0], cursor: 'provider-cursor-secret' }] } },
      { name: 'provider path field', value: { ...page, items: [{ ...page.items[0], absolutePath: '/Users/private/statement.csv' }] } },
      { name: 'provider-secret next cursor', value: { ...page, nextCursor: 'provider-cursor-secret' } },
      { name: 'malformed next cursor', value: { ...page, nextCursor: { connectorKind: 'DROPBOX', connectionKey: 'drive-primary' } } },
      { name: 'oversized next cursor', value: { ...page, nextCursor: { connectorKind: 'GMAIL', connectionKey: 'a'.repeat(129) } } },
      { name: 'provider field in next cursor', value: { ...page, nextCursor: { connectorKind: 'GMAIL', connectionKey: 'gmail-primary', providerCursor: 'provider-cursor-secret' } } },
    ]
    for (const { value } of invalidPages) {
      const invalidClient = createPlatformClient({ tauri: true, invoke: async <T>() => value as T })
      await expect(invalidClient.listConnectorSummaries('family')).rejects.toMatchObject({
        code: 'INVALID_RESPONSE', command: 'connector_control_list',
      })
    }
  })

  it('strictly reconstructs refresh batches and invokes the three refresh commands exactly', async () => {
    const started = {
      batchId: 'batch-1', householdId: 'family', status: 'ACTIVE', totalCount: 2, terminalCount: 0,
      succeededCount: 0, noChangesCount: 0, skippedManualCount: 0, failedCount: 0, changedCount: 0,
      createdAt: '2026-08-25T10:00:00Z', updatedAt: '2026-08-25T10:00:00Z', completedAt: null,
    } as const
    const progress = {
      schemaVersion: 1, ...started, status: 'PARTIAL', terminalCount: 2, succeededCount: 1, failedCount: 1,
      changedCount: 3, updatedAt: '2026-08-25T10:00:02Z', completedAt: '2026-08-25T10:00:02Z',
      items: [
        { connectorKind: 'GOOGLE_DRIVE', connectionKey: 'drive-primary', status: 'SUCCEEDED', changedCount: 3, lastErrorCode: null, updatedAt: '2026-08-25T10:00:01Z', startedAt: '2026-08-25T10:00:00Z', completedAt: '2026-08-25T10:00:01Z' },
        { connectorKind: 'GMAIL', connectionKey: 'gmail-primary', status: 'FAILED_RETRYABLE', changedCount: 0, lastErrorCode: 'RATE_LIMITED', updatedAt: '2026-08-25T10:00:02Z', startedAt: '2026-08-25T10:00:01Z', completedAt: '2026-08-25T10:00:02Z' },
      ],
    } as const
    const invokeSpy = vi.fn(async (command: AppCommand, args?: Record<string, unknown>) => {
      void args
      return command === 'connector_refresh_batch_get' ? progress : started
    })
    const invoke: Invoke = async <T>(command: AppCommand, args?: Record<string, unknown>) => {
      return await invokeSpy(command, args) as T
    }
    const client = createPlatformClient({ tauri: true, invoke })

    await expect(client.startConnectorRefresh('family', 'GOOGLE_DRIVE', 'drive-primary')).resolves.toEqual(started)
    await expect(client.startConnectorRefreshAll('family')).resolves.toEqual(started)
    await expect(client.getConnectorRefreshBatch('family', 'batch-1')).resolves.toEqual(progress)
    expect(invokeSpy.mock.calls).toEqual([
      ['connector_refresh_one', { input: { householdId: 'family', connectorKind: 'GOOGLE_DRIVE', connectionKey: 'drive-primary' } }],
      ['connector_refresh_all', { householdId: 'family' }],
      ['connector_refresh_batch_get', { householdId: 'family', batchId: 'batch-1' }],
    ])
  })

  it('rejects malformed refresh batch and item contracts before exposing progress', async () => {
    const valid = {
      schemaVersion: 1, batchId: 'batch-1', householdId: 'family', status: 'COMPLETE', totalCount: 2, terminalCount: 2,
      succeededCount: 1, noChangesCount: 0, skippedManualCount: 1, failedCount: 0, changedCount: 3,
      createdAt: '2026-08-25T10:00:00Z', updatedAt: '2026-08-25T10:00:02Z', completedAt: '2026-08-25T10:00:02Z',
      items: [
        { connectorKind: 'GOOGLE_DRIVE', connectionKey: 'drive-primary', status: 'SUCCEEDED', changedCount: 3, lastErrorCode: null, updatedAt: '2026-08-25T10:00:01Z', startedAt: '2026-08-25T10:00:00Z', completedAt: '2026-08-25T10:00:01Z' },
        { connectorKind: 'MANUAL_IMPORT', connectionKey: 'manual-import', status: 'SKIPPED_MANUAL', changedCount: 0, lastErrorCode: null, updatedAt: '2026-08-25T10:00:02Z', startedAt: null, completedAt: '2026-08-25T10:00:02Z' },
      ],
    }
    const invalid = [
      { ...valid, providerCursor: 'secret' },
      { ...valid, householdId: 'another-family' },
      { ...valid, batchId: 'another-batch' },
      { ...valid, status: 'UNKNOWN' },
      { ...valid, totalCount: 10_001 },
      { ...valid, terminalCount: 1 },
      { ...valid, failedCount: 1 },
      { ...valid, completedAt: null },
      { ...valid, updatedAt: '2026-08-25T19:00:02+09:00' },
      { ...valid, items: [valid.items[1], valid.items[0]] },
      { ...valid, items: [valid.items[0], valid.items[0]] },
      { ...valid, items: [{ ...valid.items[0], absolutePath: '/Users/private/statement.csv' }, valid.items[1]] },
      { ...valid, items: [{ ...valid.items[0], connectorKind: 'DROPBOX' }, valid.items[1]] },
      { ...valid, items: [{ ...valid.items[0], status: 'SUCCEEDED', changedCount: 0 }, valid.items[1]] },
      { ...valid, items: [{ ...valid.items[0], status: 'FAILED_RETRYABLE', changedCount: 0, lastErrorCode: null }, valid.items[1]] },
      { ...valid, items: [{ ...valid.items[0], lastErrorCode: 'provider/private/path' }, valid.items[1]] },
      { ...valid, items: [valid.items[0], { ...valid.items[1], connectorKind: 'GMAIL' }] },
    ]
    for (const response of invalid) {
      const client = createPlatformClient({ tauri: true, invoke: async <T>() => response as T })
      await expect(client.getConnectorRefreshBatch('family', 'batch-1')).rejects.toMatchObject({
        code: 'INVALID_RESPONSE', command: 'connector_refresh_batch_get',
      })
    }
  })

  it('keeps native refresh commands unreachable in the browser runtime', async () => {
    const invoke = vi.fn()
    const client = createPlatformClient({ tauri: false, invoke })

    await expect(client.startConnectorRefresh('family', 'GOOGLE_DRIVE', 'drive-primary')).rejects.toMatchObject({ command: 'connector_refresh_one' })
    await expect(client.startConnectorRefreshAll('family')).rejects.toMatchObject({ command: 'connector_refresh_all' })
    await expect(client.getConnectorRefreshBatch('family', 'batch-1')).rejects.toMatchObject({ command: 'connector_refresh_batch_get' })
    expect(invoke).not.toHaveBeenCalled()
  })

  it('reconstructs connector bindings field by field and invokes optimistic mutations exactly', async () => {
    const binding = {
      householdId: 'family', connectorKind: 'GMAIL', connectionKey: 'gmail-primary',
      allowedAccountIds: ['family-bank', 'family-card'], parserProfileId: 'profile-bank', parserProfileVersion: 3,
      version: 7, createdAt: '2026-08-25T10:00:00Z', updatedAt: '2026-08-25T10:05:00Z',
    }
    const invokeSpy = vi.fn(async (command: AppCommand, args?: Record<string, unknown>) => {
      void args
      if (command === 'connector_bindings_list') return [binding]
      if (command === 'connector_binding_upsert') return { ...binding, version: 8 }
      return null
    })
    const invoke: Invoke = async <T>(command: AppCommand, args?: Record<string, unknown>) => await invokeSpy(command, args) as T
    const client = createPlatformClient({ tauri: true, invoke })

    await expect(client.listConnectorBindings('family')).resolves.toEqual([binding])
    await expect(client.upsertConnectorBinding({
      householdId: 'family', connectorKind: 'GMAIL', connectionKey: 'gmail-primary',
      allowedAccountIds: ['family-card', 'family-bank'], parserProfileId: 'profile-bank', parserProfileVersion: 3,
      expectedVersion: 7,
    })).resolves.toEqual({ ...binding, version: 8 })
    await expect(client.deleteConnectorBinding({
      householdId: 'family', connectorKind: 'GMAIL', connectionKey: 'gmail-primary', expectedVersion: 8,
    })).resolves.toBeUndefined()

    expect(invokeSpy.mock.calls).toEqual([
      ['connector_bindings_list', { householdId: 'family' }],
      ['connector_binding_upsert', { input: {
        householdId: 'family', connectorKind: 'GMAIL', connectionKey: 'gmail-primary',
        allowedAccountIds: ['family-card', 'family-bank'], parserProfileId: 'profile-bank', parserProfileVersion: 3,
        expectedVersion: 7,
      } }],
      ['connector_binding_delete', { input: {
        householdId: 'family', connectorKind: 'GMAIL', connectionKey: 'gmail-primary', expectedVersion: 8,
      } }],
    ])
  })

  it('rejects malformed connector binding DTOs and unsafe mutation inputs', async () => {
    const binding = {
      householdId: 'family', connectorKind: 'GOOGLE_DRIVE', connectionKey: 'drive-primary',
      allowedAccountIds: ['family-bank'], parserProfileId: null, parserProfileVersion: null,
      version: 1, createdAt: '2026-08-25T10:00:00Z', updatedAt: '2026-08-25T10:00:00Z',
    } as const
    const invalidBindings = [
      { ...binding, providerToken: 'secret' },
      { ...binding, householdId: 'another-family' },
      { ...binding, connectorKind: 'DROPBOX' },
      { ...binding, allowedAccountIds: ['family-bank', 'family-bank'] },
      { ...binding, allowedAccountIds: ['a'.repeat(65)] },
      { ...binding, allowedAccountIds: [] },
      { ...binding, parserProfileId: 'p'.repeat(65), parserProfileVersion: 1 },
      { ...binding, parserProfileId: 'profile-bank', parserProfileVersion: null },
      { ...binding, version: 0 },
      { ...binding, createdAt: '2026-08-25T19:00:00+09:00' },
    ]
    for (const value of invalidBindings) {
      const client = createPlatformClient({ tauri: true, invoke: async <T>() => [value] as T })
      await expect(client.listConnectorBindings('family')).rejects.toMatchObject({
        code: 'INVALID_RESPONSE', command: 'connector_bindings_list',
      })
    }

    const duplicateClient = createPlatformClient({ tauri: true, invoke: async <T>() => [binding, binding] as T })
    await expect(duplicateClient.listConnectorBindings('family')).rejects.toMatchObject({
      code: 'INVALID_RESPONSE', command: 'connector_bindings_list',
    })

    const invoke = vi.fn()
    const client = createPlatformClient({ tauri: true, invoke })
    await expect(client.upsertConnectorBinding({ ...binding, expectedVersion: 1, allowedAccountIds: ['family-bank', 'family-bank'] })).rejects.toThrow('connector binding')
    await expect(client.upsertConnectorBinding({ ...binding, expectedVersion: 1, allowedAccountIds: ['a'.repeat(65)] })).rejects.toThrow('connector binding')
    await expect(client.upsertConnectorBinding({ ...binding, expectedVersion: 1, parserProfileId: 'p'.repeat(65), parserProfileVersion: 1 })).rejects.toThrow('connector binding')
    await expect(client.upsertConnectorBinding({ ...binding, expectedVersion: 0 })).rejects.toThrow('connector binding')
    await expect(client.upsertConnectorBinding({ ...binding, expectedVersion: null, parserProfileId: 'profile-bank', parserProfileVersion: null })).rejects.toThrow('connector binding')
    await expect(client.deleteConnectorBinding({ householdId: 'family', connectorKind: 'MANUAL_IMPORT', connectionKey: 'wrong', expectedVersion: 1 })).rejects.toThrow('connector binding')
    expect(invoke).not.toHaveBeenCalled()
  })

  it('sanitizes optimistic binding conflicts while preserving the command identity', async () => {
    const client = createPlatformClient({ tauri: true, invoke: async () => { throw new Error('connector binding changed; reload it and try again') } })
    await expect(client.upsertConnectorBinding({
      householdId: 'family', connectorKind: 'MANUAL_IMPORT', connectionKey: 'manual-import',
      allowedAccountIds: ['family-bank'], parserProfileId: null, parserProfileVersion: null, expectedVersion: 4,
    })).rejects.toEqual(new PlatformIpcError('COMMAND_FAILED', 'connector_binding_upsert'))
  })

  it.each([
    ['household', { householdId: 'another-family' }],
    ['connector kind', { connectorKind: 'GMAIL' }],
    ['connection key', { connectionKey: 'another-drive' }],
  ] as const)('rejects a valid-shaped upsert response from a different %s scope', async (_label, override) => {
    const response = {
      householdId: 'family', connectorKind: 'GOOGLE_DRIVE', connectionKey: 'drive-primary',
      allowedAccountIds: ['family-bank'], parserProfileId: null, parserProfileVersion: null,
      version: 2, createdAt: '2026-08-25T10:00:00Z', updatedAt: '2026-08-25T10:05:00Z',
      ...override,
    }
    const client = createPlatformClient({ tauri: true, invoke: async <T>() => response as T })

    await expect(client.upsertConnectorBinding({
      householdId: 'family', connectorKind: 'GOOGLE_DRIVE', connectionKey: 'drive-primary',
      allowedAccountIds: ['family-bank'], parserProfileId: null, parserProfileVersion: null, expectedVersion: 1,
    })).rejects.toMatchObject({ code: 'INVALID_RESPONSE', command: 'connector_binding_upsert' })
  })

  it('invokes each desktop command and returns validated camelCase DTOs', async () => {
    const responses: Record<string, unknown> = {
      app_bootstrap: { application: 'KakeFlow', database: { healthy: true, schemaVersion: 5 } },
      app_health: { status: 'ok', database: { healthy: true, schemaVersion: 5 } },
      app_status: { schemaVersion: 5, integrity: 'ok' },
      local_sync_foundation_status: { device: { id: 'device-1', displayName: 'Desktop', createdAt: '2026-07-13T00:00:00Z' }, platform: 'MACOS', principal: { id: 'principal-1', displayName: 'Local principal', createdAt: '2026-07-13T00:00:00Z' }, binding: { householdId: 'family', principalId: 'principal-1', memberId: 'member-1', memberName: 'Taro', updatedAt: '2026-07-13T00:00:00Z' }, outbox: { envelopeCount: 0, latestSequence: 0, latestRecordedAt: null }, remoteTransport: 'NOT_CONFIGURED', restoreValidation: 'ENABLED' },
      principal_member_binding_update: { device: { id: 'device-1', displayName: 'Desktop', createdAt: '2026-07-13T00:00:00Z' }, platform: 'MACOS', principal: { id: 'principal-1', displayName: 'Local principal', createdAt: '2026-07-13T00:00:00Z' }, binding: { householdId: 'family', principalId: 'principal-1', memberId: null, memberName: null, updatedAt: '2026-07-13T00:00:00Z' }, outbox: { envelopeCount: 1, latestSequence: 1, latestRecordedAt: '2026-07-13T00:00:00Z' }, remoteTransport: 'NOT_CONFIGURED', restoreValidation: 'ENABLED' },
      households_list: [{ id: 'family', name: 'Family', baseCurrency: 'JPY', createdAt: '2026-07-12T00:00:00Z' }],
      household_create: { id: 'family', name: 'Family', baseCurrency: 'JPY', createdAt: '2026-07-12T00:00:00Z' },
      household_members_list: [{ id: 'member-1', householdId: 'family', displayName: 'Taro', relationshipLabel: 'Father', status: 'ACTIVE', sortOrder: 0, createdAt: '2026-07-12T00:00:00Z', updatedAt: '2026-07-12T00:00:00Z' }],
      household_member_create: { id: 'member-1', householdId: 'family', displayName: 'Taro', relationshipLabel: null, status: 'ACTIVE', sortOrder: 0, createdAt: '2026-07-12T00:00:00Z', updatedAt: '2026-07-12T00:00:00Z' },
      household_member_update: { id: 'member-1', householdId: 'family', displayName: 'Taro Updated', relationshipLabel: null, status: 'ACTIVE', sortOrder: 1, createdAt: '2026-07-12T00:00:00Z', updatedAt: '2026-07-13T00:00:00Z' },
      household_member_archive: null,
      accounts_list: [{ id: 'family-bank', name: 'Bank', accountKind: 'ASSET', accountSubtype: 'BANK', currency: 'JPY', ownershipKind: 'HOUSEHOLD', ownerMemberId: null, ownerMemberName: null, visibility: 'SHARED' }],
      account_ownership_update: { id: 'family-bank', name: 'Bank', accountKind: 'ASSET', accountSubtype: 'BANK', currency: 'JPY', ownershipKind: 'MEMBER', ownerMemberId: 'member-1', ownerMemberName: 'Taro', visibility: 'PERSONAL' },
      dashboard_query: {
        month: '2026-07', accountingBasis: 'ACCRUAL', incomeJpy: 650000, expenseJpy: 250000, savingsJpy: 400000, postedTransactionCount: 10,
        netWorthAsOf: '2026-07-31', assetsJpy: 8_500_000, liabilitiesJpy: 250_000, netWorthJpy: 8_250_000,
        accrualTrend: [{ month: '2026-07', incomeJpy: 650000, expenseJpy: 250000 }],
        cashFlowTrend: Array.from({ length: 6 }, (_, index) => ({
          month: `2026-${String(index + 2).padStart(2, '0')}`,
          inflowJpy: index === 5 ? 650000 : 0,
          outflowJpy: index === 5 ? 250000 : 0,
          netCashFlowJpy: index === 5 ? 400000 : 0,
        })),
        expenseCategories: [{ accountId: 'family-groceries', name: 'Groceries', amountJpy: 250000 }],
      },
      transactions_query: { items: [], page: 1, pageSize: 20, totalItems: 0, totalPages: 0 },
      transaction_manual_create: {
        id: 'tx-manual', occurredOn: '2026-07-12', postedOn: null, transactionType: 'EXPENSE', payee: 'Store', description: null,
        amountJpy: 1000, status: 'POSTED', calculationTarget: true, debitAccountId: 'expense', debitAccountName: 'Food', creditAccountId: 'bank', creditAccountName: 'Bank', categoryAccountId: 'expense', categoryName: 'Food',
        attributionKind: 'HOUSEHOLD', attributedMemberId: null, attributedMemberName: null, audienceVisibility: 'SHARED', audienceMemberId: null, audienceMemberName: null, labels: ['SUBSCRIPTION'], tags: ['food'],
      },
      transaction_detail_get: {
        id: 'tx-manual', householdId: 'family', occurredOn: '2026-07-12', postedOn: null, transactionType: 'EXPENSE', payee: 'Store', description: null, status: 'POSTED', calculationTarget: true, createdAt: '2026-07-12T00:00:00Z', updatedAt: '2026-07-12T00:00:00Z', editable: true,
        attributionKind: 'MEMBER', attributedMemberId: 'member-1', attributedMemberName: 'Taro', audienceVisibility: 'PERSONAL', audienceMemberId: 'member-1', audienceMemberName: 'Taro', labels: ['REIMBURSABLE'], tags: ['trip'],
        entries: [{ id: 'entry-1', accountId: 'expense', accountName: 'Food', accountKind: 'EXPENSE', side: 'DEBIT', amountJpy: 1000, lineNumber: 1 }, { id: 'entry-2', accountId: 'bank', accountName: 'Bank', accountKind: 'ASSET', side: 'CREDIT', amountJpy: 1000, lineNumber: 2 }],
        sourceEvidence: [{ sourceRecordId: 'record-1', sourceDocumentId: 'document-1', sourceType: 'MANUAL_UPLOAD', originalFilename: 'bank.csv', mediaType: 'text/csv', rowNumber: 2, importedAt: '2026-07-12T00:00:00Z', evidenceRole: 'PRIMARY', audienceVisibility: 'SHARED', audienceMemberId: null, audienceMemberName: null }],
      },
      transaction_update: null,
      transaction_metadata_bulk_update: { updatedCount: 1 },
      source_document_get: {
        id: 'document-1', householdId: 'family', importRunId: 'run-1', sourceType: 'MANUAL_UPLOAD', originalFilename: 'bank.csv',
        mediaType: 'text/csv', byteSize: 42, sha256: 'a'.repeat(64), sourceModifiedAt: null, importedAt: '2026-07-12T00:00:00Z',
        adapterId: 'japanese-bank-ledger-v1', adapterVersion: '1', recordCount: 1, audienceVisibility: 'SHARED', audienceMemberId: null, audienceMemberName: null,
      },
      source_document_audience_update: {
        id: 'document-1', householdId: 'family', importRunId: 'run-1', sourceType: 'MANUAL_UPLOAD', originalFilename: 'bank.csv', mediaType: 'text/csv', byteSize: 42, sha256: 'a'.repeat(64), sourceModifiedAt: null, importedAt: '2026-07-12T00:00:00Z', adapterId: 'japanese-bank-ledger-v1', adapterVersion: '1', recordCount: 1, audienceVisibility: 'PERSONAL', audienceMemberId: 'member-1', audienceMemberName: 'Taro',
      },
      source_document_records_query: {
        items: [{ id: 'record-1', sourceDocumentId: 'document-1', rowNumber: 2, recordHash: 'b'.repeat(64), payloadJson: '{"rawFields":["STORE","1200"]}', createdAt: '2026-07-12T00:00:00Z', evidenceRole: null }],
        page: 1, pageSize: 20, totalItems: 1, totalPages: 1,
      },
      transaction_source_records_list: [{ id: 'record-1', sourceDocumentId: 'document-1', rowNumber: 2, recordHash: 'b'.repeat(64), payloadJson: '{"rawFields":["STORE","1200"]}', createdAt: '2026-07-12T00:00:00Z', evidenceRole: 'PRIMARY' }],
      watched_folders_list: [{ id: 'folder', householdId: 'family', label: 'Inbox', displayName: 'KakeFlow', sourceType: 'LOCAL_FOLDER', provider: 'LOCAL', isEnabled: true, createdAt: '2026-07-12T00:00:00Z' }],
      watched_folder_select: { id: 'folder', householdId: 'family', label: 'Inbox', displayName: 'KakeFlow', sourceType: 'LOCAL_FOLDER', provider: 'LOCAL', isEnabled: true, createdAt: '2026-07-12T00:00:00Z' },
      icloud_folder_select: { id: 'icloud-folder', householdId: 'family', label: 'iCloud Drive Inbox', displayName: 'KakeFlow Inbox', sourceType: 'ICLOUD_PICKER', provider: 'ICLOUD', isEnabled: true, createdAt: '2026-07-12T00:00:00Z' },
      watched_folder_remove: null,
      watched_folder_scan: { watchedFolderId: 'folder', files: [{ relativePath: 'bank.csv', fileName: 'bank.csv', mediaType: 'text/csv', byteSize: 3, modifiedUnixMs: 1000 }] },
      watched_folder_file_read: { relativePath: 'bank.csv', fileName: 'bank.csv', mediaType: 'text/csv', byteSize: 3, modifiedUnixMs: 1000, fileBytes: [1, 2, 3] },
      watched_file_inbox_list: [{ id: 'a'.repeat(64), householdId: 'family', watchedFolderId: 'folder', watchedFolderLabel: 'Inbox', sourceType: 'LOCAL_FOLDER', provider: 'LOCAL', relativePath: 'bank.csv', fileName: 'bank.csv', mediaType: 'text/csv', byteSize: 3, modifiedUnixMs: 1000, fingerprint: 'b'.repeat(64), state: 'READY', attemptCount: 1, importRunId: null, lastErrorCode: null, discoveredAt: '2026-07-12T00:00:00Z', updatedAt: '2026-07-12T00:01:00Z' }],
      watched_file_inbox_counts: { discovered: 0, processing: 0, ready: 1, needsMapping: 0, staged: 0, failed: 0, ignored: 0, removed: 0, actionable: 1, total: 1 },
      watched_file_inbox_claim: { leaseToken: 'c'.repeat(64), leaseExpiresAt: '2026-07-12T00:06:00Z', items: [{ id: 'a'.repeat(64), householdId: 'family', watchedFolderId: 'folder', watchedFolderLabel: 'Inbox', sourceType: 'LOCAL_FOLDER', provider: 'LOCAL', relativePath: 'bank.csv', fileName: 'bank.csv', mediaType: 'text/csv', byteSize: 3, modifiedUnixMs: 1000, fingerprint: 'b'.repeat(64), state: 'PROCESSING', attemptCount: 2, importRunId: null, lastErrorCode: null, discoveredAt: '2026-07-12T00:00:00Z', updatedAt: '2026-07-12T00:01:00Z' }] },
      watched_file_inbox_mark_ready: { id: 'a'.repeat(64), householdId: 'family', watchedFolderId: 'folder', watchedFolderLabel: 'Inbox', sourceType: 'LOCAL_FOLDER', provider: 'LOCAL', relativePath: 'bank.csv', fileName: 'bank.csv', mediaType: 'text/csv', byteSize: 3, modifiedUnixMs: 1000, fingerprint: 'b'.repeat(64), state: 'READY', attemptCount: 2, importRunId: null, lastErrorCode: null, discoveredAt: '2026-07-12T00:00:00Z', updatedAt: '2026-07-12T00:02:00Z' },
      watched_file_inbox_mark_needs_mapping: { id: 'a'.repeat(64), householdId: 'family', watchedFolderId: 'folder', watchedFolderLabel: 'Inbox', sourceType: 'LOCAL_FOLDER', provider: 'LOCAL', relativePath: 'bank.csv', fileName: 'bank.csv', mediaType: 'text/csv', byteSize: 3, modifiedUnixMs: 1000, fingerprint: 'b'.repeat(64), state: 'NEEDS_MAPPING', attemptCount: 2, importRunId: null, lastErrorCode: null, discoveredAt: '2026-07-12T00:00:00Z', updatedAt: '2026-07-12T00:02:00Z' },
      watched_file_inbox_mark_failed: { id: 'a'.repeat(64), householdId: 'family', watchedFolderId: 'folder', watchedFolderLabel: 'Inbox', sourceType: 'LOCAL_FOLDER', provider: 'LOCAL', relativePath: 'bank.csv', fileName: 'bank.csv', mediaType: 'text/csv', byteSize: 3, modifiedUnixMs: 1000, fingerprint: 'b'.repeat(64), state: 'FAILED', attemptCount: 2, importRunId: null, lastErrorCode: 'PREVIEW_FAILED', discoveredAt: '2026-07-12T00:00:00Z', updatedAt: '2026-07-12T00:02:00Z' },
      watched_file_inbox_mark_staged: { id: 'a'.repeat(64), householdId: 'family', watchedFolderId: 'folder', watchedFolderLabel: 'Inbox', sourceType: 'LOCAL_FOLDER', provider: 'LOCAL', relativePath: 'bank.csv', fileName: 'bank.csv', mediaType: 'text/csv', byteSize: 3, modifiedUnixMs: 1000, fingerprint: 'b'.repeat(64), state: 'STAGED', attemptCount: 2, importRunId: 'run-1', lastErrorCode: null, discoveredAt: '2026-07-12T00:00:00Z', updatedAt: '2026-07-12T00:02:00Z' },
      watched_file_inbox_ignore: { id: 'a'.repeat(64), householdId: 'family', watchedFolderId: 'folder', watchedFolderLabel: 'Inbox', sourceType: 'LOCAL_FOLDER', provider: 'LOCAL', relativePath: 'bank.csv', fileName: 'bank.csv', mediaType: 'text/csv', byteSize: 3, modifiedUnixMs: 1000, fingerprint: 'b'.repeat(64), state: 'IGNORED', attemptCount: 1, importRunId: null, lastErrorCode: null, discoveredAt: '2026-07-12T00:00:00Z', updatedAt: '2026-07-12T00:02:00Z' },
      watched_file_inbox_retry: { id: 'a'.repeat(64), householdId: 'family', watchedFolderId: 'folder', watchedFolderLabel: 'Inbox', sourceType: 'LOCAL_FOLDER', provider: 'LOCAL', relativePath: 'bank.csv', fileName: 'bank.csv', mediaType: 'text/csv', byteSize: 3, modifiedUnixMs: 1000, fingerprint: 'b'.repeat(64), state: 'DISCOVERED', attemptCount: 1, importRunId: null, lastErrorCode: null, discoveredAt: '2026-07-12T00:00:00Z', updatedAt: '2026-07-12T00:02:00Z' },
      import_summary: { totalRuns: 0, discovered: 0, extracting: 0, reviewRequired: 0, posted: 0, failed: 0, rolledBack: 0, sourceDocuments: 0, sourceRecords: 0, pendingCandidates: 0, readyCandidates: 0, latestSuccessfulImportAt: null, latestSourceFilename: null, latestSourceType: null, distinctSourceTypes: 0 },
      pending_review_list: {
        householdId: 'family',
        runs: [
          { runId: 'run-2', documentId: 'document-2', status: 'REVIEW_REQUIRED', adapterId: 'paypay-history-v1', adapterVersion: '1', startedAt: '2026-07-13T12:00:00Z', sourceType: 'MANUAL_UPLOAD', originalFilename: 'paypay.csv', mediaType: 'text/csv', byteSize: 2048, sourceModifiedAt: '2026-07-13T11:59:00Z', recordCount: 20, candidateCount: 10, completionState: 'CANDIDATE_REVIEW' },
          { runId: 'run-1', documentId: 'document-1', status: 'REVIEW_REQUIRED', adapterId: null, adapterVersion: null, startedAt: '2026-07-12T12:00:00.000Z', sourceType: 'LOCAL_FOLDER', originalFilename: 'bank.csv', mediaType: 'text/csv', byteSize: 1024, sourceModifiedAt: null, recordCount: 8, candidateCount: 8, completionState: 'CANDIDATE_REVIEW' },
        ],
      },
      import_start: { runId: 'run-1', documentId: 'document-1', status: 'REVIEW_REQUIRED', recordCount: 1, candidateCount: 1, reusedExisting: false },
      import_preview: {
        summary: { runId: 'run-1', documentId: 'document-1', status: 'REVIEW_REQUIRED', recordCount: 1, candidateCount: 1, reusedExisting: false },
        source: { sourceType: 'MANUAL_UPLOAD', originalFilename: 'bank.csv', mediaType: 'text/csv', byteSize: 3, sha256: 'abc123', audienceVisibility: 'SHARED', audienceMemberId: null },
        candidates: [{
          id: 'candidate-1', accountId: 'family-bank', occurredOn: '2026-07-12', postedOn: null,
          amountJpy: 1200, direction: 'OUT', descriptionRaw: 'STORE', merchantRaw: 'STORE',
          externalTransactionId: null, extractionConfidenceBps: 10000, normalizationConfidenceBps: 10000,
          externalSource: null, externalFactHash: null, calculationTarget: true, suggestedTransactionType: null,
          institutionRaw: null, categoryMajorRaw: null, categoryMinorRaw: null, memoRaw: null,
          attributionKind: 'HOUSEHOLD', attributedMemberId: null, audienceVisibility: 'SHARED', audienceMemberId: null,
          reviewStatus: 'READY', evidenceCount: 1, evidenceRoles: ['PRIMARY'], issues: [],
          receiptReview: {
            merchant: 'STORE', occurredOn: '2026-07-12', totalAmountJpy: 1200,
            items: [{ description: '牛乳', quantity: 1, amountJpy: 1200, taxRatePercent: 8, confidenceBps: 8500, provenance: { lineNumber: 4, regionIndexes: [1], method: 'TEXT_PATTERN' } }],
            taxes: [{ ratePercent: 8, taxAmountJpy: 88, taxableAmountJpy: 1112, confidenceBps: 8000, provenance: { lineNumber: 5, regionIndexes: [2], method: 'TEXT_PATTERN' } }],
            couponAmountJpy: 50, pointsUsedJpy: null,
            couponEvidence: [{ amountJpy: 50, confidenceBps: 8000, provenance: { lineNumber: 6, regionIndexes: [], method: 'TEXT_PATTERN' } }],
            pointsUsedEvidence: [{ amountJpy: null, confidenceBps: 4000, provenance: { lineNumber: 7, regionIndexes: [], method: 'TEXT_PATTERN' } }],
            subtotalJpy: 1200, changeJpy: null, paymentMethod: 'PayPay', taxMode: 'INCLUDED',
            reconciliation: { status: 'EXACT', itemTotalJpy: 1200, totalAmountJpy: 1200, deltaJpy: 0 },
            provenance: { sourceRecordId: 'record-1', sourceRowNumber: 1, documentPageNumber: 2 },
          },
        }],
      },
      import_commit: { runId: 'run-1', postedCount: 1 },
      import_rollback: null,
      backup_create: { formatVersion: 2, entryCount: 4, plaintextBytes: 4096 },
      backup_restore_stage: { formatVersion: 2, entryCount: 4, plaintextBytes: 4096 },
      app_restart_for_restore: null,
      document_extract: { method: 'EMBEDDED_TEXT', text: 'STORE TOTAL 1200', confidenceBps: 9000, issues: [] },
      document_ocr: { method: 'OCR', text: 'STORE TOTAL 1200', confidenceBps: 7800, issues: ['LOW_CONFIDENCE'] },
      receipt_match_suggestions: [{ candidateId: 'candidate-1', transactionId: 'transaction-1', occurredOn: '2026-07-12', payee: 'STORE', description: null, transactionType: 'EXPENSE', amountJpy: 1200, dayDifference: 0, merchantSimilarityBps: 10000, scoreBps: 10000, reasons: ['Exact receipt and posted-expense amount'] }],
      receipt_match_confirm: { runId: 'run-1', candidateId: 'candidate-1', transactionId: 'transaction-1', resolutionStatus: 'LINKED', evidenceCount: 1, runStatus: 'POSTED' },
      cards_list: [{
        id: 'statement-1', cardAccountId: 'family-rakuten-card', cardName: 'Rakuten Card', maskedIdentifier: null,
        periodStart: '2026-07-01', periodEnd: '2026-07-31', paymentDueOn: null,
        statementAmountJpy: 1000, detailAmountJpy: 1000, lineCount: 1,
        paymentId: 'payment-1', bankTransactionId: 'transaction-1', paymentAmountJpy: 1000,
        paymentOn: '2026-08-10', matchScoreBps: 8000, reconciliationStatus: 'UNMATCHED',
        paidAmountJpy: 0, outstandingAmountJpy: 1000, overpaidAmountJpy: 0, payments: [],
        eligiblePayments: [{ paymentId: 'payment-1', bankTransactionId: 'transaction-1', paymentAmountJpy: 1000, paymentOn: '2026-08-10', matchScoreBps: 8000 }],
      }],
      card_match_confirm: { statementId: 'statement-1', paymentId: 'payment-1', reconciliationStatus: 'FULLY_RECONCILED' },
      card_payment_link_confirm: {
        id: 'statement-1', cardAccountId: 'family-rakuten-card', cardName: 'Rakuten Card', maskedIdentifier: null,
        periodStart: '2026-07-01', periodEnd: '2026-07-31', paymentDueOn: null,
        statementAmountJpy: 1000, detailAmountJpy: 1000, lineCount: 1,
        paymentId: 'payment-1', bankTransactionId: 'transaction-1', paymentAmountJpy: 1000,
        paymentOn: '2026-08-10', matchScoreBps: 8000, reconciliationStatus: 'FULLY_RECONCILED',
        paidAmountJpy: 1000, outstandingAmountJpy: 0, overpaidAmountJpy: 0,
        payments: [{ paymentId: 'payment-1', bankTransactionId: 'transaction-1', paymentAmountJpy: 1000, paymentOn: '2026-08-10', matchScoreBps: 8000 }], eligiblePayments: [],
      },
      card_payment_link_unlink: {
        id: 'statement-1', cardAccountId: 'family-rakuten-card', cardName: 'Rakuten Card', maskedIdentifier: null,
        periodStart: '2026-07-01', periodEnd: '2026-07-31', paymentDueOn: null,
        statementAmountJpy: 1000, detailAmountJpy: 1000, lineCount: 1,
        paymentId: null, bankTransactionId: null, paymentAmountJpy: null,
        paymentOn: null, matchScoreBps: null, reconciliationStatus: 'UNMATCHED',
        paidAmountJpy: 0, outstandingAmountJpy: 1000, overpaidAmountJpy: 0, payments: [],
        eligiblePayments: [{ paymentId: 'payment-1', bankTransactionId: 'transaction-1', paymentAmountJpy: 1000, paymentOn: '2026-08-10', matchScoreBps: null }],
      },
      card_statement_due_date_update: {
        id: 'statement-1', cardAccountId: 'family-rakuten-card', cardName: 'Rakuten Card', maskedIdentifier: null,
        periodStart: '2026-07-01', periodEnd: '2026-07-31', paymentDueOn: '2026-08-27',
        statementAmountJpy: 1000, detailAmountJpy: 1000, lineCount: 1,
        paymentId: 'payment-1', bankTransactionId: 'transaction-1', paymentAmountJpy: 1000,
        paymentOn: '2026-08-10', matchScoreBps: 8000, reconciliationStatus: 'FULLY_RECONCILED',
        paidAmountJpy: 1000, outstandingAmountJpy: 0, overpaidAmountJpy: 0,
        payments: [{ paymentId: 'payment-1', bankTransactionId: 'transaction-1', paymentAmountJpy: 1000, paymentOn: '2026-08-10', matchScoreBps: 8000 }], eligiblePayments: [],
      },
      card_settlement_bank_mappings_list: [{ householdId: 'family', cardAccountId: 'family-rakuten-card', cardAccountName: 'Rakuten Card', bankAccountId: 'family-bank', bankAccountName: 'Bank', createdAt: '2026-07-13T00:00:00Z', updatedAt: '2026-07-13T00:00:00Z' }],
      card_settlement_bank_mapping_upsert: { householdId: 'family', cardAccountId: 'family-rakuten-card', cardAccountName: 'Rakuten Card', bankAccountId: 'family-bank', bankAccountName: 'Bank', createdAt: '2026-07-13T00:00:00Z', updatedAt: '2026-07-13T00:00:00Z' },
      card_settlement_bank_mapping_delete: null,
      card_settlement_balance_coverage_query: { asOf: '2026-07-13', historyFrom: '2026-07-27', horizonThrough: '2026-08-27', horizonDays: 45, banks: [{ bankAccountId: 'family-bank', bankAccountName: 'Bank', balanceAsOfJpy: 1000, projectedEndingBalanceJpy: 400, maxShortfallJpy: 0, statements: [{ statementId: 'statement-1', cardAccountId: 'family-rakuten-card', cardAccountName: 'Rakuten Card', paymentDueOn: '2026-07-27', statementAmountJpy: 600, paidAmountJpy: 0, outstandingAmountJpy: 600, projectedBankBalanceJpy: 400, shortfallJpy: 0, status: 'COVERED' }] }], unmappedStatements: [], missingDueStatements: [] },
    }
    const invokeSpy = vi.fn()
    const invoke: Invoke = async <T>(command: AppCommand, args?: Record<string, unknown>) => {
      invokeSpy(command, args)
      return responses[command] as T
    }
    const client = createPlatformClient({ tauri: true, invoke })
    const importRequest: StartImportDto = {
      runId: 'run-1', documentId: 'document-1', householdId: 'family', sourceType: 'MANUAL_UPLOAD',
      originalFilename: 'bank.csv', mediaType: 'text/csv', byteSize: 3, sha256: 'abc123',
      sourceModifiedAt: null, adapterId: 'japanese-bank-ledger', adapterVersion: '1',
      audienceVisibility: 'SHARED', audienceMemberId: null,
      records: [{ id: 'record-1', rowNumber: 1, recordHash: 'record-hash', payloadJson: '{}' }],
      candidates: [{
        id: 'candidate-1', accountId: 'family-bank', occurredOn: '2026-07-12', postedOn: null,
        amountJpy: 1200, direction: 'OUT', descriptionRaw: 'STORE', merchantRaw: 'STORE',
        externalTransactionId: null, extractionConfidenceBps: 10000, normalizationConfidenceBps: 10000,
        externalSource: null, externalFactHash: null, calculationTarget: true, suggestedTransactionType: null,
        institutionRaw: null, categoryMajorRaw: null, categoryMinorRaw: null, memoRaw: null,
        attributionKind: 'HOUSEHOLD', attributedMemberId: null, audienceVisibility: 'SHARED', audienceMemberId: null,
        reviewStatus: 'READY', evidence: [{ sourceRecordId: 'record-1', role: 'PRIMARY' }],
      }],
      cardStatements: [],
    }
    const decisions: readonly PostingDecisionDto[] = [{
      candidateId: 'candidate-1', transactionId: 'transaction-1', transactionType: 'EXPENSE',
      payee: 'STORE', description: null,
      calculationTarget: true,
      attributionKind: 'HOUSEHOLD', attributedMemberId: null, audienceVisibility: 'SHARED', audienceMemberId: null,
      entries: [
        { id: 'entry-1', accountId: 'family-expense-other', side: 'DEBIT', amountJpy: 1200 },
        { id: 'entry-2', accountId: 'family-bank', side: 'CREDIT', amountJpy: 1200 },
      ],
    }]

    await expect(client.bootstrap()).resolves.toEqual(responses.app_bootstrap)
    await expect(client.health()).resolves.toEqual(responses.app_health)
    await expect(client.status()).resolves.toEqual(responses.app_status)
    await expect(client.getLocalSyncFoundationStatus('family')).resolves.toEqual(responses.local_sync_foundation_status)
    const bindingInput = { householdId: 'family', principalId: 'principal-1', memberId: null, mutationId: 'binding-1' }
    await expect(client.updatePrincipalMemberBinding(bindingInput)).resolves.toEqual(responses.principal_member_binding_update)
    await expect(client.listHouseholds()).resolves.toEqual(responses.households_list)
    await expect(client.createHousehold({ id: 'family', name: 'Family' })).resolves.toEqual(responses.household_create)
    await expect(client.listHouseholdMembers('family')).resolves.toEqual(responses.household_members_list)
    const memberCreate = { id: 'member-1', householdId: 'family', displayName: 'Taro', relationshipLabel: null }
    await expect(client.createHouseholdMember(memberCreate)).resolves.toEqual(responses.household_member_create)
    const memberUpdate = { householdId: 'family', memberId: 'member-1', displayName: 'Taro Updated', relationshipLabel: null, sortOrder: 1 }
    await expect(client.updateHouseholdMember(memberUpdate)).resolves.toEqual(responses.household_member_update)
    await expect(client.archiveHouseholdMember('family', 'member-1')).resolves.toBeUndefined()
    await expect(client.listAccounts('family')).resolves.toEqual(responses.accounts_list)
    await expect(client.queryDashboard({ householdId: 'family', accountGroupId: 'daily', attributionScope: { kind: 'MEMBER', memberId: 'member-1' }, month: '2026-07', accountingBasis: 'ACCRUAL' })).resolves.toEqual(responses.dashboard_query)
    await expect(client.queryTransactions({ householdId: 'family', accountGroupId: 'daily', attributionScope: { kind: 'MEMBER', memberId: 'member-1' }, accountingBasis: 'ACCRUAL', page: 1, pageSize: 20 })).resolves.toEqual(responses.transactions_query)
    const manualInput = { id: 'tx-manual', householdId: 'family', occurredOn: '2026-07-12', postedOn: null, transactionType: 'EXPENSE' as const, payee: 'Store', description: null, attributionKind: 'MEMBER' as const, attributedMemberId: 'member-1', audienceVisibility: 'PERSONAL' as const, audienceMemberId: 'member-1', entries: [] }
    await expect(client.createManualTransaction(manualInput)).resolves.toEqual(responses.transaction_manual_create)
    await expect(client.getTransactionDetail('family', 'tx-manual')).resolves.toEqual(responses.transaction_detail_get)
    responses.transaction_update = responses.transaction_detail_get
    const updateInput = { householdId: 'family', transactionId: 'tx-manual', occurredOn: '2026-07-12', postedOn: null, transactionType: 'EXPENSE' as const, payee: 'Store', description: null, calculationTarget: true, attributionKind: 'MEMBER' as const, attributedMemberId: 'member-1', audienceVisibility: 'PERSONAL' as const, audienceMemberId: 'member-1', entries: [] }
    await expect(client.updateTransaction(updateInput)).resolves.toEqual(responses.transaction_detail_get)
    const metadataInput = { householdId: 'family', transactionIds: ['tx-manual'], addLabels: ['REIMBURSABLE' as const], removeLabels: [], addTags: ['trip'], removeTags: [] }
    await expect(client.bulkUpdateTransactionMetadata(metadataInput)).resolves.toEqual({ updatedCount: 1 })
    await expect(client.getSourceDocument('family', 'document-1')).resolves.toEqual(responses.source_document_get)
    const sourceAudience = { householdId: 'family', sourceDocumentId: 'document-1', audienceVisibility: 'PERSONAL' as const, audienceMemberId: 'member-1' }
    await expect(client.updateSourceDocumentAudience(sourceAudience)).resolves.toEqual(responses.source_document_audience_update)
    const sourcePage = { householdId: 'family', sourceDocumentId: 'document-1', page: 1, pageSize: 20 }
    await expect(client.querySourceDocumentRecords(sourcePage)).resolves.toEqual(responses.source_document_records_query)
    await expect(client.listTransactionSourceRecords('family', 'tx-manual')).resolves.toEqual(responses.transaction_source_records_list)
    await expect(client.listWatchedFolders('family')).resolves.toEqual(responses.watched_folders_list)
    await expect(client.selectWatchedFolder('family', 'Inbox')).resolves.toEqual(responses.watched_folder_select)
    await expect(client.selectIcloudFolder('family', 'iCloud Drive Inbox')).resolves.toEqual(responses.icloud_folder_select)
    await expect(client.removeWatchedFolder('family', 'folder')).resolves.toBeUndefined()
    await expect(client.scanWatchedFolder('family', 'folder')).resolves.toEqual(responses.watched_folder_scan)
    await expect(client.readWatchedFile('family', 'folder', 'bank.csv')).resolves.toEqual(responses.watched_folder_file_read)
    await expect(client.listWatchedFileInbox('family', 'READY', 25)).resolves.toEqual(responses.watched_file_inbox_list)
    await expect(client.countWatchedFileInbox('family')).resolves.toEqual(responses.watched_file_inbox_counts)
    await expect(client.ignoreWatchedFileInboxItem('family', 'a'.repeat(64))).resolves.toEqual(responses.watched_file_inbox_ignore)
    await expect(client.retryWatchedFileInboxItem('family', 'a'.repeat(64))).resolves.toEqual(responses.watched_file_inbox_retry)
    await expect(client.claimWatchedFileInboxItems('family', ['a'.repeat(64)])).resolves.toEqual(responses.watched_file_inbox_claim)
    await expect(client.markWatchedFileInboxReady('family', 'a'.repeat(64), 'c'.repeat(64))).resolves.toEqual(responses.watched_file_inbox_mark_ready)
    await expect(client.markWatchedFileInboxNeedsMapping('family', 'a'.repeat(64), 'c'.repeat(64))).resolves.toEqual(responses.watched_file_inbox_mark_needs_mapping)
    await expect(client.markWatchedFileInboxFailed('family', 'a'.repeat(64), 'c'.repeat(64), 'PREVIEW_FAILED')).resolves.toEqual(responses.watched_file_inbox_mark_failed)
    await expect(client.markWatchedFileInboxStaged('family', 'a'.repeat(64), 'c'.repeat(64), 'run-1')).resolves.toEqual(responses.watched_file_inbox_mark_staged)
    await expect(client.importSummary('family')).resolves.toEqual(responses.import_summary)
    await expect(client.listPendingReviews('family')).resolves.toEqual(responses.pending_review_list)
    await expect(client.startImport(importRequest, new Uint8Array([1, 2, 3]))).resolves.toEqual(responses.import_start)
    await expect(client.previewImport('run-1')).resolves.toEqual(responses.import_preview)
    await expect(client.commitImport('run-1', decisions)).resolves.toEqual(responses.import_commit)
    await expect(client.rollbackImport('run-1')).resolves.toBeUndefined()
    await expect(client.createBackup('long secure passphrase')).resolves.toEqual(responses.backup_create)
    await expect(client.stageBackupRestore('long secure passphrase')).resolves.toEqual(responses.backup_restore_stage)
    await expect(client.restartForRestore()).resolves.toBeUndefined()
    await expect(client.extractDocument(new Uint8Array([37, 80, 68, 70]), 'application/pdf')).resolves.toEqual(responses.document_extract)
    await expect(client.ocrDocument(new Uint8Array([1, 2, 3]), 'image/png')).resolves.toEqual(responses.document_ocr)
    await expect(client.suggestReceiptMatches('family', 'candidate-1')).resolves.toEqual(responses.receipt_match_suggestions)
    await expect(client.confirmReceiptMatch('family', 'candidate-1', 'transaction-1')).resolves.toEqual(responses.receipt_match_confirm)
    await expect(client.listCardSettlements('family')).resolves.toEqual(responses.cards_list)
    await expect(client.confirmCardMatch('family', 'statement-1', 'payment-1')).resolves.toEqual(responses.card_match_confirm)
    await expect(client.confirmCardPaymentLink('family', 'statement-1', 'payment-1')).resolves.toEqual(responses.card_payment_link_confirm)
    await expect(client.unlinkCardPaymentLink('family', 'statement-1', 'payment-1')).resolves.toEqual(responses.card_payment_link_unlink)
    const dueDateInput = { householdId: 'family', statementId: 'statement-1', paymentDueOn: '2026-08-27' }
    await expect(client.updateCardStatementDueDate(dueDateInput)).resolves.toEqual(responses.card_statement_due_date_update)
    const mappingInput = { householdId: 'family', cardAccountId: 'family-rakuten-card', bankAccountId: 'family-bank' }
    await expect(client.listCardSettlementBankMappings('family')).resolves.toEqual(responses.card_settlement_bank_mappings_list)
    await expect(client.upsertCardSettlementBankMapping(mappingInput)).resolves.toEqual(responses.card_settlement_bank_mapping_upsert)
    await expect(client.deleteCardSettlementBankMapping({ householdId: 'family', cardAccountId: 'family-rakuten-card' })).resolves.toBeUndefined()
    const coverageRequest = { householdId: 'family', asOf: '2026-07-13', horizonDays: 45 }
    await expect(client.queryCardSettlementBalanceCoverage(coverageRequest)).resolves.toEqual(responses.card_settlement_balance_coverage_query)
    expect(invokeSpy).toHaveBeenCalledWith('household_create', { input: { id: 'family', name: 'Family' } })
    expect(invokeSpy).toHaveBeenCalledWith('local_sync_foundation_status', { householdId: 'family' })
    expect(invokeSpy).toHaveBeenCalledWith('principal_member_binding_update', { input: bindingInput })
    expect(invokeSpy).toHaveBeenCalledWith('household_members_list', { householdId: 'family' })
    expect(invokeSpy).toHaveBeenCalledWith('household_member_create', { input: memberCreate })
    expect(invokeSpy).toHaveBeenCalledWith('household_member_update', { input: memberUpdate })
    expect(invokeSpy).toHaveBeenCalledWith('household_member_archive', { householdId: 'family', memberId: 'member-1' })
    expect(invokeSpy).toHaveBeenCalledWith('accounts_list', { householdId: 'family' })
    expect(invokeSpy).toHaveBeenCalledWith('import_start', { request: { import: importRequest, fileBytes: [1, 2, 3] } })
    expect(invokeSpy).toHaveBeenCalledWith('pending_review_list', { householdId: 'family' })
    expect(invokeSpy).toHaveBeenCalledWith('transaction_manual_create', { input: manualInput })
    expect(invokeSpy).toHaveBeenCalledWith('transaction_detail_get', { householdId: 'family', transactionId: 'tx-manual' })
    expect(invokeSpy).toHaveBeenCalledWith('transaction_update', { input: updateInput })
    expect(invokeSpy).toHaveBeenCalledWith('source_document_get', { householdId: 'family', sourceDocumentId: 'document-1' })
    expect(invokeSpy).toHaveBeenCalledWith('source_document_audience_update', { input: sourceAudience })
    expect(invokeSpy).toHaveBeenCalledWith('source_document_records_query', { request: sourcePage })
    expect(invokeSpy).toHaveBeenCalledWith('transaction_source_records_list', { householdId: 'family', transactionId: 'tx-manual' })
    expect(invokeSpy).toHaveBeenCalledWith('watched_folders_list', { householdId: 'family' })
    expect(invokeSpy).toHaveBeenCalledWith('watched_folder_select', { householdId: 'family', label: 'Inbox' })
    expect(invokeSpy).toHaveBeenCalledWith('icloud_folder_select', { householdId: 'family', label: 'iCloud Drive Inbox' })
    expect(invokeSpy).toHaveBeenCalledWith('watched_folder_remove', { householdId: 'family', watchedFolderId: 'folder' })
    expect(invokeSpy).toHaveBeenCalledWith('watched_folder_scan', { householdId: 'family', watchedFolderId: 'folder' })
    expect(invokeSpy).toHaveBeenCalledWith('watched_folder_file_read', { householdId: 'family', watchedFolderId: 'folder', relativePath: 'bank.csv' })
    expect(invokeSpy).toHaveBeenCalledWith('watched_file_inbox_list', { householdId: 'family', state: 'READY', limit: 25 })
    expect(invokeSpy).toHaveBeenCalledWith('watched_file_inbox_counts', { householdId: 'family' })
    expect(invokeSpy).toHaveBeenCalledWith('watched_file_inbox_ignore', { householdId: 'family', itemId: 'a'.repeat(64) })
    expect(invokeSpy).toHaveBeenCalledWith('watched_file_inbox_retry', { householdId: 'family', itemId: 'a'.repeat(64) })
    expect(invokeSpy).toHaveBeenCalledWith('watched_file_inbox_claim', { householdId: 'family', itemIds: ['a'.repeat(64)] })
    expect(invokeSpy).toHaveBeenCalledWith('watched_file_inbox_mark_ready', { householdId: 'family', itemId: 'a'.repeat(64), leaseToken: 'c'.repeat(64) })
    expect(invokeSpy).toHaveBeenCalledWith('watched_file_inbox_mark_needs_mapping', { householdId: 'family', itemId: 'a'.repeat(64), leaseToken: 'c'.repeat(64) })
    expect(invokeSpy).toHaveBeenCalledWith('watched_file_inbox_mark_failed', { householdId: 'family', itemId: 'a'.repeat(64), leaseToken: 'c'.repeat(64), errorCode: 'PREVIEW_FAILED' })
    expect(invokeSpy).toHaveBeenCalledWith('watched_file_inbox_mark_staged', { householdId: 'family', itemId: 'a'.repeat(64), leaseToken: 'c'.repeat(64), importRunId: 'run-1' })
    expect(invokeSpy).toHaveBeenCalledWith('import_preview', { runId: 'run-1' })
    expect(invokeSpy).toHaveBeenCalledWith('import_commit', { runId: 'run-1', decisions })
    expect(invokeSpy).toHaveBeenCalledWith('import_rollback', { runId: 'run-1' })
    expect(invokeSpy).toHaveBeenCalledWith('backup_create', { passphrase: 'long secure passphrase' })
    expect(invokeSpy).toHaveBeenCalledWith('backup_restore_stage', { passphrase: 'long secure passphrase' })
    expect(invokeSpy).toHaveBeenCalledWith('app_restart_for_restore', undefined)
    expect(invokeSpy).toHaveBeenCalledWith('document_extract', { fileBytes: [37, 80, 68, 70], mediaType: 'application/pdf' })
    expect(invokeSpy).toHaveBeenCalledWith('document_ocr', { fileBytes: [1, 2, 3], mediaType: 'image/png' })
    expect(invokeSpy).toHaveBeenCalledWith('receipt_match_suggestions', { request: { householdId: 'family', candidateId: 'candidate-1' } })
    expect(invokeSpy).toHaveBeenCalledWith('receipt_match_confirm', { request: { householdId: 'family', candidateId: 'candidate-1', transactionId: 'transaction-1' } })
    expect(invokeSpy).toHaveBeenCalledWith('cards_list', { householdId: 'family' })
    expect(invokeSpy).toHaveBeenCalledWith('card_match_confirm', { householdId: 'family', statementId: 'statement-1', paymentId: 'payment-1' })
    expect(invokeSpy).toHaveBeenCalledWith('card_payment_link_confirm', { householdId: 'family', statementId: 'statement-1', paymentId: 'payment-1' })
    expect(invokeSpy).toHaveBeenCalledWith('card_payment_link_unlink', { householdId: 'family', statementId: 'statement-1', paymentId: 'payment-1' })
    expect(invokeSpy).toHaveBeenCalledWith('card_statement_due_date_update', { input: dueDateInput })
    expect(invokeSpy).toHaveBeenCalledWith('card_settlement_bank_mappings_list', { householdId: 'family' })
    expect(invokeSpy).toHaveBeenCalledWith('card_settlement_bank_mapping_upsert', { input: mappingInput })
    expect(invokeSpy).toHaveBeenCalledWith('card_settlement_bank_mapping_delete', { input: { householdId: 'family', cardAccountId: 'family-rakuten-card' } })
    expect(invokeSpy).toHaveBeenCalledWith('card_settlement_balance_coverage_query', { request: coverageRequest })
    expect(invokeSpy).toHaveBeenCalledWith('transaction_metadata_bulk_update', { input: metadataInput })
    expect(invokeSpy).toHaveBeenCalledTimes(59)
  })

  it('rejects inconsistent cumulative card-payment rows', async () => {
    const payment = { paymentId: 'payment-1', bankTransactionId: 'bank-1', paymentAmountJpy: 400, paymentOn: '2026-07-27', matchScoreBps: null }
    const valid = {
      id: 'statement-1', cardAccountId: 'card-1', cardName: 'Card', maskedIdentifier: null,
      periodStart: '2026-06-01', periodEnd: '2026-06-30', paymentDueOn: '2026-07-27',
      statementAmountJpy: 1000, detailAmountJpy: 1000, lineCount: 1,
      paymentId: 'payment-1', bankTransactionId: 'bank-1', paymentAmountJpy: 400, paymentOn: '2026-07-27', matchScoreBps: null,
      reconciliationStatus: 'PARTIALLY_RECONCILED', paidAmountJpy: 400, outstandingAmountJpy: 600, overpaidAmountJpy: 0,
      payments: [payment], eligiblePayments: [],
    }
    const invalidRows = [
      { ...valid, paidAmountJpy: 399 },
      { ...valid, outstandingAmountJpy: 599 },
      { ...valid, overpaidAmountJpy: 1 },
      { ...valid, reconciliationStatus: 'FULLY_RECONCILED' },
      { ...valid, payments: [payment, payment] },
      { ...valid, eligiblePayments: [{ ...payment }] },
      { ...valid, payments: [{ ...payment, paymentAmountJpy: -1 }] },
      { ...valid, payments: [{ ...payment, paymentOn: '2026-02-30' }] },
      { ...valid, eligiblePayments: [{ ...payment, paymentId: 'candidate', bankTransactionId: 'candidate-bank', matchScoreBps: 10001 }] },
      { ...valid, periodEnd: 'not-a-date' },
      { ...valid, periodStart: '2026-07-01', periodEnd: '2026-06-30' },
      { ...valid, paymentDueOn: '2026-06-29' },
    ]
    for (const response of invalidRows) {
      const client = createPlatformClient({ tauri: true, invoke: async <T>() => [response] as T })
      await expect(client.listCardSettlements('family')).rejects.toMatchObject({ code: 'INVALID_RESPONSE', command: 'cards_list' })
    }
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

  it('rejects unknown or mismatched watched-folder provenance at the IPC boundary', async () => {
    const baseFolder = { id: 'folder', householdId: 'family', label: 'Inbox', displayName: 'Inbox', sourceType: 'ICLOUD_PICKER', provider: 'ICLOUD', isEnabled: true, createdAt: '2026-07-12T00:00:00Z' }
    for (const response of [{ ...baseFolder, sourceType: 'DROPBOX' }, { ...baseFolder, provider: 'LOCAL' }]) {
      const client = createPlatformClient({ tauri: true, invoke: async <T>() => [response] as T })
      await expect(client.listWatchedFolders('family')).rejects.toMatchObject({ code: 'INVALID_RESPONSE', command: 'watched_folders_list' })
    }
    const inbox = { id: 'a'.repeat(64), householdId: 'family', watchedFolderId: 'folder', watchedFolderLabel: 'Inbox', sourceType: 'ICLOUD_PICKER', provider: 'LOCAL', relativePath: 'bank.csv', fileName: 'bank.csv', mediaType: 'text/csv', byteSize: 3, modifiedUnixMs: 1000, fingerprint: 'b'.repeat(64), state: 'READY', attemptCount: 1, importRunId: null, lastErrorCode: null, discoveredAt: '2026-07-12T00:00:00Z', updatedAt: '2026-07-12T00:01:00Z' }
    const client = createPlatformClient({ tauri: true, invoke: async <T>() => [inbox] as T })
    await expect(client.listWatchedFileInbox('family')).rejects.toMatchObject({ code: 'INVALID_RESPONSE', command: 'watched_file_inbox_list' })
  })

  it('strictly validates v0.57 partition coverage, evidence summaries, and all artifact schemas', async () => {
    const partition = {
      audienceKey: 'SHARED', audienceVisibility: 'SHARED', audienceMemberId: null, audienceMemberName: null,
      recipientNames: ['Hanako'], pendingChangeCount: 3, state: 'READY', withheldReason: null,
      domainCounts: { LEDGER: 1, PLANNING: 0, CONFIG: 0, CARD: 1, INVESTMENT: 1 },
      withheldDomainCounts: { LEDGER: 0, PLANNING: 0, CONFIG: 0, CARD: 0, INVESTMENT: 0 },
      evidenceFileCount: 2, evidenceRecordCount: 3, withheldCountsByReason: {}, coverageState: 'COMPLETE',
    }
    const status = {
      householdId: 'family', connectionState: 'CONNECTED', endpoint: 'https://relay.example', remotePrincipalId: 'principal-1',
      localDeviceId: 'device-1', inboundCursor: 0, localMemberId: 'member-1', localMemberName: 'Taro', memberships: [],
      outbound: [partition], withheldChangeCount: 0, inbound: [],
    }
    const review = {
      packageId: 'package-1', householdId: 'family', senderMemberName: 'Hanako', audienceVisibility: 'SHARED', audienceMemberName: null,
      state: 'REVIEW_REQUIRED', recordCount: 1, createCount: 0, updateCount: 0, deleteCount: 0, conflictCount: 1,
      evidenceFileCount: 2, evidenceRecordCount: 3,
      records: [{ recordOrder: 0, entityKind: 'CARD_STATEMENT', entityId: 'statement-1', entityLabel: 'カード請求・statement-1', domain: 'CARD', entitySummary: '楽天カード · 2026年7月 · ¥204,987', operation: 'UPSERT', reviewState: 'CONFLICT', resolution: 'PENDING', localSummary: '既存', incomingSummary: '受信' }],
    }
    const prepared = [{ deliveryId: 'delivery-1', artifactId: 'artifact-1', digest: 'a'.repeat(64), householdId: 'family', originDeviceId: 'device-1', audienceKey: 'SHARED', audienceVisibility: 'SHARED', audienceMemberId: null, artifactSchema: 'FAMILY_AUDIENCE_PARTITION_V3', packageBytes: [1] }]
    const invoke: Invoke = async <T>(command: AppCommand) => {
      if (command === 'family_delivery_status') return status as T
      if (command === 'family_snapshot_active_review') return review as T
      if (command === 'family_delivery_send_prepare') return prepared as T
      return undefined as T
    }
    const client = createPlatformClient({ tauri: true, invoke })
    await expect(client.getFamilyDeliveryStatus('family')).resolves.toMatchObject({ outbound: [expect.objectContaining({ coverageState: 'COMPLETE', evidenceFileCount: 2 })] })
    await expect(client.getActiveFamilySnapshotReview('family')).resolves.toMatchObject({ evidenceFileCount: 2, evidenceRecordCount: 3, records: [expect.objectContaining({ domain: 'CARD', entitySummary: '楽天カード · 2026年7月 · ¥204,987' })] })
    await expect(client.prepareFamilyDelivery({ householdId: 'family', audienceKeys: ['SHARED'] })).resolves.toMatchObject([{ artifactSchema: 'FAMILY_AUDIENCE_PARTITION_V3' }])

    const v4Client = createPlatformClient({ tauri: true, invoke: async <T>() => [{ ...prepared[0], artifactSchema: 'FAMILY_AUDIENCE_PARTITION_V4' }] as T })
    await expect(v4Client.prepareFamilyDelivery({ householdId: 'family', audienceKeys: ['SHARED'] })).resolves.toMatchObject([{ artifactSchema: 'FAMILY_AUDIENCE_PARTITION_V4' }])
    const v5Client = createPlatformClient({ tauri: true, invoke: async <T>() => [{ ...prepared[0], artifactSchema: 'FAMILY_AUDIENCE_PARTITION_V5' }] as T })
    await expect(v5Client.prepareFamilyDelivery({ householdId: 'family', audienceKeys: ['SHARED'] })).rejects.toMatchObject({ code: 'INVALID_RESPONSE', command: 'family_delivery_send_prepare' })

    for (const invalidPartition of [
      { ...partition, domainCounts: { LEDGER: 1, PLANNING: 0, CONFIG: 0, CARD: 1 } },
      { ...partition, withheldDomainCounts: { LEDGER: 0, PLANNING: 0, CONFIG: 0, CARD: 0 } },
      { ...partition, withheldDomainCounts: { LEDGER: 0, PLANNING: 0, CONFIG: 0, CARD: -1, INVESTMENT: 0 } },
      { ...partition, withheldCountsByReason: { 'not-canonical': 1 }, coverageState: 'PARTIAL' },
      { ...partition, withheldCountsByReason: { MISSING_CARD_EVIDENCE: 1 }, coverageState: 'PARTIAL' },
      { ...partition, withheldCountsByReason: { EVIDENCE_REQUIRED: 1 }, coverageState: 'COMPLETE' },
      { ...partition, evidenceFileCount: -1 },
    ]) {
      const invalidClient = createPlatformClient({ tauri: true, invoke: async <T>() => ({ ...status, outbound: [invalidPartition] }) as T })
      await expect(invalidClient.getFamilyDeliveryStatus('family')).rejects.toMatchObject({ code: 'INVALID_RESPONSE', command: 'family_delivery_status' })
    }
    for (const invalidReview of [{ ...review, evidenceFileCount: -1 }, { ...review, evidenceRecordCount: -1 }]) {
      const invalidClient = createPlatformClient({ tauri: true, invoke: async <T>() => invalidReview as T })
      await expect(invalidClient.getActiveFamilySnapshotReview('family')).rejects.toMatchObject({ code: 'INVALID_RESPONSE', command: 'family_snapshot_active_review' })
    }
  })

  it('validates the public-only KFE1 identity and native seal/open boundaries', async () => {
    const digest = 'a'.repeat(64); const publicKey = 'A'.repeat(43)
    const invoke: Invoke = async <T>(command: AppCommand) => {
      if (command === 'family_envelope_identity_get') return { keyId: digest, publicKey, generation: 1 } as T
      if (command === 'family_envelope_seal') return { envelopeBytes: [75, 70, 69, 49], envelopeSha256: digest, envelopeByteSize: 4, recipientCount: 2 } as T
      if (command === 'family_envelope_open') return { artifactBytes: [75, 70, 70, 51], artifactSha256: digest, artifactByteSize: 4 } as T
      return undefined as T
    }
    const client = createPlatformClient({ tauri: true, invoke })
    await expect(client.getFamilyEnvelopeIdentity()).resolves.toEqual({ keyId: digest, publicKey, generation: 1 })
    await expect(client.sealFamilyEnvelope({ metadata: { householdId: 'family', publicationId: 'artifact', originInstallationId: 'device', artifactSchema: 'FAMILY_AUDIENCE_PARTITION_V3', innerSha256: digest }, artifactBytes: [1], recipients: [{ membershipId: 'membership-2', keyId: digest, publicKey, generation: 1 }] })).resolves.toMatchObject({ envelopeByteSize: 4, recipientCount: 2 })
    await expect(client.openFamilyEnvelope({ expectedMetadata: { householdId: 'family', publicationId: 'artifact', originInstallationId: 'device', artifactSchema: 'FAMILY_AUDIENCE_PARTITION_V3', innerSha256: digest }, envelopeBytes: [1], localMembershipId: 'membership-1' })).resolves.toMatchObject({ artifactByteSize: 4 })

    const invalid = createPlatformClient({ tauri: true, invoke: async <T>(command: AppCommand) => (command === 'family_envelope_identity_get'
      ? { keyId: digest, publicKey: 'not-base64url', generation: 1 }
      : { envelopeBytes: [1], envelopeSha256: digest, envelopeByteSize: 2, recipientCount: 1 }) as T })
    await expect(invalid.getFamilyEnvelopeIdentity()).rejects.toMatchObject({ command: 'family_envelope_identity_get', code: 'INVALID_RESPONSE' })
    await expect(invalid.sealFamilyEnvelope({} as never)).rejects.toMatchObject({ command: 'family_envelope_seal', code: 'INVALID_RESPONSE' })
  })

  it('routes exact recipient-set change metadata to the native envelope reset command', async () => {
    const status = {
      householdId: 'family', connectionState: 'CONNECTED', endpoint: 'https://relay.example', remotePrincipalId: 'principal-1',
      localDeviceId: 'device-1', inboundCursor: 0, localMemberId: 'member-1', localMemberName: 'Taro', memberships: [],
      outbound: [], withheldChangeCount: 0, inbound: [],
    }
    const invokeSpy = vi.fn()
    const client = createPlatformClient({ tauri: true, invoke: async <T>(command: AppCommand, args?: Record<string, unknown>) => {
      invokeSpy(command, args); return status as T
    } })
    const deliveries = [{ deliveryId: 'delivery-1', transportSha256: 'a'.repeat(64), recipientSetDigest: 'b'.repeat(64) }]
    await expect(client.resetFamilyDeliveryRecipientSetChanged('family', deliveries)).resolves.toEqual(status)
    expect(invokeSpy).toHaveBeenCalledWith('family_delivery_envelope_recipient_set_changed', { householdId: 'family', deliveries })
  })

  it('validates and routes prepared and cached family envelope metadata independently of generic sealing', async () => {
    const prepared = {
      envelopeBytes: [75, 70, 69, 49], envelopeSha256: 'a'.repeat(64), envelopeByteSize: 4, recipientCount: 2,
      recipientSetDigest: 'b'.repeat(64), cacheDisposition: 'STALE_CACHE_REUSED',
    }
    const invokeSpy = vi.fn()
    const client = createPlatformClient({ tauri: true, invoke: async <T>(command: AppCommand, args?: Record<string, unknown>) => {
      invokeSpy(command, args)
      return (command === 'family_delivery_envelope_cached_get' ? prepared : { ...prepared, cacheDisposition: 'NEWLY_SEALED' }) as T
    } })
    const metadata = { householdId: 'family', publicationId: 'artifact', originInstallationId: 'device', artifactSchema: 'FAMILY_AUDIENCE_PARTITION_V3' as const, innerSha256: 'c'.repeat(64) }
    const cachedInput = { deliveryId: 'delivery-1', metadata }
    await expect(client.getCachedFamilyDeliveryEnvelope(cachedInput)).resolves.toEqual(prepared)
    await expect(client.prepareEncryptedFamilyEnvelope({ ...cachedInput, recipients: [{ membershipId: 'membership-2', keyId: 'd'.repeat(64), publicKey: 'A'.repeat(43), generation: 1 }], recipientSetDigest: 'b'.repeat(64) }))
      .resolves.toMatchObject({ cacheDisposition: 'NEWLY_SEALED', recipientSetDigest: 'b'.repeat(64) })
    expect(invokeSpy).toHaveBeenCalledWith('family_delivery_envelope_cached_get', { input: cachedInput })

    const absent = createPlatformClient({ tauri: true, invoke: async <T>() => null as T })
    await expect(absent.getCachedFamilyDeliveryEnvelope(cachedInput)).resolves.toBeNull()
    for (const invalid of [
      { ...prepared, recipientSetDigest: 'not-a-hash' },
      { ...prepared, cacheDisposition: 'UNKNOWN' },
    ]) {
      const invalidClient = createPlatformClient({ tauri: true, invoke: async <T>() => invalid as T })
      await expect(invalidClient.getCachedFamilyDeliveryEnvelope(cachedInput)).rejects.toMatchObject({ command: 'family_delivery_envelope_cached_get', code: 'INVALID_RESPONSE' })
    }
  })

  it('validates and routes opt-in background family discovery commands', async () => {
    const schedule = {
      householdId: 'family', enabled: true, intervalMinutes: 30, nextDueAt: '2026-07-14T02:00:00.000Z',
      running: false, leaseExpiresAt: null, lastAttemptAt: '2026-07-14T01:30:00.000Z',
      lastSuccessAt: '2026-07-14T01:30:00.000Z', lastResult: 'DISCOVERED', lastDiscoveredCount: 2,
      consecutiveFailures: 0, suspendedUntil: null, suspensionReason: null, lastErrorCode: null,
      intakeEnabled: false, lastIntakeResult: 'DISABLED', lastStagedCount: 0, lastIntakeErrorCode: null,
      updatedAt: '2026-07-14T01:30:00.000Z',
    }
    const invokeSpy = vi.fn()
    const client = createPlatformClient({ tauri: true, invoke: async <T>(command: AppCommand, args?: Record<string, unknown>) => { invokeSpy(command, args); return schedule as T } })

    await expect(client.getFamilyDeliveryBackgroundStatus('family')).resolves.toEqual(schedule)
    await expect(client.enableFamilyDeliveryBackground({ householdId: 'family', token: 'session-secret', intervalMinutes: 30, intakeEnabled: false })).resolves.toEqual(schedule)
    await expect(client.disableFamilyDeliveryBackground('family')).resolves.toEqual(schedule)
    await expect(client.runFamilyDeliveryBackgroundNow('family')).resolves.toEqual(schedule)
    expect(invokeSpy).toHaveBeenCalledWith('family_delivery_background_status', { householdId: 'family' })
    expect(invokeSpy).toHaveBeenCalledWith('family_delivery_background_enable', { input: { householdId: 'family', token: 'session-secret', intervalMinutes: 30, intakeEnabled: false } })
    expect(invokeSpy).toHaveBeenCalledWith('family_delivery_background_disable', { householdId: 'family' })
    expect(invokeSpy).toHaveBeenCalledWith('family_delivery_background_run_now', { householdId: 'family' })

    const unconfigured = {
      ...schedule, enabled: false, nextDueAt: null, lastResult: 'DISABLED',
      lastAttemptAt: null, lastSuccessAt: null, lastDiscoveredCount: 0, updatedAt: '2026-07-14T01:00:00.000Z',
    }
    const unconfiguredClient = createPlatformClient({ tauri: true, invoke: async <T>() => unconfigured as T })
    await expect(unconfiguredClient.getFamilyDeliveryBackgroundStatus('family')).resolves.toEqual(unconfigured)

    const invalidResponses = [
      { ...schedule, intervalMinutes: 10 },
      { ...schedule, running: true },
      { ...schedule, lastResult: 'UNKNOWN' },
      { ...schedule, lastDiscoveredCount: -1 },
      { ...schedule, nextDueAt: 'soon' },
      { ...schedule, enabled: false, lastResult: 'DISABLED', nextDueAt: schedule.nextDueAt },
    ]
    for (const response of invalidResponses) {
      const invalid = createPlatformClient({ tauri: true, invoke: async <T>() => response as T })
      await expect(invalid.getFamilyDeliveryBackgroundStatus('family')).rejects.toMatchObject({ command: 'family_delivery_background_status', code: 'INVALID_RESPONSE' })
    }

    const terminal = { ...schedule, nextDueAt: null, lastResult: 'TERMINAL_SUSPENDED', suspensionReason: 'AUTH_EXPIRED', lastErrorCode: 'AUTH_EXPIRED' }
    const terminalClient = createPlatformClient({ tauri: true, invoke: async <T>() => terminal as T })
    await expect(terminalClient.getFamilyDeliveryBackgroundStatus('family')).resolves.toEqual(terminal)
  })

  it('loads and persists strictly validated household dashboard preferences', async () => {
    const saved = {
      householdId: 'family', template: 'CASH_FLOW', theme: 'DARK', density: 'COMPACT',
      templateLayouts: { ...dashboardLayouts(), CASH_FLOW: { widgetOrder: ['CARDS', 'TREND', 'RECENT', 'SPENDING'] as const, hiddenWidgets: ['RECENT'] as const } },
      updatedAt: '2026-07-13T08:30:00.000Z',
    }
    const invokeSpy = vi.fn()
    const client = createPlatformClient({
      tauri: true,
      invoke: async <T>(command: AppCommand, args?: Record<string, unknown>) => {
        invokeSpy(command, args)
        return saved as T
      },
    })
    const input = {
      householdId: 'family', template: 'CASH_FLOW' as const, theme: 'DARK' as const, density: 'COMPACT' as const,
      templateLayouts: saved.templateLayouts,
    }

    await expect(client.getDashboardPreferences('family')).resolves.toEqual(saved)
    await expect(client.upsertDashboardPreferences(input)).resolves.toEqual(saved)
    expect(invokeSpy).toHaveBeenCalledWith('dashboard_preferences_get', { householdId: 'family' })
    expect(invokeSpy).toHaveBeenCalledWith('dashboard_preferences_upsert', { input })

    const invalidResponses = [
      { ...saved, template: 'CUSTOM' },
      { ...saved, theme: 'AMOLED' },
      { ...saved, density: 'TINY' },
      { ...saved, templateLayouts: undefined },
      { ...saved, templateLayouts: { ...saved.templateLayouts, CASH_FLOW: { widgetOrder: ['TREND', 'RECENT', 'CARDS'], hiddenWidgets: [] } } },
      { ...saved, templateLayouts: { ...saved.templateLayouts, CASH_FLOW: { widgetOrder: ['TREND', 'RECENT', 'CARDS', 'CARDS'], hiddenWidgets: [] } } },
      { ...saved, templateLayouts: { ...saved.templateLayouts, CASH_FLOW: { widgetOrder: ['TREND', 'RECENT', 'CARDS', 'UNKNOWN'], hiddenWidgets: [] } } },
      { ...saved, templateLayouts: { ...saved.templateLayouts, CASH_FLOW: { widgetOrder: ['TREND', 'RECENT', 'CARDS', 'SPENDING'], hiddenWidgets: ['TREND', 'TREND'] } } },
      { ...saved, templateLayouts: { ...saved.templateLayouts, CASH_FLOW: { widgetOrder: ['TREND', 'RECENT', 'CARDS', 'SPENDING'], hiddenWidgets: ['SPENDING'] } } },
      { ...saved, templateLayouts: { ...saved.templateLayouts, CASH_FLOW: { widgetOrder: ['TREND', 'RECENT', 'CARDS', 'SPENDING'], hiddenWidgets: ['TREND', 'RECENT', 'CARDS'] } } },
      { ...saved, templateLayouts: { ...saved.templateLayouts, EXTRA: saved.templateLayouts.CASH_FLOW } },
      { ...saved, templateLayouts: { ...saved.templateLayouts, CASH_FLOW: { ...saved.templateLayouts.CASH_FLOW, extra: true } } },
      { ...saved, householdId: '' },
      { ...saved, updatedAt: 'yesterday' },
    ]
    for (const response of invalidResponses) {
      const invalidClient = createPlatformClient({ tauri: true, invoke: async <T>() => response as T })
      await expect(invalidClient.getDashboardPreferences('family')).rejects.toMatchObject({
        code: 'INVALID_RESPONSE', command: 'dashboard_preferences_get',
      })
    }
  })

  it('rejects malformed or non-contiguous cash-flow dashboard trends', async () => {
    const trend = Array.from({ length: 6 }, (_, index) => ({
      month: `2026-${String(index + 2).padStart(2, '0')}`,
      inflowJpy: index === 5 ? 1000 : 0,
      outflowJpy: index === 5 ? 400 : 0,
      netCashFlowJpy: index === 5 ? 600 : 0,
    }))
    const valid = {
      month: '2026-07', accountingBasis: 'CASH', incomeJpy: 1000, expenseJpy: 400, savingsJpy: 600,
      postedTransactionCount: 2, netWorthAsOf: '2026-07-31', assetsJpy: 1000, liabilitiesJpy: 0, netWorthJpy: 1000,
      accrualTrend: [], cashFlowTrend: trend, expenseCategories: [],
    }
    const invalidResponses = [
      { ...valid, cashFlowTrend: trend.slice(1) },
      { ...valid, cashFlowTrend: trend.map((point, index) => index === 5 ? { ...point, netCashFlowJpy: 599 } : point) },
      { ...valid, cashFlowTrend: trend.map((point, index) => index === 5 ? { ...point, outflowJpy: -1 } : point) },
      { ...valid, cashFlowTrend: trend.map((point, index) => index === 2 ? { ...point, month: '2026-02' } : point) },
    ]
    for (const response of invalidResponses) {
      const client = createPlatformClient({ tauri: true, invoke: async <T>() => response as T })
      await expect(client.queryDashboard({ householdId: 'family', attributionScope: { kind: 'ALL' }, month: '2026-07', accountingBasis: 'CASH' })).rejects.toMatchObject({
        code: 'INVALID_RESPONSE', command: 'dashboard_query',
      })
    }
  })

  it('rejects malformed receipt match scores and confirmations', async () => {
    const invoke: Invoke = async <T>(command: AppCommand) => (command === 'receipt_match_suggestions'
      ? [{ candidateId: 'candidate-1', transactionId: 'transaction-1', occurredOn: '2026-07-12', payee: null, description: null, transactionType: 'EXPENSE', amountJpy: 1200, dayDifference: 4, merchantSimilarityBps: 10000, scoreBps: 10000, reasons: [] }]
      : { runId: 'run-1', candidateId: 'candidate-1', transactionId: 'transaction-1', resolutionStatus: 'DECLINED', evidenceCount: 0, runStatus: 'REVIEW_REQUIRED' }) as T
    const client = createPlatformClient({ tauri: true, invoke })

    await expect(client.suggestReceiptMatches('family', 'candidate-1')).rejects.toMatchObject({ code: 'INVALID_RESPONSE', command: 'receipt_match_suggestions' })
    await expect(client.confirmReceiptMatch('family', 'candidate-1', 'transaction-1')).rejects.toMatchObject({ code: 'INVALID_RESPONSE', command: 'receipt_match_confirm' })
  })

  it('validates planning DTOs and keeps household scope in every command', async () => {
    const responses: Record<string, unknown> = {
      budgets_query: [{ householdId: 'family', month: '2026-07', categoryAccountId: 'food', categoryName: '食費', budgetJpy: 50000, actualJpy: 12000, remainingJpy: 38000 }],
      budget_upsert: { householdId: 'family', month: '2026-07', categoryAccountId: 'food', categoryName: '食費', budgetJpy: 50000, actualJpy: 12000, remainingJpy: 38000 },
      savings_goals_list: [{ id: 'goal', householdId: 'family', name: '旅行', targetJpy: 100000, savedJpy: 20000, targetDate: '2027-07-01', status: 'ACTIVE', createdAt: '2026-07-01T00:00:00Z', updatedAt: '2026-07-01T00:00:00Z' }],
      savings_goal_create: { id: 'goal', householdId: 'family', name: '旅行', targetJpy: 100000, savedJpy: 0, targetDate: '2027-07-01', status: 'ACTIVE', createdAt: '2026-07-01T00:00:00Z', updatedAt: '2026-07-01T00:00:00Z' },
      savings_goal_update: { id: 'goal', householdId: 'family', name: '旅行', targetJpy: 100000, savedJpy: 20000, targetDate: '2027-07-01', status: 'ACTIVE', createdAt: '2026-07-01T00:00:00Z', updatedAt: '2026-07-02T00:00:00Z' },
      savings_goal_delete: null,
    }
    const invokeSpy = vi.fn()
    const client = createPlatformClient({ tauri: true, invoke: async <T>(command: AppCommand, args?: Record<string, unknown>) => { invokeSpy(command, args); return responses[command] as T } })
    const goal = { id: 'goal', householdId: 'family', name: '旅行', targetJpy: 100000, savedJpy: 0, targetDate: '2027-07-01', status: 'ACTIVE' as const }

    await expect(client.listBudgets('family', '2026-07')).resolves.toHaveLength(1)
    await expect(client.upsertBudget({ householdId: 'family', month: '2026-07', categoryAccountId: 'food', budgetJpy: 50000 })).resolves.toMatchObject({ remainingJpy: 38000 })
    await expect(client.listSavingsGoals('family')).resolves.toHaveLength(1)
    await expect(client.createSavingsGoal(goal)).resolves.toMatchObject({ savedJpy: 0 })
    await expect(client.updateSavingsGoal({ ...goal, savedJpy: 20000 })).resolves.toMatchObject({ savedJpy: 20000 })
    await expect(client.deleteSavingsGoal('family', 'goal')).resolves.toBeUndefined()
    expect(invokeSpy).toHaveBeenCalledWith('budgets_query', { householdId: 'family', month: '2026-07' })
    expect(invokeSpy).toHaveBeenCalledWith('savings_goal_delete', { householdId: 'family', goalId: 'goal' })
  })

  it('validates account mutations and preserves household ownership inputs', async () => {
    const account = { id: 'bank-2', name: 'ゆうちょ銀行', accountKind: 'ASSET', accountSubtype: 'BANK', currency: 'JPY', ownershipKind: 'HOUSEHOLD', ownerMemberId: null, ownerMemberName: null, visibility: 'SHARED' }
    const responses: Record<string, unknown> = { account_create: account, account_rename: { ...account, name: '生活口座' }, account_archive: null, account_ownership_update: { ...account, ownershipKind: 'MEMBER', ownerMemberId: 'member-1', ownerMemberName: 'Taro', visibility: 'PERSONAL' } }
    const invokeSpy = vi.fn()
    const client = createPlatformClient({ tauri: true, invoke: async <T>(command: AppCommand, args?: Record<string, unknown>) => { invokeSpy(command, args); return responses[command] as T } })
    const create = { id: 'bank-2', householdId: 'family', name: 'ゆうちょ銀行', accountKind: 'ASSET' as const, accountSubtype: 'BANK' as const, currency: 'JPY' as const, ownershipKind: 'HOUSEHOLD' as const, ownerMemberId: null, visibility: 'SHARED' as const }

    await expect(client.createAccount(create)).resolves.toEqual(account)
    await expect(client.renameAccount({ householdId: 'family', accountId: 'bank-2', name: '生活口座' })).resolves.toMatchObject({ name: '生活口座' })
    await expect(client.archiveAccount({ householdId: 'family', accountId: 'bank-2' })).resolves.toBeUndefined()
    await expect(client.updateAccountOwnership({ householdId: 'family', accountId: 'bank-2', ownershipKind: 'MEMBER', ownerMemberId: 'member-1', visibility: 'PERSONAL' })).resolves.toMatchObject({ ownerMemberName: 'Taro', visibility: 'PERSONAL' })
    expect(invokeSpy).toHaveBeenCalledWith('account_create', { input: create })
    expect(invokeSpy).toHaveBeenCalledWith('account_archive', { input: { householdId: 'family', accountId: 'bank-2' } })
  })

  it('validates classification rule CRUD, preview, and safe apply DTOs', async () => {
    const rule = {
      id: 'coffee', householdId: 'family', name: 'Coffee', priority: 10, isEnabled: true,
      merchantContains: 'coffee', descriptionContains: null, categoryAccountId: 'entertainment', categoryName: 'Entertainment',
      labels: ['Recurring'], tags: ['#work'], createdAt: '2026-07-13T00:00:00Z', updatedAt: '2026-07-13T00:00:00Z',
    }
    const responses: Record<string, unknown> = {
      classification_rules_list: [rule], classification_rule_create: rule,
      classification_rule_update: { ...rule, isEnabled: false }, classification_rule_delete: null,
      classification_rules_preview: { winningRuleId: 'coffee', matches: [rule] },
      classification_rule_apply: {
        transactionId: 'tx', ruleId: 'coffee', categoryAccountId: 'entertainment', categoryName: 'Entertainment',
        labels: ['Recurring'], tags: ['#work'], transactionUpdatedAt: '2026-07-13T00:00:01Z',
      },
    }
    const invokeSpy = vi.fn()
    const client = createPlatformClient({ tauri: true, invoke: async <T>(command: AppCommand, args?: Record<string, unknown>) => { invokeSpy(command, args); return responses[command] as T } })
    const input = { id: 'coffee', householdId: 'family', name: 'Coffee', priority: 10, isEnabled: true, merchantContains: 'coffee', descriptionContains: null, categoryAccountId: 'entertainment', labels: ['Recurring'], tags: ['#work'] }

    await expect(client.listClassificationRules('family')).resolves.toEqual([rule])
    await expect(client.createClassificationRule(input)).resolves.toEqual(rule)
    await expect(client.updateClassificationRule({ ...input, isEnabled: false })).resolves.toMatchObject({ isEnabled: false })
    await expect(client.previewClassificationRules({ householdId: 'family', merchant: 'Tokyo Coffee', description: null })).resolves.toMatchObject({ winningRuleId: 'coffee' })
    await expect(client.applyClassificationRule({ householdId: 'family', transactionId: 'tx', ruleId: 'coffee', expectedTransactionUpdatedAt: rule.updatedAt })).resolves.toMatchObject({ transactionId: 'tx' })
    await expect(client.deleteClassificationRule('family', 'coffee')).resolves.toBeUndefined()
    expect(invokeSpy).toHaveBeenCalledWith('classification_rules_list', { householdId: 'family' })
    expect(invokeSpy).toHaveBeenCalledWith('classification_rule_delete', { householdId: 'family', ruleId: 'coffee' })
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

  it('preserves only the allowlisted retry code for an unavailable cloud file', async () => {
    const unavailable = createPlatformClient({
      tauri: true,
      invoke: async () => { throw 'CLOUD_FILE_UNAVAILABLE' },
    })
    const unrelated = createPlatformClient({
      tauri: true,
      invoke: async () => { throw 'CLOUD_FILE_UNAVAILABLE: /private/path' },
    })

    await expect(unavailable.readWatchedFile('family', 'folder', 'receipt.jpg')).rejects.toMatchObject({
      code: 'CLOUD_FILE_UNAVAILABLE',
      command: 'watched_folder_file_read',
      message: 'The cloud file is not available locally.',
    })
    await expect(unrelated.readWatchedFile('family', 'folder', 'receipt.jpg')).rejects.toMatchObject({
      code: 'COMMAND_FAILED',
      command: 'watched_folder_file_read',
    })
    await expect(unavailable.health()).rejects.toMatchObject({
      code: 'COMMAND_FAILED',
      command: 'app_health',
    })
  })

  it('rejects malformed financial IPC rows instead of trusting structural casts', async () => {
    const invoke: Invoke = async <T>(command: AppCommand) => {
      if (command === 'accounts_list') return [{ id: 'bank', name: 'Bank', accountKind: 'ROOT', accountSubtype: 'BANK', currency: 'JPY' }] as T
      return {
        summary: { runId: 'run', documentId: 'document', status: 'REVIEW_REQUIRED', recordCount: 1, candidateCount: 1, reusedExisting: false },
        source: { sourceType: 'MANUAL_UPLOAD', originalFilename: 'bank.csv', mediaType: 'text/csv', byteSize: 4, sha256: 'a'.repeat(64) },
        candidates: [{ id: 'candidate', accountId: null, occurredOn: '2026-07-12', postedOn: null, amountJpy: -1, direction: 'OUT', reviewStatus: 'READY', evidenceCount: 1, evidenceRoles: ['PRIMARY'], issues: [] }],
      } as T
    }
    const client = createPlatformClient({ tauri: true, invoke })

    await expect(client.listAccounts('family')).rejects.toMatchObject({ code: 'INVALID_RESPONSE', command: 'accounts_list' })
    await expect(client.previewImport('run')).rejects.toMatchObject({ code: 'INVALID_RESPONSE', command: 'import_preview' })
  })

  it('sanitizes receipt review DTOs and rejects malformed structured evidence', async () => {
    const candidate = {
      id: 'candidate', accountId: 'bank', occurredOn: '2026-07-12', postedOn: null, amountJpy: 1200, direction: 'OUT',
      descriptionRaw: null, merchantRaw: null, externalTransactionId: null, externalSource: null, externalFactHash: null,
      calculationTarget: true, suggestedTransactionType: null, institutionRaw: null, categoryMajorRaw: null, categoryMinorRaw: null, memoRaw: null,
      extractionConfidenceBps: 9000, normalizationConfidenceBps: 9000, attributionKind: 'HOUSEHOLD', attributedMemberId: null,
      audienceVisibility: 'SHARED', audienceMemberId: null, reviewStatus: 'READY', evidenceCount: 1, evidenceRoles: ['PRIMARY'], issues: [],
      receiptReview: {
        merchant: 'STORE', occurredOn: '2026-07-12', totalAmountJpy: 1200,
        items: [], taxes: [], couponAmountJpy: null, pointsUsedJpy: null, couponEvidence: [],
        pointsUsedEvidence: [{ amountJpy: null, confidenceBps: 4000, provenance: { lineNumber: 2, regionIndexes: [], method: 'TEXT_PATTERN' } }],
        subtotalJpy: null, changeJpy: null, paymentMethod: null, taxMode: null,
        reconciliation: { status: 'NO_ITEMS', itemTotalJpy: null, totalAmountJpy: 1200, deltaJpy: null },
        provenance: { sourceRecordId: 'record', sourceRowNumber: 1, documentPageNumber: null },
        extraction: { text: 'RAW OCR MUST NOT SURVIVE' },
      },
    }
    const response = (override: Record<string, unknown> = {}) => ({
      summary: { runId: 'run', documentId: 'doc', status: 'REVIEW_REQUIRED', recordCount: 1, candidateCount: 1, reusedExisting: false },
      source: { sourceType: 'MANUAL_UPLOAD', originalFilename: 'receipt.png', mediaType: 'image/png', byteSize: 1, sha256: 'a'.repeat(64), audienceVisibility: 'SHARED', audienceMemberId: null },
      candidates: [{ ...candidate, receiptReview: { ...candidate.receiptReview, ...override } }],
    })
    const client = createPlatformClient({ tauri: true, invoke: async <T>() => response() as T })
    const parsed = await client.previewImport('run')
    expect(parsed.candidates[0].receiptReview?.pointsUsedEvidence[0].amountJpy).toBeNull()
    expect(parsed.candidates[0].receiptReview).not.toHaveProperty('extraction')
    expect(JSON.stringify(parsed)).not.toContain('RAW OCR')

    for (const malformed of [
      { items: Array.from({ length: 101 }, () => ({})) },
      { reconciliation: { status: 'DELTA', itemTotalJpy: 1300, totalAmountJpy: 1200, deltaJpy: -100 } },
      { pointsUsedEvidence: [{ amountJpy: -1, confidenceBps: 4000, provenance: { lineNumber: 2, regionIndexes: [], method: 'TEXT_PATTERN' } }] },
    ]) {
      const invalid = createPlatformClient({ tauri: true, invoke: async <T>() => response(malformed) as T })
      await expect(invalid.previewImport('run')).rejects.toMatchObject({ code: 'INVALID_RESPONSE', command: 'import_preview' })
    }
  })

  it('strictly validates desktop relay DTOs and keeps bearer tokens outside IPC', async () => {
    const hash = 'a'.repeat(64)
    const status = {
      householdId: 'family', connectionState: 'CONNECTED', localDeviceId: 'device-local', remotePrincipalId: 'principal-remote', endpoint: 'https://relay.example',
      outbound: { pendingEnvelopeCount: 2, totalEnvelopeCount: 8, deliveryState: 'IDLE', latestAcceptedAt: null },
      inbound: [{ artifactId: 'artifact-in', digest: hash, createdAt: '2026-07-13T00:00:00Z', originDeviceId: 'device-other', state: 'AVAILABLE' }],
    }
    const prepared = { deliveryId: 'delivery-1', artifactId: 'artifact-out', digest: hash, householdId: 'family', originDeviceId: 'device-local', packageBytes: [1, 2, 3] }
    const invokeSpy = vi.fn()
    const invoke: Invoke = async <T>(command: AppCommand, args?: Record<string, unknown>) => {
      invokeSpy(command, args)
      return (command === 'relay_send_prepare' ? prepared : status) as T
    }
    const client = createPlatformClient({ tauri: true, invoke })
    const connection = { householdId: 'family', endpoint: 'https://relay.example', remotePrincipalId: 'principal-remote' }
    const acceptance = { householdId: 'family', deliveryId: 'delivery-1', artifactId: 'artifact-out', digest: hash, acceptedAt: '2026-07-13T00:01:00Z' }
    const artifacts = [{ artifactId: 'artifact-in', digest: hash, createdAt: '2026-07-13T00:00:00Z', originDeviceId: 'device-other' }]
    await expect(client.getDesktopRelayStatus('family')).resolves.toEqual(status)
    await expect(client.saveDesktopRelayConnection(connection)).resolves.toEqual(status)
    await expect(client.prepareDesktopRelaySend('family')).resolves.toEqual(prepared)
    await expect(client.acceptDesktopRelaySend(acceptance)).resolves.toEqual(status)
    await expect(client.registerDesktopRelayInbound({ householdId: 'family', artifacts })).resolves.toEqual(status)
    await expect(client.stageDesktopRelayInbound({ householdId: 'family', artifactId: 'artifact-in', packageBytes: [1, 2, 3] })).resolves.toEqual(status)
    await expect(client.disconnectDesktopRelay('family')).resolves.toEqual(status)
    expect(invokeSpy.mock.calls).not.toContainEqual(expect.arrayContaining([expect.objectContaining({ bearerToken: expect.anything() })]))
    expect(invokeSpy).toHaveBeenCalledWith('relay_connection_save', { input: connection })
    expect(invokeSpy).toHaveBeenCalledWith('relay_send_prepare', { householdId: 'family' })

    for (const invalid of [
      { ...status, connectionState: 'SYNCED' },
      { ...status, remotePrincipalId: null },
      { ...status, outbound: { ...status.outbound, pendingEnvelopeCount: 9 } },
      { ...status, inbound: [{ ...status.inbound[0], digest: 'bad' }] },
      { ...status, inbound: [status.inbound[0], status.inbound[0]] },
    ]) {
      const invalidClient = createPlatformClient({ tauri: true, invoke: async <T>() => invalid as T })
      await expect(invalidClient.getDesktopRelayStatus('family')).rejects.toMatchObject({ code: 'INVALID_RESPONSE', command: 'relay_status' })
    }
    const invalidDelivery = createPlatformClient({ tauri: true, invoke: async <T>() => ({ ...prepared, packageBytes: [256] }) as T })
    await expect(invalidDelivery.prepareDesktopRelaySend('family')).rejects.toMatchObject({ code: 'INVALID_RESPONSE', command: 'relay_send_prepare' })
  })

  it('validates import freshness as an atomic source-backed tuple', async () => {
    const base = { totalRuns: 1, discovered: 0, extracting: 0, reviewRequired: 0, posted: 1, failed: 0, rolledBack: 0, sourceDocuments: 1, sourceRecords: 1, pendingCandidates: 0, readyCandidates: 0, latestSuccessfulImportAt: '2026-07-12T12:00:00Z', latestSourceFilename: 'bank.csv', latestSourceType: 'MANUAL_UPLOAD', distinctSourceTypes: 1 }
    const validClient = createPlatformClient({ tauri: true, invoke: async <T>() => base as T })
    await expect(validClient.importSummary('family')).resolves.toEqual(base)

    for (const response of [
      { ...base, latestSuccessfulImportAt: '2026-07-12' },
      { ...base, latestSourceFilename: null },
      { ...base, latestSourceType: null },
      { ...base, distinctSourceTypes: -1 },
    ]) {
      const client = createPlatformClient({ tauri: true, invoke: async <T>() => response as T })
      await expect(client.importSummary('family')).rejects.toMatchObject({ code: 'INVALID_RESPONSE', command: 'import_summary' })
    }
  })

  it('strictly validates the bounded and ordered pending-review list', async () => {
    const older = { runId: 'run-b', documentId: 'document-b', status: 'REVIEW_REQUIRED', adapterId: null, adapterVersion: null, startedAt: '2026-07-12T12:00:00Z', sourceType: 'LOCAL_FOLDER', originalFilename: 'bank.csv', mediaType: 'text/csv', byteSize: 100, sourceModifiedAt: null, recordCount: 2, candidateCount: 1, completionState: 'CANDIDATE_REVIEW' }
    const newer = { ...older, runId: 'run-a', documentId: 'document-a', startedAt: '2026-07-13T12:00:00.000Z', adapterId: 'paypay-history-v1', adapterVersion: '1' }
    const valid = { householdId: 'family', runs: [newer, older] }
    const validClient = createPlatformClient({ tauri: true, invoke: async <T>() => valid as T })
    await expect(validClient.listPendingReviews('family')).resolves.toEqual(valid)

    const invalidResponses: readonly unknown[] = [
      { ...valid, householdId: '' },
      { ...valid, householdId: 'other-household' },
      { ...valid, runs: [{ ...newer, status: 'POSTED' }] },
      { ...valid, runs: [older, newer] },
      { ...valid, runs: [newer, { ...older, runId: newer.runId }] },
      { ...valid, runs: [newer, { ...older, documentId: newer.documentId }] },
      { ...valid, runs: [{ ...newer, startedAt: '2026-07-13' }] },
      { ...valid, runs: [{ ...newer, sourceModifiedAt: 'yesterday' }] },
      { ...valid, runs: [{ ...newer, adapterId: '' }] },
      { ...valid, runs: [{ ...newer, adapterId: undefined }] },
      { ...valid, runs: [{ ...newer, completionState: undefined }] },
      { ...valid, runs: [{ ...newer, completionState: 'SOURCE_READY' }] },
      { ...valid, runs: [{ ...newer, sourceModifiedAt: undefined }] },
      { ...valid, runs: [{ ...newer, originalFilename: '' }] },
      { ...valid, runs: [{ ...newer, byteSize: -1 }] },
      { ...valid, runs: Array.from({ length: 201 }, (_, index) => ({ ...newer, runId: `run-${index}`, documentId: `document-${index}` })) },
    ]
    for (const response of invalidResponses) {
      const client = createPlatformClient({ tauri: true, invoke: async <T>() => response as T })
      await expect(client.listPendingReviews('family')).rejects.toMatchObject({ code: 'INVALID_RESPONSE', command: 'pending_review_list' })
    }
  })

  it('validates pending-import handoff DTOs and keeps package paths outside IPC', async () => {
    const hash = 'a'.repeat(64)
    const exportSummary = { packageId: 'package-1', schemaVersion: 1, householdId: 'family', portableRunId: 'run-1', manifestSha256: hash, sourceSha256: hash, recordCount: 2, candidateCount: 1, statementCount: 0, byteSize: 4096 }
    const stage = {
      packageId: 'package-1', schemaVersion: 1, originInstallationId: 'installation-1', portableRunId: 'run-1',
      manifestSha256: hash, sourceFilename: 'bank.csv', sourceSha256: hash, recordCount: 2, candidateCount: 1, statementCount: 0,
      accountDependencies: [{ portableAccountId: 'portable-bank', name: 'Bank', accountKind: 'ASSET', accountSubtype: 'BANK', currency: 'JPY', institutionName: 'MUFG', maskedIdentifier: null }],
      memberDependencies: [{ portableMemberId: 'portable-member', displayName: 'Taro', role: 'OWNER' }],
      alreadyApplied: false, existingLocalRunId: null,
    }
    const applied = { packageId: 'package-1', localRunId: 'local-run', localDocumentId: 'local-document', recordCount: 2, candidateCount: 1, statementCount: 0, reusedExisting: false }
    const invokeSpy = vi.fn()
    const invoke: Invoke = async <T>(command: AppCommand, args?: Record<string, unknown>) => {
      invokeSpy(command, args)
      if (command === 'pending_import_export_to_picker') return exportSummary as T
      if (command === 'pending_import_pick_and_stage') return stage as T
      if (command === 'pending_import_apply') return applied as T
      return true as T
    }
    const client = createPlatformClient({ tauri: true, invoke })
    const request = { householdId: 'family', runId: 'run-1' }
    const mappings = { accounts: [{ portableAccountId: 'portable-bank', localAccountId: 'family-bank' }], members: [{ portableMemberId: 'portable-member', localMemberId: 'member-1' }] }
    await expect(client.exportPendingImport(request, 'long secure passphrase')).resolves.toEqual(exportSummary)
    await expect(client.pickAndStagePendingImport('family', 'long secure passphrase')).resolves.toEqual(stage)
    await expect(client.applyPendingImport('family', 'package-1', mappings)).resolves.toEqual(applied)
    await expect(client.discardPendingImport('package-1')).resolves.toBe(true)
    expect(invokeSpy).toHaveBeenCalledWith('pending_import_export_to_picker', { request, passphrase: 'long secure passphrase' })
    expect(invokeSpy).toHaveBeenCalledWith('pending_import_pick_and_stage', { householdId: 'family', passphrase: 'long secure passphrase' })
    expect(invokeSpy).toHaveBeenCalledWith('pending_import_apply', { householdId: 'family', packageId: 'package-1', mappings })
    expect(invokeSpy).toHaveBeenCalledWith('pending_import_discard', { packageId: 'package-1' })
    expect(JSON.stringify(invokeSpy.mock.calls)).not.toContain('packagePath')

    const invalidStages: readonly unknown[] = [
      { ...stage, schemaVersion: 2 },
      { ...stage, candidateCount: 0 },
      { ...stage, statementCount: 17 },
      { ...stage, manifestSha256: 'not-a-hash' },
      { ...stage, accountDependencies: [...stage.accountDependencies, stage.accountDependencies[0]] },
      { ...stage, memberDependencies: [...stage.memberDependencies, stage.memberDependencies[0]] },
      { ...stage, accountDependencies: [{ ...stage.accountDependencies[0], accountKind: 'UNKNOWN' }] },
      { ...stage, accountDependencies: [{ ...stage.accountDependencies[0], institutionName: undefined }] },
      { ...stage, alreadyApplied: true, existingLocalRunId: null },
    ]
    for (const response of invalidStages) {
      const invalidClient = createPlatformClient({ tauri: true, invoke: async <T>() => response as T })
      await expect(invalidClient.pickAndStagePendingImport('family', 'long secure passphrase')).rejects.toMatchObject({ code: 'INVALID_RESPONSE', command: 'pending_import_pick_and_stage' })
    }
  })

  it('rejects impossible card coverage dates and inconsistent financial projections', async () => {
    const statement = { statementId: 'statement', cardAccountId: 'card', cardAccountName: 'Card', paymentDueOn: '2026-07-27', statementAmountJpy: 600, paidAmountJpy: 0, outstandingAmountJpy: 600, projectedBankBalanceJpy: 400, shortfallJpy: 0, status: 'COVERED' }
    const bank = { bankAccountId: 'bank', bankAccountName: 'Bank', balanceAsOfJpy: 1000, projectedEndingBalanceJpy: 400, maxShortfallJpy: 0, statements: [statement] }
    const valid = { asOf: '2026-07-13', historyFrom: '2026-07-27', horizonThrough: '2026-08-27', horizonDays: 45, banks: [bank], unmappedStatements: [], missingDueStatements: [] }
    const todayOnly = { asOf: '2026-07-13', historyFrom: '2026-07-13', horizonThrough: '2026-07-13', horizonDays: 0, banks: [], unmappedStatements: [], missingDueStatements: [] }
    const zeroHorizonClient = createPlatformClient({ tauri: true, invoke: async <T>() => todayOnly as T })
    await expect(zeroHorizonClient.queryCardSettlementBalanceCoverage({ householdId: 'family', asOf: '2026-07-13', horizonDays: 0 })).resolves.toEqual(todayOnly)
    const invalidResponses: readonly unknown[] = [
      { ...valid, asOf: '2026-02-30' },
      { ...valid, horizonDays: 366 },
      { ...valid, banks: [bank, bank] },
      { ...valid, banks: [{ ...bank, statements: [{ ...statement, statementId: 'later', paymentDueOn: '2026-08-01' }, { ...statement, statementId: 'earlier' }], projectedEndingBalanceJpy: 400 }] },
      { ...valid, banks: [{ ...bank, statements: [{ ...statement, outstandingAmountJpy: 599 }] }] },
      { ...valid, banks: [{ ...bank, statements: [{ ...statement, projectedBankBalanceJpy: -1, shortfallJpy: 0 }], projectedEndingBalanceJpy: -1 }] },
      { ...valid, banks: [{ ...bank, projectedEndingBalanceJpy: 401 }] },
      { ...valid, banks: [{ ...bank, maxShortfallJpy: 1 }] },
      { ...valid, missingDueStatements: [{ statementId: 'missing', cardAccountId: 'card', cardAccountName: 'Card', statementAmountJpy: 100, paidAmountJpy: 0, outstandingAmountJpy: 100, mappingConfigured: 'yes' }] },
    ]
    for (const response of invalidResponses) {
      const client = createPlatformClient({ tauri: true, invoke: async <T>() => response as T })
      await expect(client.queryCardSettlementBalanceCoverage({ householdId: 'family', asOf: '2026-07-13' })).rejects.toMatchObject({ code: 'INVALID_RESPONSE', command: 'card_settlement_balance_coverage_query' })
    }
  })

  it('rejects invalid member and account-ownership response contracts', async () => {
    const invoke: Invoke = async <T>(command: AppCommand) => {
      if (command === 'household_members_list') return [{ id: 'member', householdId: 'family', displayName: 'Taro', relationshipLabel: null, status: 'ADMIN', sortOrder: 0, createdAt: 'x', updatedAt: 'x' }] as T
      return [{ id: 'bank', name: 'Bank', accountKind: 'ASSET', accountSubtype: 'BANK', currency: 'JPY', ownershipKind: 'HOUSEHOLD', ownerMemberId: 'member', ownerMemberName: 'Taro', visibility: 'PERSONAL' }] as T
    }
    const client = createPlatformClient({ tauri: true, invoke })

    await expect(client.listHouseholdMembers('family')).rejects.toMatchObject({ code: 'INVALID_RESPONSE', command: 'household_members_list' })
    await expect(client.listAccounts('family')).rejects.toMatchObject({ code: 'INVALID_RESPONSE', command: 'accounts_list' })
  })

  it('rejects half-valid attribution and audience tuples at every IPC boundary', async () => {
    const invoke: Invoke = async <T>(command: AppCommand) => {
      if (command === 'transactions_query') return { items: [{ id: 'tx', occurredOn: '2026-07-01', postedOn: null, transactionType: 'EXPENSE', payee: null, description: null, amountJpy: 1, status: 'POSTED', debitAccountId: null, debitAccountName: null, creditAccountId: null, creditAccountName: null, categoryAccountId: null, categoryName: null, attributionKind: 'HOUSEHOLD', attributedMemberId: 'member', attributedMemberName: 'Taro', audienceVisibility: 'SHARED', audienceMemberId: null, audienceMemberName: null }], page: 1, pageSize: 20, totalItems: 1, totalPages: 1 } as T
      if (command === 'import_preview') return { summary: { runId: 'run', documentId: 'doc', status: 'REVIEW_REQUIRED', recordCount: 1, candidateCount: 1, reusedExisting: false }, source: { sourceType: 'MANUAL_UPLOAD', originalFilename: 'x.csv', mediaType: 'text/csv', byteSize: 1, sha256: 'hash', audienceVisibility: 'SHARED', audienceMemberId: null }, candidates: [{ id: 'candidate', accountId: null, occurredOn: '2026-07-01', postedOn: null, amountJpy: 1, direction: 'OUT', descriptionRaw: null, merchantRaw: null, externalTransactionId: null, extractionConfidenceBps: null, normalizationConfidenceBps: null, attributionKind: 'MEMBER', attributedMemberId: null, audienceVisibility: 'SHARED', audienceMemberId: null, reviewStatus: 'READY', evidenceCount: 0, evidenceRoles: [], issues: [] }] } as T
      return { id: 'doc', householdId: 'family', importRunId: 'run', sourceType: 'MANUAL_UPLOAD', originalFilename: 'x.csv', mediaType: 'text/csv', byteSize: 1, sha256: 'hash', sourceModifiedAt: null, importedAt: '2026-07-01', adapterId: null, adapterVersion: null, recordCount: 1, audienceVisibility: 'PERSONAL', audienceMemberId: null, audienceMemberName: null } as T
    }
    const client = createPlatformClient({ tauri: true, invoke })

    await expect(client.queryTransactions({ householdId: 'family', attributionScope: { kind: 'ALL' }, accountingBasis: 'ACCRUAL', page: 1, pageSize: 20 })).rejects.toMatchObject({ code: 'INVALID_RESPONSE', command: 'transactions_query' })
    await expect(client.previewImport('run')).rejects.toMatchObject({ code: 'INVALID_RESPONSE', command: 'import_preview' })
    await expect(client.getSourceDocument('family', 'doc')).rejects.toMatchObject({ code: 'INVALID_RESPONSE', command: 'source_document_get' })
  })
})
