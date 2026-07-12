import { describe, expect, it, vi } from 'vitest'

import { createPlatformClient, isTauriRuntime, PlatformIpcError } from './client'
import type { AppCommand, Invoke, PostingDecisionDto, StartImportDto } from './types'

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
    await expect(client.listAccounts('family')).resolves.toEqual([])
    await expect(client.startImport({} as StartImportDto, new Uint8Array())).rejects.toMatchObject({ command: 'import_start' })
    await expect(client.previewImport('run-1')).rejects.toMatchObject({ command: 'import_preview' })
    await expect(client.commitImport('run-1', [])).rejects.toMatchObject({ command: 'import_commit' })
    await expect(client.rollbackImport('run-1')).rejects.toMatchObject({ command: 'import_rollback' })
    await expect(client.createBackup('/tmp/family.kakeflow-backup', 'long secure passphrase')).rejects.toMatchObject({ command: 'backup_create' })
    await expect(client.stageBackupRestore('/tmp/family.kakeflow-backup', 'long secure passphrase')).rejects.toMatchObject({ command: 'backup_restore_stage' })
    await expect(client.restartForRestore()).rejects.toMatchObject({ command: 'app_restart_for_restore' })
    await expect(client.extractDocument(new Uint8Array([1]), 'application/pdf')).rejects.toMatchObject({ command: 'document_extract' })
    await expect(client.ocrDocument(new Uint8Array([1]), 'image/png')).rejects.toMatchObject({ command: 'document_ocr' })
    await expect(client.listCardSettlements('family')).resolves.toEqual([])
    await expect(client.confirmCardMatch('family', 'statement', 'payment')).rejects.toMatchObject({ command: 'card_match_confirm' })
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
      accounts_list: [{ id: 'family-bank', name: 'Bank', accountKind: 'ASSET', accountSubtype: 'BANK', currency: 'JPY' }],
      dashboard_query: {
        month: '2026-07', accountingBasis: 'ACCRUAL', incomeJpy: 650000, expenseJpy: 250000, savingsJpy: 400000, postedTransactionCount: 10,
        netWorthAsOf: '2026-07-31', assetsJpy: 8_500_000, liabilitiesJpy: 250_000, netWorthJpy: 8_250_000,
        accrualTrend: [{ month: '2026-07', incomeJpy: 650000, expenseJpy: 250000 }],
        expenseCategories: [{ accountId: 'family-groceries', name: 'Groceries', amountJpy: 250000 }],
      },
      transactions_query: { items: [], page: 1, pageSize: 20, totalItems: 0, totalPages: 0 },
      import_summary: { totalRuns: 0, discovered: 0, extracting: 0, reviewRequired: 0, posted: 0, failed: 0, rolledBack: 0, sourceDocuments: 0, sourceRecords: 0, pendingCandidates: 0, readyCandidates: 0 },
      import_start: { runId: 'run-1', documentId: 'document-1', status: 'REVIEW_REQUIRED', recordCount: 1, candidateCount: 1, reusedExisting: false },
      import_preview: {
        summary: { runId: 'run-1', documentId: 'document-1', status: 'REVIEW_REQUIRED', recordCount: 1, candidateCount: 1, reusedExisting: false },
        source: { sourceType: 'MANUAL_UPLOAD', originalFilename: 'bank.csv', mediaType: 'text/csv', byteSize: 3, sha256: 'abc123' },
        candidates: [{
          id: 'candidate-1', accountId: 'family-bank', occurredOn: '2026-07-12', postedOn: null,
          amountJpy: 1200, direction: 'OUT', descriptionRaw: 'STORE', merchantRaw: 'STORE',
          externalTransactionId: null, extractionConfidenceBps: 10000, normalizationConfidenceBps: 10000,
          reviewStatus: 'READY', evidenceCount: 1, evidenceRoles: ['PRIMARY'], issues: [],
        }],
      },
      import_commit: { runId: 'run-1', postedCount: 1 },
      import_rollback: null,
      backup_create: { formatVersion: 2, entryCount: 4, plaintextBytes: 4096 },
      backup_restore_stage: { formatVersion: 2, entryCount: 4, plaintextBytes: 4096 },
      app_restart_for_restore: null,
      document_extract: { method: 'EMBEDDED_TEXT', text: 'STORE TOTAL 1200', confidenceBps: 9000, issues: [] },
      document_ocr: { method: 'OCR', text: 'STORE TOTAL 1200', confidenceBps: 7800, issues: ['LOW_CONFIDENCE'] },
      cards_list: [{
        id: 'statement-1', cardAccountId: 'family-rakuten-card', cardName: 'Rakuten Card', maskedIdentifier: null,
        periodStart: '2026-07-01', periodEnd: '2026-07-31', paymentDueOn: null,
        statementAmountJpy: 1000, detailAmountJpy: 1000, lineCount: 1,
        paymentId: 'payment-1', bankTransactionId: 'transaction-1', paymentAmountJpy: 1000,
        paymentOn: '2026-08-10', matchScoreBps: 8000, reconciliationStatus: 'POSSIBLE_MATCH',
      }],
      card_match_confirm: { statementId: 'statement-1', paymentId: 'payment-1', reconciliationStatus: 'FULLY_RECONCILED' },
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
      records: [{ id: 'record-1', rowNumber: 1, recordHash: 'record-hash', payloadJson: '{}' }],
      candidates: [{
        id: 'candidate-1', accountId: 'family-bank', occurredOn: '2026-07-12', postedOn: null,
        amountJpy: 1200, direction: 'OUT', descriptionRaw: 'STORE', merchantRaw: 'STORE',
        externalTransactionId: null, extractionConfidenceBps: 10000, normalizationConfidenceBps: 10000,
        reviewStatus: 'READY', evidence: [{ sourceRecordId: 'record-1', role: 'PRIMARY' }],
      }],
      cardStatements: [],
    }
    const decisions: readonly PostingDecisionDto[] = [{
      candidateId: 'candidate-1', transactionId: 'transaction-1', transactionType: 'EXPENSE',
      payee: 'STORE', description: null,
      entries: [
        { id: 'entry-1', accountId: 'family-expense-other', side: 'DEBIT', amountJpy: 1200 },
        { id: 'entry-2', accountId: 'family-bank', side: 'CREDIT', amountJpy: 1200 },
      ],
    }]

    await expect(client.bootstrap()).resolves.toEqual(responses.app_bootstrap)
    await expect(client.health()).resolves.toEqual(responses.app_health)
    await expect(client.status()).resolves.toEqual(responses.app_status)
    await expect(client.listHouseholds()).resolves.toEqual(responses.households_list)
    await expect(client.createHousehold({ id: 'family', name: 'Family' })).resolves.toEqual(responses.household_create)
    await expect(client.listAccounts('family')).resolves.toEqual(responses.accounts_list)
    await expect(client.queryDashboard({ householdId: 'family', month: '2026-07', accountingBasis: 'ACCRUAL' })).resolves.toEqual(responses.dashboard_query)
    await expect(client.queryTransactions({ householdId: 'family', accountingBasis: 'ACCRUAL', page: 1, pageSize: 20 })).resolves.toEqual(responses.transactions_query)
    await expect(client.importSummary('family')).resolves.toEqual(responses.import_summary)
    await expect(client.startImport(importRequest, new Uint8Array([1, 2, 3]))).resolves.toEqual(responses.import_start)
    await expect(client.previewImport('run-1')).resolves.toEqual(responses.import_preview)
    await expect(client.commitImport('run-1', decisions)).resolves.toEqual(responses.import_commit)
    await expect(client.rollbackImport('run-1')).resolves.toBeUndefined()
    await expect(client.createBackup('/tmp/family.kakeflow-backup', 'long secure passphrase')).resolves.toEqual(responses.backup_create)
    await expect(client.stageBackupRestore('/tmp/family.kakeflow-backup', 'long secure passphrase')).resolves.toEqual(responses.backup_restore_stage)
    await expect(client.restartForRestore()).resolves.toBeUndefined()
    await expect(client.extractDocument(new Uint8Array([37, 80, 68, 70]), 'application/pdf')).resolves.toEqual(responses.document_extract)
    await expect(client.ocrDocument(new Uint8Array([1, 2, 3]), 'image/png')).resolves.toEqual(responses.document_ocr)
    await expect(client.listCardSettlements('family')).resolves.toEqual(responses.cards_list)
    await expect(client.confirmCardMatch('family', 'statement-1', 'payment-1')).resolves.toEqual(responses.card_match_confirm)
    expect(invokeSpy).toHaveBeenCalledWith('household_create', { input: { id: 'family', name: 'Family' } })
    expect(invokeSpy).toHaveBeenCalledWith('accounts_list', { householdId: 'family' })
    expect(invokeSpy).toHaveBeenCalledWith('import_start', { request: { import: importRequest, fileBytes: [1, 2, 3] } })
    expect(invokeSpy).toHaveBeenCalledWith('import_preview', { runId: 'run-1' })
    expect(invokeSpy).toHaveBeenCalledWith('import_commit', { runId: 'run-1', decisions })
    expect(invokeSpy).toHaveBeenCalledWith('import_rollback', { runId: 'run-1' })
    expect(invokeSpy).toHaveBeenCalledWith('backup_create', { archivePath: '/tmp/family.kakeflow-backup', passphrase: 'long secure passphrase' })
    expect(invokeSpy).toHaveBeenCalledWith('backup_restore_stage', { archivePath: '/tmp/family.kakeflow-backup', passphrase: 'long secure passphrase' })
    expect(invokeSpy).toHaveBeenCalledWith('app_restart_for_restore', undefined)
    expect(invokeSpy).toHaveBeenCalledWith('document_extract', { fileBytes: [37, 80, 68, 70], mediaType: 'application/pdf' })
    expect(invokeSpy).toHaveBeenCalledWith('document_ocr', { fileBytes: [1, 2, 3], mediaType: 'image/png' })
    expect(invokeSpy).toHaveBeenCalledWith('cards_list', { householdId: 'family' })
    expect(invokeSpy).toHaveBeenCalledWith('card_match_confirm', { householdId: 'family', statementId: 'statement-1', paymentId: 'payment-1' })
    expect(invokeSpy).toHaveBeenCalledTimes(20)
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
})
