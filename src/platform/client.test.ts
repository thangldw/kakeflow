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
    await expect(client.selectWatchedFolder('family', 'Inbox')).rejects.toMatchObject({ command: 'watched_folder_select' })
    await expect(client.removeWatchedFolder('family', 'folder')).rejects.toMatchObject({ command: 'watched_folder_remove' })
    await expect(client.scanWatchedFolder('family', 'folder')).rejects.toMatchObject({ command: 'watched_folder_scan' })
    await expect(client.readWatchedFile('family', 'folder', 'bank.csv')).rejects.toMatchObject({ command: 'watched_folder_file_read' })
    await expect(client.listWatchedFileInbox('family')).resolves.toEqual([])
    await expect(client.countWatchedFileInbox('family')).resolves.toEqual({ discovered: 0, processing: 0, ready: 0, needsMapping: 0, staged: 0, failed: 0, ignored: 0, removed: 0, actionable: 0, total: 0 })
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
    await expect(client.updateCardStatementDueDate({ householdId: 'family', statementId: 'statement', paymentDueOn: null })).rejects.toMatchObject({ command: 'card_statement_due_date_update' })
    await expect(client.listCardSettlementBankMappings('family')).resolves.toEqual([])
    await expect(client.upsertCardSettlementBankMapping({} as never)).rejects.toMatchObject({ command: 'card_settlement_bank_mapping_upsert' })
    await expect(client.queryCardSettlementBalanceCoverage({ householdId: 'family', asOf: '2026-07-13' })).resolves.toMatchObject({ horizonDays: 45, banks: [] })
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
      watched_folders_list: [{ id: 'folder', householdId: 'family', label: 'Inbox', displayName: 'KakeFlow', isEnabled: true, createdAt: '2026-07-12T00:00:00Z' }],
      watched_folder_select: { id: 'folder', householdId: 'family', label: 'Inbox', displayName: 'KakeFlow', isEnabled: true, createdAt: '2026-07-12T00:00:00Z' },
      watched_folder_remove: null,
      watched_folder_scan: { watchedFolderId: 'folder', files: [{ relativePath: 'bank.csv', fileName: 'bank.csv', mediaType: 'text/csv', byteSize: 3, modifiedUnixMs: 1000 }] },
      watched_folder_file_read: { relativePath: 'bank.csv', fileName: 'bank.csv', mediaType: 'text/csv', byteSize: 3, modifiedUnixMs: 1000, fileBytes: [1, 2, 3] },
      watched_file_inbox_list: [{ id: 'a'.repeat(64), householdId: 'family', watchedFolderId: 'folder', watchedFolderLabel: 'Inbox', relativePath: 'bank.csv', fileName: 'bank.csv', mediaType: 'text/csv', byteSize: 3, modifiedUnixMs: 1000, fingerprint: 'b'.repeat(64), state: 'READY', attemptCount: 1, importRunId: null, lastErrorCode: null, discoveredAt: '2026-07-12T00:00:00Z', updatedAt: '2026-07-12T00:01:00Z' }],
      watched_file_inbox_counts: { discovered: 0, processing: 0, ready: 1, needsMapping: 0, staged: 0, failed: 0, ignored: 0, removed: 0, actionable: 1, total: 1 },
      watched_file_inbox_claim: { leaseToken: 'c'.repeat(64), leaseExpiresAt: '2026-07-12T00:06:00Z', items: [{ id: 'a'.repeat(64), householdId: 'family', watchedFolderId: 'folder', watchedFolderLabel: 'Inbox', relativePath: 'bank.csv', fileName: 'bank.csv', mediaType: 'text/csv', byteSize: 3, modifiedUnixMs: 1000, fingerprint: 'b'.repeat(64), state: 'PROCESSING', attemptCount: 2, importRunId: null, lastErrorCode: null, discoveredAt: '2026-07-12T00:00:00Z', updatedAt: '2026-07-12T00:01:00Z' }] },
      watched_file_inbox_mark_ready: { id: 'a'.repeat(64), householdId: 'family', watchedFolderId: 'folder', watchedFolderLabel: 'Inbox', relativePath: 'bank.csv', fileName: 'bank.csv', mediaType: 'text/csv', byteSize: 3, modifiedUnixMs: 1000, fingerprint: 'b'.repeat(64), state: 'READY', attemptCount: 2, importRunId: null, lastErrorCode: null, discoveredAt: '2026-07-12T00:00:00Z', updatedAt: '2026-07-12T00:02:00Z' },
      watched_file_inbox_mark_needs_mapping: { id: 'a'.repeat(64), householdId: 'family', watchedFolderId: 'folder', watchedFolderLabel: 'Inbox', relativePath: 'bank.csv', fileName: 'bank.csv', mediaType: 'text/csv', byteSize: 3, modifiedUnixMs: 1000, fingerprint: 'b'.repeat(64), state: 'NEEDS_MAPPING', attemptCount: 2, importRunId: null, lastErrorCode: null, discoveredAt: '2026-07-12T00:00:00Z', updatedAt: '2026-07-12T00:02:00Z' },
      watched_file_inbox_mark_failed: { id: 'a'.repeat(64), householdId: 'family', watchedFolderId: 'folder', watchedFolderLabel: 'Inbox', relativePath: 'bank.csv', fileName: 'bank.csv', mediaType: 'text/csv', byteSize: 3, modifiedUnixMs: 1000, fingerprint: 'b'.repeat(64), state: 'FAILED', attemptCount: 2, importRunId: null, lastErrorCode: 'PREVIEW_FAILED', discoveredAt: '2026-07-12T00:00:00Z', updatedAt: '2026-07-12T00:02:00Z' },
      watched_file_inbox_mark_staged: { id: 'a'.repeat(64), householdId: 'family', watchedFolderId: 'folder', watchedFolderLabel: 'Inbox', relativePath: 'bank.csv', fileName: 'bank.csv', mediaType: 'text/csv', byteSize: 3, modifiedUnixMs: 1000, fingerprint: 'b'.repeat(64), state: 'STAGED', attemptCount: 2, importRunId: 'run-1', lastErrorCode: null, discoveredAt: '2026-07-12T00:00:00Z', updatedAt: '2026-07-12T00:02:00Z' },
      watched_file_inbox_ignore: { id: 'a'.repeat(64), householdId: 'family', watchedFolderId: 'folder', watchedFolderLabel: 'Inbox', relativePath: 'bank.csv', fileName: 'bank.csv', mediaType: 'text/csv', byteSize: 3, modifiedUnixMs: 1000, fingerprint: 'b'.repeat(64), state: 'IGNORED', attemptCount: 1, importRunId: null, lastErrorCode: null, discoveredAt: '2026-07-12T00:00:00Z', updatedAt: '2026-07-12T00:02:00Z' },
      watched_file_inbox_retry: { id: 'a'.repeat(64), householdId: 'family', watchedFolderId: 'folder', watchedFolderLabel: 'Inbox', relativePath: 'bank.csv', fileName: 'bank.csv', mediaType: 'text/csv', byteSize: 3, modifiedUnixMs: 1000, fingerprint: 'b'.repeat(64), state: 'DISCOVERED', attemptCount: 1, importRunId: null, lastErrorCode: null, discoveredAt: '2026-07-12T00:00:00Z', updatedAt: '2026-07-12T00:02:00Z' },
      import_summary: { totalRuns: 0, discovered: 0, extracting: 0, reviewRequired: 0, posted: 0, failed: 0, rolledBack: 0, sourceDocuments: 0, sourceRecords: 0, pendingCandidates: 0, readyCandidates: 0 },
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
    const dueDateInput = { householdId: 'family', statementId: 'statement-1', paymentDueOn: '2026-08-27' }
    await expect(client.updateCardStatementDueDate(dueDateInput)).resolves.toEqual(responses.card_statement_due_date_update)
    const mappingInput = { householdId: 'family', cardAccountId: 'family-rakuten-card', bankAccountId: 'family-bank' }
    await expect(client.listCardSettlementBankMappings('family')).resolves.toEqual(responses.card_settlement_bank_mappings_list)
    await expect(client.upsertCardSettlementBankMapping(mappingInput)).resolves.toEqual(responses.card_settlement_bank_mapping_upsert)
    await expect(client.deleteCardSettlementBankMapping({ householdId: 'family', cardAccountId: 'family-rakuten-card' })).resolves.toBeUndefined()
    const coverageRequest = { householdId: 'family', asOf: '2026-07-13', horizonDays: 45 }
    await expect(client.queryCardSettlementBalanceCoverage(coverageRequest)).resolves.toEqual(responses.card_settlement_balance_coverage_query)
    expect(invokeSpy).toHaveBeenCalledWith('household_create', { input: { id: 'family', name: 'Family' } })
    expect(invokeSpy).toHaveBeenCalledWith('household_members_list', { householdId: 'family' })
    expect(invokeSpy).toHaveBeenCalledWith('household_member_create', { input: memberCreate })
    expect(invokeSpy).toHaveBeenCalledWith('household_member_update', { input: memberUpdate })
    expect(invokeSpy).toHaveBeenCalledWith('household_member_archive', { householdId: 'family', memberId: 'member-1' })
    expect(invokeSpy).toHaveBeenCalledWith('accounts_list', { householdId: 'family' })
    expect(invokeSpy).toHaveBeenCalledWith('import_start', { request: { import: importRequest, fileBytes: [1, 2, 3] } })
    expect(invokeSpy).toHaveBeenCalledWith('transaction_manual_create', { input: manualInput })
    expect(invokeSpy).toHaveBeenCalledWith('transaction_detail_get', { householdId: 'family', transactionId: 'tx-manual' })
    expect(invokeSpy).toHaveBeenCalledWith('transaction_update', { input: updateInput })
    expect(invokeSpy).toHaveBeenCalledWith('source_document_get', { householdId: 'family', sourceDocumentId: 'document-1' })
    expect(invokeSpy).toHaveBeenCalledWith('source_document_audience_update', { input: sourceAudience })
    expect(invokeSpy).toHaveBeenCalledWith('source_document_records_query', { request: sourcePage })
    expect(invokeSpy).toHaveBeenCalledWith('transaction_source_records_list', { householdId: 'family', transactionId: 'tx-manual' })
    expect(invokeSpy).toHaveBeenCalledWith('watched_folders_list', { householdId: 'family' })
    expect(invokeSpy).toHaveBeenCalledWith('watched_folder_select', { householdId: 'family', label: 'Inbox' })
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
    expect(invokeSpy).toHaveBeenCalledWith('card_statement_due_date_update', { input: dueDateInput })
    expect(invokeSpy).toHaveBeenCalledWith('card_settlement_bank_mappings_list', { householdId: 'family' })
    expect(invokeSpy).toHaveBeenCalledWith('card_settlement_bank_mapping_upsert', { input: mappingInput })
    expect(invokeSpy).toHaveBeenCalledWith('card_settlement_bank_mapping_delete', { input: { householdId: 'family', cardAccountId: 'family-rakuten-card' } })
    expect(invokeSpy).toHaveBeenCalledWith('card_settlement_balance_coverage_query', { request: coverageRequest })
    expect(invokeSpy).toHaveBeenCalledWith('transaction_metadata_bulk_update', { input: metadataInput })
    expect(invokeSpy).toHaveBeenCalledTimes(54)
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

  it('loads and persists strictly validated household dashboard preferences', async () => {
    const saved = {
      householdId: 'family', template: 'CASH_FLOW', theme: 'DARK', density: 'COMPACT',
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
    const input = { householdId: 'family', template: 'CASH_FLOW' as const, theme: 'DARK' as const, density: 'COMPACT' as const }

    await expect(client.getDashboardPreferences('family')).resolves.toEqual(saved)
    await expect(client.upsertDashboardPreferences(input)).resolves.toEqual(saved)
    expect(invokeSpy).toHaveBeenCalledWith('dashboard_preferences_get', { householdId: 'family' })
    expect(invokeSpy).toHaveBeenCalledWith('dashboard_preferences_upsert', { input })

    const invalidResponses = [
      { ...saved, template: 'CUSTOM' },
      { ...saved, theme: 'AMOLED' },
      { ...saved, density: 'TINY' },
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
