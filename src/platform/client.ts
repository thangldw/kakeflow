import { invoke as tauriInvoke } from '@tauri-apps/api/core'

import type {
  AppBootstrapDto,
  AppCommand,
  AppHealthDto,
  AppStatusDto,
  DashboardTemplateLayoutsDto,
  DatabaseStatusDto,
  HouseholdDto,
  Invoke,
  PlatformClient,
  GoogleDriveAvailabilityDto,
  GmailAvailabilityDto,
  ConnectorSummaryPageDto,
} from './types'
import { parseHouseholds, parseHousehold, parseHouseholdMembers, parseHouseholdMember, parseLocalSyncFoundationStatus, parseDesktopRelayStatus, parseDesktopRelayPreparedDelivery, parseFamilyDeliveryStatus, parseFamilyDeliveryScheduleStatus, parseMobileCaptureBackgroundStatus, parseFamilyPreparedArtifacts, parseFamilyEnvelopeIdentity, parseSealedFamilyEnvelope, parsePreparedFamilyEnvelope, parseNullablePreparedFamilyEnvelope, parseOpenedFamilyEnvelope, parseFamilySnapshotReview, parseNullableFamilySnapshotReview, parseMobileCaptureInboxItem, parseMobileCaptureInboxItems, parseMobileCaptureStatus, parseMobileCaptureImagePreview, parseMobileCaptureOcrResult, parseMobileCapturePromoteResult, parseNullableString, parseNullableEvidenceBundleSummary, parseNullablePendingImportExportSummary, parseNullablePendingImportStage, parsePendingImportApplySummary, parseBoolean, parseNullableChangePackageReview, parseChangePackageReview, parseAccounts, parseAccount, parseImportSummaryDto, parsePendingReviewList, parseImportPreview, parseImportBindingExpectation, parseCommitSummary, parseNullableBackupSummary, parseExtractedDocument, parseCardSettlement, parseCardSettlements, parseCardMatchConfirmation, parseCardSettlementBankMapping, parseCardSettlementBankMappings, parseCardSettlementBalanceCoverage, parseVoid, parseReceiptMatchSuggestions, parseReceiptMatchConfirmation, parseBudget, parseBudgets, parseNullableMonthlyReviewMemo, parseSavingsGoal, parseSavingsGoals, parseClassificationRule, parseClassificationRules, parseClassificationPreview, parseAppliedClassification, parseNullableLastClassificationApplication, parseDashboard, parseDashboardPreferences, parseTransactionPage, parseTransactionRow, parseTransactionDetail, parseBulkUpdateTransactionMetadataResult, parseSourceDocument, parseSourceRecords, parseSourceRecordPage, connectorListArgs, connectorBindingListArgs, connectorRefreshOneInput, parseConnectorRefreshProgress, parseNullableActiveConnectorRefreshProgress, parseConnectorRefreshBatch, parseConnectorBindings, parseUpsertConnectorBindingInput, parseUpsertConnectorBindingResponse, parseDeleteConnectorBindingInput, asConnectorBindingIdentifier, parseConnectorSummaryPage, parseWatchedFolders, parseNullableWatchedFolder, parseWatchedFolderScan, parseWatchedFile, parseWatchedFileInboxItem, parseWatchedFileInboxItems, parseWatchedFileInboxCounts, parseWatchedFileInboxClaim, parseGoogleDriveAvailability, parseGoogleDriveConnection, parseGoogleDriveConnections, parseGoogleDriveSchedule, parseGoogleDriveInboxItem, parseGoogleDriveInboxItems, parseGoogleDriveInboxFile, parseGoogleDriveInboxClaim, parseGmailAvailability, parseGmailConnection, parseGmailConnections, parseGmailLabels, parseGmailSchedule, parseGmailInboxItem, parseGmailInboxItems, parseGmailInboxFile, parseGmailInboxClaim, parseImportSummary, parseBootstrap, parseHealth, parseStatus, parseTransferPairDecisions, parseEnvelopeCardActivity } from './parsers'

export type PlatformIpcErrorCode = 'COMMAND_FAILED' | 'INVALID_RESPONSE' | 'CLOUD_FILE_UNAVAILABLE'

/** A deliberately sanitized error safe to show or log in the webview. */
export class PlatformIpcError extends Error {
  readonly code: PlatformIpcErrorCode
  readonly command: AppCommand

  constructor(code: PlatformIpcErrorCode, command: AppCommand) {
    super(code === 'INVALID_RESPONSE'
      ? 'The desktop service returned an invalid response.'
      : code === 'CLOUD_FILE_UNAVAILABLE'
        ? 'The cloud file is not available locally.'
        : 'The desktop service is unavailable.')
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

const WEB_DEMO_HOUSEHOLD: HouseholdDto = Object.freeze({
  id: 'demo-tanaka-family',
  name: '田中家',
  baseCurrency: 'JPY',
  createdAt: '2025-07-31T00:00:00.000Z',
})

const WEB_GOOGLE_DRIVE_AVAILABILITY: GoogleDriveAvailabilityDto = Object.freeze({
  available: false,
  authorizationMode: 'SYSTEM_BROWSER_LOOPBACK',
  scopeProfile: 'DRIVE_READONLY',
  unavailableReason: 'UNSUPPORTED_RUNTIME',
})
const WEB_GMAIL_AVAILABILITY: GmailAvailabilityDto = Object.freeze({
  available: false, authorizationMode: 'SYSTEM_BROWSER_LOOPBACK', scopeProfile: 'GMAIL_READONLY', unavailableReason: 'CLIENT_ID_NOT_COMPILED',
})
const WEB_CONNECTOR_SUMMARY_PAGE: ConnectorSummaryPageDto = Object.freeze({
  schemaVersion: 1,
  items: Object.freeze([Object.freeze({
    schemaVersion: 1,
    connectorKind: 'MANUAL_IMPORT',
    connectionKey: 'manual-import',
    displayLabel: 'Manual import',
    availability: 'AVAILABLE',
    lifecycle: 'CONNECTED',
    health: 'MANUAL',
    capabilities: Object.freeze(['IMPORT_FILE', 'ACCOUNT_BINDING'] as const),
    lastAttemptAt: null,
    lastSuccessAt: null,
    freshnessDeadlineAt: null,
    nextDueAt: null,
    pendingReviewCount: 0,
    consecutiveFailures: 0,
    lastErrorCode: null,
    bindingSummary: null,
    configurationDestination: 'IMPORT_INBOX',
  })]),
  nextCursor: null,
})
const WEB_EMPTY_CONNECTOR_SUMMARY_PAGE: ConnectorSummaryPageDto = Object.freeze({
  schemaVersion: 1,
  items: Object.freeze([]),
  nextCursor: null,
})

const EMPTY_DASHBOARD_ANALYTICS = Object.freeze({
  netWorthAsOf: '1970-01-31', assetsJpy: 0, liabilitiesJpy: 0, netWorthJpy: 0,
  accrualTrend: Object.freeze([]), cashFlowTrend: Object.freeze([]), expenseCategories: Object.freeze([]),
})

function defaultDashboardTemplateLayouts(): DashboardTemplateLayoutsDto {
  return {
    FINANCIAL_OVERVIEW: { widgetOrder: ['TREND', 'SPENDING', 'RECENT', 'CARDS'], hiddenWidgets: [] },
    HOUSEHOLD_LEDGER: { widgetOrder: ['SPENDING', 'RECENT', 'TREND', 'CARDS'], hiddenWidgets: [] },
    ASSETS_LIABILITIES: { widgetOrder: ['TREND', 'SPENDING', 'CARDS', 'RECENT'], hiddenWidgets: [] },
    CARD_RECONCILIATION: { widgetOrder: ['CARDS', 'RECENT', 'TREND', 'SPENDING'], hiddenWidgets: [] },
    CASH_FLOW: { widgetOrder: ['TREND', 'RECENT', 'CARDS', 'SPENDING'], hiddenWidgets: [] },
  }
}

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
      getLocalSyncFoundationStatus: async () => { throw new PlatformIpcError('COMMAND_FAILED', 'local_sync_foundation_status') },
      updatePrincipalMemberBinding: async () => { throw new PlatformIpcError('COMMAND_FAILED', 'principal_member_binding_update') },
      getDesktopRelayStatus: async () => { throw new PlatformIpcError('COMMAND_FAILED', 'relay_status') },
      saveDesktopRelayConnection: async () => { throw new PlatformIpcError('COMMAND_FAILED', 'relay_connection_save') },
      disconnectDesktopRelay: async () => { throw new PlatformIpcError('COMMAND_FAILED', 'relay_disconnect') },
      prepareDesktopRelaySend: async () => { throw new PlatformIpcError('COMMAND_FAILED', 'relay_send_prepare') },
      acceptDesktopRelaySend: async () => { throw new PlatformIpcError('COMMAND_FAILED', 'relay_send_accept') },
      failDesktopRelaySend: async () => { throw new PlatformIpcError('COMMAND_FAILED', 'relay_send_failed') },
      registerDesktopRelayInbound: async () => { throw new PlatformIpcError('COMMAND_FAILED', 'relay_inbound_register') },
      stageDesktopRelayInbound: async () => { throw new PlatformIpcError('COMMAND_FAILED', 'relay_inbound_stage') },
      getFamilyDeliveryStatus: async () => { throw new PlatformIpcError('COMMAND_FAILED', 'family_delivery_status') },
      saveFamilyDeliveryConnection: async () => { throw new PlatformIpcError('COMMAND_FAILED', 'family_delivery_connection_save') },
      disconnectFamilyDelivery: async () => { throw new PlatformIpcError('COMMAND_FAILED', 'family_delivery_disconnect') },
      registerFamilyDeliveryRemoteState: async () => { throw new PlatformIpcError('COMMAND_FAILED', 'family_delivery_remote_state_register') },
      prepareFamilyDelivery: async () => { throw new PlatformIpcError('COMMAND_FAILED', 'family_delivery_send_prepare') },
      prepareEncryptedFamilyEnvelope: async () => { throw new PlatformIpcError('COMMAND_FAILED', 'family_delivery_envelope_prepare') },
      getCachedFamilyDeliveryEnvelope: async () => { throw new PlatformIpcError('COMMAND_FAILED', 'family_delivery_envelope_cached_get') },
      getFamilyEnvelopeIdentity: async () => { throw new PlatformIpcError('COMMAND_FAILED', 'family_envelope_identity_get') },
      sealFamilyEnvelope: async () => { throw new PlatformIpcError('COMMAND_FAILED', 'family_envelope_seal') },
      openFamilyEnvelope: async () => { throw new PlatformIpcError('COMMAND_FAILED', 'family_envelope_open') },
      acceptFamilyDelivery: async () => { throw new PlatformIpcError('COMMAND_FAILED', 'family_delivery_send_accept') },
      failFamilyDelivery: async () => { throw new PlatformIpcError('COMMAND_FAILED', 'family_delivery_send_failed') },
      resetFamilyDeliveryRecipientSetChanged: async () => { throw new PlatformIpcError('COMMAND_FAILED', 'family_delivery_envelope_recipient_set_changed') },
      registerFamilyDeliveryInbound: async () => { throw new PlatformIpcError('COMMAND_FAILED', 'family_delivery_inbound_register') },
      stageFamilyDeliveryInbound: async () => { throw new PlatformIpcError('COMMAND_FAILED', 'family_delivery_inbound_stage') },
      stageEncryptedFamilyDeliveryInbound: async () => { throw new PlatformIpcError('COMMAND_FAILED', 'family_delivery_encrypted_inbound_stage') },
      getFamilyDeliveryBackgroundStatus: async () => { throw new PlatformIpcError('COMMAND_FAILED', 'family_delivery_background_status') },
      enableFamilyDeliveryBackground: async () => { throw new PlatformIpcError('COMMAND_FAILED', 'family_delivery_background_enable') },
      disableFamilyDeliveryBackground: async () => { throw new PlatformIpcError('COMMAND_FAILED', 'family_delivery_background_disable') },
      runFamilyDeliveryBackgroundNow: async () => { throw new PlatformIpcError('COMMAND_FAILED', 'family_delivery_background_run_now') },
      getMobileCaptureBackgroundStatus: async () => { throw new PlatformIpcError('COMMAND_FAILED', 'mobile_capture_background_status') },
      enableMobileCaptureBackground: async () => { throw new PlatformIpcError('COMMAND_FAILED', 'mobile_capture_background_enable') },
      disableMobileCaptureBackground: async () => { throw new PlatformIpcError('COMMAND_FAILED', 'mobile_capture_background_disable') },
      runMobileCaptureBackgroundNow: async () => { throw new PlatformIpcError('COMMAND_FAILED', 'mobile_capture_background_run_now') },
      getActiveFamilySnapshotReview: async () => null,
      resolveFamilySnapshot: async () => { throw new PlatformIpcError('COMMAND_FAILED', 'family_snapshot_resolve') },
      applyFamilySnapshot: async () => { throw new PlatformIpcError('COMMAND_FAILED', 'family_snapshot_apply') },
      discardFamilySnapshot: async () => { throw new PlatformIpcError('COMMAND_FAILED', 'family_snapshot_discard') },
      listMobileCaptureInbox: async () => [],
      getMobileCaptureStatus: async () => { throw new PlatformIpcError('COMMAND_FAILED', 'mobile_capture_status') },
      updateMobileCaptureCursor: async () => { throw new PlatformIpcError('COMMAND_FAILED', 'mobile_capture_cursor_update') },
      ingestMobileCapture: async () => { throw new PlatformIpcError('COMMAND_FAILED', 'mobile_capture_ingest') },
      ingestLocalCapture: async () => { throw new PlatformIpcError('COMMAND_FAILED', 'mobile_capture_local_ingest') },
      getMobileCaptureImagePreview: async () => { throw new PlatformIpcError('COMMAND_FAILED', 'mobile_capture_image_preview') },
      ocrMobileCapture: async () => { throw new PlatformIpcError('COMMAND_FAILED', 'mobile_capture_ocr') },
      storeMobileCaptureOcr: async () => { throw new PlatformIpcError('COMMAND_FAILED', 'mobile_capture_ocr_store') },
      markMobileCaptureOcrReviewRequired: async () => { throw new PlatformIpcError('COMMAND_FAILED', 'mobile_capture_mark_ocr_review_required') },
      discardMobileCapture: async () => { throw new PlatformIpcError('COMMAND_FAILED', 'mobile_capture_discard') },
      promoteMobileCapture: async () => { throw new PlatformIpcError('COMMAND_FAILED', 'mobile_capture_promote') },
      exportChangePackage: async () => { throw new PlatformIpcError('COMMAND_FAILED', 'change_package_export_save') },
      pickAndStageChangePackage: async () => { throw new PlatformIpcError('COMMAND_FAILED', 'change_package_pick_and_stage') },
      getActiveChangePackageReview: async () => null,
      resolveChangePackage: async () => { throw new PlatformIpcError('COMMAND_FAILED', 'change_package_resolve') },
      applyChangePackage: async () => { throw new PlatformIpcError('COMMAND_FAILED', 'change_package_apply') },
      discardChangePackage: async () => { throw new PlatformIpcError('COMMAND_FAILED', 'change_package_discard') },
      exportEvidenceBundle: async () => { throw new PlatformIpcError('COMMAND_FAILED', 'evidence_bundle_export_save') },
      pickAndImportEvidenceBundle: async () => { throw new PlatformIpcError('COMMAND_FAILED', 'evidence_bundle_pick_and_import') },
      exportPendingImport: async () => { throw new PlatformIpcError('COMMAND_FAILED', 'pending_import_export_to_picker') },
      pickAndStagePendingImport: async () => { throw new PlatformIpcError('COMMAND_FAILED', 'pending_import_pick_and_stage') },
      applyPendingImport: async () => { throw new PlatformIpcError('COMMAND_FAILED', 'pending_import_apply') },
      discardPendingImport: async () => { throw new PlatformIpcError('COMMAND_FAILED', 'pending_import_discard') },
      listHouseholds: async () => [WEB_DEMO_HOUSEHOLD],
      createHousehold: async (input) => ({ id: input.id, name: input.name, baseCurrency: 'JPY', createdAt: new Date(0).toISOString() }),
      listHouseholdMembers: async () => [],
      createHouseholdMember: async () => { throw new PlatformIpcError('COMMAND_FAILED', 'household_member_create') },
      updateHouseholdMember: async () => { throw new PlatformIpcError('COMMAND_FAILED', 'household_member_update') },
      archiveHouseholdMember: async () => { throw new PlatformIpcError('COMMAND_FAILED', 'household_member_archive') },
      listAccounts: async () => [],
      createAccount: async () => { throw new PlatformIpcError('COMMAND_FAILED', 'account_create') },
      renameAccount: async () => { throw new PlatformIpcError('COMMAND_FAILED', 'account_rename') },
      archiveAccount: async () => { throw new PlatformIpcError('COMMAND_FAILED', 'account_archive') },
      updateAccountOwnership: async () => { throw new PlatformIpcError('COMMAND_FAILED', 'account_ownership_update') },
      queryTransactions: async (request) => ({ items: [], page: request.page, pageSize: request.pageSize, totalItems: 0, totalPages: 0 }),
      createManualTransaction: async () => { throw new PlatformIpcError('COMMAND_FAILED', 'transaction_manual_create') },
      getTransactionDetail: async () => { throw new PlatformIpcError('COMMAND_FAILED', 'transaction_detail_get') },
      updateTransaction: async () => { throw new PlatformIpcError('COMMAND_FAILED', 'transaction_update') },
      bulkUpdateTransactionMetadata: async () => { throw new PlatformIpcError('COMMAND_FAILED', 'transaction_metadata_bulk_update') },
      getSourceDocument: async () => { throw new PlatformIpcError('COMMAND_FAILED', 'source_document_get') },
      updateSourceDocumentAudience: async () => { throw new PlatformIpcError('COMMAND_FAILED', 'source_document_audience_update') },
      querySourceDocumentRecords: async () => { throw new PlatformIpcError('COMMAND_FAILED', 'source_document_records_query') },
      listTransactionSourceRecords: async () => { throw new PlatformIpcError('COMMAND_FAILED', 'transaction_source_records_list') },
      listConnectorSummaries: async (householdId, cursor, limit) => {
        const { cursor: after } = connectorListArgs(householdId, cursor, limit)
        return after === null ? WEB_CONNECTOR_SUMMARY_PAGE : WEB_EMPTY_CONNECTOR_SUMMARY_PAGE
      },
      listConnectorBindings: async () => [],
      upsertConnectorBinding: async () => { throw new PlatformIpcError('COMMAND_FAILED', 'connector_binding_upsert') },
      deleteConnectorBinding: async () => { throw new PlatformIpcError('COMMAND_FAILED', 'connector_binding_delete') },
      startConnectorRefresh: async () => { throw new PlatformIpcError('COMMAND_FAILED', 'connector_refresh_one') },
      startConnectorRefreshAll: async () => { throw new PlatformIpcError('COMMAND_FAILED', 'connector_refresh_all') },
      getActiveConnectorRefreshBatch: async () => null,
      getConnectorRefreshBatch: async () => { throw new PlatformIpcError('COMMAND_FAILED', 'connector_refresh_batch_get') },
      listWatchedFolders: async () => [],
      selectWatchedFolder: async () => { throw new PlatformIpcError('COMMAND_FAILED', 'watched_folder_select') },
      selectIcloudFolder: async () => { throw new PlatformIpcError('COMMAND_FAILED', 'icloud_folder_select') },
      removeWatchedFolder: async () => { throw new PlatformIpcError('COMMAND_FAILED', 'watched_folder_remove') },
      scanWatchedFolder: async () => { throw new PlatformIpcError('COMMAND_FAILED', 'watched_folder_scan') },
      readWatchedFile: async () => { throw new PlatformIpcError('COMMAND_FAILED', 'watched_folder_file_read') },
      listWatchedFileInbox: async () => [],
      countWatchedFileInbox: async () => ({ discovered: 0, processing: 0, ready: 0, needsMapping: 0, staged: 0, failed: 0, ignored: 0, removed: 0, actionable: 0, total: 0 }),
      ignoreWatchedFileInboxItem: async () => { throw new PlatformIpcError('COMMAND_FAILED', 'watched_file_inbox_ignore') },
      retryWatchedFileInboxItem: async () => { throw new PlatformIpcError('COMMAND_FAILED', 'watched_file_inbox_retry') },
      claimWatchedFileInboxItems: async () => { throw new PlatformIpcError('COMMAND_FAILED', 'watched_file_inbox_claim') },
      markWatchedFileInboxReady: async () => { throw new PlatformIpcError('COMMAND_FAILED', 'watched_file_inbox_mark_ready') },
      markWatchedFileInboxNeedsMapping: async () => { throw new PlatformIpcError('COMMAND_FAILED', 'watched_file_inbox_mark_needs_mapping') },
      markWatchedFileInboxFailed: async () => { throw new PlatformIpcError('COMMAND_FAILED', 'watched_file_inbox_mark_failed') },
      markWatchedFileInboxStaged: async () => { throw new PlatformIpcError('COMMAND_FAILED', 'watched_file_inbox_mark_staged') },
      getGoogleDriveAvailability: async () => WEB_GOOGLE_DRIVE_AVAILABILITY,
      listGoogleDriveConnections: async () => [],
      connectGoogleDrive: async () => { throw new PlatformIpcError('COMMAND_FAILED', 'google_drive_connect') },
      bindGoogleDriveFolder: async () => { throw new PlatformIpcError('COMMAND_FAILED', 'google_drive_folder_bind') },
      disconnectGoogleDrive: async () => { throw new PlatformIpcError('COMMAND_FAILED', 'google_drive_disconnect') },
      getGoogleDriveSchedule: async () => { throw new PlatformIpcError('COMMAND_FAILED', 'google_drive_schedule_get') },
      updateGoogleDriveSchedule: async () => { throw new PlatformIpcError('COMMAND_FAILED', 'google_drive_schedule_update') },
      syncGoogleDriveNow: async () => { throw new PlatformIpcError('COMMAND_FAILED', 'google_drive_sync_now') },
      listGoogleDriveInbox: async () => [],
      ignoreGoogleDriveInboxItem: async () => { throw new PlatformIpcError('COMMAND_FAILED', 'google_drive_inbox_ignore') },
      retryGoogleDriveInboxItem: async () => { throw new PlatformIpcError('COMMAND_FAILED', 'google_drive_inbox_retry') },
      readGoogleDriveInboxFile: async () => { throw new PlatformIpcError('COMMAND_FAILED', 'google_drive_inbox_file_read') },
      claimGoogleDriveInboxItems: async () => { throw new PlatformIpcError('COMMAND_FAILED', 'google_drive_inbox_claim') },
      markGoogleDriveInboxStaged: async () => { throw new PlatformIpcError('COMMAND_FAILED', 'google_drive_inbox_mark_staged') },
      markGoogleDriveInboxFailed: async () => { throw new PlatformIpcError('COMMAND_FAILED', 'google_drive_inbox_mark_failed') },
      reopenGoogleDriveInboxItem: async () => { throw new PlatformIpcError('COMMAND_FAILED', 'google_drive_inbox_reopen') },
      getGmailAvailability: async () => WEB_GMAIL_AVAILABILITY,
      listGmailConnections: async () => [],
      connectGmail: async () => { throw new PlatformIpcError('COMMAND_FAILED', 'gmail_connect') },
      listGmailLabels: async () => [],
      bindGmailLabel: async () => { throw new PlatformIpcError('COMMAND_FAILED', 'gmail_label_bind') },
      disconnectGmail: async () => { throw new PlatformIpcError('COMMAND_FAILED', 'gmail_disconnect') },
      getGmailSchedule: async () => { throw new PlatformIpcError('COMMAND_FAILED', 'gmail_schedule_get') },
      updateGmailSchedule: async () => { throw new PlatformIpcError('COMMAND_FAILED', 'gmail_schedule_update') },
      syncGmailNow: async () => { throw new PlatformIpcError('COMMAND_FAILED', 'gmail_sync_now') },
      listGmailInbox: async () => [],
      ignoreGmailInboxItem: async () => { throw new PlatformIpcError('COMMAND_FAILED', 'gmail_inbox_ignore') },
      retryGmailInboxItem: async () => { throw new PlatformIpcError('COMMAND_FAILED', 'gmail_inbox_retry') },
      readGmailInboxFile: async () => { throw new PlatformIpcError('COMMAND_FAILED', 'gmail_inbox_file_read') },
      claimGmailInboxItems: async () => { throw new PlatformIpcError('COMMAND_FAILED', 'gmail_inbox_claim') },
      markGmailInboxStaged: async () => { throw new PlatformIpcError('COMMAND_FAILED', 'gmail_inbox_mark_staged') },
      markGmailInboxFailed: async () => { throw new PlatformIpcError('COMMAND_FAILED', 'gmail_inbox_mark_failed') },
      reopenGmailInboxItem: async () => { throw new PlatformIpcError('COMMAND_FAILED', 'gmail_inbox_reopen') },
      queryDashboard: async (request) => ({ month: request.month, accountingBasis: request.accountingBasis, incomeJpy: 0, expenseJpy: 0, savingsJpy: 0, postedTransactionCount: 0, ...EMPTY_DASHBOARD_ANALYTICS }),
      getDashboardPreferences: async (householdId) => ({ householdId, template: 'FINANCIAL_OVERVIEW', theme: 'SYSTEM', density: 'COMFORTABLE', templateLayouts: defaultDashboardTemplateLayouts(), updatedAt: new Date(0).toISOString() }),
      upsertDashboardPreferences: async () => { throw new PlatformIpcError('COMMAND_FAILED', 'dashboard_preferences_upsert') },
      listBudgets: async () => [],
      upsertBudget: async () => { throw new PlatformIpcError('COMMAND_FAILED', 'budget_upsert') },
      moveBudget: async () => { throw new PlatformIpcError('COMMAND_FAILED', 'budget_move') },
      queryEnvelopeCardActivity: async () => { throw new PlatformIpcError('COMMAND_FAILED', 'envelope_card_activity_query') },
      getMonthlyReviewMemo: async () => null,
      upsertMonthlyReviewMemo: async () => { throw new PlatformIpcError('COMMAND_FAILED', 'monthly_review_memo_upsert') },
      listSavingsGoals: async () => [],
      createSavingsGoal: async () => { throw new PlatformIpcError('COMMAND_FAILED', 'savings_goal_create') },
      updateSavingsGoal: async () => { throw new PlatformIpcError('COMMAND_FAILED', 'savings_goal_update') },
      deleteSavingsGoal: async () => { throw new PlatformIpcError('COMMAND_FAILED', 'savings_goal_delete') },
      listClassificationRules: async () => [],
      getLastClassificationApplication: async () => null,
      createClassificationRule: async () => { throw new PlatformIpcError('COMMAND_FAILED', 'classification_rule_create') },
      updateClassificationRule: async () => { throw new PlatformIpcError('COMMAND_FAILED', 'classification_rule_update') },
      deleteClassificationRule: async () => { throw new PlatformIpcError('COMMAND_FAILED', 'classification_rule_delete') },
      previewClassificationRules: async () => ({ winningRuleId: null, matches: [] }),
      applyClassificationRule: async () => { throw new PlatformIpcError('COMMAND_FAILED', 'classification_rule_apply') },
      importSummary: async () => ({ totalRuns: 0, discovered: 0, extracting: 0, reviewRequired: 0, posted: 0, failed: 0, rolledBack: 0, sourceDocuments: 0, sourceRecords: 0, pendingCandidates: 0, readyCandidates: 0, latestSuccessfulImportAt: null, latestSourceFilename: null, latestSourceType: null, distinctSourceTypes: 0 }),
      listPendingReviews: async (householdId) => ({ householdId, runs: [] }),
      startImport: async () => { throw new PlatformIpcError('COMMAND_FAILED', 'import_start') },
      previewImport: async () => { throw new PlatformIpcError('COMMAND_FAILED', 'import_preview') },
      setImportDuplicateResolution: async () => { throw new PlatformIpcError('COMMAND_FAILED', 'import_duplicate_resolution_set') },
      commitImport: async () => { throw new PlatformIpcError('COMMAND_FAILED', 'import_commit') },
      rollbackImport: async () => { throw new PlatformIpcError('COMMAND_FAILED', 'import_rollback') },
      createBackup: async () => { throw new PlatformIpcError('COMMAND_FAILED', 'backup_create') },
      stageBackupRestore: async () => { throw new PlatformIpcError('COMMAND_FAILED', 'backup_restore_stage') },
      restartForRestore: async () => { throw new PlatformIpcError('COMMAND_FAILED', 'app_restart_for_restore') },
      extractDocument: async () => { throw new PlatformIpcError('COMMAND_FAILED', 'document_extract') },
      ocrDocument: async () => { throw new PlatformIpcError('COMMAND_FAILED', 'document_ocr') },
      listCardSettlements: async () => [],
      confirmCardMatch: async () => { throw new PlatformIpcError('COMMAND_FAILED', 'card_match_confirm') },
      confirmCardPaymentLink: async () => { throw new PlatformIpcError('COMMAND_FAILED', 'card_payment_link_confirm') },
      unlinkCardPaymentLink: async () => { throw new PlatformIpcError('COMMAND_FAILED', 'card_payment_link_unlink') },
      listTransferPairDecisions: async () => { throw new PlatformIpcError('COMMAND_FAILED', 'transfer_pair_decisions_list') },
      decideTransferPair: async () => { throw new PlatformIpcError('COMMAND_FAILED', 'transfer_pair_decide') },
      updateCardStatementDueDate: async () => { throw new PlatformIpcError('COMMAND_FAILED', 'card_statement_due_date_update') },
      listCardSettlementBankMappings: async () => [],
      upsertCardSettlementBankMapping: async () => { throw new PlatformIpcError('COMMAND_FAILED', 'card_settlement_bank_mapping_upsert') },
      deleteCardSettlementBankMapping: async () => { throw new PlatformIpcError('COMMAND_FAILED', 'card_settlement_bank_mapping_delete') },
      queryCardSettlementBalanceCoverage: async () => ({ asOf: '1970-01-01', historyFrom: '1970-01-01', horizonThrough: '1970-02-15', horizonDays: 45, banks: [], unmappedStatements: [], missingDueStatements: [] }),
      suggestReceiptMatches: async () => [],
      confirmReceiptMatch: async () => { throw new PlatformIpcError('COMMAND_FAILED', 'receipt_match_confirm') },
    }
  }

  return {
    runtime,
    bootstrap: () => invokeValidated(invoke, 'app_bootstrap', parseBootstrap),
    health: () => invokeValidated(invoke, 'app_health', parseHealth),
    status: () => invokeValidated(invoke, 'app_status', parseStatus),
    getLocalSyncFoundationStatus: (householdId) => invokeValidated(invoke, 'local_sync_foundation_status', parseLocalSyncFoundationStatus, { householdId }),
    updatePrincipalMemberBinding: (input) => invokeValidated(invoke, 'principal_member_binding_update', parseLocalSyncFoundationStatus, { input }),
    getDesktopRelayStatus: (householdId) => invokeValidated(invoke, 'relay_status', parseDesktopRelayStatus, { householdId }),
    saveDesktopRelayConnection: (input) => invokeValidated(invoke, 'relay_connection_save', parseDesktopRelayStatus, { input }),
    disconnectDesktopRelay: (householdId) => invokeValidated(invoke, 'relay_disconnect', parseDesktopRelayStatus, { householdId }),
    prepareDesktopRelaySend: (householdId) => invokeValidated(invoke, 'relay_send_prepare', parseDesktopRelayPreparedDelivery, { householdId }),
    acceptDesktopRelaySend: (input) => invokeValidated(invoke, 'relay_send_accept', parseDesktopRelayStatus, { input }),
    failDesktopRelaySend: (householdId, deliveryId) => invokeValidated(invoke, 'relay_send_failed', parseDesktopRelayStatus, { householdId, deliveryId }),
    registerDesktopRelayInbound: (input) => invokeValidated(invoke, 'relay_inbound_register', parseDesktopRelayStatus, { input }),
    stageDesktopRelayInbound: (input) => invokeValidated(invoke, 'relay_inbound_stage', parseDesktopRelayStatus, { input }),
    getFamilyDeliveryStatus: (householdId) => invokeValidated(invoke, 'family_delivery_status', parseFamilyDeliveryStatus, { householdId }),
    saveFamilyDeliveryConnection: (input) => invokeValidated(invoke, 'family_delivery_connection_save', parseFamilyDeliveryStatus, { input }),
    disconnectFamilyDelivery: (householdId) => invokeValidated(invoke, 'family_delivery_disconnect', parseFamilyDeliveryStatus, { householdId }),
    registerFamilyDeliveryRemoteState: (input) => invokeValidated(invoke, 'family_delivery_remote_state_register', parseFamilyDeliveryStatus, { input }),
    prepareFamilyDelivery: (input) => invokeValidated(invoke, 'family_delivery_send_prepare', parseFamilyPreparedArtifacts, { input }),
    prepareEncryptedFamilyEnvelope: (input) => invokeValidated(invoke, 'family_delivery_envelope_prepare', parsePreparedFamilyEnvelope, { input }),
    getCachedFamilyDeliveryEnvelope: (input) => invokeValidated(invoke, 'family_delivery_envelope_cached_get', parseNullablePreparedFamilyEnvelope, { input }),
    getFamilyEnvelopeIdentity: () => invokeValidated(invoke, 'family_envelope_identity_get', parseFamilyEnvelopeIdentity),
    sealFamilyEnvelope: (input) => invokeValidated(invoke, 'family_envelope_seal', parseSealedFamilyEnvelope, { input }),
    openFamilyEnvelope: (input) => invokeValidated(invoke, 'family_envelope_open', parseOpenedFamilyEnvelope, { input }),
    acceptFamilyDelivery: (input) => invokeValidated(invoke, 'family_delivery_send_accept', parseFamilyDeliveryStatus, { input }),
    failFamilyDelivery: (householdId, deliveryIds) => invokeValidated(invoke, 'family_delivery_send_failed', parseFamilyDeliveryStatus, { householdId, deliveryIds }),
    resetFamilyDeliveryRecipientSetChanged: (householdId, deliveries) => invokeValidated(invoke, 'family_delivery_envelope_recipient_set_changed', parseFamilyDeliveryStatus, { householdId, deliveries }),
    registerFamilyDeliveryInbound: (input) => invokeValidated(invoke, 'family_delivery_inbound_register', parseFamilyDeliveryStatus, { input }),
    stageFamilyDeliveryInbound: (input) => invokeValidated(invoke, 'family_delivery_inbound_stage', parseFamilyDeliveryStatus, { input }),
    stageEncryptedFamilyDeliveryInbound: (input) => invokeValidated(invoke, 'family_delivery_encrypted_inbound_stage', parseFamilyDeliveryStatus, { input }),
    getFamilyDeliveryBackgroundStatus: (householdId) => invokeValidated(invoke, 'family_delivery_background_status', parseFamilyDeliveryScheduleStatus, { householdId }),
    enableFamilyDeliveryBackground: (input) => invokeValidated(invoke, 'family_delivery_background_enable', parseFamilyDeliveryScheduleStatus, { input }),
    disableFamilyDeliveryBackground: (householdId) => invokeValidated(invoke, 'family_delivery_background_disable', parseFamilyDeliveryScheduleStatus, { householdId }),
    runFamilyDeliveryBackgroundNow: (householdId) => invokeValidated(invoke, 'family_delivery_background_run_now', parseFamilyDeliveryScheduleStatus, { householdId }),
    getMobileCaptureBackgroundStatus: (householdId) => invokeValidated(invoke, 'mobile_capture_background_status', parseMobileCaptureBackgroundStatus, { householdId }),
    enableMobileCaptureBackground: (input) => invokeValidated(invoke, 'mobile_capture_background_enable', parseMobileCaptureBackgroundStatus, { input }),
    disableMobileCaptureBackground: (householdId) => invokeValidated(invoke, 'mobile_capture_background_disable', parseMobileCaptureBackgroundStatus, { householdId }),
    runMobileCaptureBackgroundNow: (householdId) => invokeValidated(invoke, 'mobile_capture_background_run_now', parseMobileCaptureBackgroundStatus, { householdId }),
    getActiveFamilySnapshotReview: (householdId) => invokeValidated(invoke, 'family_snapshot_active_review', parseNullableFamilySnapshotReview, { householdId }),
    resolveFamilySnapshot: (packageId, resolutions) => invokeValidated(invoke, 'family_snapshot_resolve', parseFamilySnapshotReview, { packageId, resolutions }),
    applyFamilySnapshot: (packageId) => invokeValidated(invoke, 'family_snapshot_apply', parseFamilySnapshotReview, { packageId }),
    discardFamilySnapshot: async (packageId) => { await invokeValidated(invoke, 'family_snapshot_discard', parseVoid, { packageId }) },
    listMobileCaptureInbox: (householdId) => invokeValidated(invoke, 'mobile_capture_inbox_list', parseMobileCaptureInboxItems, { householdId }),
    getMobileCaptureStatus: (householdId) => invokeValidated(invoke, 'mobile_capture_status', parseMobileCaptureStatus, { householdId }),
    updateMobileCaptureCursor: (householdId, nextCursor) => invokeValidated(invoke, 'mobile_capture_cursor_update', parseMobileCaptureStatus, { householdId, nextCursor }),
    ingestMobileCapture: (input) => invokeValidated(invoke, 'mobile_capture_ingest', parseMobileCaptureInboxItem, { input }),
    ingestLocalCapture: (input) => invokeValidated(invoke, 'mobile_capture_local_ingest', parseMobileCaptureInboxItem, { input }),
    getMobileCaptureImagePreview: (householdId, artifactId) => invokeValidated(invoke, 'mobile_capture_image_preview', parseMobileCaptureImagePreview, { householdId, artifactId }),
    ocrMobileCapture: (householdId, artifactId) => invokeValidated(invoke, 'mobile_capture_ocr', parseMobileCaptureOcrResult, { householdId, artifactId }),
    storeMobileCaptureOcr: (householdId, artifactId, document) => invokeValidated(invoke, 'mobile_capture_ocr_store', parseMobileCaptureOcrResult, { householdId, artifactId, document }),
    markMobileCaptureOcrReviewRequired: (householdId, artifactId) => invokeValidated(invoke, 'mobile_capture_mark_ocr_review_required', parseMobileCaptureInboxItem, { householdId, artifactId }),
    discardMobileCapture: async (householdId, artifactId) => { await invokeValidated(invoke, 'mobile_capture_discard', parseVoid, { householdId, artifactId }) },
    promoteMobileCapture: (input) => invokeValidated(invoke, 'mobile_capture_promote', parseMobileCapturePromoteResult, { input }),
    exportChangePackage: (householdId) => invokeValidated(invoke, 'change_package_export_save', parseNullableString, { householdId }),
    pickAndStageChangePackage: (householdId) => invokeValidated(invoke, 'change_package_pick_and_stage', parseNullableChangePackageReview, { householdId }),
    getActiveChangePackageReview: (householdId) => invokeValidated(invoke, 'change_package_active_review', parseNullableChangePackageReview, { householdId }),
    resolveChangePackage: (packageId, resolutions) => invokeValidated(invoke, 'change_package_resolve', parseChangePackageReview, { packageId, resolutions }),
    applyChangePackage: (packageId) => invokeValidated(invoke, 'change_package_apply', parseChangePackageReview, { packageId }),
    discardChangePackage: async (packageId) => { await invokeValidated(invoke, 'change_package_discard', parseVoid, { packageId }) },
    exportEvidenceBundle: (householdId, passphrase) => invokeValidated(invoke, 'evidence_bundle_export_save', parseNullableEvidenceBundleSummary, { householdId, passphrase }),
    pickAndImportEvidenceBundle: (householdId, passphrase) => invokeValidated(invoke, 'evidence_bundle_pick_and_import', parseNullableEvidenceBundleSummary, { householdId, passphrase }),
    exportPendingImport: (request, passphrase) => invokeValidated(invoke, 'pending_import_export_to_picker', (value) => parseNullablePendingImportExportSummary(value, request.householdId), { request, passphrase }),
    pickAndStagePendingImport: (householdId, passphrase) => invokeValidated(invoke, 'pending_import_pick_and_stage', parseNullablePendingImportStage, { householdId, passphrase }),
    applyPendingImport: (householdId, packageId, mappings) => invokeValidated(invoke, 'pending_import_apply', (value) => parsePendingImportApplySummary(value, packageId), { householdId, packageId, mappings }),
    discardPendingImport: (packageId) => invokeValidated(invoke, 'pending_import_discard', parseBoolean, { packageId }),
    listHouseholds: () => invokeValidated(invoke, 'households_list', parseHouseholds),
    createHousehold: (input) => invokeValidated(invoke, 'household_create', parseHousehold, { input }),
    listHouseholdMembers: (householdId) => invokeValidated(invoke, 'household_members_list', parseHouseholdMembers, { householdId }),
    createHouseholdMember: (input) => invokeValidated(invoke, 'household_member_create', parseHouseholdMember, { input }),
    updateHouseholdMember: (input) => invokeValidated(invoke, 'household_member_update', parseHouseholdMember, { input }),
    archiveHouseholdMember: async (householdId, memberId) => { await invokeValidated(invoke, 'household_member_archive', parseVoid, { householdId, memberId }) },
    listAccounts: (householdId) => invokeValidated(invoke, 'accounts_list', parseAccounts, { householdId }),
    createAccount: (input) => invokeValidated(invoke, 'account_create', parseAccount, { input }),
    renameAccount: (input) => invokeValidated(invoke, 'account_rename', parseAccount, { input }),
    archiveAccount: async (input) => { await invokeValidated(invoke, 'account_archive', parseVoid, { input }) },
    updateAccountOwnership: (input) => invokeValidated(invoke, 'account_ownership_update', parseAccount, { input }),
    queryTransactions: (request) => invokeValidated(invoke, 'transactions_query', parseTransactionPage, { request }),
    createManualTransaction: (input) => invokeValidated(invoke, 'transaction_manual_create', parseTransactionRow, { input }),
    getTransactionDetail: (householdId, transactionId) => invokeValidated(invoke, 'transaction_detail_get', parseTransactionDetail, { householdId, transactionId }),
    updateTransaction: (input) => invokeValidated(invoke, 'transaction_update', parseTransactionDetail, { input }),
    bulkUpdateTransactionMetadata: (input) => invokeValidated(invoke, 'transaction_metadata_bulk_update', parseBulkUpdateTransactionMetadataResult, { input }),
    getSourceDocument: (householdId, sourceDocumentId) => invokeValidated(invoke, 'source_document_get', parseSourceDocument, { householdId, sourceDocumentId }),
    updateSourceDocumentAudience: (input) => invokeValidated(invoke, 'source_document_audience_update', parseSourceDocument, { input }),
    querySourceDocumentRecords: (request) => invokeValidated(invoke, 'source_document_records_query', parseSourceRecordPage, { request }),
    listTransactionSourceRecords: (householdId, transactionId) => invokeValidated(invoke, 'transaction_source_records_list', parseSourceRecords, { householdId, transactionId }),
    listConnectorSummaries: async (householdId, cursor, limit) => invokeValidated(invoke, 'connector_control_list', parseConnectorSummaryPage, connectorListArgs(householdId, cursor, limit)),
    listConnectorBindings: (householdId) => {
      const args = connectorBindingListArgs(householdId)
      return invokeValidated(invoke, 'connector_bindings_list', (value) => parseConnectorBindings(value, args.householdId), args)
    },
    upsertConnectorBinding: async (input) => {
      const parsedInput = parseUpsertConnectorBindingInput(input)
      return invokeValidated(invoke, 'connector_binding_upsert', (value) => parseUpsertConnectorBindingResponse(value, parsedInput), { input: parsedInput })
    },
    deleteConnectorBinding: async (input) => { await invokeValidated(invoke, 'connector_binding_delete', parseVoid, { input: parseDeleteConnectorBindingInput(input) }) },
    startConnectorRefresh: (householdId, connectorKind, connectionKey) => {
      const input = connectorRefreshOneInput(householdId, connectorKind, connectionKey)
      return invokeValidated(invoke, 'connector_refresh_one', (value) => parseConnectorRefreshBatch(value, input.householdId), { input })
    },
    startConnectorRefreshAll: (householdId) => {
      const expectedHouseholdId = asConnectorBindingIdentifier(householdId, 128, 'connector refresh')
      return invokeValidated(invoke, 'connector_refresh_all', (value) => parseConnectorRefreshBatch(value, expectedHouseholdId), { householdId: expectedHouseholdId })
    },
    getActiveConnectorRefreshBatch: (householdId) => {
      const expectedHouseholdId = asConnectorBindingIdentifier(householdId, 128, 'connector refresh')
      return invokeValidated(invoke, 'connector_refresh_active_batch_get', (value) => parseNullableActiveConnectorRefreshProgress(value, expectedHouseholdId), { householdId: expectedHouseholdId })
    },
    getConnectorRefreshBatch: (householdId, batchId) => {
      const expectedHouseholdId = asConnectorBindingIdentifier(householdId, 128, 'connector refresh')
      const expectedBatchId = asConnectorBindingIdentifier(batchId, 64, 'connector refresh')
      return invokeValidated(invoke, 'connector_refresh_batch_get', (value) => parseConnectorRefreshProgress(value, expectedHouseholdId, expectedBatchId), { householdId: expectedHouseholdId, batchId: expectedBatchId })
    },
    listWatchedFolders: (householdId) => invokeValidated(invoke, 'watched_folders_list', parseWatchedFolders, { householdId }),
    selectWatchedFolder: (householdId, label) => invokeValidated(invoke, 'watched_folder_select', parseNullableWatchedFolder, { householdId, label }),
    selectIcloudFolder: (householdId, label) => invokeValidated(invoke, 'icloud_folder_select', parseNullableWatchedFolder, { householdId, label }),
    removeWatchedFolder: async (householdId, watchedFolderId) => { await invokeValidated(invoke, 'watched_folder_remove', parseVoid, { householdId, watchedFolderId }) },
    scanWatchedFolder: (householdId, watchedFolderId) => invokeValidated(invoke, 'watched_folder_scan', parseWatchedFolderScan, { householdId, watchedFolderId }),
    readWatchedFile: (householdId, watchedFolderId, relativePath) => invokeValidated(invoke, 'watched_folder_file_read', parseWatchedFile, { householdId, watchedFolderId, relativePath }),
    listWatchedFileInbox: (householdId, state, limit) => invokeValidated(invoke, 'watched_file_inbox_list', parseWatchedFileInboxItems, { householdId, state: state ?? null, limit: limit ?? null }),
    countWatchedFileInbox: (householdId) => invokeValidated(invoke, 'watched_file_inbox_counts', parseWatchedFileInboxCounts, { householdId }),
    ignoreWatchedFileInboxItem: (householdId, itemId) => invokeValidated(invoke, 'watched_file_inbox_ignore', parseWatchedFileInboxItem, { householdId, itemId }),
    retryWatchedFileInboxItem: (householdId, itemId) => invokeValidated(invoke, 'watched_file_inbox_retry', parseWatchedFileInboxItem, { householdId, itemId }),
    claimWatchedFileInboxItems: (householdId, itemIds) => invokeValidated(invoke, 'watched_file_inbox_claim', parseWatchedFileInboxClaim, { householdId, itemIds }),
    markWatchedFileInboxReady: (householdId, itemId, leaseToken) => invokeValidated(invoke, 'watched_file_inbox_mark_ready', parseWatchedFileInboxItem, { householdId, itemId, leaseToken }),
    markWatchedFileInboxNeedsMapping: (householdId, itemId, leaseToken) => invokeValidated(invoke, 'watched_file_inbox_mark_needs_mapping', parseWatchedFileInboxItem, { householdId, itemId, leaseToken }),
    markWatchedFileInboxFailed: (householdId, itemId, leaseToken, errorCode) => invokeValidated(invoke, 'watched_file_inbox_mark_failed', parseWatchedFileInboxItem, { householdId, itemId, leaseToken, errorCode }),
    markWatchedFileInboxStaged: (householdId, itemId, leaseToken, importRunId) => invokeValidated(invoke, 'watched_file_inbox_mark_staged', parseWatchedFileInboxItem, { householdId, itemId, leaseToken, importRunId }),
    getGoogleDriveAvailability: () => invokeValidated(invoke, 'google_drive_availability', parseGoogleDriveAvailability),
    listGoogleDriveConnections: (householdId) => invokeValidated(invoke, 'google_drive_connections_list', parseGoogleDriveConnections, { householdId }),
    connectGoogleDrive: (householdId) => invokeValidated(invoke, 'google_drive_connect', parseGoogleDriveConnection, { householdId }),
    bindGoogleDriveFolder: (input) => invokeValidated(invoke, 'google_drive_folder_bind', parseGoogleDriveConnection, { input }),
    disconnectGoogleDrive: (householdId, connectionId) => invokeValidated(invoke, 'google_drive_disconnect', parseGoogleDriveConnection, { householdId, connectionId }),
    getGoogleDriveSchedule: (householdId, connectionId) => invokeValidated(invoke, 'google_drive_schedule_get', parseGoogleDriveSchedule, { householdId, connectionId }),
    updateGoogleDriveSchedule: (input) => invokeValidated(invoke, 'google_drive_schedule_update', parseGoogleDriveSchedule, { input }),
    syncGoogleDriveNow: (householdId, connectionId) => invokeValidated(invoke, 'google_drive_sync_now', parseGoogleDriveSchedule, { householdId, connectionId }),
    listGoogleDriveInbox: (householdId, connectionId, state, limit) => invokeValidated(invoke, 'google_drive_inbox_list', parseGoogleDriveInboxItems, { householdId, connectionId: connectionId ?? null, state: state ?? null, limit: limit ?? null }),
    ignoreGoogleDriveInboxItem: (householdId, itemId) => invokeValidated(invoke, 'google_drive_inbox_ignore', parseGoogleDriveInboxItem, { householdId, itemId }),
    retryGoogleDriveInboxItem: (householdId, itemId) => invokeValidated(invoke, 'google_drive_inbox_retry', parseGoogleDriveInboxItem, { householdId, itemId }),
    readGoogleDriveInboxFile: (householdId, itemId) => invokeValidated(invoke, 'google_drive_inbox_file_read', parseGoogleDriveInboxFile, { householdId, itemId }),
    claimGoogleDriveInboxItems: (householdId, itemIds) => invokeValidated(invoke, 'google_drive_inbox_claim', parseGoogleDriveInboxClaim, { householdId, itemIds }),
    markGoogleDriveInboxStaged: (householdId, itemId, leaseToken, importRunId) => invokeValidated(invoke, 'google_drive_inbox_mark_staged', parseGoogleDriveInboxItem, { householdId, itemId, leaseToken, importRunId }),
    markGoogleDriveInboxFailed: (householdId, itemId, leaseToken, errorCode) => invokeValidated(invoke, 'google_drive_inbox_mark_failed', parseGoogleDriveInboxItem, { householdId, itemId, leaseToken, errorCode }),
    reopenGoogleDriveInboxItem: (householdId, itemId, importRunId) => invokeValidated(invoke, 'google_drive_inbox_reopen', parseGoogleDriveInboxItem, { householdId, itemId, importRunId }),
    getGmailAvailability: () => invokeValidated(invoke, 'gmail_availability', parseGmailAvailability),
    listGmailConnections: (householdId) => invokeValidated(invoke, 'gmail_connections_list', parseGmailConnections, { householdId }),
    connectGmail: (householdId) => invokeValidated(invoke, 'gmail_connect', parseGmailConnection, { householdId }),
    listGmailLabels: (householdId, connectionId) => invokeValidated(invoke, 'gmail_labels_list', parseGmailLabels, { householdId, connectionId }),
    bindGmailLabel: (input) => invokeValidated(invoke, 'gmail_label_bind', parseGmailConnection, { input }),
    disconnectGmail: (householdId, connectionId) => invokeValidated(invoke, 'gmail_disconnect', parseGmailConnection, { householdId, connectionId }),
    getGmailSchedule: (householdId, connectionId) => invokeValidated(invoke, 'gmail_schedule_get', parseGmailSchedule, { householdId, connectionId }),
    updateGmailSchedule: (input) => invokeValidated(invoke, 'gmail_schedule_update', parseGmailSchedule, { input }),
    syncGmailNow: (householdId, connectionId) => invokeValidated(invoke, 'gmail_sync_now', parseGmailSchedule, { householdId, connectionId }),
    listGmailInbox: (householdId, connectionId, state, limit) => invokeValidated(invoke, 'gmail_inbox_list', parseGmailInboxItems, { householdId, connectionId: connectionId ?? null, state: state ?? null, limit: limit ?? null }),
    ignoreGmailInboxItem: (householdId, itemId) => invokeValidated(invoke, 'gmail_inbox_ignore', parseGmailInboxItem, { householdId, itemId }),
    retryGmailInboxItem: (householdId, itemId) => invokeValidated(invoke, 'gmail_inbox_retry', parseGmailInboxItem, { householdId, itemId }),
    readGmailInboxFile: (householdId, itemId) => invokeValidated(invoke, 'gmail_inbox_file_read', parseGmailInboxFile, { householdId, itemId }),
    claimGmailInboxItems: (householdId, itemIds) => invokeValidated(invoke, 'gmail_inbox_claim', parseGmailInboxClaim, { householdId, itemIds }),
    markGmailInboxStaged: (householdId, itemId, leaseToken, importRunId) => invokeValidated(invoke, 'gmail_inbox_mark_staged', parseGmailInboxItem, { householdId, itemId, leaseToken, importRunId }),
    markGmailInboxFailed: (householdId, itemId, leaseToken, errorCode) => invokeValidated(invoke, 'gmail_inbox_mark_failed', parseGmailInboxItem, { householdId, itemId, leaseToken, errorCode }),
    reopenGmailInboxItem: (householdId, itemId, importRunId) => invokeValidated(invoke, 'gmail_inbox_reopen', parseGmailInboxItem, { householdId, itemId, importRunId }),
    queryDashboard: (request) => invokeValidated(invoke, 'dashboard_query', parseDashboard, { request }),
    getDashboardPreferences: (householdId) => invokeValidated(invoke, 'dashboard_preferences_get', parseDashboardPreferences, { householdId }),
    upsertDashboardPreferences: (input) => invokeValidated(invoke, 'dashboard_preferences_upsert', parseDashboardPreferences, { input }),
    listBudgets: (householdId, month) => invokeValidated(invoke, 'budgets_query', parseBudgets, { householdId, month }),
    upsertBudget: (input) => invokeValidated(invoke, 'budget_upsert', parseBudget, { input }),
    moveBudget: (input) => invokeValidated(invoke, 'budget_move', parseBudgets, { input }),
    queryEnvelopeCardActivity: (householdId, month) => invokeValidated(invoke, 'envelope_card_activity_query', parseEnvelopeCardActivity, { householdId, month }),
    getMonthlyReviewMemo: (householdId, month) => invokeValidated(invoke, 'monthly_review_memo_get', parseNullableMonthlyReviewMemo, { householdId, month }),
    upsertMonthlyReviewMemo: (input) => invokeValidated(invoke, 'monthly_review_memo_upsert', parseNullableMonthlyReviewMemo, { input }),
    listSavingsGoals: (householdId) => invokeValidated(invoke, 'savings_goals_list', parseSavingsGoals, { householdId }),
    createSavingsGoal: (input) => invokeValidated(invoke, 'savings_goal_create', parseSavingsGoal, { input }),
    updateSavingsGoal: (input) => invokeValidated(invoke, 'savings_goal_update', parseSavingsGoal, { input }),
    deleteSavingsGoal: async (householdId, goalId) => { await invokeValidated(invoke, 'savings_goal_delete', parseVoid, { householdId, goalId }) },
    listClassificationRules: (householdId) => invokeValidated(invoke, 'classification_rules_list', parseClassificationRules, { householdId }),
    getLastClassificationApplication: (householdId) => invokeValidated(invoke, 'classification_application_last', parseNullableLastClassificationApplication, { householdId }),
    createClassificationRule: (input) => invokeValidated(invoke, 'classification_rule_create', parseClassificationRule, { input }),
    updateClassificationRule: (input) => invokeValidated(invoke, 'classification_rule_update', parseClassificationRule, { input }),
    deleteClassificationRule: async (householdId, ruleId) => { await invokeValidated(invoke, 'classification_rule_delete', parseVoid, { householdId, ruleId }) },
    previewClassificationRules: (input) => invokeValidated(invoke, 'classification_rules_preview', parseClassificationPreview, { input }),
    applyClassificationRule: (input) => invokeValidated(invoke, 'classification_rule_apply', parseAppliedClassification, { input }),
    importSummary: (householdId) => invokeValidated(invoke, 'import_summary', parseImportSummary, { householdId }),
    listPendingReviews: (householdId) => invokeValidated(invoke, 'pending_review_list', (value) => parsePendingReviewList(value, householdId), { householdId }),
    startImport: (request, fileBytes) => invokeValidated(invoke, 'import_start', parseImportSummaryDto, { request: { import: request, fileBytes: Array.from(fileBytes) } }),
    previewImport: (runId) => invokeValidated(invoke, 'import_preview', parseImportPreview, { runId }),
    setImportDuplicateResolution: (runId, candidateId, resolution) => invokeValidated(invoke, 'import_duplicate_resolution_set', parseImportPreview, { runId, candidateId, resolution }),
    commitImport: (runId, decisions, expectedConnectorBinding) => invokeValidated(invoke, 'import_commit', parseCommitSummary, {
      runId,
      decisions,
      expectedConnectorBinding: parseImportBindingExpectation(expectedConnectorBinding),
    }),
    rollbackImport: async (runId) => { await invokeValidated(invoke, 'import_rollback', parseVoid, { runId }) },
    createBackup: (passphrase) => invokeValidated(invoke, 'backup_create', parseNullableBackupSummary, { passphrase }),
    stageBackupRestore: (passphrase) => invokeValidated(invoke, 'backup_restore_stage', parseNullableBackupSummary, { passphrase }),
    restartForRestore: async () => { await invokeValidated(invoke, 'app_restart_for_restore', parseVoid) },
    extractDocument: (fileBytes, mediaType) => invokeValidated(invoke, 'document_extract', parseExtractedDocument, { fileBytes: Array.from(fileBytes), mediaType }),
    ocrDocument: (fileBytes, mediaType) => invokeValidated(invoke, 'document_ocr', parseExtractedDocument, { fileBytes: Array.from(fileBytes), mediaType }),
    listCardSettlements: (householdId) => invokeValidated(invoke, 'cards_list', parseCardSettlements, { householdId }),
    confirmCardMatch: (householdId, statementId, paymentId) => invokeValidated(invoke, 'card_match_confirm', parseCardMatchConfirmation, { householdId, statementId, paymentId }),
    confirmCardPaymentLink: (householdId, statementId, paymentId) => invokeValidated(invoke, 'card_payment_link_confirm', parseCardSettlement, { householdId, statementId, paymentId }),
    unlinkCardPaymentLink: (householdId, statementId, paymentId) => invokeValidated(invoke, 'card_payment_link_unlink', parseCardSettlement, { householdId, statementId, paymentId }),
    listTransferPairDecisions: (householdId) => invokeValidated(invoke, 'transfer_pair_decisions_list', parseTransferPairDecisions, { householdId }),
    decideTransferPair: (input) => invokeValidated(invoke, 'transfer_pair_decide', parseTransferPairDecisions, { input }),
    updateCardStatementDueDate: (input) => invokeValidated(invoke, 'card_statement_due_date_update', parseCardSettlement, { input }),
    listCardSettlementBankMappings: (householdId) => invokeValidated(invoke, 'card_settlement_bank_mappings_list', parseCardSettlementBankMappings, { householdId }),
    upsertCardSettlementBankMapping: (input) => invokeValidated(invoke, 'card_settlement_bank_mapping_upsert', parseCardSettlementBankMapping, { input }),
    deleteCardSettlementBankMapping: async (input) => { await invokeValidated(invoke, 'card_settlement_bank_mapping_delete', parseVoid, { input }) },
    queryCardSettlementBalanceCoverage: (request) => invokeValidated(invoke, 'card_settlement_balance_coverage_query', parseCardSettlementBalanceCoverage, { request }),
    suggestReceiptMatches: (householdId, candidateId) => invokeValidated(invoke, 'receipt_match_suggestions', parseReceiptMatchSuggestions, { request: { householdId, candidateId } }),
    confirmReceiptMatch: (householdId, candidateId, transactionId) => invokeValidated(invoke, 'receipt_match_confirm', parseReceiptMatchConfirmation, { request: { householdId, candidateId, transactionId } }),
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
  } catch (error) {
    if (command === 'watched_folder_file_read' && isCloudFileUnavailable(error)) {
      throw new PlatformIpcError('CLOUD_FILE_UNAVAILABLE', command)
    }
    // Rust, SQL, filesystem paths, and source data must never cross this boundary.
    throw new PlatformIpcError('COMMAND_FAILED', command)
  }

  try {
    return parse(response)
  } catch {
    throw new PlatformIpcError('INVALID_RESPONSE', command)
  }
}

function isCloudFileUnavailable(error: unknown): boolean {
  if (error === 'CLOUD_FILE_UNAVAILABLE') return true
  return error instanceof Error && error.message === 'CLOUD_FILE_UNAVAILABLE'
}

export const platformClient = createPlatformClient()
