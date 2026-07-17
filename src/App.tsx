import { useCallback, useEffect, useRef, useState } from 'react'
import type { KeyboardEvent as ReactKeyboardEvent } from 'react'
import { invoke as tauriInvoke } from '@tauri-apps/api/core'
import kakeflowLogo from './assets/kakeflow-logo.png'
import {
  ArrowDownLeft,
  ArrowRight,
  ArrowUpRight,
  CircleDollarSign,
  CalendarDays,
  Check,
  Camera,
  Bell,
  CreditCard,
  FileCheck2,
  FileText,
  GripVertical,
  Download,
  Goal,
  Home,
  Import,
  Leaf,
  Layers,
  LayoutDashboard,
  Menu,
  ChevronLeft,
  ChevronRight,
  CircleDotDashed,
  Minus,
  MoreHorizontal,
  Search,
  Settings,
  Sparkles,
  Repeat2,
  TrainFront,
  TrendingUp,
  ChevronDown,
  ChevronUp,
  Utensils,
  Users,
  WalletCards,
  X,
  Zap,
} from 'lucide-react'
import { cardSettlements, categoryData, importItems, previewPortfolioSnapshot, spendingTrend, transactions } from './data'
import { previewImportFiles, takeFileInputSelection } from './features/import/importService'
import type { ImportPreview } from './features/import/importService'
import { sha256Text } from './features/import/importService'
import { mapParsedImportToStartImport } from './features/import/importMapper'
import { buildReceiptImport } from './features/import/receiptText'
import { paddleOcrDocument, paddleOcrRenderedPdfPages } from './features/import/paddleOcr'
import { parseRakutenStatementPdf } from './features/import/rakutenStatementPdf'
import { createPortfolioPlatform, mapPortfolioSnapshotImport } from './features/investments/portfolioPlatform'
import type { PortfolioSnapshotDetailDto, PortfolioSnapshotSummaryDto } from './features/investments/portfolioPlatform'
import { createBrokeragePlatform, mapBrokerageEventsImport } from './features/investments/brokeragePlatform'
import type { BrokerageHistoryDto } from './features/investments/brokeragePlatform'
import { createInvestmentPerformancePlatform } from './features/investments/investmentPerformancePlatform'
import type { InvestmentHoldingsDto, InvestmentPerformanceDto } from './features/investments/investmentPerformancePlatform'
import { InvestmentFxSummary } from './features/investments/InvestmentFxSummary'
import { InvestmentPeriodReport } from './features/investments/InvestmentPeriodReport'
import { InvestmentValuationSummary } from './features/investments/InvestmentValuationSummary'
import { AggregateAssetHistoryView } from './features/investments/AggregateAssetHistoryView'
import { createAggregateAssetHistoryPlatform, mapAggregateAssetSnapshotImport } from './features/investments/aggregateAssetHistoryPlatform'
import type { AggregateAssetSnapshotDto } from './features/investments/aggregateAssetHistoryPlatform'
import { createInvestmentMarketPlatform } from './features/investments/investmentMarketPlatform'
import type { InvestmentValuationDto } from './features/investments/investmentMarketPlatform'
import { createWatchedFolderDiscoveryPlatform } from './features/import/watchedFolderDiscoveryPlatform'
import { deleteRecurringSeriesPreference, listRecurringSeriesPreferences, queryFinancialIntelligence, upsertRecurringSeriesPreference } from './features/financial-intelligence/platform'
import type { FinancialIntelligenceDto, RecurringDecision, RecurringSeriesPreferenceDto } from './features/financial-intelligence/platform'
import { queryFixedCostReview } from './features/fixed-costs/platform'
import type { FixedCostReviewDto } from './features/fixed-costs/platform'
import { FixedCostReviewView } from './features/fixed-costs/FixedCostReviewView'
import { createAccountGroupExportPlatform } from './features/export/accountGroupExportPlatform'
import type { AccountGroupDto, AccountGroupKindDto, ExportAccountingBasisDto, ExportKindDto } from './features/export/accountGroupExportPlatform'
import { createFinancialCalendarPlatform } from './features/calendar/financialCalendarPlatform'
import type { FinancialCalendarDto, MonthlyFinancialReportDto, YearlyFinancialReportDto } from './features/calendar/financialCalendarPlatform'
import { FinancialCalendarView, MonthlyReportView } from './features/reports/ReportViews'
import { AnnualReviewView } from './features/reports/AnnualReviewView'
import { createForecastActionPlatform } from './features/forecast/forecastActionPlatform'
import type { ActionItemDto, ForecastActionDto } from './features/forecast/forecastActionPlatform'
import { ForecastActionViews } from './features/forecast/ForecastActionViews'
import { HomeActionCenter } from './features/forecast/HomeActionCenter'
import { pageForAction } from './features/forecast/actionCenterModel'
import { buildDocumentEvidence } from './features/source-viewer/documentEvidence'
import { DocumentEvidenceViewer } from './features/source-viewer/DocumentEvidenceViewer'
import { createSourceImagePreviewPlatform } from './features/source-viewer/sourceImagePreviewPlatform'
import type { SourceImagePreviewDto } from './features/source-viewer/sourceImagePreviewPlatform'
import { PdfPasswordPrompt } from './features/source-viewer/PdfPasswordPrompt'
import { createProtectedPdfPlatform } from './features/source-viewer/protectedPdfPlatform'
import type { PdfPasswordStatus } from './features/source-viewer/protectedPdfPlatform'
import type { AdapterId, AggregateAssetSnapshotCandidate, BrokerageEventCandidate, PortfolioSnapshotCandidate } from './ingestion'
import { DEFAULT_FOLDER_SCAN_INTERVAL_MS } from './features/import/folderAutomation'
import { attachFolderInboxIdentity, folderInboxFailureCode, folderInboxPreviewOutcome, recordClaimedFolderItems, retainActiveFolderPreviews, selectFolderInboxHydrationBatch } from './features/import/durableFolderInbox'
import { attachGoogleDriveInboxIdentity, googleDriveInboxFileIsImmutable, googleDriveInboxStateLabel, isGoogleDriveInboxPreviewable, retainActiveGoogleDrivePreviews } from './features/import/googleDriveInbox'
import { attachGmailInboxIdentity, gmailInboxFileIsImmutable, gmailInboxStateLabel, isGmailInboxPreviewable, retainActiveGmailPreviews } from './features/import/gmailInbox'
import { toTransactionViewModel } from './features/transactions/transactionViewModel'
import { FamilyPage } from './features/family/FamilyPage'
import { LocalSyncFoundationPanel } from './features/sync/LocalSyncFoundationPanel'
import { DesktopRelayPanel } from './features/sync/DesktopRelayPanel'
import { FamilyDeliveryPanel } from './features/sync/FamilyDeliveryPanel'
import { DelimitedParserProfilesPanel } from './features/parser-profiles/DelimitedParserProfilesPanel'
import { CustomParserRescueDialog } from './features/parser-profiles/CustomParserRescueDialog'
import { PendingImportHandoffPanel } from './features/import/PendingImportHandoffPanel'
import { GoogleDriveSettingsPanel } from './features/import/GoogleDriveSettingsPanel'
import { googleDriveSyncEventPlatform } from './features/import/googleDriveSyncEventPlatform'
import { GmailSettingsPanel } from './features/import/GmailSettingsPanel'
import { gmailSyncEventPlatform } from './features/import/gmailSyncEventPlatform'
import { PostingEntryEditor } from './features/import/PostingEntryEditor'
import { ReceiptReviewPanel } from './features/import/ReceiptReviewPanel'
import { validatePostingDecision } from './features/import/receiptSplitPosting'
import { CaptureInboxWorkspace } from './features/capture/CaptureInboxWorkspace'
import { MobileCaptureConnectorPanel } from './features/capture/MobileCaptureConnectorPanel'
import { delimitedParserProfilePlatform } from './features/parser-profiles/delimitedParserProfilePlatform'
import type { DelimitedParserProfileDto } from './features/parser-profiles/delimitedParserProfilePlatform'
import { parseCustomDelimitedBytes } from './ingestion'
import type { CustomDelimitedPreview } from './ingestion'
import { budgetByCategory, budgetUsage, currentMonthMetrics, savings, savingsRate } from './metrics'
import { platformClient, PlatformIpcError } from './platform'
import type { AccountDto, AccountOwnershipKindDto, AccountVisibilityDto, AppBootstrapDto, AttributionScopeDto, CardSettlementBalanceCoverageDto, CardSettlementBankMappingDto, CardSettlementDto, ClassificationRuleDto, DashboardMonthlyTotalsDto, DashboardPreferencesDto, DashboardWidgetIdDto, ExtractedDocumentDto, GmailInboxItemDto, GoogleDriveInboxItemDto, HouseholdDto, HouseholdMemberDto, ImportPreviewDto, ImportRunCountsDto, LastClassificationApplicationDto, ManualTransactionTypeDto, MonthlyCategoryBudgetDto, PendingReviewRunDto, PostingDecisionDto, PreviewCandidateDto, ReceiptMatchSuggestionDto, SavingsGoalDto, SourceRecordViewDto, TransactionDetailDto, TransactionLabelDto, TransactionRowDto, UpdatePostedTransactionInputDto, WatchedFileInboxCountsDto, WatchedFileInboxItemDto, WatchedFolderDto } from './platform'
import type { NavigationItem, PageId, Transaction } from './types'
import { useI18n } from './i18n'
import { KAKEFLOW_TOAST_EVENT, showToast, type ToastTone } from './toast'

const yen = (value: number) => `${value < 0 ? '−' : ''}¥${Math.abs(value).toLocaleString('ja-JP')}`
const portfolioPlatform = createPortfolioPlatform()
const brokeragePlatform = createBrokeragePlatform()
const investmentPerformancePlatform = createInvestmentPerformancePlatform()
const investmentMarketPlatform = createInvestmentMarketPlatform()
const aggregateAssetHistoryPlatform = createAggregateAssetHistoryPlatform()
const watchedFolderDiscoveryPlatform = createWatchedFolderDiscoveryPlatform()
const sourceImagePreviewPlatform = createSourceImagePreviewPlatform()
const protectedPdfPlatform = createProtectedPdfPlatform()
const accountGroupExportPlatform = createAccountGroupExportPlatform()
const financialCalendarPlatform = createFinancialCalendarPlatform()
const forecastActionPlatform = createForecastActionPlatform()

type StandardImportAccountRequirement = {
  kind: 'ASSET' | 'LIABILITY'
  subtype: 'BANK' | 'WALLET' | 'CREDIT_CARD'
  kindLabel: '銀行口座' | 'ウォレット口座' | 'カード口座'
  message: string
}

const STANDARD_IMPORT_ACCOUNT_REQUIREMENTS: Partial<Record<AdapterId, StandardImportAccountRequirement>> = {
  'mizuho-business-web-statement-v1': { kind: 'ASSET', subtype: 'BANK', kindLabel: '銀行口座', message: 'みずほビジネスWEB 入出金明細CSVの取込先銀行口座を選択してください。' },
  'resona-web-meisai-plus-v1': { kind: 'ASSET', subtype: 'BANK', kindLabel: '銀行口座', message: 'りそな銀行 Web入出金明細PLUS CSVの取込先銀行口座を選択してください。' },
  'personal-japanese-bank-ledger-v2': { kind: 'ASSET', subtype: 'BANK', kindLabel: '銀行口座', message: '銀行CSVの取込先銀行口座を選択してください。' },
  'japanese-bank-ledger-v1': { kind: 'ASSET', subtype: 'BANK', kindLabel: '銀行口座', message: '銀行CSVの取込先銀行口座を選択してください。' },
  'mufg-bizstation-all-details-v1': { kind: 'ASSET', subtype: 'BANK', kindLabel: '銀行口座', message: '三菱UFJ銀行 BizSTATION CSVの取込先銀行口座を選択してください。' },
  'mufg-bizstation-deposit-withdrawal-v1': { kind: 'ASSET', subtype: 'BANK', kindLabel: '銀行口座', message: '三菱UFJ銀行 BizSTATION 入出金明細CSVの取込先銀行口座を選択してください。' },
  'paypay-history-v2': { kind: 'ASSET', subtype: 'WALLET', kindLabel: 'ウォレット口座', message: 'PayPay履歴の取込先ウォレット口座を選択してください。' },
  'paypay-history-v1': { kind: 'ASSET', subtype: 'WALLET', kindLabel: 'ウォレット口座', message: 'PayPay履歴の取込先ウォレット口座を選択してください。' },
  'rakuten-enavi-v1': { kind: 'LIABILITY', subtype: 'CREDIT_CARD', kindLabel: 'カード口座', message: '楽天カード明細の取込先カード口座を選択してください。' },
  'amazon-mastercard-statement-v1': { kind: 'LIABILITY', subtype: 'CREDIT_CARD', kindLabel: 'カード口座', message: 'Amazon Mastercard明細の取込先カード口座を選択してください。' },
  'jcb-myjcb-statement-v1': { kind: 'LIABILITY', subtype: 'CREDIT_CARD', kindLabel: 'カード口座', message: 'JCB明細の取込先カード口座を選択してください。' },
  'smbc-vpass-statement-v1': { kind: 'LIABILITY', subtype: 'CREDIT_CARD', kindLabel: 'カード口座', message: '三井住友カード（Vpass）明細の取込先カード口座を選択してください。' },
  'aeon-card-finalized-statement-v1': { kind: 'LIABILITY', subtype: 'CREDIT_CARD', kindLabel: 'カード口座', message: 'イオンカード確定明細の取込先カード口座を選択してください。' },
  'paypay-card-finalized-statement-v1': { kind: 'LIABILITY', subtype: 'CREDIT_CARD', kindLabel: 'カード口座', message: 'PayPayカード確定明細の取込先カード口座を選択してください。' },
}

function builtInAdapterVersion(adapterId: AdapterId): string {
  return adapterId === 'personal-japanese-bank-ledger-v2' || adapterId === 'paypay-history-v2' ? '2' : '1'
}

type DedicatedBrokerageImportConfig = {
  readonly title: string
  readonly description: string
  readonly accountHint: string
  readonly missingAccountMessage: string
}

const DEDICATED_BROKERAGE_IMPORTS: Readonly<Record<string, DedicatedBrokerageImportConfig>> = {
  'sbi-securities-trade-history-v1': {
    title: 'SBI証券 取引履歴CSV',
    description: '取引履歴を保存する証券口座を原本ごとに明示します。家計簿の取引台帳へは自動反映しません。',
    accountHint: 'SBI証券の口座を推測または自動作成しません。',
    missingAccountMessage: 'SBI証券取引履歴の取込先証券口座を選択してください。',
  },
  'rakuten-securities-domestic-trade-history-v1': {
    title: '楽天証券 国内株式 取引履歴CSV',
    description: '国内株式の取引履歴を保存する証券口座を原本ごとに明示します。家計簿の取引台帳へは自動反映しません。',
    accountHint: '楽天証券の口座を推測または自動作成しません。',
    missingAccountMessage: '楽天証券取引履歴の取込先証券口座を選択してください。',
  },
  'monex-us-stock-trade-history-v1': {
    title: 'マネックス証券 米国株 取引履歴CSV',
    description: '米ドル決済の現物売買を保存する証券口座を原本ごとに明示します。家計簿の取引台帳へは自動反映しません。',
    accountHint: 'マネックス証券の口座を推測または自動作成せず、円決済・信用取引も取り込みません。',
    missingAccountMessage: 'マネックス証券取引履歴の取込先証券口座を選択してください。',
  },
}

function dedicatedBrokerageImport(adapterId: AdapterId | undefined): DedicatedBrokerageImportConfig | undefined {
  return adapterId ? DEDICATED_BROKERAGE_IMPORTS[adapterId] : undefined
}

function isBrokerageTransactionAdapter(adapterId: AdapterId | undefined): boolean {
  return adapterId === 'japanese-brokerage-transactions-v1' || dedicatedBrokerageImport(adapterId) != null
}

function hasCompatibleStandardImportAccount(adapterId: AdapterId | undefined, accounts: readonly AccountDto[]): boolean {
  if (!adapterId) return true
  const requirement = STANDARD_IMPORT_ACCOUNT_REQUIREMENTS[adapterId]
  return !requirement || accounts.some((account) => account.accountKind === requirement.kind && account.accountSubtype === requirement.subtype)
}

function moneyForwardInstitutions(item: ImportPreview): readonly string[] {
  if (item.detectedAdapterId !== 'money-forward-me-household-ledger-v1' || !item.parsed) return []
  const institutions = item.parsed.records.flatMap((record) => {
    if (typeof record !== 'object' || record === null) return []
    const candidate = record as { kind?: unknown; institution?: unknown }
    return candidate.kind === 'money-forward-household-transaction' && typeof candidate.institution === 'string' && candidate.institution ? [candidate.institution] : []
  })
  return [...new Set(institutions)]
}

function eligibleMoneyForwardAccounts(accounts: readonly AccountDto[]): readonly AccountDto[] {
  return accounts.filter((account) => account.accountKind === 'ASSET' || account.accountKind === 'LIABILITY')
}

function importAccountDescriptionId(item: ImportPreview, accounts: readonly AccountDto[]): string | undefined {
  if (!hasCompatibleStandardImportAccount(item.detectedAdapterId, accounts)) return `standard-account-empty-${item.id}`
  if (item.detectedAdapterId === 'money-forward-me-household-ledger-v1' && eligibleMoneyForwardAccounts(accounts).length === 0) return `money-forward-account-empty-${item.id}`
  return undefined
}

function hasCompleteMoneyForwardMapping(item: ImportPreview, mappings: Readonly<Record<string, string>> | undefined, accounts: readonly AccountDto[]): boolean {
  const institutions = moneyForwardInstitutions(item)
  if (institutions.length === 0 || !mappings || Object.keys(mappings).length !== institutions.length) return false
  return institutions.every((institution) => {
    const account = eligibleMoneyForwardAccounts(accounts).find((candidate) => candidate.id === mappings[institution])
    return account?.accountKind === 'ASSET' || account?.accountKind === 'LIABILITY'
  })
}

function currentTokyoPeriod(now = new Date()) {
  const parts = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Tokyo', year: 'numeric', month: '2-digit' }).formatToParts(now)
  const year = Number(parts.find((part) => part.type === 'year')?.value)
  const monthNumber = Number(parts.find((part) => part.type === 'month')?.value)
  const month = `${year}-${String(monthNumber).padStart(2, '0')}`
  const lastDay = new Date(Date.UTC(year, monthNumber, 0)).getUTCDate()
  return { month, fromDate: `${month}-01`, toDate: `${month}-${String(lastDay).padStart(2, '0')}` }
}

function currentTokyoDate(now = new Date()) {
  const parts = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Tokyo', year: 'numeric', month: '2-digit', day: '2-digit' }).formatToParts(now)
  const value = (type: 'year' | 'month' | 'day') => parts.find((part) => part.type === type)?.value ?? ''
  return `${value('year')}-${value('month')}-${value('day')}`
}

function periodFromMonth(month: string) {
  const match = /^(\d{4})-(\d{2})$/.exec(month)
  if (!match) return currentTokyoPeriod()
  const year = Number(match[1])
  const monthNumber = Number(match[2])
  if (monthNumber < 1 || monthNumber > 12) return currentTokyoPeriod()
  const lastDay = new Date(Date.UTC(year, monthNumber, 0)).getUTCDate()
  return { month, fromDate: `${month}-01`, toDate: `${month}-${String(lastDay).padStart(2, '0')}` }
}

const ACCOUNT_SCOPE_STORAGE_KEY = 'kakeflow.accountScope'
const ATTRIBUTION_SCOPE_STORAGE_KEY = 'kakeflow.attributionScopes'
const ALL_ATTRIBUTION_SCOPE: AttributionScopeDto = Object.freeze({ kind: 'ALL' })

function readSavedAccountScope(): { householdId: string; groupId: string } | null {
  try {
    const value = globalThis.localStorage?.getItem(ACCOUNT_SCOPE_STORAGE_KEY)
    if (!value) return null
    const parsed = JSON.parse(value) as unknown
    if (typeof parsed !== 'object' || parsed === null) return null
    const item = parsed as Record<string, unknown>
    return typeof item.householdId === 'string' && typeof item.groupId === 'string' ? { householdId: item.householdId, groupId: item.groupId } : null
  } catch { return null }
}

function readSavedAttributionScopes(): Record<string, AttributionScopeDto> {
  try {
    const value = globalThis.localStorage?.getItem(ATTRIBUTION_SCOPE_STORAGE_KEY)
    if (!value) return {}
    const parsed = JSON.parse(value) as unknown
    if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) return {}
    return Object.fromEntries(Object.entries(parsed).flatMap(([householdId, scope]) => {
      if (typeof scope !== 'object' || scope === null || Array.isArray(scope)) return []
      const item = scope as Record<string, unknown>
      if (item.kind === 'ALL' || item.kind === 'HOUSEHOLD_COMMON') return [[householdId, { kind: item.kind } as AttributionScopeDto]]
      if (item.kind === 'MEMBER' && typeof item.memberId === 'string' && item.memberId) return [[householdId, { kind: 'MEMBER', memberId: item.memberId } as AttributionScopeDto]]
      return []
    }))
  } catch { return {} }
}

function writeSavedAttributionScope(householdId: string, scope: AttributionScopeDto): void {
  const scopes = readSavedAttributionScopes()
  if (scope.kind === 'ALL') delete scopes[householdId]
  else scopes[householdId] = scope
  if (Object.keys(scopes).length === 0) globalThis.localStorage?.removeItem(ATTRIBUTION_SCOPE_STORAGE_KEY)
  else globalThis.localStorage?.setItem(ATTRIBUTION_SCOPE_STORAGE_KEY, JSON.stringify(scopes))
}

const navigation: NavigationItem[] = [
  { id: 'overview', label: 'ホーム', icon: Home },
  { id: 'transactions', label: '取引', icon: WalletCards },
  { id: 'import', label: 'インポート', icon: Import },
  { id: 'capture', label: '撮影 Inbox', icon: Camera },
  { id: 'cards', label: 'カード照合', icon: CreditCard },
  { id: 'investments', label: '資産・投資', icon: TrendingUp },
  { id: 'reports', label: 'カレンダー・レポート', icon: CalendarDays },
  { id: 'budgets', label: '予算・目標', icon: Goal },
  { id: 'rules', label: '分類ルール', icon: Sparkles },
  { id: 'family', label: '家族スペース', icon: Users },
]

const navigationSections: readonly { label: string; pages: readonly PageId[] }[] = [
  { label: 'メイン', pages: ['overview', 'transactions'] },
  { label: '取り込み', pages: ['import', 'capture'] },
  { label: '照合・資産', pages: ['cards', 'investments'] },
  { label: '計画・分析', pages: ['reports', 'budgets', 'rules'] },
  { label: '世帯', pages: ['family'] },
]

const pageMeta: Readonly<Record<PageId, { title: string; description: string }>> = {
  overview: { title: 'ホーム', description: '世帯の状況・重要アクション・データ品質' },
  transactions: { title: '取引', description: '確定済み元帳 — 検索・証跡・ドリルダウン' },
  import: { title: 'インポート', description: 'ファイル検出 → レビュー → 転記' },
  capture: { title: '撮影 Inbox', description: 'レシート原本・端末内OCR・取込候補' },
  cards: { title: 'カード照合', description: '明細・引落口座・支払照合' },
  investments: { title: '資産・投資', description: 'スナップショット・保有・実現損益' },
  reports: { title: 'カレンダー・レポート', description: '月次・年次・予測・固定費' },
  budgets: { title: '予算・目標', description: '計画値と確定台帳の比較' },
  rules: { title: '分類ルール', description: '決定的で説明可能な分類ルール' },
  family: { title: '家族スペース', description: '世帯メンバー・帰属・共有レビュー' },
  settings: { title: '設定', description: '口座・ローカルデータ・バックアップ' },
}

function householdInitials(name: string): string { return name.trim().slice(0, 2) || '家計' }

function Sidebar({ page, setPage, open, close, bootstrap, households, activeHouseholdId, selectHousehold, createHousehold, importActionableCount, capturePendingCount }: { page: PageId; setPage: (page: PageId) => void; open: boolean; close: () => void; bootstrap: AppBootstrapDto | null; households: readonly HouseholdDto[]; activeHouseholdId: string | null; selectHousehold: (id: string) => void; createHousehold: () => void; importActionableCount: number; capturePendingCount: number }) {
  const { locale, text } = useI18n()
  const [householdOpen, setHouseholdOpen] = useState(false)
  const householdRef = useRef<HTMLDivElement>(null)
  const activeHouseholdName = households.find((household) => household.id === activeHouseholdId)?.name ?? (platformClient.runtime === 'web' ? '田中家' : '家計')
  useEffect(() => {
    const closeOutside = (event: MouseEvent) => { if (!householdRef.current?.contains(event.target as Node)) setHouseholdOpen(false) }
    const closeEscape = (event: globalThis.KeyboardEvent) => { if (event.key === 'Escape') setHouseholdOpen(false) }
    document.addEventListener('mousedown', closeOutside)
    document.addEventListener('keydown', closeEscape)
    return () => { document.removeEventListener('mousedown', closeOutside); document.removeEventListener('keydown', closeEscape) }
  }, [])
  return (
    <>
      {open && <button className="sidebar-backdrop" aria-label={text('メニューを閉じる')} onClick={close} />}
      <aside className={`sidebar ${open ? 'sidebar--open' : ''}`} aria-label={text('メインナビゲーション')}>
        <div className="brand">
          <img className="brand-mark" src={kakeflowLogo} alt="" aria-hidden="true" />
          <span>kakeflow</span>
          <small className="brand-version">1.0.0</small>
          <button className="icon-btn mobile-close" aria-label={text('メニューを閉じる')} onClick={close}><X size={19} /></button>
        </div>

        <div className="household-picker" ref={householdRef}>
          <div className="avatar" aria-hidden="true">{householdInitials(activeHouseholdName)}</div>
          <button type="button" className="household-trigger" aria-haspopup="menu" aria-expanded={householdOpen} onClick={() => setHouseholdOpen((value) => !value)}><strong>{activeHouseholdName}</strong><small>{households.length > 1 ? `${households.length}世帯` : text('ローカル世帯')}</small></button><ChevronDown size={14} aria-hidden="true" />
          <label className="visually-hidden">{text('世帯を切り替える')}<select aria-label={text('世帯を切り替える')} value={activeHouseholdId ?? ''} onChange={(event) => selectHousehold(event.target.value)}><option value="" disabled>{activeHouseholdName}</option>{households.map((household) => <option key={household.id} value={household.id}>{household.name}</option>)}</select></label>
          {householdOpen && <div className="household-menu" role="menu" aria-label={text('世帯を切り替える')}>{households.length === 0 ? <button role="menuitem" className="selected"><span><Check size={13} />{activeHouseholdName}</span></button> : households.map((household) => <button role="menuitem" className={household.id === activeHouseholdId ? 'selected' : ''} key={household.id} onClick={() => { selectHousehold(household.id); setHouseholdOpen(false) }}><span>{household.id === activeHouseholdId && <Check size={13} />}{household.name}</span></button>)}<button role="menuitem" className="household-create" onClick={() => { setHouseholdOpen(false); createHousehold() }}>＋ 新しい世帯を作成…</button></div>}
        </div>

        <nav>
          {navigationSections.map((section) => <div className="nav-section" key={section.label}>
          <p className="nav-caption">{text(section.label)}</p>
          {navigation.filter((item) => section.pages.includes(item.id)).map((item) => (
            <button
              key={item.id}
              className={`nav-item ${page === item.id ? 'active' : ''}`}
              aria-label={item.id === 'import' && importActionableCount > 0 ? locale === 'ja' ? `${item.label}（${importActionableCount}件の確認対象）` : `${text(item.label)} (${importActionableCount})` : item.id === 'capture' && capturePendingCount > 0 ? locale === 'ja' ? `${item.label}（${capturePendingCount}件の確認対象）` : `${text(item.label)} (${capturePendingCount})` : text(item.label)}
              onClick={() => { setPage(item.id); close() }}
            >
              <item.icon size={19} />
              <span>{text(item.label)}</span>
              {item.id === 'import' && (importActionableCount > 0 || platformClient.runtime === 'web') ? <b aria-hidden="true">{platformClient.runtime === 'web' && importActionableCount === 0 ? 2 : importActionableCount > 99 ? '99+' : importActionableCount}</b> : item.id === 'capture' && (capturePendingCount > 0 || platformClient.runtime === 'web') ? <b aria-hidden="true">{platformClient.runtime === 'web' && capturePendingCount === 0 ? 2 : capturePendingCount > 99 ? '99+' : capturePendingCount}</b> : item.badge && <b>{item.badge}</b>}
            </button>
          ))}</div>)}
        </nav>

        <div className="sidebar-foot">
          <div className={`sync-status ${bootstrap?.database.healthy ? '' : 'sync-status--offline'}`}><span /><div><strong>{text('ローカル · デスクトップ版')}</strong><small>{bootstrap?.database.healthy ? `Schema v${bootstrap.database.schemaVersion}` : text(platformClient.runtime === 'web' ? 'ブラウザプレビュー' : 'データベース確認中')}</small></div></div>
          <button className={`nav-item ${page === 'settings' ? 'active' : ''}`} onClick={() => { setPage('settings'); close() }}><Settings size={19} /><span>{text('設定')}</span></button>
        </div>
      </aside>
    </>
  )
}

type WorkspaceBasis = 'ACCRUAL' | 'CASH' | 'BALANCE'

function shiftMonth(month: string, delta: number): string {
  const date = new Date(`${month}-01T12:00:00`)
  date.setMonth(date.getMonth() + delta)
  const next = `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}`
  return next > currentTokyoPeriod().month ? currentTokyoPeriod().month : next
}

function DesktopTitleBar({ householdName }: { householdName: string }) {
  const os = navigator.userAgent.includes('Windows') ? 'windows' : 'macos'
  return <div className={`desktop-titlebar desktop-titlebar--${os}`} data-tauri-drag-region>
    <div className="mac-traffic-lights" aria-hidden="true"><i /><i /><i /></div>
    <div className="windows-app-title" aria-hidden="true"><span>家</span><b>KakeFlow — {householdName}</b></div>
    <strong>KakeFlow — {householdName}</strong>
    <div className="windows-caption-buttons" aria-hidden="true"><button tabIndex={-1}>─</button><button tabIndex={-1}>□</button><button tabIndex={-1}>×</button></div>
  </div>
}

function Topbar({ page, openMenu, month, setMonth, accountGroups, accountGroupId, setAccountGroupId, attributionScope, setAttributionScope, members, showAccountScope, showBasis, basis, setBasis }: { page: PageId; openMenu: () => void; month: string; setMonth: (month: string) => void; accountGroups: readonly AccountGroupDto[]; accountGroupId: string | null; setAccountGroupId: (groupId: string | null) => void; attributionScope: AttributionScopeDto; setAttributionScope: (scope: AttributionScopeDto) => void; members: readonly HouseholdMemberDto[]; showAccountScope: boolean; showBasis: boolean; basis: WorkspaceBasis; setBasis: (basis: WorkspaceBasis) => void }) {
  const { text } = useI18n()
  const meta = pageMeta[page]
  const [openPopover, setOpenPopover] = useState<'scope' | 'period' | null>(null)
  const [pickerYear, setPickerYear] = useState(() => Number(month.slice(0, 4)))
  const controlsRef = useRef<HTMLDivElement>(null)
  const selectedScopeLabel = accountGroups.find((group) => group.id === accountGroupId)?.name ?? text('すべての口座')
  const currentMonth = currentTokyoPeriod().month
  const monthLabel = new Intl.DateTimeFormat('ja-JP', { year: 'numeric', month: 'long' }).format(new Date(`${month}-01T12:00:00`))
  useEffect(() => {
    const close = (event: MouseEvent) => { if (!controlsRef.current?.contains(event.target as Node)) setOpenPopover(null) }
    const closeOnEscape = (event: globalThis.KeyboardEvent) => { if (event.key === 'Escape') setOpenPopover(null) }
    document.addEventListener('mousedown', close)
    document.addEventListener('keydown', closeOnEscape)
    return () => { document.removeEventListener('mousedown', close); document.removeEventListener('keydown', closeOnEscape) }
  }, [])
  const selectPeriod = (next: string) => { setMonth(next); setPickerYear(Number(next.slice(0, 4))); setOpenPopover(null) }
  return (
    <header className={`topbar topbar--${page}`}>
      <button className="icon-btn menu-btn" aria-label={text('メニューを開く')} onClick={openMenu}><Menu size={21} /></button>
      <div className="topbar-context"><strong>{text(meta.title)}</strong><span>{text(meta.description)}</span></div>
      <div className="top-actions" ref={controlsRef}>
        {showAccountScope && <div className="workspace-popover-control"><button className="scope-trigger" aria-haspopup="dialog" aria-expanded={openPopover === 'scope'} onClick={() => setOpenPopover((value) => value === 'scope' ? null : 'scope')}>範囲: <strong>{selectedScopeLabel}</strong><ChevronDown size={13} /></button>{openPopover === 'scope' && <div className="scope-popover" role="dialog" aria-label="集計範囲"><section><p>口座グループ</p><button className={accountGroupId === null ? 'selected' : ''} onClick={() => { setAccountGroupId(null); setOpenPopover(null) }}><span>{accountGroupId === null && <Check size={13} />}すべての口座</span><small>{accountGroups.reduce((sum, group) => sum + group.accountIds.length, 0) || '全'}口座</small></button>{accountGroups.map((group) => <button key={group.id} className={accountGroupId === group.id ? 'selected' : ''} onClick={() => { setAccountGroupId(group.id); setOpenPopover(null) }}><span>{accountGroupId === group.id && <Check size={13} />}{group.name}</span><small>{group.accountIds.length}口座</small></button>)}</section><section><p>帰属</p><button className={attributionScope.kind === 'ALL' ? 'selected' : ''} onClick={() => { setAttributionScope(ALL_ATTRIBUTION_SCOPE); setOpenPopover(null) }}><span>{attributionScope.kind === 'ALL' && <Check size={13} />}世帯全体</span></button>{members.filter((member) => member.status === 'ACTIVE').map((member) => <button key={member.id} className={attributionScope.kind === 'MEMBER' && attributionScope.memberId === member.id ? 'selected' : ''} onClick={() => { setAttributionScope({ kind: 'MEMBER', memberId: member.id }); setOpenPopover(null) }}><span>{attributionScope.kind === 'MEMBER' && attributionScope.memberId === member.id && <Check size={13} />}{member.displayName}のみ</span></button>)}</section></div>}</div>}
        <div className="period-stepper"><button aria-label="前月" onClick={() => selectPeriod(shiftMonth(month, -1))}><ChevronLeft size={14} /></button><button aria-haspopup="dialog" aria-expanded={openPopover === 'period'} onClick={() => { setPickerYear(Number(month.slice(0, 4))); setOpenPopover((value) => value === 'period' ? null : 'period') }}>{monthLabel}</button><button aria-label="翌月" disabled={month >= currentMonth} onClick={() => selectPeriod(shiftMonth(month, 1))}><ChevronRight size={14} /></button>{openPopover === 'period' && <div className="period-popover" role="dialog" aria-label="対象月を選択"><header><button aria-label="前年" onClick={() => setPickerYear((year) => year - 1)}><ChevronLeft size={14} /></button><strong>{pickerYear}年</strong><button aria-label="翌年" disabled={pickerYear >= Number(currentMonth.slice(0, 4))} onClick={() => setPickerYear((year) => year + 1)}><ChevronRight size={14} /></button></header><div className="month-grid">{Array.from({ length: 12 }, (_, index) => { const value = `${pickerYear}-${String(index + 1).padStart(2, '0')}`; const future = value > currentMonth; const partial = value === month || value === currentMonth; return <button key={value} disabled={future} className={value === month ? 'selected' : ''} onClick={() => selectPeriod(value)}><span>{index + 1}月</span>{future ? <Minus size={11} /> : partial ? <CircleDotDashed size={11} /> : <Check size={11} />}</button> })}</div><footer><span><Check size={11} /> 完全</span><span><CircleDotDashed size={11} /> 一部</span><span><Minus size={11} /> なし</span><button onClick={() => selectPeriod(currentMonth)}>今月</button></footer></div>}</div>
        {showBasis && <div className="workspace-basis" role="group" aria-label="計上基準">{([['ACCRUAL', '発生'], ['CASH', '資金移動'], ['BALANCE', '残高']] as const).map(([value, label]) => <button key={value} className={basis === value ? 'active' : ''} aria-pressed={basis === value} disabled={value === 'BALANCE'} title={value === 'BALANCE' ? '残高ベースは読み取りモデル対応後に有効になります' : undefined} onClick={() => setBasis(value)}>{label}</button>)}</div>}
      </div>
      <div className="topbar-native-fallback" hidden aria-hidden="true"><label>対象月<input tabIndex={-1} type="month" value={month} onChange={(event) => selectPeriod(event.target.value)} /></label>{showAccountScope && <><label>口座スコープ<select tabIndex={-1} value={accountGroupId ?? ''} onChange={(event) => setAccountGroupId(event.target.value || null)}><option value="">すべての口座</option>{accountGroups.map((group) => <option key={group.id} value={group.id}>{group.name}</option>)}</select></label><label>家族集計範囲<select tabIndex={-1} value={attributionScope.kind === 'MEMBER' ? `MEMBER:${attributionScope.memberId}` : attributionScope.kind} onChange={(event) => { const value = event.target.value; setAttributionScope(value === 'HOUSEHOLD_COMMON' ? { kind: 'HOUSEHOLD_COMMON' } : value.startsWith('MEMBER:') ? { kind: 'MEMBER', memberId: value.slice(7) } : ALL_ATTRIBUTION_SCOPE) }}><option value="ALL">世帯全体</option><option value="HOUSEHOLD_COMMON">世帯共通</option>{members.map((member) => <option key={member.id} value={`MEMBER:${member.id}`}>{member.displayName}</option>)}</select></label></>}</div>
    </header>
  )
}

function PageHeader({ eyebrow, title, description, children }: { eyebrow: string; title: string; description: string; children?: React.ReactNode }) {
  const { text } = useI18n()
  return (
    <div className="page-header">
      <div><p>{text(eyebrow)}</p><h1>{text(title)}</h1><span>{text(description)}</span></div>
      <div className="page-actions">{children}</div>
    </div>
  )
}

function ToastCenter() {
  const [toast, setToast] = useState<{ readonly message: string; readonly tone: ToastTone } | null>(null)
  useEffect(() => {
    let timer: ReturnType<typeof globalThis.setTimeout> | undefined
    const receive = (event: Event) => {
      const detail = (event as CustomEvent<{ message?: unknown; tone?: unknown }>).detail
      if (typeof detail?.message !== 'string' || !detail.message.trim()) return
      const tone: ToastTone = detail.tone === 'error' || detail.tone === 'info' ? detail.tone : 'success'
      setToast({ message: detail.message, tone })
      if (timer) globalThis.clearTimeout(timer)
      timer = globalThis.setTimeout(() => setToast(null), 2600)
    }
    globalThis.addEventListener(KAKEFLOW_TOAST_EVENT, receive)
    return () => { globalThis.removeEventListener(KAKEFLOW_TOAST_EVENT, receive); if (timer) globalThis.clearTimeout(timer) }
  }, [])
  if (!toast) return null
  return <div className={`global-toast global-toast-${toast.tone}`} role={toast.tone === 'error' ? 'alert' : 'status'}><span>{toast.tone === 'error' ? <X size={15} /> : <Check size={15} />}</span><p>{toast.message}</p><button className="icon-btn" aria-label="通知を閉じる" onClick={() => setToast(null)}><X size={14} /></button></div>
}

function KpiCard({ label, value, meta, trend, icon: Icon, accent }: { label: string; value: string; meta: string; trend?: string; icon: typeof TrendingUp; accent: string }) {
  const { locale, text } = useI18n()
  return (
    <article className="kpi-card">
      <div className="kpi-head"><div className="kpi-icon" style={{ background: accent }}><Icon size={18} /></div><span>{text(label)}</span><small>{text(meta.includes('資金移動') || label.includes('入金') || label.includes('出金') ? '資金移動' : label.includes('純資産') || label === '資産' || label === '負債' ? '残高' : '発生')}</small></div>
      <strong>{value}</strong>
      <div className="kpi-meta">{trend && <em aria-label={locale === 'ja' ? `${trend} 増加` : trend}><ArrowUpRight aria-hidden="true" size={13} /><span aria-hidden="true">{trend}</span></em>}<span>{text(meta)}</span></div>
    </article>
  )
}

function TrendChart({ data = spendingTrend.slice(-6).map((point) => ({ month: point.month, income: point.income * 1000, expense: point.expense * 1000 })), incomeLabel = '収入', expenseLabel = '支出' }: { data?: readonly { month: string; income: number; expense: number }[]; incomeLabel?: string; expenseLabel?: string }) {
  const { locale, text } = useI18n()
  if (data.length === 0) return <p className="empty-state">トレンドを表示する取引はまだありません。</p>
  const max = Math.max(1, ...data.flatMap((point) => [point.income, point.expense]))
  const periodLabel = locale === 'ja' ? `直近${data.length}か月` : `${data.length} months`
  return (
    <div className="chart-wrap chart-bars" role="img" aria-label={`${periodLabel}の${text(incomeLabel)}と${text(expenseLabel)}`}>
      <div className="bar-grid" aria-hidden="true">{[1, .75, .5, .25].map((line) => <i key={line} style={{ bottom: `${line * 100}%` }} />)}</div>
      <div className="bar-columns">{data.map((point) => <div className="bar-month" key={point.month} aria-label={`${point.month}: ${text(incomeLabel)} ${yen(point.income)}、${text(expenseLabel)} ${yen(point.expense)}`}><div className="bar-pair"><span className="bar-income" style={{ height: `${Math.max(3, point.income / max * 100)}%` }} /><span className="bar-expense" style={{ height: `${Math.max(3, point.expense / max * 100)}%` }} /></div><small>{point.month.includes('-') ? `${Number(point.month.slice(5))}月` : point.month}</small></div>)}</div>
      <table className="visually-hidden"><caption>{periodLabel}の{text(incomeLabel)}と{text(expenseLabel)}</caption><thead><tr><th>{locale === 'ja' ? '月' : text('対象月')}</th><th>{text(incomeLabel)}</th><th>{text(expenseLabel)}</th></tr></thead><tbody>{data.map((point) => <tr key={`table-${point.month}`}><th>{point.month}</th><td>{point.income}{locale === 'ja' ? '円' : ' JPY'}</td><td>{point.expense}{locale === 'ja' ? '円' : ' JPY'}</td></tr>)}</tbody></table>
    </div>
  )
}

function SpendingCard({ expense = currentMonthMetrics.expense, categories, onDetails }: { expense?: number; categories?: readonly { name: string; amount: number }[]; onDetails: () => void }) {
  const { text } = useI18n()
  const palette = ['#a64f43', '#9b443b', '#a56c22', '#a34f43', '#9d4a41', '#a65b4b']
  const source = categories ? categories.filter((item) => item.amount > 0).slice(0, 6).map((item, index) => ({ ...item, color: palette[index % palette.length] })) : categoryData
  const categoryTotal = source.reduce((total, item) => total + item.amount, 0)
  const legend = source.map((item) => ({ ...item, pct: categoryTotal > 0 ? Math.round(item.amount / categoryTotal * 100) : 0 }))
  const max = Math.max(1, ...legend.map((item) => item.amount))
  return (
    <article className="panel spending-card">
      <div className="panel-head"><div><h2>{text('カテゴリ別支出')}</h2><p>{text('発生ベース')} · {yen(expense)}</p></div><button className="text-btn" onClick={onDetails}>{text('詳細を見る')} <ArrowRight size={14} /></button></div>
      <div className="category-bars">{legend.length > 0 ? legend.map((item) => <button type="button" onClick={onDetails} key={item.name}><span>{text(item.name)}<strong>{yen(item.amount)}</strong></span><i><b style={{ width: `${Math.max(4, item.amount / max * 100)}%`, background: item.color }} /></i></button>) : <p className="empty-state">—</p>}</div>
    </article>
  )
}

const txIcons = { food: Utensils, home: Zap, transport: TrainFront, income: ArrowDownLeft, subscription: Sparkles }

const transactionLabelNames: Readonly<Record<TransactionLabelDto, string>> = {
  SUBSCRIPTION: 'サブスク', RECURRING: '定期', TAX_DEDUCTIBLE: '税控除', REIMBURSABLE: '立替',
  UNUSUAL: '通常外', SHARED_EXPENSE: '共通支出', PRIVATE_EXPENSE: '個人支出',
}

const transactionTypeLabels: Readonly<Record<NonNullable<Transaction['transactionType']>, string>> = {
  INCOME: '収入', EXPENSE: '支出', TRANSFER: '振替', CARD_PURCHASE: 'カード購入', CARD_PAYMENT: 'カード支払', REFUND: '返金', OTHER: '取引',
}

function TransactionRows({ rows = transactions, onSelect, selectedIds, onToggleSelection, compact = !onSelect }: { rows?: readonly Transaction[]; onSelect?: (id: string, trigger: HTMLButtonElement) => void; selectedIds?: ReadonlySet<string>; onToggleSelection?: (id: string, selected: boolean) => void; compact?: boolean }) {
  const { text } = useI18n()
  if (!compact) return <div className="transaction-ledger" role="table" aria-label="確定取引">
    <div className="transaction-ledger-head" role="row">{onToggleSelection && <span aria-hidden="true" />}<span>日付</span><span>摘要</span><span>カテゴリ</span><span>口座</span><span>種別</span><span>金額</span><span aria-label="証跡">証跡</span></div>
    {rows.map((tx) => {
      const txType = tx.transactionType ?? (tx.amount > 0 ? 'INCOME' : tx.accountingEffect === 'CASH_ONLY' ? 'CARD_PAYMENT' : 'EXPENSE')
      const row = <button type="button" className="transaction-ledger-row" onClick={(event) => onSelect?.(tx.id, event.currentTarget)} role="row"><span className="tx-date">{tx.date}</span><span className="tx-description"><strong>{tx.merchant}</strong><small>{tx.detail}</small>{tx.calculationTarget === false && <em className="calculation-badge excluded">{text('集計対象外')}</em>}</span><span><b className="category-pill">{text(tx.category)}</b></span><span className="tx-account">{tx.account}</span><span><b className={`transaction-type type-${txType.toLowerCase()}`}>{transactionTypeLabels[txType]}</b></span><strong className={`tx-amount ${txType === 'INCOME' || txType === 'REFUND' ? 'amount-positive' : txType === 'EXPENSE' || txType === 'CARD_PURCHASE' ? 'amount-expense' : ''}`}>{yen(tx.amount)}</strong><span className="tx-evidence" aria-label="原本証跡あり"><FileCheck2 size={14} /></span></button>
      return <div className="transaction-ledger-selection" role="rowgroup" key={tx.id}>{onToggleSelection && <label className="transaction-selector"><input type="checkbox" aria-label={`${tx.merchant}を一括編集対象に選択`} checked={selectedIds?.has(tx.id) ?? false} onChange={(event) => onToggleSelection(tx.id, event.target.checked)} /></label>}{row}</div>
    })}
  </div>
  return <div className="transaction-list">{rows.map((tx) => {
    const Icon = txIcons[tx.icon]
    const content = <>
      <div className={`transaction-icon ${tx.amount > 0 ? 'positive' : ''}`}><Icon size={18} /></div>
      <div className="transaction-main"><strong>{tx.merchant}</strong><span>{tx.date} ・ {tx.detail}</span><div className="transaction-family-labels"><span className={tx.calculationTarget === false ? 'calculation-badge excluded' : 'calculation-badge included'}>{text(tx.calculationTarget === false ? '集計対象外' : '計算対象')}</span>{tx.attributionLabel && tx.audienceLabel && <><span>{text('帰属')}: {tx.attributionLabel}</span><span>{text('表示')}: {tx.audienceLabel}</span></>}{tx.labels?.map((label) => <span className="metadata-label" key={label}>{text(transactionLabelNames[label as TransactionLabelDto] ?? label)}</span>)}{tx.tags?.map((tag) => <span className="metadata-tag" key={tag}>#{tag}</span>)}</div></div>
      <span className="category-pill">{text(tx.category)}</span>
      <span className="account-label">{tx.account}</span>
      <strong className={tx.amount > 0 ? 'amount-positive' : ''}>{yen(tx.amount)}</strong>
      {tx.status === 'review' && <span className="review-dot" title={text('要確認')} />}
    </>
    const row = onSelect
      ? <button type="button" className="transaction-row selectable" onClick={(event) => onSelect(tx.id, event.currentTarget)}>{content}</button>
      : <div className="transaction-row" key={tx.id}>{content}</div>
    return onToggleSelection
      ? <div className="transaction-selection-row" key={tx.id}><label className="transaction-selector"><input type="checkbox" aria-label={`${tx.merchant}を一括編集対象に選択`} checked={selectedIds?.has(tx.id) ?? false} onChange={(event) => onToggleSelection(tx.id, event.target.checked)} /></label>{row}</div>
      : <div key={tx.id}>{row}</div>
  })}</div>
}

function ReconciliationMini({ liveCards, desktop, onOpen }: { liveCards: readonly CardSettlementDto[]; desktop: boolean; onOpen: () => void }) {
  const { text } = useI18n()
  const cards = desktop ? liveCards.map((card) => ({
    name: card.cardName, mask: card.maskedIdentifier ?? '番号未設定', dueDate: card.paymentDueOn ?? card.periodEnd,
    statement: card.statementAmountJpy, bankDebit: card.paidAmountJpy || undefined,
    progress: card.statementAmountJpy === 0 ? 0 : Math.min(Math.round(card.paidAmountJpy / card.statementAmountJpy * 100), 100),
    status: card.reconciliationStatus === 'FULLY_RECONCILED' ? 'reconciled' as const : card.reconciliationStatus === 'PARTIALLY_RECONCILED' || card.eligiblePayments.length > 0 ? 'possible' as const : 'pending' as const,
    color: card.cardName.includes('Rakuten') ? '#b15b68' : '#394b5a',
  })) : cardSettlements
  return (
    <article className="panel reconciliation">
      <div className="panel-head"><div><h2>{text('カード支払い')}</h2><p>{text('請求と口座引落の照合')}</p></div><button className="text-btn" onClick={onOpen}>{text('照合を開く')} <ArrowRight size={14} /></button></div>
      <div className="card-stack">{cards.length > 0 ? cards.map((card) => <div className="settlement" key={card.name}>
        <div className="settlement-title"><i style={{ background: card.color }} /><div><strong>{card.name}</strong><span>{card.mask} ・ {card.dueDate}</span></div><b className={card.status}>{text(card.status === 'reconciled' ? '全額照合' : card.status === 'possible' ? '一部・候補あり' : '引落待ち')}</b></div>
        <div className="settlement-values"><span>{text('請求額')} <strong>{yen(card.statement)}</strong></span><span>{text('口座引落')} <strong>{card.bankDebit ? yen(card.bankDebit) : '—'}</strong></span></div>
        <div className="progress"><span style={{ width: `${card.progress}%` }} /></div>
      </div>) : <p className="empty-state">カード明細はまだありません。</p>}</div>
    </article>
  )
}

function DashboardDataQuality({ counts, desktop, onOpenImport }: { counts: ImportRunCountsDto | null; desktop: boolean; onOpenImport: () => void }) {
  const { localeCode, text } = useI18n()
  const data = desktop ? counts : { sourceDocuments: 15, sourceRecords: 1_286, pendingCandidates: 4, readyCandidates: 2, failed: 0, latestSuccessfulImportAt: '2026-07-12T14:55:16Z', latestSourceFilename: 'mufg_smbc_202607.csv', latestSourceType: 'MANUAL_UPLOAD', distinctSourceTypes: 5 } as ImportRunCountsDto
  const reviewCount = (data?.pendingCandidates ?? 0) + (data?.readyCandidates ?? 0)
  const state = !data || data.sourceDocuments === 0 ? '原本データなし' : data.failed > 0 ? '取込エラーあり' : reviewCount > 0 ? '確認待ちあり' : '確認済みデータを反映'
  const latest = data?.latestSuccessfulImportAt ? new Intl.DateTimeFormat(localeCode, { dateStyle: 'medium', timeStyle: 'short' }).format(new Date(data.latestSuccessfulImportAt)) : text('まだありません')
  return <section className="panel dashboard-data-quality" aria-labelledby="dashboard-data-quality-title">
    <div className="panel-head"><div><h2 id="dashboard-data-quality-title">{text('データ品質')}</h2><p>{text(desktop ? 'この端末の原本・取込・確認状態' : 'ブラウザプレビュー用のサンプル状態')}</p></div><b className={data?.failed ? 'error' : reviewCount ? 'review' : 'ready'}>{text(state)}</b></div>
    <div className="data-quality-grid"><div><span>{text('最終確定取込')}</span><strong>{latest}</strong><small>{data?.latestSourceFilename ?? text('原本未登録')}{data?.latestSourceType ? ` ・ ${data.latestSourceType}` : ''}</small></div><div><span>{text('原本とソース行')}</span><strong>{data?.sourceDocuments ?? 0}{text('原本')}</strong><small>{(data?.sourceRecords ?? 0).toLocaleString(localeCode)}{text('行')} ・ {data?.distinctSourceTypes ?? 0}{text('種類')}</small></div><div><span>{text('確認待ち候補')}</span><strong>{reviewCount}{text('件')}</strong><small>{text('確定するまでダッシュボード集計外')}</small></div><div><span>{text('失敗した取込')}</span><strong>{data?.failed ?? 0}{text('件')}</strong><small>{text('再実行または原本確認が必要')}</small></div></div>
    <button className="secondary-btn" onClick={onOpenImport}>{text('インポート Inboxを確認')} <ArrowRight size={14} /></button>
  </section>
}

const dashboardTemplateLabels: Record<DashboardPreferencesDto['template'], string> = {
  FINANCIAL_OVERVIEW: '財務概要',
  HOUSEHOLD_LEDGER: '家計簿',
  ASSETS_LIABILITIES: '資産・負債',
  CARD_RECONCILIATION: 'カード照合',
  CASH_FLOW: 'キャッシュフロー',
}

const dashboardWidgetLabels: Record<DashboardWidgetIdDto, string> = {
  TREND: '収支の推移',
  SPENDING: 'カテゴリ別支出',
  RECENT: '最近の取引',
  CARDS: 'カード支払い',
}

const dashboardTemplateWidgetOrder: Record<DashboardPreferencesDto['template'], readonly DashboardWidgetIdDto[]> = {
  FINANCIAL_OVERVIEW: ['TREND', 'SPENDING', 'RECENT', 'CARDS'],
  HOUSEHOLD_LEDGER: ['SPENDING', 'RECENT', 'TREND', 'CARDS'],
  ASSETS_LIABILITIES: ['TREND', 'SPENDING', 'CARDS', 'RECENT'],
  CARD_RECONCILIATION: ['CARDS', 'RECENT', 'TREND', 'SPENDING'],
  CASH_FLOW: ['TREND', 'RECENT', 'CARDS'],
}

type DashboardPreferenceChange = Partial<Pick<DashboardPreferencesDto, 'template' | 'theme' | 'density'>> & {
  readonly widgetOrder?: readonly DashboardWidgetIdDto[]
  readonly hiddenWidgets?: readonly DashboardWidgetIdDto[]
}

function exhaustiveWidgetOrder(template: DashboardPreferencesDto['template']): DashboardWidgetIdDto[] {
  const preferred = dashboardTemplateWidgetOrder[template]
  return [...preferred, ...(['TREND', 'SPENDING', 'RECENT', 'CARDS'] as const).filter((widget) => !preferred.includes(widget))]
}

function activeDashboardLayout(preferences: DashboardPreferencesDto) {
  return preferences.templateLayouts[preferences.template]
}

function effectiveHiddenWidgets(preferences: DashboardPreferencesDto): DashboardWidgetIdDto[] {
  const layout = activeDashboardLayout(preferences)
  const available = layout.widgetOrder.filter((widget) => dashboardTemplateWidgetOrder[preferences.template].includes(widget))
  return available.some((widget) => !layout.hiddenWidgets.includes(widget))
    ? [...layout.hiddenWidgets]
    : layout.hiddenWidgets.filter((widget) => widget !== available[0])
}

function DashboardControls({ preferences, disabled, onChange }: { preferences: DashboardPreferencesDto; disabled: boolean; onChange: (change: DashboardPreferenceChange) => void }) {
  const [editorOpen, setEditorOpen] = useState(false)
  const [editorBaseline, setEditorBaseline] = useState<{ widgetOrder: readonly DashboardWidgetIdDto[]; hiddenWidgets: readonly DashboardWidgetIdDto[] } | null>(null)
  const [dragging, setDragging] = useState<DashboardWidgetIdDto | null>(null)
  const [announcement, setAnnouncement] = useState('')
  const layout = activeDashboardLayout(preferences)
  const available = layout.widgetOrder.filter((widget) => dashboardTemplateWidgetOrder[preferences.template].includes(widget))
  const effectiveHidden = effectiveHiddenWidgets(preferences)
  const visibleCount = available.filter((widget) => !effectiveHidden.includes(widget)).length
  const visibleWidgets = available.filter((widget) => !effectiveHidden.includes(widget))
  const hiddenWidgets = available.filter((widget) => effectiveHidden.includes(widget))
  const move = (widget: DashboardWidgetIdDto, target: DashboardWidgetIdDto) => {
    if (widget === target) return
    const next = [...layout.widgetOrder]
    const from = next.indexOf(widget)
    const to = next.indexOf(target)
    next.splice(from, 1)
    next.splice(to, 0, widget)
    onChange({ widgetOrder: next })
    const position = next.filter((item) => available.includes(item)).indexOf(widget) + 1
    setAnnouncement(`${dashboardWidgetLabels[widget]}を${position}/${available.length}へ移動しました`)
  }
  const moveBy = (widget: DashboardWidgetIdDto, offset: -1 | 1) => {
    const index = visibleWidgets.indexOf(widget)
    const target = visibleWidgets[index + offset]
    if (target) move(widget, target)
  }
  const toggleVisible = (widget: DashboardWidgetIdDto) => {
    const hidden = effectiveHidden.includes(widget)
    if (!hidden && visibleCount <= 1) return
    onChange({ hiddenWidgets: hidden ? effectiveHidden.filter((item) => item !== widget) : [...effectiveHidden, widget] })
    setAnnouncement(`${dashboardWidgetLabels[widget]}を${hidden ? '表示' : '非表示に'}しました`)
  }
  return <div className="dashboard-controls-shell">
    <div className="dashboard-controls" aria-label="ダッシュボード表示設定">
      <span className="dashboard-control-label">テンプレート:</span>
      <div className="dashboard-template-chips" role="group" aria-label="ダッシュボードテンプレート">{Object.entries(dashboardTemplateLabels).map(([value, label]) => <button key={value} type="button" aria-label={`テンプレート: ${label}`} className={preferences.template === value ? 'active' : ''} aria-pressed={preferences.template === value} disabled={disabled} onClick={() => { setDragging(null); setAnnouncement(''); onChange({ template: value as DashboardPreferencesDto['template'] }) }}>{label}</button>)}</div>
      <div className="visually-hidden"><label>ホームの表示テンプレート<select aria-label="ホームの表示テンプレート" disabled={disabled} value={preferences.template} onChange={(event) => { setDragging(null); setAnnouncement(''); onChange({ template: event.target.value as DashboardPreferencesDto['template'] }) }}>{Object.entries(dashboardTemplateLabels).map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></label><label>アプリのテーマ<select aria-label="アプリのテーマ" disabled={disabled} value={preferences.theme} onChange={(event) => onChange({ theme: event.target.value as DashboardPreferencesDto['theme'] })}><option value="SYSTEM">システム</option><option value="LIGHT">ライト</option><option value="DARK">ダーク</option></select></label><label>画面の表示密度<select aria-label="画面の表示密度" disabled={disabled} value={preferences.density} onChange={(event) => onChange({ density: event.target.value as DashboardPreferencesDto['density'] })}><option value="COMFORTABLE">標準</option><option value="COMPACT">コンパクト</option></select></label></div>
      <button className="secondary-btn dashboard-layout-toggle" type="button" disabled={disabled} aria-expanded={editorOpen} onClick={() => { if (editorOpen) { setEditorOpen(false); setEditorBaseline(null) } else { setEditorBaseline({ widgetOrder: [...layout.widgetOrder], hiddenWidgets: [...layout.hiddenWidgets] }); setEditorOpen(true) } }}><LayoutDashboard size={15} /> レイアウト編集</button>
    </div>
    {editorOpen && <section className="dashboard-layout-editor" aria-labelledby="dashboard-layout-title">
      <div className="dashboard-layout-head"><div><strong id="dashboard-layout-title">ウィジェットの並びと表示</strong><span>{dashboardTemplateLabels[preferences.template]}に適用</span></div><div><button type="button" disabled={disabled} onClick={() => onChange({ widgetOrder: exhaustiveWidgetOrder(preferences.template), hiddenWidgets: [] })}>テンプレートに戻す</button><button type="button" disabled={disabled || !editorBaseline} onClick={() => { if (editorBaseline) onChange(editorBaseline); setEditorOpen(false); setEditorBaseline(null) }}>キャンセル</button><button type="button" className="primary-btn" disabled={disabled} onClick={() => { setEditorOpen(false); setEditorBaseline(null); showToast('ホームのレイアウトを保存しました。') }}>完了</button></div></div>
      <div className="dashboard-layout-list">{visibleWidgets.map((widget, index) => {
        const lastVisible = visibleCount <= 1
        return <div className={`dashboard-layout-row${dragging === widget ? ' is-dragging' : ''}`} key={widget} draggable={!disabled} onDragStart={(event) => { setDragging(widget); event.dataTransfer.effectAllowed = 'move'; event.dataTransfer.setData('text/plain', widget) }} onDragEnd={() => setDragging(null)} onDragOver={(event) => { if (dragging) event.preventDefault() }} onDrop={(event) => { event.preventDefault(); if (dragging) move(dragging, widget); setDragging(null) }}>
          <GripVertical size={15} aria-hidden="true" /><strong>{dashboardWidgetLabels[widget]}</strong>
          <button type="button" className="layout-visibility" aria-label={`${dashboardWidgetLabels[widget]}を非表示`} aria-pressed="true" aria-describedby={lastVisible ? 'last-widget-note' : undefined} disabled={disabled || lastVisible} onClick={() => toggleVisible(widget)}>非表示</button>
          <button type="button" aria-label={`${dashboardWidgetLabels[widget]}を上へ移動`} disabled={disabled || index === 0} onClick={() => moveBy(widget, -1)}><ChevronUp size={15} /></button>
          <button type="button" aria-label={`${dashboardWidgetLabels[widget]}を下へ移動`} disabled={disabled || index === visibleWidgets.length - 1} onClick={() => moveBy(widget, 1)}><ChevronDown size={15} /></button>
        </div>
      })}</div>
      <div className="dashboard-hidden-tray" aria-label="非表示のウィジェット"><strong>非表示のウィジェット</strong>{hiddenWidgets.length > 0 ? <div>{hiddenWidgets.map((widget) => <button type="button" key={widget} disabled={disabled} onClick={() => toggleVisible(widget)}>{dashboardWidgetLabels[widget]} <span>復元</span></button>)}</div> : <span>非表示のウィジェットはありません。</span>}</div>
      <small id="last-widget-note">少なくとも1つのウィジェットを表示します。</small>
      <span className="sr-only" aria-live="polite">{announcement}</span>
    </section>}
  </div>
}

function Overview({ setPage, openAllActions, householdId, accountGroupId, attributionScope, revision, liveDashboard, liveTransactions, liveCards, importCounts, dashboardLoading, desktop, householdName, month, preferences, preferencesBusy, updatePreferences }: { setPage: (page: PageId) => void; openAllActions: () => void; householdId: string | null; accountGroupId: string | null; attributionScope: AttributionScopeDto; revision: number; liveDashboard: DashboardMonthlyTotalsDto | null; liveTransactions: readonly TransactionRowDto[]; liveCards: readonly CardSettlementDto[]; importCounts: ImportRunCountsDto | null; dashboardLoading: boolean; desktop: boolean; householdName: string; month: string; preferences: DashboardPreferencesDto; preferencesBusy: boolean; updatePreferences: (change: DashboardPreferenceChange) => void }) {
  const { locale, localeCode, text } = useI18n()
  const cashFlow = preferences.template === 'CASH_FLOW'
  const income = desktop ? liveDashboard?.incomeJpy ?? 0 : currentMonthMetrics.income
  const expense = desktop ? liveDashboard?.expenseJpy ?? 0 : currentMonthMetrics.expense
  const projectedSavings = desktop ? liveDashboard?.savingsJpy ?? 0 : savings
  const displayTransactions = desktop ? liveTransactions.map(toTransactionViewModel) : transactions.slice(0, 4)
  const trend = desktop ? cashFlow
    ? (liveDashboard?.cashFlowTrend ?? []).slice(-6).map((point) => ({ month: point.month, income: point.inflowJpy, expense: point.outflowJpy }))
    : (liveDashboard?.accrualTrend ?? []).slice(-6).map((point) => ({ month: point.month, income: point.incomeJpy, expense: point.expenseJpy })) : undefined
  const categories = desktop ? (liveDashboard?.expenseCategories ?? []).map((item) => ({ name: item.name, amount: item.amountJpy })) : undefined
  const assets = desktop ? liveDashboard?.assetsJpy ?? 0 : currentMonthMetrics.netWorth
  const liabilities = desktop ? liveDashboard?.liabilitiesJpy ?? 0 : 0
  const netWorth = desktop ? liveDashboard?.netWorthJpy ?? 0 : currentMonthMetrics.netWorth
  const kpis = cashFlow
    ? [<KpiCard key="cash-in" label="今月の入金" value={yen(income)} meta="資金移動ベース" icon={ArrowDownLeft} accent="#dce9e6" />, <KpiCard key="cash-out" label="今月の出金" value={yen(expense)} meta="カード購入ではなく銀行引落時に計上" icon={ArrowUpRight} accent="#f7e3d9" />, <KpiCard key="net-cash" label="差引キャッシュフロー" value={yen(projectedSavings)} meta="入金 − 出金" icon={CircleDollarSign} accent="#eee5cf" />, <KpiCard key="assets" label="月末資産" value={yen(assets)} meta={`${liveDashboard?.netWorthAsOf ?? '月末'} 現在`} icon={WalletCards} accent="#e4edda" />]
    : preferences.template === 'HOUSEHOLD_LEDGER'
    ? [<KpiCard key="income" label="今月の収入" value={yen(income)} meta="発生ベース" icon={ArrowDownLeft} accent="#dce9e6" />, <KpiCard key="expense" label="今月の支出" value={yen(expense)} meta="カード引落は二重計上しません" icon={ArrowUpRight} accent="#f7e3d9" />, <KpiCard key="savings" label="貯蓄見込み" value={yen(projectedSavings)} meta="収入 − 支出" icon={CircleDollarSign} accent="#eee5cf" />, <KpiCard key="net-worth" label="純資産" value={yen(netWorth)} meta={`${liveDashboard?.netWorthAsOf ?? '月末'} 現在`} icon={TrendingUp} accent="#e4edda" />]
    : preferences.template === 'ASSETS_LIABILITIES'
      ? [<KpiCard key="assets" label="資産" value={yen(assets)} meta={`${liveDashboard?.netWorthAsOf ?? '月末'} 現在`} icon={WalletCards} accent="#dce9e6" />, <KpiCard key="liabilities" label="負債" value={yen(liabilities)} meta="カードを含む台帳残高" icon={CreditCard} accent="#f7e3d9" />, <KpiCard key="net-worth" label="純資産" value={yen(netWorth)} meta="資産 − 負債" icon={TrendingUp} accent="#e4edda" />, <KpiCard key="savings" label="今月の貯蓄" value={yen(projectedSavings)} meta="収入 − 支出" icon={CircleDollarSign} accent="#eee5cf" />]
      : preferences.template === 'CARD_RECONCILIATION'
        ? [<KpiCard key="liabilities" label="カードを含む負債" value={yen(liabilities)} meta={`${liveDashboard?.netWorthAsOf ?? '月末'} 現在`} icon={CreditCard} accent="#f7e3d9" />, <KpiCard key="expense" label="今月の支出" value={yen(expense)} meta="カード購入は利用日に計上" icon={ArrowUpRight} accent="#f7e3d9" />, <KpiCard key="assets" label="支払原資を含む資産" value={yen(assets)} meta="台帳上の資産残高" icon={WalletCards} accent="#dce9e6" />, <KpiCard key="net-worth" label="純資産" value={yen(netWorth)} meta="支払い後も二重計上しません" icon={TrendingUp} accent="#e4edda" />]
        : [<KpiCard key="net-worth" label="純資産" value={yen(netWorth)} meta={desktop ? `${liveDashboard?.netWorthAsOf ?? '月末'} 現在` : '前月比'} trend={desktop ? undefined : '2.8%'} icon={TrendingUp} accent="#e4edda" />, <KpiCard key="income" label="今月の収入" value={yen(income)} meta={desktop ? '発生ベース' : '予定の 104%'} trend={desktop ? undefined : '4.2%'} icon={ArrowDownLeft} accent="#dce9e6" />, <KpiCard key="expense" label="今月の支出" value={yen(expense)} meta={desktop ? 'カード引落は二重計上しません' : `予算 ${yen(currentMonthMetrics.budget)}`} icon={ArrowUpRight} accent="#f7e3d9" />, <KpiCard key="savings" label="貯蓄見込み" value={yen(projectedSavings)} meta={desktop ? '収入 − 支出' : `貯蓄率 ${(savingsRate * 100).toFixed(1)}%`} trend={desktop ? undefined : '6.1%'} icon={CircleDollarSign} accent="#eee5cf" />]
  const panels: Record<DashboardWidgetIdDto, React.ReactNode> = {
    TREND: <article key="trend" className="panel trend-panel dashboard-widget dashboard-widget--trend"><div className="panel-head"><div><h2>{text(cashFlow ? '入出金の推移' : '収支の推移')}</h2><p>{text(cashFlow ? '資金移動' : '発生ベース')} · {desktop ? trend?.length ?? 0 : 6} months</p></div><div className="chart-legend"><span className="income">{text(cashFlow ? '入金' : '収入')}</span><span className="expense">{text(cashFlow ? '出金' : '支出')}</span></div></div><TrendChart data={trend} incomeLabel={cashFlow ? '入金' : '収入'} expenseLabel={cashFlow ? '出金' : '支出'} /></article>,
    SPENDING: <div key="spending" className="dashboard-widget dashboard-widget--spending"><SpendingCard expense={expense} categories={categories} onDetails={() => setPage('transactions')} /></div>,
    RECENT: <article key="recent" className="panel recent-panel dashboard-widget dashboard-widget--recent"><div className="panel-head"><div><h2>{text(cashFlow ? '最近の資金移動' : '最近の取引')}</h2><p>{text('確認済みの最新データ')}</p></div><button className="text-btn" onClick={() => setPage('transactions')}>{text('すべて見る')} <ArrowRight size={14} /></button></div>{displayTransactions.length > 0 ? <TransactionRows rows={displayTransactions} /> : <p className="empty-state">—</p>}</article>,
    CARDS: <div key="cards" className="dashboard-widget dashboard-widget--cards"><ReconciliationMini liveCards={liveCards} desktop={desktop} onOpen={() => setPage('cards')} /></div>,
  }
  const activeLayout = activeDashboardLayout(preferences)
  const availablePanels = activeLayout.widgetOrder.filter((widget) => dashboardTemplateWidgetOrder[preferences.template].includes(widget))
  const visiblePanels = availablePanels.filter((widget) => !effectiveHiddenWidgets(preferences).includes(widget))
  const panelOrder = visiblePanels.map((widget) => panels[widget])
  const monthLabel = new Intl.DateTimeFormat(localeCode, { year: 'numeric', month: 'long' }).format(new Date(`${month}-01T00:00:00`))
  const overviewDescription = locale === 'ja'
    ? (desktop ? `選択月の計算対象の確定取引 ${liveDashboard?.postedTransactionCount ?? 0}件を${cashFlow ? '資金移動' : '発生'}ベースで集計しています（集計対象外を除く）。` : `家計は順調です。予算の ${(budgetUsage * 100).toFixed(1)}% を使いました。`)
    : locale === 'vi' ? `Tổng hợp ${desktop ? liveDashboard?.postedTransactionCount ?? 0 : transactions.length} giao dịch đã xác nhận trong tháng đã chọn.`
      : `Summarizing ${desktop ? liveDashboard?.postedTransactionCount ?? 0 : transactions.length} confirmed transactions for the selected month.`
  if (desktop && dashboardLoading) return <div className="overview dashboard-loading" aria-busy="true" aria-label="ホームを読み込み中"><PageHeader eyebrow={monthLabel} title={householdName === '家計' ? '家計の概要' : `${householdName}の家計`} description="確定済み台帳を読み込んでいます。"><DashboardControls preferences={preferences} disabled={preferencesBusy} onChange={updatePreferences} /></PageHeader><div className="skeleton-kpi-grid">{[0, 1, 2, 3].map((item) => <div className="skeleton skeleton-kpi" key={item} />)}</div><div className="skeleton-dashboard-grid"><div className="skeleton skeleton-panel" /><div className="skeleton skeleton-panel" /></div></div>
  const firstRunEmpty = desktop && liveDashboard?.postedTransactionCount === 0 && (importCounts?.sourceDocuments ?? 0) === 0
  if (firstRunEmpty) return <div className="overview"><PageHeader eyebrow={monthLabel} title={`${householdName}の家計`} description="最初のデータを追加すると、収支・予算・カード照合がここにまとまります。" /><section className="panel dashboard-first-run"><div className="first-run-icon"><Home size={24} /></div><h2>新しい世帯へようこそ</h2><p>ダッシュボードに表示されるのは、レビューして確定した取引だけです。まず原本、レシート、または口座を設定してください。</p><div><button className="primary-btn" onClick={() => setPage('import')}><Import size={16} /> ファイルを取り込む</button><button className="secondary-btn" onClick={() => setPage('capture')}><Camera size={16} /> レシートを追加</button><button className="secondary-btn" onClick={() => setPage('settings')}><Settings size={16} /> 口座を設定</button></div></section></div>
  return <div className={`overview overview--${preferences.template.toLowerCase().replaceAll('_', '-')}`}>
    <PageHeader eyebrow={monthLabel} title={householdName === '家計' ? '家計の概要' : locale === 'ja' ? `${householdName}の家計` : `${householdName} · ${text('家計の概要')}`} description={overviewDescription}>
      <DashboardControls preferences={preferences} disabled={preferencesBusy} onChange={updatePreferences} />
      {!desktop && <span className="dashboard-preview-note">{text('ブラウザでは表示設定を一時的に試せます。保存はデスクトップ版で利用できます。')}</span>}
      {preferences.template === 'ASSETS_LIABILITIES' ? <button className="primary-btn" onClick={() => setPage('investments')}><TrendingUp size={17} /> {text('資産・投資を見る')}</button> : preferences.template === 'CARD_RECONCILIATION' ? <button className="primary-btn" onClick={() => setPage('cards')}><CreditCard size={17} /> {text('カード照合を開く')}</button> : cashFlow ? <button className="primary-btn" onClick={() => setPage('transactions')}><WalletCards size={17} /> {text('資金移動を見る')}</button> : <button className="primary-btn" onClick={() => setPage('import')}><Import size={17} /> {text('ファイルを取り込む')}</button>}
    </PageHeader>
    <section className="kpi-grid">{kpis}</section>
    <HomeActionCenter householdId={householdId} accountGroupId={accountGroupId} attributionScope={attributionScope} asOf={periodFromMonth(month).toDate} revision={revision} desktop={desktop} onAction={(action) => setPage(pageForAction(action))} onViewAll={openAllActions} />
    <section className="dashboard-grid">{panelOrder}</section>
    <DashboardDataQuality counts={importCounts} desktop={desktop} onOpenImport={() => setPage('import')} />
    <div className="data-footnote"><FileCheck2 size={15} /> 確定済み台帳から{cashFlow ? '実際の資産入出金を' : ''}集計 ・ 未確認の候補は含みません</div>
  </div>
}

type TransactionEntryDraft = { id: string; accountId: string; side: 'DEBIT' | 'CREDIT'; amountJpy: string }

function TransactionSplitEditor({ total, side, categoryAccounts, initialRows, onApply, onCancel }: { total: number; side: 'DEBIT' | 'CREDIT'; categoryAccounts: readonly AccountDto[]; initialRows: readonly TransactionEntryDraft[]; onApply: (rows: readonly TransactionEntryDraft[]) => void; onCancel: () => void }) {
  const [rows, setRows] = useState<readonly TransactionEntryDraft[]>(() => initialRows.length === 1 ? [...initialRows, { id: crypto.randomUUID(), accountId: '', side, amountJpy: '' }] : initialRows)
  const allocated = rows.reduce((sum, row) => sum + (/^\d+$/.test(row.amountJpy) ? Number(row.amountJpy) : 0), 0)
  const remainder = total - allocated
  const valid = rows.length >= 2 && remainder === 0 && rows.every((row) => row.accountId && /^\d+$/.test(row.amountJpy) && Number(row.amountJpy) > 0)
  const update = (id: string, change: Partial<TransactionEntryDraft>) => setRows((current) => current.map((row) => row.id === id ? { ...row, ...change } : row))
  return <section className="transaction-split-editor" aria-label="取引の分割"><header><div><strong>取引を分割</strong><span>カテゴリごとの金額を入力してください。仕訳の合計は変わりません。</span></div><button className="icon-btn" aria-label="分割編集を閉じる" onClick={onCancel}><X size={16} /></button></header><div className="split-row-list">{rows.map((row, index) => <div className="split-row" key={row.id}><span>{index + 1}</span><select aria-label={`分割${index + 1}のカテゴリ`} value={row.accountId} onChange={(event) => update(row.id, { accountId: event.target.value })}><option value="">カテゴリを選択</option>{categoryAccounts.map((account) => <option key={account.id} value={account.id}>{account.name}</option>)}</select><input aria-label={`分割${index + 1}の金額`} inputMode="numeric" value={row.amountJpy} onChange={(event) => update(row.id, { amountJpy: event.target.value.replace(/\D/g, '') })} placeholder="0" /><button className="text-btn" disabled={rows.length <= 2} onClick={() => setRows((current) => current.filter((item) => item.id !== row.id))}>削除</button></div>)}</div><button className="secondary-btn split-add" onClick={() => setRows((current) => [...current, { id: crypto.randomUUID(), accountId: '', side, amountJpy: '' }])}>＋ 分割行を追加</button><footer><div className={remainder === 0 ? 'split-remainder complete' : 'split-remainder'}><span>残り</span><strong>{yen(remainder)}</strong>{remainder === 0 && <Check size={15} aria-label="分割金額一致" />}</div><button className="secondary-btn" onClick={onCancel}>キャンセル</button><button className="primary-btn" disabled={!valid} onClick={() => onApply(rows)}>分割を適用</button></footer></section>
}

function statementFieldsFromRecords(records: readonly SourceRecordViewDto[]): readonly (readonly [string, string])[] {
  for (const record of records) {
    try {
      const payload: unknown = JSON.parse(record.payloadJson)
      if (!payload || typeof payload !== 'object' || Array.isArray(payload)) continue
      const fields = (payload as { fields?: unknown }).fields
      if (!fields || typeof fields !== 'object' || Array.isArray(fields)) continue
      const entries = Object.entries(fields).filter((entry): entry is [string, string] => typeof entry[1] === 'string')
      const names = new Set(entries.map(([name]) => name))
      if (names.has('利用日') && (names.has('利用店名・商品名') || names.has('利用店名')) && names.has('支払方法')) return entries
    } catch { /* A malformed source row remains available in the raw evidence viewer. */ }
  }
  return []
}

function CardStatementSourceFields({ records }: { records: readonly SourceRecordViewDto[] }) {
  const entries = statementFieldsFromRecords(records)
  if (entries.length === 0) return null
  return <section className="card-statement-source-fields" aria-label="カード明細情報"><header><h3>カード明細情報</h3><span>原本の列名と値</span></header><dl>{entries.map(([name, value]) => <div key={name}><dt>{name}</dt><dd>{value || '—'}</dd></div>)}</dl></section>
}

function TransactionDetailPanel({ detail, accounts, members, returnFocus, onClose, onSave, onChanged }: { detail: TransactionDetailDto; accounts: readonly AccountDto[]; members: readonly HouseholdMemberDto[]; returnFocus: HTMLElement | null; onClose: () => void; onSave: (input: UpdatePostedTransactionInputDto) => Promise<void>; onChanged: () => void }) {
  const [occurredOn, setOccurredOn] = useState(detail.occurredOn)
  const [transactionType, setTransactionType] = useState(detail.transactionType)
  const [payee, setPayee] = useState(detail.payee ?? '')
  const [description, setDescription] = useState(detail.description ?? '')
  const [attribution, setAttribution] = useState(detail.attributedMemberId ?? 'HOUSEHOLD')
  const [audience, setAudience] = useState(detail.audienceMemberId ?? 'SHARED')
  const [calculationTarget, setCalculationTarget] = useState(detail.calculationTarget)
  const [sourceAudiences, setSourceAudiences] = useState<Record<string, string>>(() => Object.fromEntries(detail.sourceEvidence.map((evidence) => [evidence.sourceDocumentId, evidence.audienceMemberId ?? 'SHARED'])))
  const [entries, setEntries] = useState<readonly TransactionEntryDraft[]>(() => detail.entries.map((entry) => ({ id: entry.id, accountId: entry.accountId, side: entry.side, amountJpy: String(entry.amountJpy) })))
  const [splitOpen, setSplitOpen] = useState(false)
  const [busy, setBusy] = useState(false)
  const [notice, setNotice] = useState('')
  const [sourceRecords, setSourceRecords] = useState<readonly SourceRecordViewDto[]>([])
  const [sourceHashes, setSourceHashes] = useState<Record<string, string>>({})
  const [selectedSourceRecordId, setSelectedSourceRecordId] = useState<string | null>(null)
  const [sourceBusy, setSourceBusy] = useState(false)
  const [sourceImagePreview, setSourceImagePreview] = useState<SourceImagePreviewDto | null>(null)
  const [sourceImageSize, setSourceImageSize] = useState<{ width: number; height: number } | null>(null)
  const [ruleBusy, setRuleBusy] = useState(false)
  const dialogRef = useRef<HTMLElement>(null)
  const headingRef = useRef<HTMLHeadingElement>(null)
  useEffect(() => {
    headingRef.current?.focus()
    return () => { if (returnFocus?.isConnected) returnFocus.focus() }
  }, [returnFocus])
  useEffect(() => {
    let active = true
    void Promise.all(detail.sourceEvidence.map(async (evidence) => [evidence.sourceDocumentId, (await platformClient.getSourceDocument(detail.householdId, evidence.sourceDocumentId)).sha256] as const)).then((items) => {
      if (active) setSourceHashes(Object.fromEntries(items))
    }).catch(() => undefined)
    return () => { active = false }
  }, [detail.householdId, detail.sourceEvidence])
  useEffect(() => {
    let active = true
    if (detail.sourceEvidence.length > 0) {
      void platformClient.listTransactionSourceRecords(detail.householdId, detail.id)
        .then((records) => { if (active) setSourceRecords(records) })
        .catch(() => undefined)
    }
    return () => { active = false }
  }, [detail.householdId, detail.id, detail.sourceEvidence.length])
  useEffect(() => {
    const evidenceList = dialogRef.current?.querySelector<HTMLElement>('.evidence-list')
    const verifiedHash = Object.values(sourceHashes)[0]
    if (evidenceList && verifiedHash) evidenceList.dataset.sha256 = verifiedHash
  }, [sourceHashes])
  useEffect(() => {
    const closeEvidence = () => setSelectedSourceRecordId(null)
    globalThis.addEventListener('kakeflow:evidence-close', closeEvidence)
    return () => globalThis.removeEventListener('kakeflow:evidence-close', closeEvidence)
  }, [])
  const debitTotal = entries.filter((entry) => entry.side === 'DEBIT').reduce((sum, entry) => sum + (Number(entry.amountJpy) || 0), 0)
  const creditTotal = entries.filter((entry) => entry.side === 'CREDIT').reduce((sum, entry) => sum + (Number(entry.amountJpy) || 0), 0)
  const splitShape = transactionType === 'INCOME' || transactionType === 'INTEREST'
    ? { side: 'CREDIT' as const, kind: 'INCOME' as const }
    : transactionType === 'REFUND'
      ? { side: 'CREDIT' as const, kind: 'EXPENSE' as const }
      : transactionType === 'EXPENSE' || transactionType === 'CARD_PURCHASE' || transactionType === 'FEE'
        ? { side: 'DEBIT' as const, kind: 'EXPENSE' as const }
        : null
  const splitCategoryAccounts = splitShape ? accounts.filter((account) => account.accountKind === splitShape.kind) : []
  const splitCategoryIds = new Set(splitCategoryAccounts.map((account) => account.id))
  const splitEntries = splitShape ? entries.filter((entry) => entry.side === splitShape.side && splitCategoryIds.has(entry.accountId)) : []
  const splitTotal = splitEntries.reduce((sum, entry) => sum + (Number(entry.amountJpy) || 0), 0)
  const applySplit = (rows: readonly TransactionEntryDraft[]) => {
    if (!splitShape) return
    setEntries((current) => [...current.filter((entry) => !(entry.side === splitShape.side && splitCategoryIds.has(entry.accountId))), ...rows])
    setSplitOpen(false)
    setNotice('分割を仕訳へ反映しました。「変更を保存」で確定してください。')
  }
  const updateEntry = (index: number, change: Partial<(typeof entries)[number]>) => setEntries((current) => current.map((entry, currentIndex) => currentIndex === index ? { ...entry, ...change } : entry))
  const showSourceRecord = async (sourceRecordId: string) => {
    setSelectedSourceRecordId(sourceRecordId)
    setSourceImagePreview(null); setSourceImageSize(null)
    setSourceBusy(true)
    try {
      if (!sourceRecords.some((record) => record.id === sourceRecordId)) setSourceRecords(await platformClient.listTransactionSourceRecords(detail.householdId, detail.id))
      const evidence = detail.sourceEvidence.find((item) => item.sourceRecordId === sourceRecordId)
      if (evidence && !sourceHashes[evidence.sourceDocumentId]) {
        const sourceDocument = await platformClient.getSourceDocument(detail.householdId, evidence.sourceDocumentId)
        setSourceHashes((current) => ({ ...current, [evidence.sourceDocumentId]: sourceDocument.sha256 }))
      }
      if (evidence?.mediaType.startsWith('image/')) {
        try {
          const preview = await sourceImagePreviewPlatform.get(detail.householdId, evidence.sourceDocumentId)
          setSourceImagePreview(preview)
          const image = new Image()
          image.onload = () => setSourceImageSize({ width: image.naturalWidth, height: image.naturalHeight })
          image.src = preview.dataUrl
        } catch {
          setNotice('原本行は読み込みましたが、画像プレビューを表示できませんでした。')
        }
      }
    }
    catch { setNotice('原本レコードを読み込めませんでした。') }
    finally { setSourceBusy(false) }
  }
  const selectedSource = sourceRecords.find((record) => record.id === selectedSourceRecordId) ?? null
  const formattedSourcePayload = (() => {
    if (!selectedSource) return ''
    try { return JSON.stringify(JSON.parse(selectedSource.payloadJson), null, 2) }
    catch { return selectedSource.payloadJson }
  })()
  const documentEvidence = selectedSource ? buildDocumentEvidence(selectedSource) : null
  const selectedSourceEvidence = detail.sourceEvidence.find((evidence) => evidence.sourceRecordId === selectedSourceRecordId)
  const selectedSourceFilename = selectedSourceEvidence?.originalFilename
  const applyBestRule = async () => {
    setRuleBusy(true); setNotice('')
    try {
      const preview = await platformClient.previewClassificationRules({ householdId: detail.householdId, merchant: detail.payee, description: detail.description })
      const winner = preview.matches.find((rule) => rule.id === preview.winningRuleId)
      if (!winner) { setNotice('この取引に一致する有効な分類ルールはありません。'); return }
      await platformClient.applyClassificationRule({ householdId: detail.householdId, transactionId: detail.id, ruleId: winner.id, expectedTransactionUpdatedAt: detail.updatedAt })
      setNotice(`${winner.name} を適用し、${winner.categoryName} に分類しました。`); onChanged()
    } catch { setNotice('分類ルールを適用できませんでした。取引が更新されている可能性があります。') }
    finally { setRuleBusy(false) }
  }
  const save = async () => {
    if (entries.length < 2 || debitTotal <= 0 || debitTotal !== creditTotal || entries.some((entry) => !entry.accountId || !/^\d+$/.test(entry.amountJpy) || Number(entry.amountJpy) <= 0)) {
      setNotice('借方と貸方を同額にし、すべての口座と金額を入力してください。'); return
    }
    setBusy(true); setNotice('')
    try {
      await onSave({
        householdId: detail.householdId, transactionId: detail.id, occurredOn, postedOn: detail.postedOn,
        transactionType, payee: payee.trim() || null, description: description.trim() || null,
        calculationTarget,
        attributionKind: attribution === 'HOUSEHOLD' ? 'HOUSEHOLD' : 'MEMBER', attributedMemberId: attribution === 'HOUSEHOLD' ? null : attribution,
        audienceVisibility: audience === 'SHARED' ? 'SHARED' : 'PERSONAL', audienceMemberId: audience === 'SHARED' ? null : audience,
        entries: entries.map((entry) => ({ id: entry.id || crypto.randomUUID(), accountId: entry.accountId, side: entry.side, amountJpy: Number(entry.amountJpy) })),
      })
    } catch { setNotice('変更を保存できませんでした。入力内容を確認してください。') }
    finally { setBusy(false) }
  }
  const updateSourceAudience = async (sourceDocumentId: string) => {
    const selected = sourceAudiences[sourceDocumentId] ?? 'SHARED'
    setSourceBusy(true); setNotice('')
    try {
      await platformClient.updateSourceDocumentAudience({ householdId: detail.householdId, sourceDocumentId, audienceVisibility: selected === 'SHARED' ? 'SHARED' : 'PERSONAL', audienceMemberId: selected === 'SHARED' ? null : selected })
      setNotice('原本の表示区分を更新しました。リンク先取引の帰属・表示区分は変更していません。')
    } catch { setNotice('原本の表示区分を更新できませんでした。') }
    finally { setSourceBusy(false) }
  }
  const assignmentMembers = (currentId: string | null) => members.filter((member) => member.status === 'ACTIVE' || member.id === currentId)
  const pageImages = sourceImagePreview && sourceImageSize ? { 1: { src: sourceImagePreview.dataUrl, width: sourceImageSize.width, height: sourceImageSize.height, alt: `${sourceImagePreview.filename} 原本` } } : undefined
  const handleKeyDown = (event: ReactKeyboardEvent<HTMLElement>) => {
    if (event.key === 'Escape') { if (!busy) { event.preventDefault(); onClose() }; return }
    if (event.key !== 'Tab') return
    const focusable = [...(dialogRef.current?.querySelectorAll<HTMLElement>('button:not([disabled]),input:not([disabled]),select:not([disabled]),textarea:not([disabled]),a[href],[tabindex]:not([tabindex="-1"])') ?? [])]
    if (focusable.length === 0) { event.preventDefault(); headingRef.current?.focus(); return }
    const activeIndex = focusable.indexOf(document.activeElement as HTMLElement)
    if (event.shiftKey && activeIndex <= 0) { event.preventDefault(); focusable[focusable.length - 1].focus() }
    else if (!event.shiftKey && (activeIndex === -1 || activeIndex === focusable.length - 1)) { event.preventDefault(); focusable[0].focus() }
  }
  return <div className="detail-backdrop" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget && !busy) onClose() }}><section ref={dialogRef} className="transaction-detail-panel" role="dialog" aria-modal="true" aria-labelledby="transaction-detail-title" onKeyDown={handleKeyDown}><div className="panel-head"><div><p>取引詳細</p><h2 ref={headingRef} tabIndex={-1} id="transaction-detail-title">{detail.payee ?? detail.description ?? detail.id}</h2><span className={calculationTarget ? 'calculation-badge included' : 'calculation-badge excluded'}>{calculationTarget ? '計算対象' : '集計対象外'}</span></div><button className="icon-btn" aria-label="取引詳細を閉じる" disabled={busy} onClick={onClose}><X size={18} /></button></div>{transactionType === 'CARD_PAYMENT' && <aside className="card-payment-info"><Repeat2 size={16} /><span><strong>カード支払・振替</strong><small>支出ではありません — 購入時に計上済み</small></span></aside>}<div className="detail-fields"><label>取引日<input type="date" value={occurredOn} onChange={(event) => setOccurredOn(event.target.value)} /></label><label>取引種別<select value={transactionType} onChange={(event) => { setTransactionType(event.target.value as ManualTransactionTypeDto); setSplitOpen(false) }}>{['EXPENSE', 'INCOME', 'TRANSFER', 'CARD_PURCHASE', 'CARD_PAYMENT', 'REFUND', 'FEE', 'INTEREST', 'ADJUSTMENT'].map((type) => <option key={type}>{type}</option>)}</select></label><label>支払先<input value={payee} onChange={(event) => setPayee(event.target.value)} /></label><label>メモ<input value={description} onChange={(event) => setDescription(event.target.value)} /></label></div><div className="family-assignment-fields"><fieldset><legend>家族内の帰属</legend><p>誰の支出・収入として集計するかを設定します。支払口座の所有者とは別です。</p><select aria-label="取引の家族内の帰属" value={attribution} onChange={(event) => setAttribution(event.target.value)}><option value="HOUSEHOLD">世帯共通</option>{assignmentMembers(detail.attributedMemberId).map((member) => <option key={member.id} value={member.id}>{member.displayName}{member.status === 'ARCHIVED' ? '（アーカイブ済み）' : ''}</option>)}</select></fieldset><fieldset><legend>表示区分</legend><p>「個人」もこの端末内の整理用ラベルであり、閲覧制限ではありません。</p><select aria-label="取引の表示区分" value={audience} onChange={(event) => setAudience(event.target.value)}><option value="SHARED">共有</option>{assignmentMembers(detail.audienceMemberId).map((member) => <option key={member.id} value={member.id}>個人・{member.displayName}{member.status === 'ARCHIVED' ? '（アーカイブ済み）' : ''}</option>)}</select></fieldset></div><label className="calculation-target-control"><input type="checkbox" checked={calculationTarget} onChange={(event) => setCalculationTarget(event.target.checked)} /><span><strong>家計の集計に含める</strong><small>オフにするとダッシュボード、予算、レポート、予測の集計から外れます。台帳の仕訳は削除されず、口座・カード残高も変わりません。</small></span></label><div className="detail-section-head"><div><h3>仕訳</h3><span>借方 {yen(debitTotal)} / 貸方 {yen(creditTotal)}</span></div><div><button className="secondary-btn" disabled={ruleBusy} onClick={() => void applyBestRule()}>{ruleBusy ? '照合中…' : '分類ルールを適用'}</button>{splitShape && splitEntries.length > 0 && <button className="secondary-btn" aria-expanded={splitOpen} onClick={() => setSplitOpen((value) => !value)}>取引を分割…</button>}<button className="secondary-btn" onClick={() => setEntries((current) => [...current, { id: crypto.randomUUID(), accountId: '', side: 'DEBIT' as const, amountJpy: '' }])}>仕訳行を追加</button></div></div>{splitOpen && splitShape && <TransactionSplitEditor total={splitTotal} side={splitShape.side} categoryAccounts={splitCategoryAccounts} initialRows={splitEntries} onApply={applySplit} onCancel={() => setSplitOpen(false)} />}<div className="journal-editor">{entries.map((entry, index) => <div className="journal-line" key={entry.id}><select aria-label={`仕訳${index + 1}の借貸`} value={entry.side} onChange={(event) => updateEntry(index, { side: event.target.value as 'DEBIT' | 'CREDIT' })}><option value="DEBIT">借方</option><option value="CREDIT">貸方</option></select><select aria-label={`仕訳${index + 1}の口座`} value={entry.accountId} onChange={(event) => updateEntry(index, { accountId: event.target.value })}><option value="">口座を選択</option>{accounts.map((account) => <option key={account.id} value={account.id}>{account.name}</option>)}</select><input aria-label={`仕訳${index + 1}の金額`} inputMode="numeric" value={entry.amountJpy} onChange={(event) => updateEntry(index, { amountJpy: event.target.value })} /><button className="text-btn" aria-label={`仕訳${index + 1}を削除`} disabled={entries.length <= 2} onClick={() => setEntries((current) => current.filter((_, currentIndex) => currentIndex !== index))}>削除</button></div>)}</div><CardStatementSourceFields records={sourceRecords} /><div className="evidence-list"><h3>原本・証跡</h3><p className="source-audience-help">原本自体の整理ラベルです。リンク先取引の帰属・表示区分とは別に管理します。</p>{detail.sourceEvidence.length === 0 ? <p>手動入力のため原本はありません。</p> : detail.sourceEvidence.map((evidence) => { const sourceAudience = sourceAudiences[evidence.sourceDocumentId] ?? (evidence.audienceMemberId ?? 'SHARED'); return <div className="source-evidence-item" key={evidence.sourceDocumentId + '-' + evidence.sourceRecordId}><button type="button" className={'source-evidence-button ' + (selectedSourceRecordId === evidence.sourceRecordId ? 'active' : '')} onClick={() => void showSourceRecord(evidence.sourceRecordId)}><FileCheck2 size={16} /><span><strong>{evidence.originalFilename}</strong><small>{evidence.sourceType} ・ 行 {evidence.rowNumber} ・ {evidence.evidenceRole}</small><small>原本: {sourceAudience === 'SHARED' ? '共有' : '個人・' + (members.find((member) => member.id === sourceAudience)?.displayName ?? evidence.audienceMemberName ?? 'メンバー')}</small></span><em>{sourceBusy && selectedSourceRecordId === evidence.sourceRecordId ? '読込中…' : '原本行を表示'}</em></button><div className="source-audience-editor"><label>原本の表示区分<select aria-label={evidence.originalFilename + 'の原本表示区分'} value={sourceAudience} onChange={(event) => setSourceAudiences((current) => ({ ...current, [evidence.sourceDocumentId]: event.target.value }))}><option value="SHARED">共有</option>{assignmentMembers(evidence.audienceMemberId).map((member) => <option key={member.id} value={member.id}>個人・{member.displayName}{member.status === 'ARCHIVED' ? '（アーカイブ済み）' : ''}</option>)}</select></label><button className="secondary-btn" aria-label={evidence.originalFilename + 'の原本区分を保存'} disabled={sourceBusy} onClick={() => void updateSourceAudience(evidence.sourceDocumentId)}>原本区分を保存</button></div></div> })}</div>{selectedSource && (documentEvidence ? <DocumentEvidenceViewer evidence={documentEvidence} filename={selectedSourceFilename} pageImages={pageImages} pdfSource={selectedSourceEvidence?.mediaType === 'application/pdf' ? { householdId: detail.householdId, sourceDocumentId: selectedSourceEvidence.sourceDocumentId } : undefined} /> : <section className="source-record-viewer" aria-label="原本レコード"><div><strong>{selectedSource.evidenceRole ?? 'SOURCE'} ・ 行 {selectedSource.rowNumber}</strong><small>改変されていない取込時の値</small></div><pre>{formattedSourcePayload}</pre></section>)}{notice && <p role="status">{notice}</p>}<div className="detail-actions"><span>{detail.sourceEvidence.length > 0 ? '原本とのリンクを保持したまま修正します。' : '手動取引'}</span><button className="secondary-btn" disabled={busy} onClick={onClose}>キャンセル</button><button className="primary-btn" disabled={busy || debitTotal !== creditTotal} onClick={() => void save()}>{busy ? '保存中…' : '変更を保存'}</button></div></section></div>
}

function updateInputFromDetail(detail: TransactionDetailDto, change: { readonly calculationTarget?: boolean; readonly categoryAccount?: AccountDto; readonly attributedMemberId?: string | null }): UpdatePostedTransactionInputDto {
  const categoryShape = detail.transactionType === 'INCOME' || detail.transactionType === 'INTEREST'
    ? { side: 'CREDIT' as const, kind: 'INCOME' }
    : detail.transactionType === 'REFUND'
      ? { side: 'CREDIT' as const, kind: 'EXPENSE' }
      : detail.transactionType === 'EXPENSE' || detail.transactionType === 'CARD_PURCHASE' || detail.transactionType === 'FEE'
        ? { side: 'DEBIT' as const, kind: 'EXPENSE' }
        : null
  if (change.categoryAccount && (!categoryShape || change.categoryAccount.accountKind !== categoryShape.kind)) throw new Error('CATEGORY_NOT_SUPPORTED')
  const entries = detail.entries.map((entry) => change.categoryAccount && entry.side === categoryShape?.side && entry.accountKind === categoryShape.kind
    ? { id: entry.id, accountId: change.categoryAccount.id, side: entry.side, amountJpy: entry.amountJpy }
    : { id: entry.id, accountId: entry.accountId, side: entry.side, amountJpy: entry.amountJpy })
  if (change.categoryAccount && !entries.some((entry, index) => entry.accountId === change.categoryAccount?.id && detail.entries[index]?.accountId !== entry.accountId)) throw new Error('CATEGORY_ENTRY_NOT_FOUND')
  return {
    householdId: detail.householdId, transactionId: detail.id, occurredOn: detail.occurredOn, postedOn: detail.postedOn,
    transactionType: detail.transactionType, payee: detail.payee, description: detail.description,
    calculationTarget: change.calculationTarget ?? detail.calculationTarget,
    attributionKind: change.attributedMemberId === undefined ? detail.attributionKind : change.attributedMemberId === null ? 'HOUSEHOLD' : 'MEMBER',
    attributedMemberId: change.attributedMemberId === undefined ? detail.attributedMemberId : change.attributedMemberId,
    audienceVisibility: detail.audienceVisibility, audienceMemberId: detail.audienceMemberId,
    entries,
  }
}

function TransactionsPage({ householdId, accountGroupId, accountGroups, onAccountGroupChange, attributionScope, revision, month, basis, onBasisChange, accounts, members, onChanged }: { householdId: string | null; accountGroupId: string | null; accountGroups: readonly AccountGroupDto[]; onAccountGroupChange: (groupId: string | null) => void; attributionScope: AttributionScopeDto; revision: number; month: string; basis: 'ACCRUAL' | 'CASH'; onBasisChange: (basis: 'ACCRUAL' | 'CASH') => void; accounts: readonly AccountDto[]; members: readonly HouseholdMemberDto[]; onChanged: () => void }) {
  const { text } = useI18n()
  const [query, setQuery] = useState('')
  const [transactionTypeFilter, setTransactionTypeFilter] = useState<'ALL' | 'INCOME' | 'EXPENSE' | 'TRANSFER_PAYMENT' | 'REFUND'>('ALL')
  const [showAdvancedFilters, setShowAdvancedFilters] = useState(false)
  const [exportBusy, setExportBusy] = useState(false)
  const [exportNotice, setExportNotice] = useState('')
  const [calculationFilter, setCalculationFilter] = useState<'ALL' | 'INCLUDED' | 'EXCLUDED'>('ALL')
  const [labelFilter, setLabelFilter] = useState<TransactionLabelDto | ''>('')
  const [tagFilter, setTagFilter] = useState('')
  const [liveRows, setLiveRows] = useState<readonly TransactionRowDto[]>([])
  const [liveTotals, setLiveTotals] = useState<DashboardMonthlyTotalsDto | null>(null)
  const [ledgerPage, setLedgerPage] = useState(1)
  const [totalPages, setTotalPages] = useState(0)
  const [totalItems, setTotalItems] = useState(0)
  const [loadError, setLoadError] = useState(false)
  const [showManual, setShowManual] = useState(false)
  const [manualDate, setManualDate] = useState(`${month}-01`)
  const [manualType, setManualType] = useState<ManualTransactionTypeDto>('EXPENSE')
  const [manualPayee, setManualPayee] = useState('')
  const [manualDescription, setManualDescription] = useState('')
  const [manualAmount, setManualAmount] = useState('')
  const [manualDebit, setManualDebit] = useState('')
  const [manualCredit, setManualCredit] = useState('')
  const [manualAttribution, setManualAttribution] = useState('HOUSEHOLD')
  const [manualAudience, setManualAudience] = useState('SHARED')
  const [manualBusy, setManualBusy] = useState(false)
  const [manualNotice, setManualNotice] = useState('')
  const [selectedDetail, setSelectedDetail] = useState<TransactionDetailDto | null>(null)
  const detailReturnFocus = useRef<HTMLElement | null>(null)
  const [detailNotice, setDetailNotice] = useState('')
  const [selectedTransactionIds, setSelectedTransactionIds] = useState<ReadonlySet<string>>(new Set())
  const [metadataOperation, setMetadataOperation] = useState<'ADD' | 'REMOVE'>('ADD')
  const [metadataLabel, setMetadataLabel] = useState<TransactionLabelDto | ''>('')
  const [metadataTags, setMetadataTags] = useState('')
  const [bulkCategoryAccountId, setBulkCategoryAccountId] = useState('')
  const [bulkCalculationTarget, setBulkCalculationTarget] = useState<'INCLUDED' | 'EXCLUDED' | ''>('')
  const [bulkAttribution, setBulkAttribution] = useState('')
  const [metadataBusy, setMetadataBusy] = useState(false)
  const [metadataNotice, setMetadataNotice] = useState('')
  const desktop = platformClient.runtime === 'tauri'

  useEffect(() => {
    if (!desktop || !householdId) return
    let active = true
    const period = periodFromMonth(month)
    setLoadError(false)
    void Promise.all([
      platformClient.queryTransactions({ householdId, accountGroupId, attributionScope, accountingBasis: basis, calculationTargetFilter: calculationFilter, label: labelFilter || null, tag: tagFilter.trim() || null, fromDate: period.fromDate, toDate: period.toDate, search: query.trim() || null, page: ledgerPage, pageSize: 25 }),
      platformClient.queryDashboard({ householdId, accountGroupId, attributionScope, month: period.month, accountingBasis: basis }),
    ]).then(([page, totals]) => {
      if (active) { setLiveRows(page.items); setLiveTotals(totals); setTotalPages(page.totalPages); setTotalItems(page.totalItems) }
    }).catch(() => {
      if (active) { setLiveRows([]); setLiveTotals(null); setTotalPages(0); setTotalItems(0); setLoadError(true) }
    })
    return () => { active = false }
  }, [accountGroupId, attributionScope, basis, calculationFilter, desktop, householdId, labelFilter, ledgerPage, month, query, revision, tagFilter])

  useEffect(() => { setLedgerPage(1) }, [accountGroupId, attributionScope, basis, calculationFilter, householdId, labelFilter, month, query, tagFilter])
  useEffect(() => { setManualDate(`${month}-01`) }, [month])
  useEffect(() => { setSelectedTransactionIds(new Set()); setMetadataNotice('') }, [householdId, month])

  const basisTransactions = transactions.filter((transaction) => basis === 'ACCRUAL' ? transaction.accountingEffect !== 'CASH_ONLY' : transaction.accountingEffect !== 'ACCRUAL_ONLY')
  const displayRows = desktop ? liveRows.map(toTransactionViewModel) : basisTransactions
  const searchedRows = desktop ? displayRows : displayRows.filter((t) => `${t.merchant}${t.category}${t.account}`.toLowerCase().includes(query.toLowerCase()))
  const visible = searchedRows.filter((transaction) => {
    const type = transaction.transactionType ?? (transaction.amount >= 0 ? 'INCOME' : 'EXPENSE')
    if (transactionTypeFilter === 'ALL') return true
    if (transactionTypeFilter === 'TRANSFER_PAYMENT') return type === 'TRANSFER' || type === 'CARD_PAYMENT'
    return type === transactionTypeFilter
  })
  const basisExpense = desktop ? liveTotals?.expenseJpy ?? 0 : basis === 'ACCRUAL' ? currentMonthMetrics.expense : currentMonthMetrics.cashOutflow
  const basisIncome = desktop ? liveTotals?.incomeJpy ?? 0 : currentMonthMetrics.income
  const openDetail = async (transactionId: string, trigger: HTMLButtonElement) => {
    if (!desktop || !householdId) return
    setDetailNotice('')
    detailReturnFocus.current = trigger
    try { setSelectedDetail(await platformClient.getTransactionDetail(householdId, transactionId)) }
    catch { setDetailNotice('取引詳細を読み込めませんでした。') }
  }
  const saveDetail = async (input: UpdatePostedTransactionInputDto) => {
    await platformClient.updateTransaction(input)
    setSelectedDetail(null); onChanged(); setDetailNotice('取引と仕訳を更新しました。')
  }
  const toggleTransactionSelection = (transactionId: string, selected: boolean) => {
    setSelectedTransactionIds((current) => {
      const next = new Set(current)
      if (selected) {
        if (next.size >= 200) { setMetadataNotice('一度に編集できる取引は200件までです。'); return current }
        next.add(transactionId)
      } else next.delete(transactionId)
      return next
    })
  }
  const toggleVisibleTransactions = () => {
    const visibleIds = visible.map((transaction) => transaction.id)
    const allSelected = visibleIds.length > 0 && visibleIds.every((id) => selectedTransactionIds.has(id))
    setSelectedTransactionIds((current) => {
      const next = new Set(current)
      if (allSelected) visibleIds.forEach((id) => next.delete(id))
      else visibleIds.slice(0, Math.max(0, 200 - next.size)).forEach((id) => next.add(id))
      return next
    })
  }
  const applyBulkMetadata = async () => {
    if (!householdId || selectedTransactionIds.size === 0) { setMetadataNotice('編集する取引を選択してください。'); return }
    const tags = [...new Set(metadataTags.split(',').map((tag) => tag.trim().replace(/^#/, '')).filter(Boolean))]
    if (!metadataLabel && tags.length === 0) { setMetadataNotice('ラベルまたはタグを入力してください。'); return }
    if (tags.length > 20 || tags.some((tag) => tag.length > 64)) { setMetadataNotice('タグは一度に20個、1個64文字以内で入力してください。'); return }
    setMetadataBusy(true); setMetadataNotice('')
    try {
      const labels = metadataLabel ? [metadataLabel] : []
      const result = await platformClient.bulkUpdateTransactionMetadata({
        householdId, transactionIds: [...selectedTransactionIds],
        addLabels: metadataOperation === 'ADD' ? labels : [], removeLabels: metadataOperation === 'REMOVE' ? labels : [],
        addTags: metadataOperation === 'ADD' ? tags : [], removeTags: metadataOperation === 'REMOVE' ? tags : [],
      })
      setSelectedTransactionIds(new Set()); setMetadataTags(''); setMetadataLabel(''); onChanged()
      setMetadataNotice(`${result.updatedCount}件のラベル・タグを${metadataOperation === 'ADD' ? '追加' : '削除'}しました。カテゴリーと仕訳は変更していません。`)
      showToast(`${result.updatedCount}件を更新しました。`)
    } catch { setMetadataNotice('ラベル・タグを更新できませんでした。選択内容を確認してください。'); showToast('一括更新に失敗しました。', 'error') }
    finally { setMetadataBusy(false) }
  }
  const applyBulkLedgerChange = async (kind: 'CATEGORY' | 'CALCULATION' | 'ATTRIBUTION') => {
    if (!householdId || selectedTransactionIds.size === 0) { setMetadataNotice('編集する取引を選択してください。'); return }
    const categoryAccount = accounts.find((account) => account.id === bulkCategoryAccountId)
    if (kind === 'CATEGORY' && !categoryAccount) { setMetadataNotice('変更先のカテゴリーを選択してください。'); return }
    if (kind === 'CALCULATION' && !bulkCalculationTarget) { setMetadataNotice('計算対象の状態を選択してください。'); return }
    if (kind === 'ATTRIBUTION' && !bulkAttribution) { setMetadataNotice('変更先の帰属を選択してください。'); return }
    setMetadataBusy(true); setMetadataNotice('')
    let updated = 0
    let skipped = 0
    for (const transactionId of selectedTransactionIds) {
      try {
        const detail = await platformClient.getTransactionDetail(householdId, transactionId)
        await platformClient.updateTransaction(updateInputFromDetail(detail, kind === 'CATEGORY'
          ? { categoryAccount }
          : kind === 'CALCULATION'
            ? { calculationTarget: bulkCalculationTarget === 'INCLUDED' }
            : { attributedMemberId: bulkAttribution === 'HOUSEHOLD' ? null : bulkAttribution }))
        updated += 1
      } catch { skipped += 1 }
    }
    if (updated > 0) { onChanged(); setSelectedTransactionIds(new Set()) }
    const action = kind === 'CATEGORY' ? 'カテゴリー' : kind === 'CALCULATION' ? '計算対象' : '家族内の帰属'
    setMetadataNotice(`${updated}件の${action}を更新しました。${skipped ? `${skipped}件は取引種別または照合状態により変更できませんでした。` : ''}`)
    showToast(`${updated}件の${action}を更新しました。`, skipped ? 'info' : 'success')
    setMetadataBusy(false)
  }
  const createManual = async () => {
    const amount = Number(manualAmount)
    if (!householdId || !/^\d+$/.test(manualAmount) || !Number.isSafeInteger(amount) || amount <= 0 || !manualDebit || !manualCredit || manualDebit === manualCredit) {
      setManualNotice('金額と異なる借方・貸方口座を正しく入力してください。'); return
    }
    setManualBusy(true); setManualNotice('')
    try {
      await platformClient.createManualTransaction({
        id: crypto.randomUUID(), householdId, occurredOn: manualDate, postedOn: null, transactionType: manualType,
        payee: manualPayee.trim() || null, description: manualDescription.trim() || null,
        attributionKind: manualAttribution === 'HOUSEHOLD' ? 'HOUSEHOLD' : 'MEMBER', attributedMemberId: manualAttribution === 'HOUSEHOLD' ? null : manualAttribution,
        audienceVisibility: manualAudience === 'SHARED' ? 'SHARED' : 'PERSONAL', audienceMemberId: manualAudience === 'SHARED' ? null : manualAudience,
        entries: [
          { id: crypto.randomUUID(), accountId: manualDebit, side: 'DEBIT', amountJpy: amount },
          { id: crypto.randomUUID(), accountId: manualCredit, side: 'CREDIT', amountJpy: amount },
        ],
      })
      setManualPayee(''); setManualDescription(''); setManualAmount(''); setManualAttribution('HOUSEHOLD'); setManualAudience('SHARED'); setShowManual(false); setLedgerPage(1); onChanged(); setManualNotice('手動取引を台帳に記録しました。'); showToast('手動取引を台帳に記録しました。')
    } catch { setManualNotice('取引を記録できませんでした。日付と口座を確認してください。') }
    finally { setManualBusy(false) }
  }
  const exportLedger = async (format: 'CSV' | 'XLSX' | 'PDF') => {
    if (!desktop || !householdId) { setExportNotice('保存はデスクトップ版で利用できます。'); return }
    setExportBusy(true); setExportNotice('')
    const period = periodFromMonth(month)
    const request = { householdId, exportKind: 'TRANSACTIONS' as const, accountingBasis: basis, groupId: accountGroupId, attributionScope, fromDate: period.fromDate, toDate: period.toDate }
    try {
      const saved = format === 'CSV'
        ? await accountGroupExportPlatform.saveCsv(request)
        : format === 'XLSX'
          ? await accountGroupExportPlatform.saveTransactionLedgerXlsx(request)
          : await accountGroupExportPlatform.saveTransactionLedgerPdf(request)
      setExportNotice(saved ? `${format}を保存しました。` : '保存をキャンセルしました。')
      if (saved) showToast(`${format}を保存しました。`)
    } catch { setExportNotice(`${format}を書き出せませんでした。`); showToast(`${format}を書き出せませんでした。`, 'error') }
    finally { setExportBusy(false) }
  }
  const manualAmountValue = Number(manualAmount)
  const manualBalanced = /^\d+$/.test(manualAmount) && Number.isSafeInteger(manualAmountValue) && manualAmountValue > 0 && Boolean(manualDebit) && Boolean(manualCredit) && manualDebit !== manualCredit

  return <>
    <PageHeader eyebrow="取引台帳" title="すべての取引" description="確定した取引と元データを一か所で管理します。">
      {desktop && <button className="primary-btn" onClick={() => setShowManual((value) => !value)}>{showManual ? '入力を閉じる' : '＋ 手入力取引'}</button>}
    </PageHeader>
    {showManual && <div className="manual-transaction-backdrop" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget && !manualBusy) setShowManual(false) }}><section className="panel manual-transaction-dialog" role="dialog" aria-modal="true" aria-labelledby="manual-transaction-title"><div className="panel-head"><div><h2 id="manual-transaction-title">手入力取引（複式）</h2><p>借方と貸方を明示し、貸借差額が ¥0 の取引だけを確定台帳へ転記します。</p></div><button className="icon-btn" aria-label="手動取引を閉じる" disabled={manualBusy} onClick={() => setShowManual(false)}><X size={18} /></button></div><div className="manual-transaction-grid"><label>日付<input aria-label="取引日" type="date" value={manualDate} onChange={(event) => setManualDate(event.target.value)} /></label><label>取引種別<select aria-label="手動取引種別" value={manualType} onChange={(event) => setManualType(event.target.value as ManualTransactionTypeDto)}>{['EXPENSE', 'INCOME', 'TRANSFER', 'CARD_PURCHASE', 'CARD_PAYMENT', 'REFUND', 'FEE', 'INTEREST', 'ADJUSTMENT'].map((type) => <option key={type}>{type}</option>)}</select></label><label>支払先<input aria-label="手動取引の支払先" value={manualPayee} onChange={(event) => setManualPayee(event.target.value)} placeholder="店舗・支払先" /></label><label>摘要<input aria-label="手動取引のメモ" value={manualDescription} onChange={(event) => setManualDescription(event.target.value)} placeholder="任意" /></label><label className="manual-amount-field">金額 (JPY)<input aria-label="手動取引の金額" inputMode="numeric" value={manualAmount} onChange={(event) => setManualAmount(event.target.value)} placeholder="1500" /></label><fieldset className="compact-assignment"><legend>家族内の帰属</legend><select aria-label="手動取引の家族内の帰属" value={manualAttribution} onChange={(event) => setManualAttribution(event.target.value)}><option value="HOUSEHOLD">世帯共通</option>{members.filter((member) => member.status === 'ACTIVE').map((member) => <option key={member.id} value={member.id}>{member.displayName}</option>)}</select></fieldset><label className="manual-journal-side debit"><span>借方</span><select aria-label="手動取引の借方口座" value={manualDebit} onChange={(event) => setManualDebit(event.target.value)}><option value="">口座を選択</option>{accounts.map((account) => <option key={account.id} value={account.id}>{account.name}</option>)}</select><b>{manualAmountValue > 0 ? yen(manualAmountValue) : '—'}</b></label><label className="manual-journal-side credit"><span>貸方</span><select aria-label="手動取引の貸方口座" value={manualCredit} onChange={(event) => setManualCredit(event.target.value)}><option value="">口座を選択</option>{accounts.map((account) => <option key={account.id} value={account.id}>{account.name}</option>)}</select><b>{manualAmountValue > 0 ? yen(manualAmountValue) : '—'}</b></label><fieldset className="compact-assignment"><legend>表示区分</legend><select aria-label="手動取引の表示区分" value={manualAudience} onChange={(event) => setManualAudience(event.target.value)}><option value="SHARED">共有</option>{members.filter((member) => member.status === 'ACTIVE').map((member) => <option key={member.id} value={member.id}>個人・{member.displayName}</option>)}</select></fieldset></div><p className="local-label-help">家族内帰属は分析対象、表示区分は端末内の整理ラベルです。「個人」も閲覧制限ではありません。</p><div className={`manual-balance-check${manualBalanced ? ' balanced' : ''}`}><span>貸借差額</span><strong>{manualBalanced ? '¥0 ✓' : '入力を確認'}</strong></div>{manualNotice && <p role="status">{manualNotice}</p>}<div className="manual-dialog-actions"><button className="secondary-btn" disabled={manualBusy} onClick={() => setShowManual(false)}>キャンセル</button><button className="primary-btn" disabled={manualBusy || !manualBalanced} onClick={() => void createManual()}>{manualBusy ? '転記中…' : '転記'}</button></div></section></div>}
    {!showManual && manualNotice && <div className="import-notice" role="status">{manualNotice}</div>}
    {detailNotice && <div className="import-notice" role="status">{detailNotice}</div>}
    <section className="panel table-panel">
      <div className="table-toolbar"><div className="search table-search"><Search size={17} /><input value={query} onChange={(e) => setQuery(e.target.value)} placeholder={text('店舗、カテゴリー、口座を検索')} /></div><div className="transaction-export-actions" aria-label="取引を書き出す"><button className="secondary-btn" disabled={exportBusy} onClick={() => void exportLedger('CSV')}>CSV</button><button className="secondary-btn" disabled={exportBusy} onClick={() => void exportLedger('XLSX')}>Excel</button><button className="secondary-btn" disabled={exportBusy} onClick={() => void exportLedger('PDF')}><Download size={15} /> PDF</button></div></div>
      <div className="transaction-filter-row"><div className="transaction-type-filters" aria-label="取引種別フィルター">{([['ALL', 'すべて'], ['INCOME', '収入'], ['EXPENSE', '支出'], ['TRANSFER_PAYMENT', '振替・カード支払'], ['REFUND', '返金']] as const).map(([value, label]) => <button key={value} className={transactionTypeFilter === value ? 'active' : ''} aria-pressed={transactionTypeFilter === value} onClick={() => setTransactionTypeFilter(value)}>{label}</button>)}</div><button className="secondary-btn advanced-filter-trigger" aria-expanded={showAdvancedFilters} onClick={() => setShowAdvancedFilters((value) => !value)}><Layers size={15} />詳細フィルタ</button></div>
      {showAdvancedFilters && <div className="metadata-filters advanced-filter-panel" role="group" aria-label="詳細フィルター"><div className="basis-toggle" aria-label={text('計上基準')}><button className={basis === 'ACCRUAL' ? 'active' : ''} onClick={() => onBasisChange('ACCRUAL')}>{text('発生ベース')}</button><button className={basis === 'CASH' ? 'active' : ''} onClick={() => onBasisChange('CASH')}>{text('資金移動')}</button><button disabled title="残高ベースは読み取りモデル対応後に有効になります">残高</button></div><label>計算対象<select aria-label="計算対象で絞り込み" value={calculationFilter} onChange={(event) => setCalculationFilter(event.target.value as typeof calculationFilter)}><option value="ALL">すべて</option><option value="INCLUDED">対象のみ</option><option value="EXCLUDED">対象外のみ</option></select></label>{desktop && <><label>ラベル<select aria-label="ラベルで絞り込み" value={labelFilter} onChange={(event) => setLabelFilter(event.target.value as TransactionLabelDto | '')}><option value="">すべて</option>{Object.entries(transactionLabelNames).map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></label><label>タグ<input aria-label="タグで絞り込み" value={tagFilter} onChange={(event) => setTagFilter(event.target.value.replace(/^#/, ''))} placeholder="旅行" /></label><label>口座グループ<select aria-label="口座グループで絞り込み" value={accountGroupId ?? ''} onChange={(event) => onAccountGroupChange(event.target.value || null)}><option value="">すべての口座</option>{accountGroups.map((group) => <option key={group.id} value={group.id}>{group.name}</option>)}</select></label></>}<button className="text-btn" onClick={() => { setCalculationFilter('ALL'); setLabelFilter(''); setTagFilter(''); onAccountGroupChange(null) }}>クリア</button></div>}
      {(calculationFilter !== 'ALL' || labelFilter || tagFilter || accountGroupId) && <div className="active-filter-chips" aria-label="適用中のフィルター">{calculationFilter !== 'ALL' && <button onClick={() => setCalculationFilter('ALL')}>{calculationFilter === 'INCLUDED' ? '計算対象' : '集計対象外'} <X size={12} /></button>}{labelFilter && <button onClick={() => setLabelFilter('')}>ラベル: {transactionLabelNames[labelFilter]} <X size={12} /></button>}{tagFilter && <button onClick={() => setTagFilter('')}>#{tagFilter} <X size={12} /></button>}{accountGroupId && <button onClick={() => onAccountGroupChange(null)}>口座: {accountGroups.find((group) => group.id === accountGroupId)?.name ?? accountGroupId} <X size={12} /></button>}<button className="clear" onClick={() => { setCalculationFilter('ALL'); setLabelFilter(''); setTagFilter(''); onAccountGroupChange(null) }}>すべてクリア</button></div>}
      {desktop && selectedTransactionIds.size > 0 && <section className="bulk-metadata-toolbar" aria-label="選択した取引の一括編集"><div className="bulk-selection"><button type="button" className="secondary-btn" onClick={toggleVisibleTransactions}>{visible.length > 0 && visible.every((row) => selectedTransactionIds.has(row.id)) ? '表示中の選択を解除' : '表示中を選択'}</button><strong>{selectedTransactionIds.size}件選択</strong><small>最大200件</small><button type="button" className="text-btn" onClick={() => setSelectedTransactionIds(new Set())}>すべて解除</button></div><div className="bulk-edit-group"><strong>カテゴリー</strong><select aria-label="一括変更するカテゴリー" value={bulkCategoryAccountId} onChange={(event) => setBulkCategoryAccountId(event.target.value)}><option value="">変更先を選択</option><optgroup label="支出">{accounts.filter((account) => account.accountKind === 'EXPENSE').map((account) => <option key={account.id} value={account.id}>{account.name}</option>)}</optgroup><optgroup label="収入">{accounts.filter((account) => account.accountKind === 'INCOME').map((account) => <option key={account.id} value={account.id}>{account.name}</option>)}</optgroup></select><button type="button" className="secondary-btn" disabled={metadataBusy || !bulkCategoryAccountId} onClick={() => void applyBulkLedgerChange('CATEGORY')}>一括変更</button></div><div className="bulk-edit-group"><strong>集計</strong><select aria-label="一括変更する計算対象" value={bulkCalculationTarget} onChange={(event) => setBulkCalculationTarget(event.target.value as 'INCLUDED' | 'EXCLUDED' | '')}><option value="">状態を選択</option><option value="INCLUDED">計算対象</option><option value="EXCLUDED">集計対象外</option></select><button type="button" className="secondary-btn" disabled={metadataBusy || !bulkCalculationTarget} onClick={() => void applyBulkLedgerChange('CALCULATION')}>一括変更</button></div><div className="bulk-edit-group"><strong>帰属</strong><select aria-label="一括変更する家族内の帰属" value={bulkAttribution} onChange={(event) => setBulkAttribution(event.target.value)}><option value="">変更先を選択</option><option value="HOUSEHOLD">世帯共通</option>{members.filter((member) => member.status === 'ACTIVE').map((member) => <option key={member.id} value={member.id}>{member.displayName}</option>)}</select><button type="button" className="secondary-btn" disabled={metadataBusy || !bulkAttribution} onClick={() => void applyBulkLedgerChange('ATTRIBUTION')}>帰属を変更</button></div><div className="bulk-edit-group bulk-label-group"><strong>ラベル・タグ</strong><select aria-label="ラベルとタグの操作" value={metadataOperation} onChange={(event) => setMetadataOperation(event.target.value as 'ADD' | 'REMOVE')}><option value="ADD">追加</option><option value="REMOVE">削除</option></select><select aria-label="一括編集するラベル" value={metadataLabel} onChange={(event) => setMetadataLabel(event.target.value as TransactionLabelDto | '')}><option value="">ラベル変更なし</option>{Object.entries(transactionLabelNames).map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select><input aria-label="一括編集するタグ" value={metadataTags} onChange={(event) => setMetadataTags(event.target.value)} placeholder="タグ（カンマ区切り）" /><button type="button" className="primary-btn" disabled={metadataBusy} onClick={() => void applyBulkMetadata()}>{metadataBusy ? '更新中…' : `${metadataOperation === 'ADD' ? '追加' : '削除'}を適用`}</button></div><p>帰属の変更は原本の表示区分を変更しません。カテゴリー変更できないカード支払・振替は安全にスキップします。</p></section>}
      {metadataNotice && <div className="bulk-metadata-notice" role="status">{metadataNotice}</div>}
      {exportNotice && <div className="bulk-metadata-notice" role="status">{exportNotice}</div>}
      <div className="table-summary"><span>{month}・{basis === 'ACCRUAL' ? '発生ベース' : '資金移動ベース'}・家計集計は計算対象のみ</span><strong>収入 {yen(basisIncome)}</strong><strong>{basis === 'ACCRUAL' ? '支出' : '現金流出'} {yen(basisExpense)}</strong><em>{desktop ? `${totalItems}件中 ${visible.length}件` : `${visible.length}件を表示`}</em></div>
      {loadError ? <p className="empty-state">{text('台帳を読み込めませんでした。')}</p> : visible.length > 0 ? <TransactionRows compact={false} rows={visible} onSelect={desktop ? (id, trigger) => void openDetail(id, trigger) : undefined} selectedIds={selectedTransactionIds} onToggleSelection={toggleTransactionSelection} /> : <p className="empty-state">該当する取引がありません</p>}
      {desktop && totalPages > 1 && <div className="pagination"><button className="secondary-btn" disabled={ledgerPage <= 1} onClick={() => setLedgerPage((value) => value - 1)}>{text('前へ')}</button><span>{ledgerPage} / {totalPages}</span><button className="secondary-btn" disabled={ledgerPage >= totalPages} onClick={() => setLedgerPage((value) => value + 1)}>{text('次へ')}</button></div>}
    </section>
    {selectedDetail && <TransactionDetailPanel key={selectedDetail.updatedAt} detail={selectedDetail} accounts={accounts} members={members} returnFocus={detailReturnFocus.current} onClose={() => setSelectedDetail(null)} onSave={saveDetail} onChanged={onChanged} />}
  </>
}

function suggestedPosting(candidate: PreviewCandidateDto, accounts: readonly AccountDto[], householdId: string): PostingDecisionDto {
  const source = accounts.find((account) => account.id === candidate.accountId)
  if (!source) throw new Error('Candidate source account is missing')
  const expenseAccount = accounts.find((account) => account.id === `${householdId}-other-expense` && account.accountKind === 'EXPENSE')
  const incomeAccount = accounts.find((account) => account.id === `${householdId}-income` && account.accountKind === 'INCOME')
  const text = `${candidate.merchantRaw ?? ''} ${candidate.descriptionRaw ?? ''}`
  const cardAccounts = accounts.filter((account) => account.accountKind === 'LIABILITY' && account.accountSubtype === 'CREDIT_CARD')
  const cardAccount = /(?:楽天|RAKUTEN)/i.test(text)
    ? cardAccounts.find((account) => /Rakuten/i.test(account.name))
    : /(?:AMAZON|SMBC|三井住友)/i.test(text)
      ? cardAccounts.find((account) => /Amazon/i.test(account.name))
      : cardAccounts.find((account) => account.id.endsWith('-card')) ?? cardAccounts[0]
  const looksLikeCardPayment = source.accountSubtype === 'BANK' && /(カード|CARD|JCB|AMEX|アメックス)/i.test(text)
  const looksLikeRefund = /(返金|返品|REFUND|REVERSAL)/i.test(text)
  let transactionType: string
  let debitAccount: AccountDto | undefined
  let creditAccount: AccountDto | undefined
  if (candidate.suggestedTransactionType === 'TRANSFER') {
    transactionType = 'TRANSFER'
    const counterpart = accounts.find((account) => account.id !== source.id && (account.accountKind === 'ASSET' || account.accountKind === 'LIABILITY'))
    if (candidate.direction === 'OUT') { debitAccount = counterpart; creditAccount = source }
    else { debitAccount = source; creditAccount = counterpart }
  } else if (looksLikeCardPayment && candidate.direction === 'OUT') {
    transactionType = 'CARD_PAYMENT'; debitAccount = cardAccount; creditAccount = source
  } else if (candidate.direction === 'OUT') {
    transactionType = source.accountSubtype === 'CREDIT_CARD' ? 'CARD_PURCHASE' : 'EXPENSE'
    debitAccount = expenseAccount; creditAccount = source
  } else if (looksLikeRefund) {
    transactionType = 'REFUND'; debitAccount = source; creditAccount = expenseAccount
  } else {
    transactionType = 'INCOME'; debitAccount = source; creditAccount = incomeAccount
  }
  if (!debitAccount || !creditAccount) throw new Error('Required ledger account is missing')
  return {
    candidateId: candidate.id,
    transactionId: globalThis.crypto.randomUUID(),
    transactionType,
    payee: candidate.merchantRaw,
    description: candidate.descriptionRaw,
    calculationTarget: candidate.suggestedTransactionType === 'TRANSFER' ? false : candidate.calculationTarget,
    attributionKind: candidate.attributionKind,
    attributedMemberId: candidate.attributedMemberId,
    audienceVisibility: candidate.audienceVisibility,
    audienceMemberId: candidate.audienceMemberId,
    duplicateResolution: candidate.duplicateMatch?.decision && candidate.duplicateMatch.decision !== 'UNRESOLVED' ? candidate.duplicateMatch.decision : undefined,
    entries: [
      { id: globalThis.crypto.randomUUID(), accountId: debitAccount.id, side: 'DEBIT', amountJpy: candidate.amountJpy },
      { id: globalThis.crypto.randomUUID(), accountId: creditAccount.id, side: 'CREDIT', amountJpy: candidate.amountJpy },
    ],
  }
}

interface PostingDraft {
  readonly approved: boolean
  readonly decision: PostingDecisionDto
  readonly error: string | null
  readonly touched: boolean
}

function matchingClassificationRule(rules: readonly ClassificationRuleDto[], merchant: string | null, description: string | null): ClassificationRuleDto | null {
  const contains = (value: string | null, needle: string | null) => needle === null || Boolean(value?.toLocaleLowerCase().includes(needle.toLocaleLowerCase()))
  return [...rules]
    .filter((rule) => rule.isEnabled && contains(merchant, rule.merchantContains) && contains(description, rule.descriptionContains))
    .sort((left, right) => left.priority - right.priority || left.id.localeCompare(right.id))[0] ?? null
}

function eligibleClassificationDecision(decision: PostingDecisionDto, accounts: readonly AccountDto[]): boolean {
  if (!['EXPENSE', 'CARD_PURCHASE', 'REFUND'].includes(decision.transactionType)) return false
  const expenseEntries = decision.entries.filter((entry) => accounts.find((account) => account.id === entry.accountId)?.accountKind === 'EXPENSE')
  const expectedSide = decision.transactionType === 'REFUND' ? 'CREDIT' : 'DEBIT'
  return expenseEntries.length === 1 && expenseEntries[0].side === expectedSide
}

function applyClassificationRuleToDecision(decision: PostingDecisionDto, rule: ClassificationRuleDto, accounts: readonly AccountDto[]): PostingDecisionDto | null {
  if (!eligibleClassificationDecision(decision, accounts) || !accounts.some((account) => account.id === rule.categoryAccountId && account.accountKind === 'EXPENSE')) return null
  const expenseEntries = decision.entries.filter((entry) => accounts.find((account) => account.id === entry.accountId)?.accountKind === 'EXPENSE')
  if (expenseEntries.length !== 1) return null
  return {
    ...decision,
    entries: decision.entries.map((entry) => entry.id === expenseEntries[0].id ? { ...entry, accountId: rule.categoryAccountId } : entry),
    classificationRuleId: rule.id,
    expectedClassificationRuleUpdatedAt: rule.updatedAt,
  }
}

function clearClassificationProvenance(decision: PostingDecisionDto): PostingDecisionDto {
  const { classificationRuleId: _ruleId, expectedClassificationRuleUpdatedAt: _updatedAt, ...manualDecision } = decision
  void _ruleId; void _updatedAt
  return manualDecision
}

function initialPostingDraft(candidate: PreviewCandidateDto, accounts: readonly AccountDto[], householdId: string): PostingDraft {
  try {
    return { approved: false, decision: suggestedPosting(candidate, accounts, householdId), error: null, touched: false }
  } catch {
    return {
      approved: false,
      touched: false,
      error: '取込先または相手勘定が見つかりません。口座設定を確認するか、このインポートを取り消してください。',
      decision: {
        candidateId: candidate.id,
        transactionId: globalThis.crypto.randomUUID(),
        transactionType: candidate.suggestedTransactionType ?? 'EXPENSE',
        payee: candidate.merchantRaw,
        description: candidate.descriptionRaw,
        calculationTarget: candidate.calculationTarget,
        attributionKind: candidate.attributionKind,
        attributedMemberId: candidate.attributedMemberId,
        audienceVisibility: candidate.audienceVisibility,
        audienceMemberId: candidate.audienceMemberId,
        duplicateResolution: candidate.duplicateMatch?.decision && candidate.duplicateMatch.decision !== 'UNRESOLVED' ? candidate.duplicateMatch.decision : undefined,
        entries: [
          { id: globalThis.crypto.randomUUID(), accountId: '', side: 'DEBIT', amountJpy: candidate.amountJpy },
          { id: globalThis.crypto.randomUUID(), accountId: '', side: 'CREDIT', amountJpy: candidate.amountJpy },
        ],
      },
    }
  }
}

export function DuplicateReviewGate({ preview, onResolution }: { preview: ImportPreviewDto; onResolution: (candidateId: string, resolution: 'LINK' | 'KEEP_BOTH' | 'EXCLUDE') => void | Promise<void> }) {
  const affected = preview.candidates.filter((candidate) => candidate.duplicateMatch)
  const summary = preview.duplicateSummary
  if (!summary || (affected.length === 0 && summary.confirmedReplays === 0)) return null
  const reasonLabel: Record<string, string> = { SAME_ACCOUNT: '同じ口座', SAME_CURRENCY: '同じ通貨', SAME_DIRECTION: '同じ入出金方向', SAME_AMOUNT: '同じ金額', SAME_EFFECTIVE_DATE: '同じ取引日', SAME_NORMALIZED_TEXT: '支払先・摘要が一致', OTHER_ACTIVE_REVIEW: '別の確認待ちにも存在' }
  return <section className="panel duplicate-review-gate" aria-label={`${preview.source.originalFilename}の重複レビュー`}>
    <div className="duplicate-file-summary"><strong>重複チェック</strong><span>{preview.candidates.length}候補: {summary.confirmedReplays}件は取込済み・{summary.likelyDuplicates}件は重複の可能性が高い・{summary.possibleDuplicates}件は要確認</span>{summary.overlapStart && <small>既存データとの重複期間: {summary.overlapStart} → {summary.overlapEnd}</small>}</div>
    {affected.map((candidate) => { const match = candidate.duplicateMatch!; const selected = match.decision === 'UNRESOLVED' ? undefined : match.decision; return <article className="duplicate-comparison" key={candidate.id}>
      <header><strong>{match.confidence === 'LIKELY' ? '重複の可能性が高い' : '重複の可能性あり'}</strong><span>{match.reasons.map((reason) => reasonLabel[reason] ?? reason).join(' + ')}</span></header>
      <div><section><small>今回の候補</small><b>{candidate.occurredOn} ・ {yen(candidate.amountJpy)}</b><span>{candidate.merchantRaw ?? candidate.descriptionRaw ?? '支払先なし'}</span><em>{preview.source.originalFilename}</em></section><section><small>既存または確認待ち</small><b>{match.occurredOn} ・ {yen(match.amountJpy)}</b><span>{match.payee ?? match.description ?? '支払先なし'}</span><em>{match.sourceFilename ?? match.matchedTransactionId ?? match.matchedCandidateId ?? '確認待ち'}</em></section></div>
      <footer role="group" aria-label={`${candidate.id}の重複判定`}><button type="button" aria-label="追加証憑として紐付け" aria-pressed={selected === 'LINK'} disabled={!match.matchedTransactionId} onClick={() => void onResolution(candidate.id, 'LINK')}>リンク</button><button type="button" aria-label="別取引として両方残す" aria-pressed={selected === 'KEEP_BOTH'} onClick={() => void onResolution(candidate.id, 'KEEP_BOTH')}>両方保持</button><button type="button" aria-label="このソース行を除外" aria-pressed={selected === 'EXCLUDE'} onClick={() => void onResolution(candidate.id, 'EXCLUDE')}>除外</button></footer>
    </article> })}
  </section>
}

function ImportReviewSection({ stagedImport, accounts, householdId, busy, isReceipt, recovered, sourceCompletionBlocked, onRollback, onCommit, onReceiptLinked }: { stagedImport: ImportPreviewDto; accounts: readonly AccountDto[]; householdId: string; busy: boolean; isReceipt: boolean; recovered: boolean; sourceCompletionBlocked: boolean; onRollback: () => void; onCommit: (decisions: readonly PostingDecisionDto[]) => void; onReceiptLinked: () => Promise<void> }) {
  const [drafts, setDrafts] = useState<Record<string, PostingDraft>>(() => Object.fromEntries(stagedImport.candidates.map((candidate) => [candidate.id, initialPostingDraft(candidate, accounts, householdId)])))
  const [receiptMatches, setReceiptMatches] = useState<Record<string, readonly ReceiptMatchSuggestionDto[]>>({})
  const [receiptSelections, setReceiptSelections] = useState<Record<string, string>>({})
  const [matchingCandidate, setMatchingCandidate] = useState<string | null>(null)
  const [classificationRules, setClassificationRules] = useState<readonly ClassificationRuleDto[]>([])
  const [classificationLoadFailed, setClassificationLoadFailed] = useState(false)
  const [classificationNotices, setClassificationNotices] = useState<Record<string, string>>({})
  const [applyingClassification, setApplyingClassification] = useState<string | null>(null)
  const classificationLoadStarted = useRef(false)
  const draftsRef = useRef(drafts)
  draftsRef.current = drafts
  useEffect(() => {
    setDrafts((current) => Object.fromEntries(Object.entries(current).map(([candidateId, draft]) => {
      const match = stagedImport.candidates.find((candidate) => candidate.id === candidateId)?.duplicateMatch
      const duplicateResolution = match && match.decision !== 'UNRESOLVED' ? match.decision : undefined
      return [candidateId, { ...draft, approved: duplicateResolution === draft.decision.duplicateResolution ? draft.approved : false, decision: { ...draft.decision, duplicateResolution } }]
    })))
  }, [stagedImport.candidates])
  const hasEligibleClassificationCandidates = Object.values(drafts).some((draft) => eligibleClassificationDecision(draft.decision, accounts))
  useEffect(() => {
    if (!hasEligibleClassificationCandidates || classificationLoadStarted.current) return
    classificationLoadStarted.current = true
    let active = true
    void platformClient.listClassificationRules(householdId)
      .then((rules) => { if (active) { setClassificationRules(rules); setClassificationLoadFailed(false) } })
      .catch(() => { if (active) { setClassificationRules([]); setClassificationLoadFailed(true) } })
    return () => { active = false }
  }, [hasEligibleClassificationCandidates, householdId])
  useEffect(() => {
    let active = true
    if (!isReceipt) return
    void Promise.all(stagedImport.candidates.map(async (candidate) => [candidate.id, await platformClient.suggestReceiptMatches(householdId, candidate.id)] as const)).then((items) => {
      if (!active) return
      const matches = Object.fromEntries(items); setReceiptMatches(matches)
      setReceiptSelections(Object.fromEntries(items.filter(([, suggestions]) => suggestions[0]).map(([candidateId, suggestions]) => [candidateId, suggestions[0].transactionId])))
    }).catch(() => { if (active) setReceiptMatches({}) })
    return () => { active = false }
  }, [householdId, isReceipt, stagedImport])
  const linkReceipt = async (candidateId: string) => {
    const transactionId = receiptSelections[candidateId]; if (!transactionId) return
    setMatchingCandidate(candidateId)
    try { await platformClient.confirmReceiptMatch(householdId, candidateId, transactionId); await onReceiptLinked() }
    catch { /* The native command revalidates atomically; keep the candidate reviewable on failure. */ }
    finally { setMatchingCandidate(null) }
  }
  const updateDecision = (candidateId: string, change: (decision: PostingDecisionDto) => PostingDecisionDto) => setDrafts((current) => {
    const draft = current[candidateId]
    return !draft ? current : { ...current, [candidateId]: { ...draft, approved: false, touched: true, decision: clearClassificationProvenance(change(draft.decision)) } }
  })
  const applyRuleSuggestion = async (candidateId: string) => {
    const draft = drafts[candidateId]
    if (!draft || !eligibleClassificationDecision(draft.decision, accounts)) return
    const expectedPayee = draft.decision.payee
    const expectedDescription = draft.decision.description
    setApplyingClassification(candidateId)
    setClassificationNotices((current) => ({ ...current, [candidateId]: '' }))
    try {
      const preview = await platformClient.previewClassificationRules({ householdId, merchant: expectedPayee, description: expectedDescription })
      const rule = preview.matches.find((candidate) => candidate.id === preview.winningRuleId)
      if (!rule) throw new Error('NO_CURRENT_RULE')
      const latest = draftsRef.current[candidateId]
      if (!latest || latest.decision.payee !== expectedPayee || latest.decision.description !== expectedDescription) throw new Error('DRAFT_CHANGED')
      const decision = applyClassificationRuleToDecision(latest.decision, rule, accounts)
      if (!decision) throw new Error('INELIGIBLE_DRAFT')
      setDrafts((current) => {
        if (current[candidateId] !== latest) return current
        return { ...current, [candidateId]: { ...latest, approved: false, touched: true, decision } }
      })
      setClassificationRules((current) => [...current.filter((candidate) => candidate.id !== rule.id), rule])
      setClassificationNotices((current) => ({ ...current, [candidateId]: `${rule.name} を適用しました。承認はまだ行われていません。` }))
    } catch {
      setClassificationNotices((current) => ({ ...current, [candidateId]: 'ルールを再確認できませんでした。候補は変更せず、手動で確認できます。' }))
    } finally { setApplyingClassification(null) }
  }
  const applyAllRuleSuggestions = () => {
    let appliedCount = 0
    const nextDrafts = Object.fromEntries(Object.entries(draftsRef.current).map(([candidateId, draft]) => {
      if (draft.touched || !eligibleClassificationDecision(draft.decision, accounts)) return [candidateId, draft]
      const rule = matchingClassificationRule(classificationRules, draft.decision.payee, draft.decision.description)
      if (!rule) return [candidateId, draft]
      const decision = applyClassificationRuleToDecision(draft.decision, rule, accounts)
      if (!decision) return [candidateId, draft]
      appliedCount += 1
      return [candidateId, { ...draft, approved: false, touched: true, decision }]
    }))
    if (appliedCount > 0) {
      setDrafts(nextDrafts)
      setClassificationNotices((current) => ({ ...current, all: `${appliedCount}件にルール候補を適用しました。承認はまだ行われていません。` }))
    }
  }
  const accountIds = new Set(accounts.map((account) => account.id))
  const approved = stagedImport.candidates.every((candidate) => {
    const draft = drafts[candidate.id]
    const duplicateResolved = !candidate.duplicateMatch || Boolean(draft?.decision.duplicateResolution)
    return Boolean(duplicateResolved && draft?.approved && !draft.error && validatePostingDecision(draft.decision, { candidateAmountJpy: candidate.amountJpy, accountIds, expectedCandidateId: candidate.id }).valid)
  })
  const decisions = stagedImport.candidates.map((candidate) => drafts[candidate.id]?.decision).filter((decision): decision is PostingDecisionDto => Boolean(decision))
  const sourceOnly = stagedImport.candidates.length === 0
  const postingError = Object.values(drafts).find((draft) => draft.error)?.error
  const untouchedSuggestionCount = Object.values(drafts).filter((draft) => !draft.touched && eligibleClassificationDecision(draft.decision, accounts) && matchingClassificationRule(classificationRules, draft.decision.payee, draft.decision.description)).length
  const bulkApprovalEligibleIds = new Set(stagedImport.candidates.filter((candidate) => {
    const draft = drafts[candidate.id]
    const duplicateResolved = !candidate.duplicateMatch || Boolean(draft?.decision.duplicateResolution)
    return Boolean(duplicateResolved && draft && !draft.error && validatePostingDecision(draft.decision, { candidateAmountJpy: candidate.amountJpy, accountIds, expectedCandidateId: candidate.id }).valid)
  }).map((candidate) => candidate.id))
  const bulkApprovedCount = [...bulkApprovalEligibleIds].filter((candidateId) => drafts[candidateId]?.approved).length
  const allEligibleApproved = bulkApprovalEligibleIds.size > 0 && bulkApprovedCount === bulkApprovalEligibleIds.size
  const setAllEligibleApprovals = (checked: boolean) => setDrafts((current) => Object.fromEntries(Object.entries(current).map(([candidateId, draft]) => [candidateId, bulkApprovalEligibleIds.has(candidateId) ? { ...draft, approved: checked } : draft])))

  if (postingError) return <section className="panel review-panel"><div className="panel-head"><div><h2>{stagedImport.source.originalFilename}</h2><p>{stagedImport.candidates.length}件の候補{recovered ? '・再起動後に復元' : ''}</p></div><b>{recovered ? 'RECOVERED' : 'REVIEW'}</b></div><p className="empty-state" role="alert">{postingError}</p><div className="review-actions"><span>口座設定の修正後に再度開くか、取り消してください。</span><button className="secondary-btn" disabled={busy} onClick={onRollback}>{busy ? '処理中…' : '取り消す'}</button></div></section>
  if (sourceOnly && sourceCompletionBlocked) return <section className="panel review-panel"><div className="panel-head"><div><h2>{stagedImport.source.originalFilename}</h2><p>投資・資産データ{recovered ? '・再起動後に復元' : ''}</p></div><b>{recovered ? 'RECOVERED' : 'REVIEW'}</b></div><p className="empty-state" role="alert">専用データの保存が完了する前に中断されました。この取込を取り消し、原本ファイルを再度取り込んでください。</p><div className="review-actions"><span>未保存の投資データを完了済みとして扱いません。</span><button className="secondary-btn" disabled={busy} onClick={onRollback}>{busy ? '処理中…' : '取り消して再取込'}</button></div></section>

  return <section className="panel review-panel"><div className="panel-head"><div><h2>{stagedImport.source.originalFilename}</h2><p>{stagedImport.candidates.length}件の候補・原本は暗号化済み{recovered ? '・再起動後に復元' : ''}</p></div><b>{recovered ? 'RECOVERED' : 'REVIEW'}</b></div>{hasEligibleClassificationCandidates && <div className="classification-review-toolbar"><span><strong>分類ルール候補</strong><small>ルールは候補だけを変更し、承認や台帳反映は行いません。</small></span><button type="button" className="secondary-btn" disabled={untouchedSuggestionCount === 0} onClick={applyAllRuleSuggestions}>未編集の候補に一括適用（{untouchedSuggestionCount}件）</button>{classificationLoadFailed && <small role="status">分類ルールを読み込めませんでした。候補は通常どおり手動で確認できます。</small>}{classificationNotices.all && <small role="status">{classificationNotices.all}</small>}</div>}{!sourceOnly && <div className="candidate-approval-toolbar"><label><input aria-label="すべての承認可能な候補を承認" type="checkbox" checked={allEligibleApproved} disabled={bulkApprovalEligibleIds.size === 0 || busy} onChange={(event) => setAllEligibleApprovals(event.target.checked)} /><span>すべて承認</span></label><small>{bulkApprovedCount}/{bulkApprovalEligibleIds.size}件承認済み{bulkApprovalEligibleIds.size < stagedImport.candidates.length ? `・未解決の${stagedImport.candidates.length - bulkApprovalEligibleIds.size}件は対象外` : ''}</small></div>}<div className="candidate-review-list">{stagedImport.candidates.map((candidate) => { const draft = drafts[candidate.id]; const draftValid = validatePostingDecision(draft.decision, { candidateAmountJpy: candidate.amountJpy, accountIds, expectedCandidateId: candidate.id }).valid; return <div className="candidate-review-row candidate-review-edit" key={candidate.id}><ReceiptReviewPanel candidate={candidate} decision={draft.decision} accounts={accounts} onDecisionChange={(decision) => updateDecision(candidate.id, () => decision)} /><label><input aria-label={`${candidate.merchantRaw ?? candidate.descriptionRaw ?? candidate.id}を承認`} type="checkbox" checked={draft.approved} disabled={!draftValid} onChange={(event) => setDrafts((current) => ({ ...current, [candidate.id]: { ...current[candidate.id], approved: event.target.checked } }))} /><span>承認</span></label><div><input aria-label={`${candidate.id}の支払先`} value={draft.decision.payee ?? ''} onChange={(event) => updateDecision(candidate.id, (decision) => ({ ...decision, payee: event.target.value || null }))} /><span>{candidate.occurredOn} ・ {candidate.direction} ・ {yen(candidate.amountJpy)}</span>{candidate.institutionRaw && <small>{candidate.institutionRaw} ・ {[candidate.categoryMajorRaw, candidate.categoryMinorRaw].filter(Boolean).join(' / ')}{candidate.externalTransactionId ? ` ・ ID ${candidate.externalTransactionId}` : ''}</small>}</div><select aria-label={`${candidate.id}の取引種別`} value={draft.decision.transactionType} onChange={(event) => updateDecision(candidate.id, (decision) => ({ ...decision, transactionType: event.target.value }))}>{['EXPENSE', 'CARD_PURCHASE', 'CARD_PAYMENT', 'INCOME', 'REFUND', 'TRANSFER'].map((type) => <option key={type}>{type}</option>)}</select><PostingEntryEditor candidateId={candidate.id} candidateAmountJpy={candidate.amountJpy} decision={draft.decision} accounts={accounts} onChange={(decision) => updateDecision(candidate.id, () => decision)} /><label><input type="checkbox" checked={draft.decision.calculationTarget} disabled={candidate.suggestedTransactionType === 'TRANSFER'} onChange={(event) => updateDecision(candidate.id, (decision) => ({ ...decision, calculationTarget: event.target.checked }))} /><span>家計集計に含める</span></label>{eligibleClassificationDecision(draft.decision, accounts) && (() => { const rule = matchingClassificationRule(classificationRules, draft.decision.payee, draft.decision.description); const ruleNotice = classificationNotices[candidate.id]; return rule ? <div className="classification-rule-suggestion"><span><strong>{rule.name}</strong><small>{rule.categoryName}{rule.labels.length > 0 ? ` ・ ${rule.labels.join(' / ')}` : ''}{rule.tags.length > 0 ? ` ・ #${rule.tags.join(' #')}` : ''}</small></span><button type="button" className="mini-btn" aria-label={`${candidate.merchantRaw ?? candidate.descriptionRaw ?? candidate.id}の分類ルール候補を適用`} disabled={applyingClassification === candidate.id} onClick={() => void applyRuleSuggestion(candidate.id)}>{applyingClassification === candidate.id ? '再確認中…' : draft.decision.classificationRuleId === rule.id ? '適用済み・再確認' : '提案を適用'}</button>{ruleNotice && <small role="status">{ruleNotice}</small>}</div> : ruleNotice ? <small className="classification-rule-notice" role="status">{ruleNotice}</small> : null })()}{isReceipt && (receiptMatches[candidate.id]?.length ?? 0) > 0 && <div className="receipt-match-review"><strong>既存取引の候補</strong><select aria-label={`${candidate.id}のレシート紐付け候補`} value={receiptSelections[candidate.id] ?? ''} onChange={(event) => setReceiptSelections((current) => ({ ...current, [candidate.id]: event.target.value }))}>{receiptMatches[candidate.id].map((match) => <option key={match.transactionId} value={match.transactionId}>{match.occurredOn} ・ {match.payee ?? match.description ?? match.transactionId} ・ {yen(match.amountJpy)} ・ {Math.round(match.scoreBps / 100)}%</option>)}</select><button className="mini-btn" disabled={matchingCandidate === candidate.id} onClick={() => void linkReceipt(candidate.id)}>{matchingCandidate === candidate.id ? '紐付け中…' : '新規支出を作らず証憑として紐付け'}</button><small>金額一致・日付差3日以内の確定済み支出だけを表示します。自動紐付けはしません。</small></div>}{candidate.issues.length > 0 && <small>{candidate.issues.join(', ')}</small>}</div> })}{sourceOnly && <p className="empty-state">台帳候補のない原本処理です。内容を確認して完了するか、取り消してください。</p>}</div><div className="review-actions"><span>{sourceOnly ? '台帳へ取引は追加されません' : approved ? '全候補を承認済み' : '各候補の口座と種別を確認して承認してください'}</span><button className="secondary-btn" disabled={busy} onClick={onRollback}>取り消す</button><button className="primary-btn" disabled={busy || !approved || decisions.length !== stagedImport.candidates.length} onClick={() => onCommit(decisions)}>{busy ? '処理中…' : sourceOnly ? '原本処理を完了' : '承認済みを台帳へ反映'}</button></div></section>
}

interface DurableFolderInboxView {
  readonly items: readonly WatchedFileInboxItemDto[]
  readonly counts: WatchedFileInboxCountsDto | null
  readonly autoScan: boolean
  readonly busy: boolean
  setAutoScan(enabled: boolean): void
  refresh(hydrate?: boolean): Promise<void>
  retry(itemId: string): Promise<void>
  ignore(itemId: string): Promise<void>
}

const demoImportCandidates = [
  { date: '2026-07-23', description: '成城石井', category: '食費', amount: -13_876, suggestion: 'ルール一致', tone: 'ok' },
  { date: '2026-07-20', description: 'JR EAST', category: '交通', amount: -2_180, suggestion: '重複の可能性', tone: 'warn' },
  { date: '2026-07-18', description: 'MUFG → SBI', category: '資金移動', amount: -120_000, suggestion: '振替の可能性', tone: 'info' },
] as const

function ImportInboxDemo({ inputRef, onPick, busy, processFiles }: { inputRef: React.Ref<HTMLInputElement>; onPick: () => void; busy: boolean; processFiles: (files: FileList | readonly File[]) => Promise<void> }) {
  const [selected, setSelected] = useState(importItems[1].file)
  const [posted, setPosted] = useState<ReadonlySet<string>>(() => new Set([importItems[3].file]))
  const active = importItems.find((item) => item.file === selected) ?? importItems[0]
  const isPosted = posted.has(active.file)
  return <><PageHeader eyebrow="データ取り込み" title="インポート Inbox" description="ファイルから読み取った候補を確認して台帳へ反映します。"><button className="primary-btn" disabled={busy} onClick={onPick}><Import size={17} /> {busy ? '解析中…' : 'ファイルを選択'}</button><input ref={inputRef} aria-label="取込ファイルを選択" className="visually-hidden" type="file" multiple onChange={(event) => { const files = takeFileInputSelection(event.currentTarget); void processFiles(files) }} /></PageHeader><div className="import-stage-strip" aria-label="インポート処理段階"><strong>処理段階:</strong>{['検出', '抽出中', 'プレビュー', 'マッピング必要', 'レビュー必要', '転記可能', '転記済み'].map((label, index) => <span className={index === 6 ? 'complete' : ''} key={label}>{label}{index < 6 && <ArrowRight size={11} />}</span>)}</div><section className="import-master-detail"><aside className="panel import-file-column"><div className="panel-head"><div><h2>ファイル</h2><p>自動転記は行いません</p></div><b>{importItems.length}</b></div><button className="mini-drop-zone" onClick={onPick} onDragOver={(event) => event.preventDefault()} onDrop={(event) => { event.preventDefault(); void processFiles(event.dataTransfer.files) }}><Import size={16} /> ファイルを追加</button>{importItems.map((item) => <button key={item.file} className={`import-file-card${selected === item.file ? ' active' : ''}`} onClick={() => setSelected(item.file)}><strong>{item.file}</strong><small>{item.source} ・ {item.records}行 ・ {item.time}</small><b className={posted.has(item.file) ? 'posted' : item.state}>{posted.has(item.file) ? '✓ 転記済み' : item.state === 'review' ? '◐ レビュー必要' : item.state === 'ready' ? '◇ プレビュー可' : item.state === 'matched' ? '◐ マッピング必要' : '✓ 転記済み'}</b></button>)}<p>新規ファイルが自動転記されることはありません。必ず候補を確認してください。</p></aside><div className="import-review-column"><article className="panel import-candidate-review"><div className="panel-head"><div><h2>{active.file}</h2><p>{active.source} ・ adapter confidence 0.98</p></div><b className={isPosted ? 'posted' : 'review'}>{isPosted ? '✓ 転記済み' : '◐ レビュー必要'}</b></div>{active.state === 'matched' && !isPosted && <div className="import-state-banner review">◐ マッピング必要 — 取込先口座を選択してください。<select aria-label="取込先口座"><option>三井住友銀行・家計</option><option>PayPay残高</option></select></div>}{!isPosted && <div className="import-candidate-table"><div className="import-candidate-head"><span>日付</span><span>元の摘要</span><span>カテゴリ案</span><span>金額</span><span>提案・警告</span></div>{demoImportCandidates.map((candidate) => <div key={candidate.date + candidate.description}><code>{candidate.date}</code><strong>{candidate.description}</strong><span>{candidate.category}</span><b>{yen(candidate.amount)}</b><em className={candidate.tone}>{candidate.suggestion}</em></div>)}</div>}{isPosted ? <div className="import-posted-state"><Check size={28} /><div><strong>台帳へ転記済み</strong><span>{active.records}件の確認済み候補</span></div><button className="secondary-btn" onClick={() => setPosted((current) => { const next = new Set(current); next.delete(active.file); return next })}>ロールバック</button></div> : <div className="review-actions"><span>提案は未確定です。候補を確認してから転記します。</span><button className="secondary-btn">行を除外</button><button className="primary-btn" onClick={() => setPosted((current) => new Set([...current, active.file]))}>レビュー確定して転記</button></div>}</article><article className="panel source-preview"><div className="panel-head"><div><h2>ソースビューア</h2><p>原本は不変</p></div><FileText size={18} /></div><pre><span>2026-07-22,コンビニ,1280</span>{'\n'}<mark>2026-07-23,成城石井,13876</mark>{'\n'}<span>2026-07-24,JR EAST,2180</span></pre><p>原本は不変 — 正規化値の編集は原本を変更しません。</p></article></div></section></>
}

function ImportPage({ previews, setPreviews, householdId, accounts, members, summary, onChanged, folderInbox }: { previews: ImportPreview[]; setPreviews: React.Dispatch<React.SetStateAction<ImportPreview[]>>; householdId: string | null; accounts: readonly AccountDto[]; members: readonly HouseholdMemberDto[]; summary: ImportRunCountsDto | null; onChanged: () => void; folderInbox: DurableFolderInboxView }) {
  const inputRef = useRef<HTMLInputElement>(null)
  const [importView, setImportView] = useState<'LOCAL' | 'CONNECTORS'>('LOCAL')
  const [busy, setBusy] = useState(false)
  const [activeRun, setActiveRun] = useState<string | null>(null)
  const [protectedPdf, setProtectedPdf] = useState<{ itemId: string; status: Exclude<PdfPasswordStatus, 'SUCCESS'>; operation: 'EXTRACT' | 'OCR' } | null>(null)
  const [pdfOcrRequiredIds, setPdfOcrRequiredIds] = useState<ReadonlySet<string>>(() => new Set())
  const [staged, setStaged] = useState<Record<string, ImportPreviewDto>>({})
  const [receiptStagedIds, setReceiptStagedIds] = useState<ReadonlySet<string>>(() => new Set())
  const [notice, setNotice] = useState('')
  const [watchedFolders, setWatchedFolders] = useState<readonly WatchedFolderDto[]>([])
  const [folderBusy, setFolderBusy] = useState<string | null>(null)
  const [driveInboxItems, setDriveInboxItems] = useState<readonly GoogleDriveInboxItemDto[]>([])
  const [driveInboxBusy, setDriveInboxBusy] = useState(false)
  const [gmailInboxItems, setGmailInboxItems] = useState<readonly GmailInboxItemDto[]>([])
  const [gmailInboxBusy, setGmailInboxBusy] = useState(false)
  const [portfolioImported, setPortfolioImported] = useState<ReadonlySet<string>>(() => new Set())
  const [aggregateAssetImported, setAggregateAssetImported] = useState<ReadonlySet<string>>(() => new Set())
  const [parserProfiles, setParserProfiles] = useState<readonly DelimitedParserProfileDto[]>([])
  const [selectedParserProfiles, setSelectedParserProfiles] = useState<Record<string, string>>({})
  const [customParserPreviews, setCustomParserPreviews] = useState<Record<string, CustomDelimitedPreview>>({})
  const [customParserAccounts, setCustomParserAccounts] = useState<Record<string, string>>({})
  const [moneyForwardAccounts, setMoneyForwardAccounts] = useState<Record<string, Record<string, string>>>({})
  const [yuchoAccounts, setYuchoAccounts] = useState<Record<string, string>>({})
  const [standardImportAccounts, setStandardImportAccounts] = useState<Record<string, string>>({})
  const [investmentImportAccounts, setInvestmentImportAccounts] = useState<Record<string, string>>({})
  const [originalParserPreviews, setOriginalParserPreviews] = useState<Record<string, ImportPreview>>({})
  const [rescuePreviewId, setRescuePreviewId] = useState<string | null>(null)
  const [recoveryBusy, setRecoveryBusy] = useState(false)
  const [recoveryError, setRecoveryError] = useState('')
  const [recoveryRevision, setRecoveryRevision] = useState(0)
  const [recoveredReceiptRunIds, setRecoveredReceiptRunIds] = useState<ReadonlySet<string>>(() => new Set())
  const [sourceResumeRequiredRunIds, setSourceResumeRequiredRunIds] = useState<ReadonlySet<string>>(() => new Set())
  const [pendingReviewRuns, setPendingReviewRuns] = useState<readonly PendingReviewRunDto[]>([])
  const rescueTriggerRef = useRef<HTMLButtonElement | null>(null)
  const hydratedStagedRunsRef = useRef(new Set<string>())
  const inFlightRunsRef = useRef(new Set<string>())
  const hydratedDriveItemsRef = useRef(new Set<string>())
  const hydratedGmailItemsRef = useRef(new Set<string>())
  const recoveredReviewCount = Object.keys(staged).filter((key) => key.startsWith('recovered:')).length

  useEffect(() => {
    hydratedStagedRunsRef.current.clear()
    setStaged({})
    setReceiptStagedIds(new Set())
    setPdfOcrRequiredIds(new Set())
    setRecoveredReceiptRunIds(new Set())
    setSourceResumeRequiredRunIds(new Set())
    setPendingReviewRuns([])
    setDriveInboxItems([])
    hydratedDriveItemsRef.current.clear()
    setGmailInboxItems([])
    hydratedGmailItemsRef.current.clear()
    setMoneyForwardAccounts({})
    setStandardImportAccounts({})
    setInvestmentImportAccounts({})
    setRescuePreviewId(null)
  }, [householdId])

  useEffect(() => {
    if (platformClient.runtime !== 'tauri' || !householdId) { setRecoveryBusy(false); setRecoveryError(''); return }
    let active = true
    setRecoveryBusy(true); setRecoveryError('')
    void platformClient.listPendingReviews(householdId).then(async (result) => {
      const recovered = await Promise.allSettled(result.runs.map(async (run) => ({ run, preview: await platformClient.previewImport(run.runId) })))
      if (!active) return
      const successful = recovered.flatMap((item) => item.status === 'fulfilled' ? [item.value] : [])
      setPendingReviewRuns(result.runs)
      const failedCount = recovered.length - successful.length
      setStaged((current) => {
        const next = { ...current }
        const pendingRunIds = new Set(result.runs.map((run) => run.runId))
        for (const key of Object.keys(next)) if (key.startsWith('recovered:') && !pendingRunIds.has(next[key].summary.runId)) delete next[key]
        const known = new Set(Object.values(next).map((preview) => preview.summary.runId))
        for (const { run, preview } of successful) {
          if (known.has(run.runId)) continue
          next[`recovered:${run.runId}`] = preview; known.add(run.runId); hydratedStagedRunsRef.current.add(run.runId)
        }
        return next
      })
      setRecoveredReceiptRunIds(new Set(result.runs.filter((run) => /^receipt-(?:text|image-ocr)-v\d+$/.test(run.adapterId ?? '')).map((run) => run.runId)))
      setSourceResumeRequiredRunIds(new Set(result.runs.filter((run) => run.completionState === 'SOURCE_RESUME_REQUIRED').map((run) => run.runId)))
      if (failedCount > 0) setRecoveryError(`${failedCount}件の確認待ちを復元できませんでした。他の候補は表示しています。`)
    }).catch(() => { if (active) setRecoveryError('確認待ちのインポートを復元できませんでした。再試行してください。') })
      .finally(() => { if (active) setRecoveryBusy(false) })
    return () => { active = false }
  }, [householdId, recoveryRevision])

  useEffect(() => {
    const activeIds = new Set(previews.map((preview) => preview.id))
    setStandardImportAccounts((current) => {
      const entries = Object.entries(current).filter(([previewId]) => activeIds.has(previewId))
      return entries.length === Object.keys(current).length ? current : Object.fromEntries(entries)
    })
    setMoneyForwardAccounts((current) => {
      const entries = Object.entries(current).filter(([previewId]) => activeIds.has(previewId))
      return entries.length === Object.keys(current).length ? current : Object.fromEntries(entries)
    })
    setInvestmentImportAccounts((current) => {
      const entries = Object.entries(current).filter(([previewId]) => activeIds.has(previewId))
      return entries.length === Object.keys(current).length ? current : Object.fromEntries(entries)
    })
  }, [previews])

  const processFiles = async (files: FileList | readonly File[], sourceType: 'MANUAL_UPLOAD' | 'LOCAL_FOLDER' | 'ICLOUD_PICKER' = 'MANUAL_UPLOAD') => {
    if (files.length === 0) return
    setBusy(true)
    setNotice('')
    try {
      const next = (await previewImportFiles(files)).map((preview) => ({ ...preview, sourceType }))
      setPreviews((current) => {
        const merged = new Map(current.map((item) => [item.id, item]))
        next.forEach((item) => merged.set(item.id, item))
        return Array.from(merged.values()).reverse()
      })
      setNotice(`${next.length}件のファイルを読み取りました。状態と次の操作を確認してください。`)
    } catch {
      setNotice('ファイルを読み取れませんでした。形式、サイズ、アクセス権を確認して再試行してください。')
    } finally {
      setBusy(false)
    }
  }

  const refreshGoogleDriveInbox = useCallback(async (hydrate = true) => {
    if (platformClient.runtime !== 'tauri' || !householdId) { setDriveInboxItems([]); return }
    setDriveInboxBusy(true)
    try {
      const items = await platformClient.listGoogleDriveInbox(householdId, undefined, undefined, 200)
      setDriveInboxItems(items)
      setPreviews((current) => retainActiveGoogleDrivePreviews(current, items))
      if (!hydrate) return
      const previewable = items.filter((item) => isGoogleDriveInboxPreviewable(item) && !hydratedDriveItemsRef.current.has(item.id)).slice(0, 20)
      for (const expected of previewable) {
        hydratedDriveItemsRef.current.add(expected.id)
        try {
          const loaded = await platformClient.readGoogleDriveInboxFile(householdId, expected.id)
          if (!googleDriveInboxFileIsImmutable(expected, loaded.item, loaded.fileBytes.length)) throw new Error('Google Drive generation changed during preview')
          const bytes = new Uint8Array(loaded.fileBytes)
          const lastModified = loaded.item.remoteModifiedAt ? Date.parse(loaded.item.remoteModifiedAt) : Date.now()
          const file = new File([bytes], loaded.item.fileName, { type: loaded.item.mediaType, lastModified })
          const parsed = (await previewImportFiles([file]))[0]
          if (!parsed || parsed.id !== loaded.item.contentSha256) throw new Error('Google Drive content hash mismatch')
          const preview = attachGoogleDriveInboxIdentity(parsed, loaded.item)
          setPreviews((current) => [...current.filter((candidate) => candidate.driveInboxItemId !== expected.id), preview])
        } catch {
          hydratedDriveItemsRef.current.delete(expected.id)
          setNotice(`Google Drive の「${expected.fileName}」を安全にプレビューできませんでした。同期後に再試行してください。`)
        }
      }
    } catch {
      setNotice('Google Drive Inbox を読み込めませんでした。接続状態を確認してください。')
    } finally {
      setDriveInboxBusy(false)
    }
  }, [householdId, setPreviews])

  const retryGoogleDriveInboxItem = async (itemId: string) => {
    if (!householdId) return
    setDriveInboxBusy(true)
    try {
      await platformClient.retryGoogleDriveInboxItem(householdId, itemId)
      hydratedDriveItemsRef.current.delete(itemId)
      await refreshGoogleDriveInbox(true)
    } catch { setNotice('Google Drive のファイルを再試行できませんでした。') }
    finally { setDriveInboxBusy(false) }
  }

  const ignoreGoogleDriveInboxItem = async (itemId: string) => {
    if (!householdId) return
    setDriveInboxBusy(true)
    try {
      await platformClient.ignoreGoogleDriveInboxItem(householdId, itemId)
      hydratedDriveItemsRef.current.add(itemId)
      setPreviews((current) => current.filter((preview) => preview.driveInboxItemId !== itemId))
      await refreshGoogleDriveInbox(false)
    } catch { setNotice('Google Drive のファイルを無視できませんでした。') }
    finally { setDriveInboxBusy(false) }
  }

  const repreviewGoogleDriveInboxItem = async (itemId: string) => {
    hydratedDriveItemsRef.current.delete(itemId)
    await refreshGoogleDriveInbox(true)
  }

  useEffect(() => {
    if (platformClient.runtime !== 'tauri' || !householdId) return
    void refreshGoogleDriveInbox(true)
  }, [householdId, refreshGoogleDriveInbox])

  useEffect(() => {
    if (platformClient.runtime !== 'tauri' || !householdId) return
    let disposed = false
    let unlisten: (() => void) | undefined
    void googleDriveSyncEventPlatform.subscribe((event) => {
      if (!disposed && event.householdId === householdId) void refreshGoogleDriveInbox(true)
    }).then((stop) => { if (disposed) stop(); else unlisten = stop }).catch(() => undefined)
    return () => { disposed = true; unlisten?.() }
  }, [householdId, refreshGoogleDriveInbox])

  const refreshGmailInbox = useCallback(async (hydrate = true) => {
    if (platformClient.runtime !== 'tauri' || !householdId) { setGmailInboxItems([]); return }
    setGmailInboxBusy(true)
    try {
      const items = await platformClient.listGmailInbox(householdId, undefined, undefined, 200)
      setGmailInboxItems(items); setPreviews((current) => retainActiveGmailPreviews(current, items))
      if (!hydrate) return
      for (const expected of items.filter((item) => isGmailInboxPreviewable(item) && !hydratedGmailItemsRef.current.has(item.id)).slice(0, 20)) {
        hydratedGmailItemsRef.current.add(expected.id)
        try {
          const loaded = await platformClient.readGmailInboxFile(householdId, expected.id)
          if (!gmailInboxFileIsImmutable(expected, loaded.item)) throw new Error('Gmail evidence changed during preview')
          const file = new File([new Uint8Array(loaded.fileBytes)], loaded.item.fileName, { type: loaded.item.mediaType, lastModified: loaded.item.internalDateMs })
          const parsed = (await previewImportFiles([file]))[0]; if (!parsed) throw new Error('Gmail preview missing')
          const preview = attachGmailInboxIdentity(parsed, loaded.item)
          setPreviews((current) => [...current.filter((candidate) => candidate.gmailInboxItemId !== expected.id), preview])
        } catch {
          hydratedGmailItemsRef.current.delete(expected.id)
          setNotice(`Gmail の「${expected.fileName}」をプレビューできませんでした。同期後に再試行してください。`)
        }
      }
    } catch { setNotice('Gmail Inbox を読み込めませんでした。接続状態を確認してください。') }
    finally { setGmailInboxBusy(false) }
  }, [householdId, setPreviews])

  const retryGmailInboxItem = async (itemId: string) => { if (!householdId) return; setGmailInboxBusy(true); try { await platformClient.retryGmailInboxItem(householdId, itemId); hydratedGmailItemsRef.current.delete(itemId); await refreshGmailInbox(true) } catch { setNotice('Gmail のメールを再試行できませんでした。') } finally { setGmailInboxBusy(false) } }
  const ignoreGmailInboxItem = async (itemId: string) => { if (!householdId) return; setGmailInboxBusy(true); try { await platformClient.ignoreGmailInboxItem(householdId, itemId); hydratedGmailItemsRef.current.add(itemId); setPreviews((current) => current.filter((preview) => preview.gmailInboxItemId !== itemId)); await refreshGmailInbox(false) } catch { setNotice('Gmail のメールを無視できませんでした。') } finally { setGmailInboxBusy(false) } }
  const repreviewGmailInboxItem = async (itemId: string) => { hydratedGmailItemsRef.current.delete(itemId); await refreshGmailInbox(true) }

  useEffect(() => { if (platformClient.runtime === 'tauri' && householdId) void refreshGmailInbox(true) }, [householdId, refreshGmailInbox])
  useEffect(() => {
    if (platformClient.runtime !== 'tauri' || !householdId) return
    let disposed = false; let unlisten: (() => void) | undefined
    void gmailSyncEventPlatform.subscribe((event) => { if (!disposed && event.householdId === householdId) void refreshGmailInbox(true) }).then((stop) => { if (disposed) stop(); else unlisten = stop }).catch(() => undefined)
    return () => { disposed = true; unlisten?.() }
  }, [householdId, refreshGmailInbox])

  useEffect(() => {
    if (platformClient.runtime !== 'tauri' || !householdId) { setWatchedFolders([]); return }
    void platformClient.listWatchedFolders(householdId).then(setWatchedFolders).catch(() => setNotice('監視フォルダーを読み込めませんでした。'))
  }, [householdId])

  useEffect(() => {
    if (platformClient.runtime !== 'tauri' || !householdId) { setParserProfiles([]); return }
    let active = true
    void delimitedParserProfilePlatform.list(householdId).then((items) => { if (active) setParserProfiles(items.filter((profile) => profile.isEnabled)) }).catch(() => { if (active) setParserProfiles([]) })
    return () => { active = false }
  }, [householdId])

  useEffect(() => {
    if (!householdId) return
    let active = true
    for (const item of folderInbox.items) {
      if (item.householdId !== householdId || item.state !== 'STAGED' || !item.importRunId || hydratedStagedRunsRef.current.has(item.importRunId)) continue
      hydratedStagedRunsRef.current.add(item.importRunId)
      void platformClient.previewImport(item.importRunId).then((preview) => {
        if (!active) return
        setStaged((current) => Object.values(current).some((existing) => existing.summary.runId === preview.summary.runId) ? current : ({ ...current, [`folder:${item.id}`]: preview }))
      }).catch(() => { hydratedStagedRunsRef.current.delete(item.importRunId!) })
    }
    return () => { active = false }
  }, [folderInbox.items, householdId])

  useEffect(() => {
    if (!householdId) return
    let active = true
    for (const item of driveInboxItems) {
      if (item.householdId !== householdId || item.state !== 'STAGED' || !item.importRunId || hydratedStagedRunsRef.current.has(item.importRunId)) continue
      hydratedStagedRunsRef.current.add(item.importRunId)
      void platformClient.previewImport(item.importRunId).then((preview) => {
        if (!active || preview.summary.status !== 'REVIEW_REQUIRED') return
        setStaged((current) => Object.values(current).some((existing) => existing.summary.runId === preview.summary.runId) ? current : ({ ...current, [`drive:${item.id}`]: preview }))
      }).catch(() => { hydratedStagedRunsRef.current.delete(item.importRunId!) })
    }
    return () => { active = false }
  }, [driveInboxItems, householdId])

  const applyCustomParserProfile = (item: ImportPreview, explicitProfile?: DelimitedParserProfileDto, explicitAccountId?: string) => {
    const profile = explicitProfile ?? parserProfiles.find((candidate) => candidate.id === selectedParserProfiles[item.id])
    if (!profile || !item.fileBytes) return
    setOriginalParserPreviews((current) => current[item.id] ? current : { ...current, [item.id]: item })
    const result = parseCustomDelimitedBytes(item.fileBytes, profile, { filename: item.filename })
    const hints = [...new Set(result.parsed.records.flatMap((record) => typeof record === 'object' && record !== null && 'accountHint' in record && typeof record.accountHint === 'string' && record.accountHint.trim() ? [record.accountHint.trim()] : []))]
    const balanceAccounts = accounts.filter((account) => account.accountKind === 'ASSET' || account.accountKind === 'LIABILITY')
    const hintedAccount = hints.length === 1 ? balanceAccounts.find((account) => account.id === hints[0] || account.name === hints[0]) : undefined
    const fallbackAccount = accounts.find((account) => account.accountKind === 'ASSET' && account.accountSubtype === 'BANK')
    setCustomParserAccounts((current) => ({ ...current, [item.id]: explicitAccountId ?? hintedAccount?.id ?? fallbackAccount?.id ?? '' }))
    setCustomParserPreviews((current) => ({ ...current, [item.id]: result.preview }))
    const hasErrors = result.preview.issues.some((issue) => issue.severity === 'error')
    setPreviews((current) => current.map((preview) => preview.id === item.id ? {
      ...preview,
      adapterId: `${profile.name} / custom-delimited-v1`,
      encoding: result.preview.encoding,
      recordCount: result.preview.candidateCount,
      issues: result.preview.issues,
      status: result.preview.candidateCount > 0 && !hasErrors ? 'ready' : 'error',
      parsed: result.parsed,
      detectedAdapterId: 'custom-delimited-v1',
    } : preview))
    setNotice(result.preview.candidateCount > 0 && !hasErrors ? `${profile.name} で ${result.preview.candidateCount}件を候補化しました。台帳への反映前に内容を確認してください。` : 'エラーを含むため取込を開始できません。ヘッダーの一致、除外行と問題を確認してください。')
  }

  const selectCustomParserProfile = (item: ImportPreview, profileId: string) => {
    setSelectedParserProfiles((current) => ({ ...current, [item.id]: profileId }))
    if (!customParserPreviews[item.id]) return
    const original = originalParserPreviews[item.id]
    if (original) setPreviews((current) => current.map((preview) => preview.id === item.id ? original : preview))
    setCustomParserPreviews((current) => { const next = { ...current }; delete next[item.id]; return next })
    setCustomParserAccounts((current) => { const next = { ...current }; delete next[item.id]; return next })
    setNotice('プロファイルを変更しました。「適用してプレビュー」をもう一度実行してください。')
  }

  const scanForNewFiles = async (folders: readonly WatchedFolderDto[]) => {
    if (!householdId || folders.length === 0) return 0
    for (const folder of folders) {
      await platformClient.scanWatchedFolder(householdId, folder.id)
    }
    await folderInbox.refresh(true)
    return folderInbox.items.length
  }

  const addWatchedFolder = async () => {
    if (!householdId) return
    setFolderBusy('select'); setNotice('')
    try {
      const selected = await platformClient.selectWatchedFolder(householdId, '家計簿 Inbox')
      if (selected) { setWatchedFolders((current) => [...current.filter((folder) => folder.id !== selected.id), selected]); await platformClient.scanWatchedFolder(householdId, selected.id); await folderInbox.refresh(true) }
    } catch { setNotice('フォルダーを登録できませんでした。シンボリックリンクではないローカルフォルダーを選択してください。') }
    finally { setFolderBusy(null) }
  }
  const connectIcloudFolder = async () => {
    if (!householdId) return
    setFolderBusy('icloud'); setNotice('')
    try {
      const selected = await platformClient.selectIcloudFolder(householdId, 'iCloud Drive Inbox')
      if (!selected) { setNotice('iCloud Drive フォルダーの接続をキャンセルしました。'); return }
      setWatchedFolders((current) => [...current.filter((folder) => folder.id !== selected.id), selected])
      await platformClient.scanWatchedFolder(householdId, selected.id)
      await folderInbox.refresh(true)
      setNotice('iCloud Drive の同期済みローカルフォルダーを永続 Inbox に接続しました。台帳へは自動反映しません。')
    } catch {
      setNotice('iCloud Drive フォルダーを接続できませんでした。macOS または Windows の iCloud Drive がローカルに同期済みか確認してください。')
    } finally { setFolderBusy(null) }
  }
  const scanWatchedFolder = async (folder: WatchedFolderDto) => {
    if (!householdId) return
    setFolderBusy(folder.id); setNotice('')
    try { await scanForNewFiles([folder]); setNotice('同期フォルダーを確認し、永続 Inbox を更新しました。') }
    catch { setNotice('フォルダーを安全にスキャンできませんでした。同期状態とアクセス権を確認してください。') }
    finally { setFolderBusy(null) }
  }
  const removeWatchedFolder = async (folder: WatchedFolderDto) => {
    if (!householdId) return
    setFolderBusy(folder.id)
    try { await platformClient.removeWatchedFolder(householdId, folder.id); setWatchedFolders((current) => current.filter((item) => item.id !== folder.id)); await folderInbox.refresh() }
    catch { setNotice('監視フォルダーを解除できませんでした。') }
    finally { setFolderBusy(null) }
  }

  const startTrackedImport = async (item: ImportPreview, request: Parameters<typeof platformClient.startImport>[0], bytes: Uint8Array) => {
    if (!householdId) return platformClient.startImport(request, bytes)
    if (item.gmailInboxItemId) {
      const claim = await platformClient.claimGmailInboxItems(householdId, [item.gmailInboxItemId])
      if (claim.items.length !== 1 || claim.items[0].id !== item.gmailInboxItemId) throw new Error('Gmail Inbox item was not claimed')
      let started: Awaited<ReturnType<typeof platformClient.startImport>>
      try { started = await platformClient.startImport(request, bytes) }
      catch (error) { try { await platformClient.markGmailInboxFailed(householdId, item.gmailInboxItemId, claim.leaseToken, 'IMPORT_START_FAILED'); await refreshGmailInbox(false) } catch { /* native lease recovery keeps the evidence durable */ } throw error }
      await platformClient.markGmailInboxStaged(householdId, item.gmailInboxItemId, claim.leaseToken, started.runId)
      await refreshGmailInbox(false)
      return started
    }
    if (item.driveInboxItemId) {
      const claim = await platformClient.claimGoogleDriveInboxItems(householdId, [item.driveInboxItemId])
      if (claim.items.length !== 1 || claim.items[0].id !== item.driveInboxItemId) throw new Error('Google Drive Inbox item was not claimed')
      let started: Awaited<ReturnType<typeof platformClient.startImport>>
      try {
        started = await platformClient.startImport(request, bytes)
      } catch (error) {
        try { await platformClient.markGoogleDriveInboxFailed(householdId, item.driveInboxItemId, claim.leaseToken, 'IMPORT_START_FAILED'); await refreshGoogleDriveInbox(false) } catch { /* native lease recovery keeps the generation durable */ }
        throw error
      }
      await platformClient.markGoogleDriveInboxStaged(householdId, item.driveInboxItemId, claim.leaseToken, started.runId)
      await refreshGoogleDriveInbox(false)
      return started
    }
    if (!item.folderInboxItemId) return platformClient.startImport(request, bytes)
    const claim = await platformClient.claimWatchedFileInboxItems(householdId, [item.folderInboxItemId])
    if (claim.items.length !== 1 || claim.items[0].id !== item.folderInboxItemId) throw new Error('Folder Inbox item was not claimed')
    let started: Awaited<ReturnType<typeof platformClient.startImport>>
    try {
      started = await platformClient.startImport(request, bytes)
    } catch (error) {
      try { await platformClient.markWatchedFileInboxFailed(householdId, item.folderInboxItemId, claim.leaseToken, 'IMPORT_START_FAILED'); await folderInbox.refresh() } catch { /* native lease recovery keeps the item durable */ }
      throw error
    }
    // Once the source import exists it is canonical. If this acknowledgement
    // fails, leave PROCESSING for lease recovery; never relabel the real run as
    // a failed parse. Retrying import_start is SHA-idempotent.
    await platformClient.markWatchedFileInboxStaged(householdId, item.folderInboxItemId, claim.leaseToken, started.runId)
    await folderInbox.refresh()
    return started
  }

  const stageImport = async (item: ImportPreview) => {
    if (!householdId || !item.fileBytes || !item.parsed || !item.detectedAdapterId) return
    if (item.detectedAdapterId === 'custom-delimited-v1') {
      const selected = accounts.find((account) => account.id === customParserAccounts[item.id])
      if (!selected || (selected.accountKind !== 'ASSET' && selected.accountKind !== 'LIABILITY')) { setNotice('カスタム形式の有効な取込先口座を選択してください。'); return }
    }
    if (item.detectedAdapterId === 'money-forward-me-household-ledger-v1' && !hasCompleteMoneyForwardMapping(item, moneyForwardAccounts[item.id], accounts)) { setNotice('Money Forwardのすべての「保有金融機関」に対応する取込先口座を選択してください。'); return }
    if (item.detectedAdapterId === 'yucho-direct-ledger-v1' && !yuchoAccounts[item.id]) { setNotice('ゆうちょCSVの取込先銀行口座を選択してください。'); return }
    const standardRequirement = STANDARD_IMPORT_ACCOUNT_REQUIREMENTS[item.detectedAdapterId]
    const standardAccountId = standardImportAccounts[item.id]
    if (standardRequirement) {
      const selected = accounts.find((account) => account.id === standardAccountId)
      if (!selected || selected.accountKind !== standardRequirement.kind || selected.accountSubtype !== standardRequirement.subtype) { setNotice(standardRequirement.message); return }
    }
    setActiveRun(item.id)
    setNotice('')
    try {
      const defaultAccount = standardRequirement
        ? standardAccountId
        : item.detectedAdapterId === 'yucho-direct-ledger-v1' ? yuchoAccounts[item.id] ?? ''
        : item.detectedAdapterId === 'custom-delimited-v1' ? customParserAccounts[item.id] ?? ''
        : ''
      const mapping = await mapParsedImportToStartImport({
        file: {
          householdId, sourceType: item.sourceType ?? 'MANUAL_UPLOAD', originalFilename: item.filename,
          mediaType: item.mediaType ?? 'text/csv', byteSize: item.fileBytes.byteLength,
          sha256: item.id, sourceModifiedAt: item.sourceModifiedAt ?? null,
          accountId: defaultAccount, adapterVersion: item.detectedAdapterId === 'custom-delimited-v1' && customParserPreviews[item.id] ? `${customParserPreviews[item.id].profileId}@${customParserPreviews[item.id].profileVersion}` : builtInAdapterVersion(item.detectedAdapterId),
        },
        detectedAdapterId: item.detectedAdapterId,
        parsed: item.parsed,
        institutionAccountMappings: item.detectedAdapterId === 'money-forward-me-household-ledger-v1' ? moneyForwardAccounts[item.id] : undefined,
      }, { next: () => globalThis.crypto.randomUUID() }, sha256Text)
      if (mapping.issues.some((issue) => issue.severity === 'error') || mapping.request.candidates.length === 0) {
        setPreviews((current) => current.map((preview) => preview.id === item.id ? {
          ...preview, status: 'error', issues: [...preview.issues, ...mapping.issues.map((issue) => ({ code: issue.code, message: issue.message, severity: issue.severity, row: issue.sourceRow }))],
        } : preview))
        setNotice('正規化できない行があります。ファイル内容を確認してください。')
        return
      }
      const summary = await startTrackedImport(item, mapping.request, item.fileBytes)
      const backendPreview = await platformClient.previewImport(summary.runId)
      setStaged((current) => ({ ...current, [item.id]: backendPreview }))
      onChanged()
      setNotice(summary.reusedExisting ? '同じファイルの既存インポートを開きました。' : '原本を暗号化し、取引候補をステージングしました。')
    } catch {
      setNotice('インポートを開始できませんでした。データベースの状態を確認してください。')
    } finally {
      setActiveRun(null)
    }
  }

  const extractDocument = async (item: ImportPreview, password?: string, requestedOperation?: 'EXTRACT' | 'OCR') => {
    if (!householdId || !item.fileBytes || !item.mediaType) return
    setActiveRun(item.id); setNotice('')
    try {
      const isImage = item.mediaType.startsWith('image/')
      const operation = requestedOperation ?? (!isImage && pdfOcrRequiredIds.has(item.id) ? 'OCR' : 'EXTRACT')
      let extracted: ExtractedDocumentDto
      if (isImage) extracted = await paddleOcrDocument(item.fileBytes, item.mediaType)
      else if (operation === 'OCR') {
        // A previous password challenge must not survive an engine/model/limit
        // failure after the password has already been accepted.
        setProtectedPdf(null)
        const attempt = await protectedPdfPlatform.renderForOcr(item.fileBytes, password)
        if (attempt.status !== 'SUCCESS') {
          if (attempt.status === 'PASSWORD_REQUIRED' || attempt.status === 'PASSWORD_INVALID' || attempt.status === 'PASSWORD_UNSUPPORTED') {
            setProtectedPdf({ itemId: item.id, status: attempt.status, operation: 'OCR' })
            setNotice(attempt.status === 'PASSWORD_UNSUPPORTED' ? 'このPDFの暗号方式には対応していません。保護を解除したコピーを取り込んでください。' : 'スキャンPDFをOCRするためのパスワードを入力してください。')
          } else {
            const messages = {
              LIMIT_EXCEEDED: 'このPDFはOCRのページ数または処理上限を超えています。32ページ以下のファイルに分割してください。',
              FAILED: 'スキャンPDFを画像へ変換できませんでした。原本は台帳へ反映されていません。',
            } as const
            setNotice(messages[attempt.status])
          }
          return
        }
        extracted = await paddleOcrRenderedPdfPages(attempt.pages)
        setProtectedPdf(null)
      } else {
        const attempt = await protectedPdfPlatform.extract(item.fileBytes, password)
        if (attempt.status !== 'SUCCESS') {
          setProtectedPdf({ itemId: item.id, status: attempt.status, operation: 'EXTRACT' })
          setNotice(attempt.status === 'PASSWORD_UNSUPPORTED' ? 'このPDFの暗号方式には対応していません。保護を解除したコピーを取り込んでください。' : 'PDFを開くためのパスワードを入力してください。')
          return
        }
        extracted = attempt.document
        setProtectedPdf(null)
        if (extracted.issues.includes('OCR_REQUIRED')) {
          setPdfOcrRequiredIds((current) => new Set(current).add(item.id))
          setNotice(extracted.issues.includes('EMBEDDED_TEXT_UNSUPPORTED')
            ? `このPDFの埋め込み文字コードには直接対応できません。${extracted.pageCount ?? '全'}ページを端末内OCRで読み取ってください。`
            : `画像として保存されたPDFです。${extracted.pageCount ?? '全'}ページを端末内OCRで読み取る操作が必要です。`)
          return
        }
      }
      if (!isImage) {
        const rakutenStatement = parseRakutenStatementPdf(extracted)
        if (rakutenStatement) {
          const hasErrors = rakutenStatement.parsed.issues.some((issue) => issue.severity === 'error')
          setPreviews((current) => current.map((preview) => preview.id === item.id ? {
            ...preview,
            adapterId: rakutenStatement.parsed.adapterId,
            detectedAdapterId: rakutenStatement.parsed.adapterId,
            parsed: rakutenStatement.parsed,
            encoding: extracted.regions?.some((region) => region.provenance === 'PDF_EMBEDDED_TEXT_RKSJ') ? 'PDF / Shift-JIS' : 'PDF / OCR',
            recordCount: rakutenStatement.detailCount,
            issues: rakutenStatement.parsed.issues,
            status: hasErrors ? 'error' : 'ready',
            parsedAt: new Date().toISOString(),
          } : preview))
          setPdfOcrRequiredIds((current) => { const next = new Set(current); next.delete(item.id); return next })
          if (hasErrors) {
            setNotice('楽天カードPDFは読み取れましたが、請求額と明細合計を照合できません。原本内容を確認してください。')
          } else {
            const statement = rakutenStatement.parsed.records[0]
            setNotice(`楽天カードPDF ${extracted.pageCount ?? 1}ページから${rakutenStatement.detailCount}件を抽出し、請求額${yen(statement.statementTotal ?? 0)}と照合しました。取込先カード口座を選択してからレビューへ進んでください。`)
          }
          return
        }
      }
      const normalized = await buildReceiptImport(extracted, {
        householdId, filename: item.filename, mediaType: item.mediaType, byteSize: item.fileBytes.byteLength,
        sha256: item.id, sourceModifiedAt: item.sourceModifiedAt ?? null, accountId: `${householdId}-cash`, sourceType: item.sourceType,
      }, () => globalThis.crypto.randomUUID(), sha256Text)
      if (!normalized.request) {
        setNotice(normalized.fields.issues.includes('STATEMENT_LIKELY') ? '明細書形式のPDFは、1件の支出として取り込みません。原本内容を確認してください。' : '日付または合計金額を読み取れませんでした。内容を確認してください。')
        return
      }
      const started = await startTrackedImport(item, normalized.request, item.fileBytes)
      const backendPreview = await platformClient.previewImport(started.runId)
      setStaged((current) => ({ ...current, [item.id]: backendPreview })); onChanged()
      setReceiptStagedIds((current) => new Set(current).add(item.id))
      setPdfOcrRequiredIds((current) => { const next = new Set(current); next.delete(item.id); return next })
      const candidatePages = normalized.pageResults.filter((page) => page.candidateCreated)
      const confidence = candidatePages.length > 0
        ? Math.min(...candidatePages.map((page) => Math.min(extracted.pages?.find((value) => value.pageNumber === page.pageNumber)?.confidenceBps ?? extracted.confidenceBps, page.fields.confidenceBps)))
        : extracted.confidenceBps
      if ((extracted.pageCount ?? 1) > 1) {
        setNotice(candidatePages.length > 0
          ? `スキャンPDF ${extracted.pageCount}ページの原本を保存し、独立したレシートとして読めた${candidatePages.length}ページだけを支出候補にしました（最低信頼度 ${Math.round(confidence / 100)}%）。明細書ページは集約しません。`
          : `スキャンPDF ${extracted.pageCount}ページの原本とOCR結果を保存しました。独立したレシートとして確定できるページがないため、支出候補は作成していません。`)
      } else {
        setNotice(`${isImage ? 'PP-OCRv5によるレシート画像OCR' : extracted.method === 'OCR' ? 'スキャンPDF 1ページのOCR' : 'PDFの埋め込みテキスト'}から支出候補を抽出しました（信頼度 ${Math.round(confidence / 100)}%）。台帳への反映にはレビューと承認が必要です。`)
      }
    } catch {
      setNotice(item.mediaType.startsWith('image/') ? 'PP-OCRv5で画像を読み取れませんでした。モデル資源、対応形式、画質を確認してください。' : 'PDFを解析できませんでした。原本、パスワード、端末内OCRの状態を確認してください。')
    } finally { setActiveRun(null) }
  }

  const importPortfolioSnapshot = async (item: ImportPreview) => {
    if (!householdId || !item.fileBytes || item.detectedAdapterId !== 'securities-asset-snapshot-v1' || !item.parsed) return
    const securitiesAccount = accounts.find((account) => account.accountKind === 'ASSET' && account.accountSubtype === 'SECURITIES')
    if (!securitiesAccount) { setNotice('先に設定で「ASSET / SECURITIES」の証券口座を追加してください。'); return }
    const snapshot = item.parsed.records.find((record): record is PortfolioSnapshotCandidate => typeof record === 'object' && record !== null && (record as { kind?: unknown }).kind === 'portfolio-snapshot')
    if (!snapshot) { setNotice('資産スナップショットを正規化できませんでした。'); return }
    setActiveRun(item.id); setNotice('')
    try {
      const runId = crypto.randomUUID(); const documentId = crypto.randomUUID(); const recordId = crypto.randomUUID()
      const payloadJson = JSON.stringify(snapshot)
      const started = await startTrackedImport(item, {
        runId, documentId, householdId, sourceType: item.sourceType ?? 'MANUAL_UPLOAD', originalFilename: item.filename,
        mediaType: item.mediaType ?? 'text/csv', byteSize: item.fileBytes.byteLength, sha256: item.id,
        sourceModifiedAt: item.sourceModifiedAt ?? null, adapterId: item.detectedAdapterId, adapterVersion: builtInAdapterVersion(item.detectedAdapterId),
        records: [{ id: recordId, rowNumber: snapshot.lineage.sourceRow, recordHash: await sha256Text(payloadJson), payloadJson }],
        audienceVisibility: 'SHARED', audienceMemberId: null,
        candidates: [], cardStatements: [],
      }, item.fileBytes)
      if (!started.reusedExisting) {
        await portfolioPlatform.importSnapshot(mapPortfolioSnapshotImport(snapshot, { snapshotId: crypto.randomUUID(), householdId, accountId: securitiesAccount.id, sourceDocumentId: started.documentId }))
      }
      if (started.status !== 'POSTED') await platformClient.commitImport(started.runId, [])
      setPortfolioImported((current) => new Set([...current, item.id])); onChanged()
      setNotice(started.reusedExisting ? 'この資産スナップショットはすでに取り込み済みです。' : `${snapshot.positions.length}銘柄の資産スナップショットを保存しました。`)
    } catch { setNotice('資産スナップショットを保存できませんでした。証券口座と原本を確認してください。') }
    finally { setActiveRun(null) }
  }

  const importBrokerageHistory = async (item: ImportPreview) => {
    if (!householdId || !item.fileBytes || !isBrokerageTransactionAdapter(item.detectedAdapterId) || !item.parsed) return
    const eligibleAccounts = accounts.filter((account) => account.accountKind === 'ASSET' && account.accountSubtype === 'SECURITIES')
    const dedicatedImport = dedicatedBrokerageImport(item.detectedAdapterId)
    const securitiesAccount = dedicatedImport
      ? eligibleAccounts.find((account) => account.id === investmentImportAccounts[item.id])
      : eligibleAccounts[0]
    if (!securitiesAccount) { setNotice(dedicatedImport?.missingAccountMessage ?? '先に設定で「ASSET / SECURITIES」の証券口座を追加してください。'); return }
    const events = item.parsed.records.filter((record): record is BrokerageEventCandidate => typeof record === 'object' && record !== null && (record as { kind?: unknown }).kind === 'brokerage-event')
    if (events.length === 0) { setNotice('証券取引を正規化できませんでした。'); return }
    setActiveRun(item.id); setNotice('')
    try {
      const runId = crypto.randomUUID(); const documentId = crypto.randomUUID()
      const records = await Promise.all(events.map(async (event) => { const payloadJson = JSON.stringify(event); return { id: crypto.randomUUID(), rowNumber: event.lineage.sourceRow, recordHash: await sha256Text(payloadJson), payloadJson } }))
      const started = await startTrackedImport(item, { runId, documentId, householdId, sourceType: item.sourceType ?? 'MANUAL_UPLOAD', originalFilename: item.filename, mediaType: item.mediaType ?? 'text/csv', byteSize: item.fileBytes.byteLength, sha256: item.id, sourceModifiedAt: item.sourceModifiedAt ?? null, adapterId: item.detectedAdapterId!, adapterVersion: builtInAdapterVersion(item.detectedAdapterId!), audienceVisibility: 'SHARED', audienceMemberId: null, records, candidates: [], cardStatements: [] }, item.fileBytes)
      if (!started.reusedExisting) {
        await brokeragePlatform.importEvents(mapBrokerageEventsImport(events, { householdId, accountId: securitiesAccount.id, sourceDocumentId: started.documentId, idPrefix: runId }))
      }
      if (started.status !== 'POSTED') await platformClient.commitImport(started.runId, [])
      setPortfolioImported((current) => new Set([...current, item.id])); onChanged()
      setNotice(started.reusedExisting ? 'この証券取引ファイルはすでに取り込み済みです。' : `${events.length}件の証券取引を保存しました。`)
    } catch { setNotice('証券取引を保存できませんでした。口座、通貨、原本の合計を確認してください。') }
    finally { setActiveRun(null) }
  }

  const importAggregateAssetHistory = async (item: ImportPreview) => {
    if (!householdId || !item.fileBytes || item.detectedAdapterId !== 'money-forward-me-asset-trend-v1' || !item.parsed) return
    const snapshots = item.parsed.records.filter((record): record is AggregateAssetSnapshotCandidate => typeof record === 'object' && record !== null && (record as { kind?: unknown }).kind === 'aggregate-asset-snapshot')
    if (snapshots.length === 0) { setNotice('Money Forwardの総資産履歴を正規化できませんでした。'); return }
    setActiveRun(item.id); setNotice('')
    let newRunId: string | null = null
    let batchPersisted = false
    try {
      const runId = crypto.randomUUID(); const documentId = crypto.randomUUID()
      const records = await Promise.all(snapshots.map(async (snapshot) => { const payloadJson = JSON.stringify(snapshot); return { id: crypto.randomUUID(), rowNumber: snapshot.lineage.sourceRow, recordHash: await sha256Text(payloadJson), payloadJson } }))
      const started = await startTrackedImport(item, { runId, documentId, householdId, sourceType: item.sourceType ?? 'MANUAL_UPLOAD', originalFilename: item.filename, mediaType: item.mediaType ?? 'text/csv', byteSize: item.fileBytes.byteLength, sha256: item.id, sourceModifiedAt: item.sourceModifiedAt ?? null, adapterId: item.detectedAdapterId, adapterVersion: builtInAdapterVersion(item.detectedAdapterId), audienceVisibility: 'SHARED', audienceMemberId: null, records, candidates: [], cardStatements: [] }, item.fileBytes)
      if (!started.reusedExisting) newRunId = started.runId
      const result = await aggregateAssetHistoryPlatform.importHistory({ householdId, snapshots: snapshots.map((snapshot) => mapAggregateAssetSnapshotImport(snapshot, { id: crypto.randomUUID(), householdId, sourceDocumentId: started.documentId })) })
      batchPersisted = true
      if (started.status !== 'POSTED') await platformClient.commitImport(started.runId, [])
      setAggregateAssetImported((current) => new Set([...current, item.id])); onChanged()
      setNotice(result.reusedCount === snapshots.length ? 'このMoney Forward総資産履歴はすでに取り込み済みです。' : `${result.createdCount}時点の総資産履歴を保存しました。台帳と純資産には加算しません。`)
    } catch {
      if (newRunId && !batchPersisted) { try { await platformClient.rollbackImport(newRunId) } catch { /* retain the primary import error */ } }
      setNotice('Money Forward総資産履歴を保存できませんでした。同じ日付の値と原本行を確認してください。')
    }
    finally { setActiveRun(null) }
  }

  const commitRun = async (previewId: string, stagedImport: ImportPreviewDto, decisions: readonly PostingDecisionDto[]) => {
    if (inFlightRunsRef.current.has(stagedImport.summary.runId)) return
    inFlightRunsRef.current.add(stagedImport.summary.runId)
    setActiveRun(stagedImport.summary.runId)
    setNotice('')
    try {
      const result = await platformClient.commitImport(stagedImport.summary.runId, decisions)
      setStaged((current) => { const next = { ...current }; delete next[previewId]; return next })
      setReceiptStagedIds((current) => { const next = new Set(current); next.delete(previewId); return next })
      onChanged()
      setRecoveryRevision((value) => value + 1)
      setNotice(result.postedCount === 0 ? '取引を追加せず原本処理を完了しました。' : `${result.postedCount}件の取引を台帳へ反映しました。`)
      showToast(result.postedCount === 0 ? '原本処理を完了しました。' : `${result.postedCount}件を台帳へ反映しました。`)
    } catch {
      setNotice('台帳へ反映できませんでした。候補の口座と仕訳を確認してください。')
      showToast('台帳へ反映できませんでした。', 'error')
    } finally {
      inFlightRunsRef.current.delete(stagedImport.summary.runId)
      setActiveRun(null)
    }
  }

  const rollbackRun = async (previewId: string, runId: string) => {
    if (inFlightRunsRef.current.has(runId)) return
    inFlightRunsRef.current.add(runId)
    setActiveRun(runId)
    try {
      await platformClient.rollbackImport(runId)
      setStaged((current) => { const next = { ...current }; delete next[previewId]; return next })
      setReceiptStagedIds((current) => { const next = new Set(current); next.delete(previewId); return next })
      onChanged()
      setRecoveryRevision((value) => value + 1)
      const folderInboxItemId = previewId.startsWith('folder:')
        ? previewId.slice('folder:'.length)
        : previews.find((preview) => preview.id === previewId)?.folderInboxItemId
          ?? folderInbox.items.find((item) => item.householdId === householdId && item.importRunId === runId)?.id
      if (folderInboxItemId) await folderInbox.retry(folderInboxItemId)
      const driveInboxItemId = previewId.startsWith('drive:')
        ? previewId.slice('drive:'.length)
        : previews.find((preview) => preview.id === previewId)?.driveInboxItemId
          ?? driveInboxItems.find((item) => item.householdId === householdId && item.importRunId === runId)?.id
      if (driveInboxItemId && householdId) {
        await platformClient.reopenGoogleDriveInboxItem(householdId, driveInboxItemId, runId)
        hydratedDriveItemsRef.current.delete(driveInboxItemId)
        await refreshGoogleDriveInbox(true)
      }
      const gmailInboxItemId = previewId.startsWith('gmail:')
        ? previewId.slice('gmail:'.length)
        : previews.find((preview) => preview.id === previewId)?.gmailInboxItemId
          ?? gmailInboxItems.find((item) => item.householdId === householdId && item.importRunId === runId)?.id
      if (gmailInboxItemId && householdId) {
        await platformClient.reopenGmailInboxItem(householdId, gmailInboxItemId, runId)
        hydratedGmailItemsRef.current.delete(gmailInboxItemId); await refreshGmailInbox(true)
      }
      setNotice(gmailInboxItemId ? '未確定のインポートを取り消し、Gmail Inbox に戻しました。' : driveInboxItemId ? '未確定のインポートを取り消し、Google Drive Inbox に戻しました。' : '未確定のインポートを取り消しました。')
    } catch {
      setNotice('インポートを取り消せませんでした。')
    } finally {
      inFlightRunsRef.current.delete(runId)
      setActiveRun(null)
    }
  }

  const refreshAfterReceiptLink = async (previewId: string, runId: string) => {
    const nextPreview = await platformClient.previewImport(runId)
    if (nextPreview.candidates.length === 0) {
      setStaged((current) => { const next = { ...current }; delete next[previewId]; return next })
      setReceiptStagedIds((current) => { const next = new Set(current); next.delete(previewId); return next })
    } else setStaged((current) => ({ ...current, [previewId]: nextPreview }))
    onChanged(); setRecoveryRevision((value) => value + 1); setNotice('既存取引にレシート証憑を紐付けました。新しい支出は作成していません。')
  }

  const setDuplicateResolution = async (previewId: string, candidateId: string, resolution: 'LINK' | 'KEEP_BOTH' | 'EXCLUDE') => {
    const preview = staged[previewId]
    if (!preview) return
    try {
      const next = await platformClient.setImportDuplicateResolution(preview.summary.runId, candidateId, resolution)
      setStaged((current) => ({ ...current, [previewId]: next }))
    } catch {
      setNotice('重複判定を保存できませんでした。既存取引と候補の状態を再確認してください。')
    }
  }

  if (String(platformClient.runtime) === 'web') return <ImportInboxDemo inputRef={inputRef} onPick={() => inputRef.current?.click()} busy={busy} processFiles={processFiles} />

  return <>
    <PageHeader eyebrow="データ取り込み" title="インポート Inbox" description="ファイルから読み取った候補を確認して台帳へ反映します。">
      {importView === 'CONNECTORS' && platformClient.runtime === 'tauri' && <button className="secondary-btn" disabled={folderBusy !== null} onClick={() => void connectIcloudFolder()}>{folderBusy === 'icloud' ? 'iCloud Drive を接続中…' : 'iCloud Drive を接続'}</button>}
      {importView === 'CONNECTORS' && platformClient.runtime === 'tauri' && <button className="secondary-btn" disabled={folderBusy !== null} onClick={() => void addWatchedFolder()}>{folderBusy === 'select' ? '選択中…' : '同期フォルダーを追加'}</button>}
      {importView === 'LOCAL' && <button className="primary-btn" disabled={busy} onClick={() => inputRef.current?.click()}><Import size={17} /> {busy ? '解析中…' : 'ファイルを選択'}</button>}
      <input ref={inputRef} aria-label="CSV、TSV、Excel、PDF、レシート画像、ゆうちょ公式ZIP、EMLを選択" className="visually-hidden" type="file" accept=".csv,.tsv,.xlsx,.pdf,.png,.jpg,.jpeg,.zip,.eml,text/csv,text/tab-separated-values,application/zip,application/x-zip-compressed,application/pdf,image/png,image/jpeg,message/rfc822,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" multiple onChange={(event) => { const files = takeFileInputSelection(event.currentTarget); void processFiles(files) }} />
    </PageHeader>
    <div className="workspace-tabs import-source-tabs" role="tablist" aria-label="インポート元"><button role="tab" aria-selected={importView === 'LOCAL'} className={importView === 'LOCAL' ? 'active' : ''} onClick={() => setImportView('LOCAL')}>ローカル</button><button role="tab" aria-selected={importView === 'CONNECTORS'} className={importView === 'CONNECTORS' ? 'active' : ''} onClick={() => setImportView('CONNECTORS')}>コネクタ</button><span>どの経路もレビュー確定まで台帳へ反映しません</span></div>
    <div className="import-stage-strip" aria-label="インポート処理段階" hidden={importView !== 'LOCAL'}>
      <strong>処理段階:</strong>
      {['検出', '抽出中', 'プレビュー', 'マッピング必要', 'レビュー必要', '転記可能', '転記済み'].map((label, index) => <span className={index === 6 ? 'complete' : ''} key={label}>{label}{index < 6 && <ArrowRight size={11} aria-hidden="true" />}</span>)}
    </div>
    {importView === 'CONNECTORS' && platformClient.runtime === 'tauri' && <div className="import-notice"><span>iCloud Drive は Apple API へ直接接続しません。macOS または Windows の iCloud Drive が端末へ同期したフォルダーをローカルで監視します。</span></div>}
    {importView === 'CONNECTORS' && folderInbox.counts && folderInbox.counts.actionable > 0 && <div className="import-notice folder-discovery-notice" role="status"><span>永続 Folder Inbox に {folderInbox.counts.actionable} 件の確認対象があります。プレビューだけを自動化し、台帳への反映は必ず明示的な承認後です。</span><button className="text-btn" disabled={folderInbox.busy} onClick={() => void folderInbox.refresh(true)}>更新</button></div>}
    {(recoveryBusy || recoveryError) && <div className="import-notice" role={recoveryError ? 'alert' : 'status'}><span>{recoveryError || '保存済みの確認待ちインポートを復元しています…'}</span>{recoveryError && <button className="text-btn" onClick={() => setRecoveryRevision((value) => value + 1)}>再試行</button>}</div>}
    {!recoveryBusy && !recoveryError && recoveredReviewCount > 0 && <div className="import-notice" role="status"><span>再起動前からの確認待ちを {recoveredReviewCount} 件復元しました。台帳へは自動反映しません。</span><button className="text-btn" onClick={() => setRecoveryRevision((value) => value + 1)}>確認待ちを更新</button></div>}
    {importView === 'CONNECTORS' && <section className="panel import-connectors-overview" aria-label="接続済みコネクタ"><article><div><strong>Google Drive</strong><span className="review-pill">テストユーザー限定</span><small>{driveInboxItems.length}件を検出</small></div><button className="secondary-btn" disabled={driveInboxBusy} onClick={() => void refreshGoogleDriveInbox(true)}>取り込む候補を確認</button></article><article><div><strong>Gmail</strong><span className="review-pill">テストユーザー限定</span><small>{gmailInboxItems.length}件を検出</small></div><button className="secondary-btn" disabled={gmailInboxBusy} onClick={() => void refreshGmailInbox(true)}>取り込む候補を確認</button></article><article><div><strong>iCloud / 同期フォルダー</strong><span className="review-pill">ローカル同期</span><small>{watchedFolders.length}フォルダー</small></div><button className="secondary-btn" disabled={folderInbox.busy} onClick={() => void folderInbox.refresh(true)}>取り込む候補を確認</button></article></section>}
    <section className="status-grid import-status-summary" hidden={importView !== 'LOCAL'}>
      {[
        ['取込済み', String(summary?.posted ?? (platformClient.runtime === 'web' ? 79 : 0)), `${summary?.sourceDocuments ?? 0}原本`],
        ['確認待ち', String(summary?.reviewRequired ?? (platformClient.runtime === 'web' ? 6 : 0)), `${summary?.readyCandidates ?? 0}候補`],
        ['処理失敗', String(summary?.failed ?? (platformClient.runtime === 'web' ? 2 : 0)), '再実行可能'],
        ['ソース行', String(summary?.sourceRecords ?? (platformClient.runtime === 'web' ? 4 : 0)), '監査証跡'],
      ].map((x, i) => <article className="status-card" key={x[0]}><span className={`status-orb s${i}`} /><div><strong>{x[1]}</strong><span>{x[0]}</span><small>{x[2]}</small></div></article>)}
    </section>
    <div hidden={importView !== 'LOCAL'}><PendingImportHandoffPanel householdId={householdId} accounts={accounts} members={members} pendingRuns={pendingReviewRuns} onApplied={() => { setRecoveryRevision((value) => value + 1); onChanged() }} /></div>
    <div hidden={importView !== 'CONNECTORS'}>
    {platformClient.runtime === 'tauri' && gmailInboxItems.length > 0 && <section className="panel watched-folders" aria-labelledby="gmail-inbox-title"><div className="panel-head"><div><h2 id="gmail-inbox-title">Gmail Inbox</h2><p>ラベル同期したEML原本と添付をプレビューします。レビューで承認するまで台帳へ反映しません。</p></div><button className="secondary-btn" disabled={gmailInboxBusy} onClick={() => void refreshGmailInbox(true)}>{gmailInboxBusy ? '更新中…' : 'Inbox を更新'}</button></div><div className="watched-folder"><div><strong>添付メールの原本</strong><span>{gmailInboxItems.length}件 ・ Gmail 読み取り専用</span></div>{gmailInboxItems.filter((item) => item.state !== 'REMOVED').map((item) => { const emailPreview = previews.find((preview) => preview.gmailInboxItemId === item.id); const previewFailed = emailPreview?.status === 'error' || emailPreview?.status === 'unsupported'; return <div className="watched-file" key={item.id}><FileCheck2 size={15} /><span><strong>{item.fileName}</strong><small>Gmail ・ {item.estimatedByteSize === null ? 'サイズ未取得' : `${(item.estimatedByteSize / 1024).toFixed(1)} KB`} ・ {new Date(item.internalDateMs).toLocaleDateString('ja-JP')}</small></span><b className={!previewFailed && ['READY', 'STAGED'].includes(item.state) ? 'ready' : 'review'}>{previewFailed ? 'プレビューで確認が必要' : gmailInboxStateLabel(item.state)}</b><span className="folder-inbox-actions">{previewFailed && <button className="mini-btn" disabled={gmailInboxBusy} onClick={() => void repreviewGmailInboxItem(item.id)}>再プレビュー</button>}{item.state === 'FAILED' && <button className="mini-btn" disabled={gmailInboxBusy} onClick={() => void retryGmailInboxItem(item.id)}>再試行</button>}{['DISCOVERED', 'READY', 'NEEDS_MAPPING', 'FAILED'].includes(item.state) && <button className="text-btn" disabled={gmailInboxBusy} onClick={() => void ignoreGmailInboxItem(item.id)}>無視</button>}</span>{item.lastErrorCode && <small className="folder-inbox-error">{item.lastErrorCode}</small>}</div> })}</div></section>}
    {platformClient.runtime === 'tauri' && driveInboxItems.length > 0 && <section className="panel watched-folders" aria-labelledby="google-drive-inbox-title"><div className="panel-head"><div><h2 id="google-drive-inbox-title">Google Drive Inbox</h2><p>同期済みの原本世代を端末内でプレビューします。取引はレビューで承認するまで台帳へ反映しません。</p></div><button className="secondary-btn" disabled={driveInboxBusy} onClick={() => void refreshGoogleDriveInbox(true)}>{driveInboxBusy ? '更新中…' : 'Inbox を更新'}</button></div><div className="watched-folder"><div><strong>接続フォルダーの原本</strong><span>{driveInboxItems.length}件 ・ Google Drive 読み取り専用</span></div>{driveInboxItems.filter((item) => item.state !== 'REMOVED').map((item) => {
      const drivePreview = previews.find((preview) => preview.driveInboxItemId === item.id)
      const previewFailed = drivePreview?.status === 'error' || drivePreview?.status === 'unsupported'
      const displayState = previewFailed ? 'プレビューで確認が必要' : googleDriveInboxStateLabel(item.state)
      return <div className="watched-file" key={item.id}><FileCheck2 size={15} /><span><strong>{item.fileName}</strong><small>Google Drive ・ {item.remoteByteSize === null ? 'サイズ未取得' : `${(item.remoteByteSize / 1024).toFixed(1)} KB`} ・ 世代 {item.driveVersion ?? '—'}</small></span><b className={!previewFailed && ['READY', 'STAGED'].includes(item.state) ? 'ready' : 'review'}>{displayState}</b><span className="folder-inbox-actions">{previewFailed && <button className="mini-btn" disabled={driveInboxBusy} onClick={() => void repreviewGoogleDriveInboxItem(item.id)}>再プレビュー</button>}{item.state === 'FAILED' && <button className="mini-btn" disabled={driveInboxBusy} onClick={() => void retryGoogleDriveInboxItem(item.id)}>再試行</button>}{['DISCOVERED', 'READY', 'NEEDS_MAPPING', 'FAILED'].includes(item.state) && <button className="text-btn" disabled={driveInboxBusy} onClick={() => void ignoreGoogleDriveInboxItem(item.id)}>無視</button>}</span>{item.lastErrorCode && <small className="folder-inbox-error">{item.lastErrorCode}</small>}</div>
    })}</div></section>}
    {platformClient.runtime === 'tauri' && watchedFolders.length > 0 && <section className="panel watched-folders"><div className="panel-head"><div><h2>同期フォルダー</h2><p>変更履歴と処理状態は端末内データベースに保持され、再起動後も復元されます。</p></div><label className="auto-scan-toggle"><input type="checkbox" checked={folderInbox.autoScan} onChange={(event) => folderInbox.setAutoScan(event.target.checked)} /><span>自動プレビュー</span></label></div>{watchedFolders.map((folder) => <div className="watched-folder" key={folder.id}><div><strong>{folder.label}</strong><span>{folder.provider === 'ICLOUD' ? 'iCloud Drive' : 'ローカル同期'} ・ {folder.displayName}</span></div><button className="secondary-btn" disabled={folderBusy === folder.id} onClick={() => void scanWatchedFolder(folder)}>{folderBusy === folder.id ? 'スキャン中…' : '新しいファイルを確認'}</button><button className="text-btn" disabled={folderBusy === folder.id} onClick={() => void removeWatchedFolder(folder)}>解除</button>{folderInbox.items.filter((item) => item.watchedFolderId === folder.id && item.state !== 'REMOVED').map((item) => { const stateLabel = { DISCOVERED: '検出済み', PROCESSING: '解析中', READY: 'プレビュー完了', NEEDS_MAPPING: '形式の対応付けが必要', STAGED: '取込処理に接続済み', FAILED: '失敗', IGNORED: '無視', REMOVED: '削除済み' }[item.state]; return <div className="watched-file" key={item.id}><FileCheck2 size={15} /><span><strong>{item.fileName}</strong><small>{item.provider === 'ICLOUD' ? 'iCloud Drive' : 'ローカル同期'} ・ {(item.byteSize / 1024).toFixed(1)} KB ・ 試行 {item.attemptCount}</small></span><b className={item.state === 'READY' || item.state === 'STAGED' ? 'ready' : 'review'}>{stateLabel}</b><span className="folder-inbox-actions">{(item.state === 'FAILED' || item.state === 'IGNORED') && <button className="mini-btn" onClick={() => void folderInbox.retry(item.id)}>再試行</button>}{['DISCOVERED', 'READY', 'NEEDS_MAPPING', 'FAILED'].includes(item.state) && <button className="text-btn" onClick={() => void folderInbox.ignore(item.id)}>無視</button>}</span>{item.lastErrorCode && <small className="folder-inbox-error">{item.lastErrorCode}</small>}</div> })}</div>)}</section>}
    </div>
    <div className="import-production-master-detail" hidden={importView !== 'LOCAL'}>
    <section className="panel import-panel">
      <div className="panel-head"><div><h2>最近のファイル</h2><p>ローカル、Google Drive、Gmail Inbox のプレビュー</p></div></div>
      <button className="drop-zone" onClick={() => inputRef.current?.click()} onDragOver={(event) => event.preventDefault()} onDrop={(event) => { event.preventDefault(); void processFiles(event.dataTransfer.files) }}><Import size={20} /><span>CSV / TSV / Excel / PDF / レシート画像 / ZIP / EMLをここにドロップ</span><small>PayPay・銀行・カード・ゆうちょ公式CSV一括ZIP・メール添付・PNG / JPEGレシート</small></button>
      {parserProfiles.length > 0 && previews.some((item) => /\.(?:csv|tsv)$/i.test(item.filename) && item.fileBytes) && <div className="custom-parser-files">
        <div><strong>保存済みプロファイルを明示的に適用</strong><small>組み込み判定を上書きする場合、ファイルとプロファイルを選んで実データをプレビューします。</small></div>
        {previews.filter((item) => /\.(?:csv|tsv)$/i.test(item.filename) && item.fileBytes).map((item) => {
          const preview = customParserPreviews[item.id]
          const errorCount = preview?.issues.filter((issue) => issue.severity === 'error').length ?? 0
          return <div className="custom-parser-file" key={item.id}>
            <span><strong>{item.filename}</strong><small>{item.detectedAdapterId ? `現在: ${item.detectedAdapterId}` : '組み込み形式では未対応'}</small></span>
            <select aria-label={`${item.filename}の読み取りプロファイル`} value={selectedParserProfiles[item.id] ?? ''} onChange={(event) => selectCustomParserProfile(item, event.target.value)}><option value="">プロファイルを選択</option>{parserProfiles.map((profile) => <option key={profile.id} value={profile.id}>{profile.name}（優先度 {profile.priority}）</option>)}</select>
            <button className="mini-btn" disabled={!selectedParserProfiles[item.id]} onClick={() => applyCustomParserProfile(item)}>適用してプレビュー</button>
            {preview && <div className="custom-parser-result">
              <strong>{preview.candidateCount}件の候補 / {preview.rejectedRowCount}行を除外 / {errorCount}件のエラー</strong>
              <span>{preview.encoding} ・ 区切り「{preview.delimiter === '\t' ? 'TAB' : preview.delimiter}」・ ヘッダー行 {preview.headerRow}</span>
              <label>取込先口座（口座ヒントは候補としてのみ使用）<select aria-label={`${item.filename}の取込先口座`} value={customParserAccounts[item.id] ?? ''} onChange={(event) => setCustomParserAccounts((current) => ({ ...current, [item.id]: event.target.value }))}><option value="">口座を選択</option>{accounts.filter((account) => account.accountKind === 'ASSET' || account.accountKind === 'LIABILITY').map((account) => <option key={account.id} value={account.id}>{account.name}</option>)}</select></label>
              <div>{preview.mappings.map((mapping) => <span className={mapping.columnIndex == null ? 'missing' : 'matched'} key={mapping.role}>{mapping.role}: {mapping.configuredHeader} → {mapping.matchedHeader ?? '未一致'}</span>)}</div>
              {preview.issues.length > 0 && <ul>{preview.issues.slice(0, 6).map((issue, index) => <li key={`${issue.code}-${issue.row ?? 0}-${index}`}>{issue.row ? `行 ${issue.row}: ` : ''}{issue.message}</li>)}</ul>}
              <small>{errorCount > 0 ? 'エラーを解消して再プレビューするまで取込を開始できません。' : 'この候補も次の「取込開始」後にレビューと個別承認が必要です。'}</small>
            </div>}
          </div>
        })}
      </div>}
      {previews.some((item) => item.detectedAdapterId === 'money-forward-me-household-ledger-v1' && item.status === 'ready') && <div className="custom-parser-files"><div><strong>Money Forward ME 家計簿CSV</strong><small>原本内の保有金融機関ごとにKakeFlow口座を明示します。振替と計算対象は元データを保持します。</small></div>{previews.filter((item) => item.detectedAdapterId === 'money-forward-me-household-ledger-v1' && item.status === 'ready').flatMap((item) => {
        const eligibleAccounts = eligibleMoneyForwardAccounts(accounts)
        return moneyForwardInstitutions(item).map((institution, index) => <div className="custom-parser-file" key={`${item.id}:${institution}`}><span><strong>{institution}</strong><small>{item.filename} ・ 口座を推測または自動作成しません。</small>{index === 0 && eligibleAccounts.length === 0 && <small id={`money-forward-account-empty-${item.id}`} role="status">設定ページで先に資産または負債口座を追加してください。追加するまで取込は開始できません。</small>}</span><select aria-label={`${item.filename}の${institution}取込先口座`} aria-describedby={eligibleAccounts.length === 0 ? `money-forward-account-empty-${item.id}` : undefined} disabled={eligibleAccounts.length === 0} value={moneyForwardAccounts[item.id]?.[institution] ?? ''} onChange={(event) => setMoneyForwardAccounts((current) => ({ ...current, [item.id]: { ...current[item.id], [institution]: event.target.value } }))}><option value="">対応する口座を選択</option>{eligibleAccounts.map((account) => <option key={account.id} value={account.id}>{account.name}</option>)}</select></div>)
      })}</div>}
      {previews.some((item) => item.detectedAdapterId === 'yucho-direct-ledger-v1' && item.status === 'ready') && <div className="custom-parser-files"><div><strong>ゆうちょダイレクトCSV</strong><small>ZIP内のCSVもファイルごとに対応する銀行口座を明示的に選択します。</small></div>{previews.filter((item) => item.detectedAdapterId === 'yucho-direct-ledger-v1' && item.status === 'ready').map((item) => <div className="custom-parser-file" key={item.id}><span><strong>{item.filename}</strong><small>口座情報を推測せず、選択した銀行口座へ取り込みます。</small></span><select aria-label={`${item.filename}のゆうちょ取込先口座`} value={yuchoAccounts[item.id] ?? ''} onChange={(event) => setYuchoAccounts((current) => ({ ...current, [item.id]: event.target.value }))}><option value="">銀行口座を選択</option>{accounts.filter((account) => account.accountKind === 'ASSET' && account.accountSubtype === 'BANK').map((account) => <option key={account.id} value={account.id}>{account.name}</option>)}</select></div>)}</div>}
      {previews.some((item) => dedicatedBrokerageImport(item.detectedAdapterId) != null && item.status === 'ready') && <div className="custom-parser-files">{previews.filter((item) => dedicatedBrokerageImport(item.detectedAdapterId) != null && item.status === 'ready').map((item) => {
        const config = dedicatedBrokerageImport(item.detectedAdapterId)!
        const eligibleAccounts = accounts.filter((account) => account.accountKind === 'ASSET' && account.accountSubtype === 'SECURITIES')
        const descriptionId = eligibleAccounts.length === 0 ? `investment-account-empty-${item.id}` : undefined
        return <div className="custom-parser-file" key={item.id}><span><strong>{config.title}</strong><small>{item.filename} ・ {config.description}</small><small>{config.accountHint}</small>{eligibleAccounts.length === 0 && <small id={descriptionId} role="status">設定ページで先に証券口座を追加してください。追加するまで保存できません。</small>}</span><select aria-label={`${item.filename}の取込先証券口座`} aria-describedby={descriptionId} disabled={eligibleAccounts.length === 0} value={investmentImportAccounts[item.id] ?? ''} onChange={(event) => setInvestmentImportAccounts((current) => ({ ...current, [item.id]: event.target.value }))}><option value="">証券口座を選択</option>{eligibleAccounts.map((account) => <option key={account.id} value={account.id}>{account.name}</option>)}</select></div>
      })}</div>}
      {previews.some((item) => item.detectedAdapterId != null && STANDARD_IMPORT_ACCOUNT_REQUIREMENTS[item.detectedAdapterId] != null && item.status === 'ready') && <div className="custom-parser-files"><div><strong>取込先口座を明示的に選択</strong><small>ファイル名、カード会社名、既定口座から推測せず、原本ごとに対応する口座を選択します。</small></div>{previews.filter((item) => item.detectedAdapterId != null && STANDARD_IMPORT_ACCOUNT_REQUIREMENTS[item.detectedAdapterId] != null && item.status === 'ready').map((item) => {
        const requirement = STANDARD_IMPORT_ACCOUNT_REQUIREMENTS[item.detectedAdapterId!]!
        const eligibleAccounts = accounts.filter((account) => account.accountKind === requirement.kind && account.accountSubtype === requirement.subtype)
        return <div className="custom-parser-file" key={item.id}><span><strong>{item.filename}</strong><small>{item.adapterId} ・ {requirement.kindLabel}のみ選択できます。</small>{eligibleAccounts.length === 0 && <small id={`standard-account-empty-${item.id}`} role="status">設定ページで先に{requirement.kindLabel}を追加してください。追加するまで取込は開始できません。</small>}</span><select aria-label={`${item.filename}の取込先${requirement.kindLabel}`} disabled={eligibleAccounts.length === 0} value={standardImportAccounts[item.id] ?? ''} onChange={(event) => setStandardImportAccounts((current) => ({ ...current, [item.id]: event.target.value }))}><option value="">{requirement.kindLabel}を選択</option>{eligibleAccounts.map((account) => <option key={account.id} value={account.id}>{account.name}</option>)}</select></div>
      })}</div>}
      <div className="import-list">
        {previews.map((item) => <div className="import-row" key={item.id}><div className="file-icon"><FileCheck2 size={19} /></div><div><strong>{item.filename}</strong><span>{item.adapterId ?? '未対応の形式'} ・ {item.encoding}{item.emailAttachmentName ? ` ・ 添付 ${item.emailAttachmentName}` : ''}</span>{item.issues.length > 0 && <small className="import-row-issues" role={item.issues.some((issue) => issue.severity === 'error') ? 'alert' : 'status'}>{item.issues.slice(0, 2).map((issue) => issue.message).join(' / ')}</small>}</div><span>{item.recordCount} レコード</span><b className={item.status === 'ready' ? 'ready' : 'review'}>{aggregateAssetImported.has(item.id) ? '総資産履歴に反映済み' : portfolioImported.has(item.id) ? '資産に反映済み' : staged[item.id] ? 'レビュー待ち' : item.status === 'ready' ? 'プレビュー完了' : item.status === 'extractable' ? item.mediaType?.startsWith('image/') ? 'OCR待ち' : pdfOcrRequiredIds.has(item.id) ? '画像PDF・OCR待ち' : 'テキスト解析待ち' : '確認が必要'}</b>{item.status === 'ready' && item.detectedAdapterId === 'money-forward-me-asset-trend-v1' && !aggregateAssetImported.has(item.id) ? <button className="mini-btn" disabled={platformClient.runtime !== 'tauri' || !householdId || activeRun === item.id} onClick={() => void importAggregateAssetHistory(item)}>{activeRun === item.id ? '保存中…' : '総資産履歴に保存'}</button> : item.status === 'ready' && item.detectedAdapterId === 'securities-asset-snapshot-v1' && !portfolioImported.has(item.id) ? <button className="mini-btn" disabled={platformClient.runtime !== 'tauri' || !householdId || activeRun === item.id} onClick={() => void importPortfolioSnapshot(item)}>{activeRun === item.id ? '保存中…' : '資産に保存'}</button> : item.status === 'ready' && isBrokerageTransactionAdapter(item.detectedAdapterId) && !portfolioImported.has(item.id) ? <button className="mini-btn" aria-describedby={dedicatedBrokerageImport(item.detectedAdapterId) && accounts.every((account) => account.accountKind !== 'ASSET' || account.accountSubtype !== 'SECURITIES') ? `investment-account-empty-${item.id}` : undefined} disabled={platformClient.runtime !== 'tauri' || !householdId || activeRun === item.id || (dedicatedBrokerageImport(item.detectedAdapterId) != null && !investmentImportAccounts[item.id])} onClick={() => void importBrokerageHistory(item)}>{activeRun === item.id ? '保存中…' : '証券取引に保存'}</button> : item.status === 'ready' && item.detectedAdapterId !== 'money-forward-me-asset-trend-v1' && !staged[item.id] && !portfolioImported.has(item.id) ? <button className="mini-btn" aria-label={previews.length > 1 ? `${item.filename}の取込開始` : undefined} aria-describedby={importAccountDescriptionId(item, accounts)} disabled={platformClient.runtime !== 'tauri' || !householdId || accounts.length === 0 || !hasCompatibleStandardImportAccount(item.detectedAdapterId, accounts) || (item.detectedAdapterId === 'money-forward-me-household-ledger-v1' && !hasCompleteMoneyForwardMapping(item, moneyForwardAccounts[item.id], accounts)) || activeRun === item.id} onClick={() => void stageImport(item)}>{activeRun === item.id ? '暗号化中…' : platformClient.runtime === 'tauri' ? '取込開始' : 'Desktopのみ'}</button> : item.status === 'extractable' && !staged[item.id] ? <button className="mini-btn" disabled={platformClient.runtime !== 'tauri' || !householdId || activeRun === item.id} onClick={() => void extractDocument(item)}>{activeRun === item.id ? pdfOcrRequiredIds.has(item.id) ? 'OCR中…' : '解析中…' : item.mediaType?.startsWith('image/') ? '画像OCR' : pdfOcrRequiredIds.has(item.id) ? 'スキャンPDF OCR' : 'PDFを解析'}</button> : item.status === 'unsupported' && item.fileBytes && /\.(?:csv|tsv)$/i.test(item.filename) ? <button className="mini-btn" onClick={(event) => { rescueTriggerRef.current = event.currentTarget; setRescuePreviewId(item.id) }}>このファイルを読み取る</button> : <span className="icon-btn" title={item.issues.map((issue) => issue.message).join('\n')}><MoreHorizontal size={18} /></span>}</div>)}
        {platformClient.runtime === 'web' && importItems.map((item) => <div className="import-row" key={item.file}><div className="file-icon"><FileCheck2 size={19} /></div><div><strong>{item.file}</strong><span>{item.source} ・ {item.time}</span></div><span>{item.records} レコード</span><b className={item.state}>{item.state === 'ready' ? '反映可能' : item.state === 'review' ? '確認が必要' : item.state === 'matched' ? '取引に照合済み' : '処理済み'}</b></div>)}
        {platformClient.runtime === 'tauri' && previews.length === 0 && <p className="empty-state">ファイルを選択すると、ここに解析結果が表示されます。</p>}
      </div>
      {protectedPdf && (() => { const item = previews.find((preview) => preview.id === protectedPdf.itemId); return item ? <PdfPasswordPrompt filename={item.filename} status={protectedPdf.status} onSubmit={(ephemeralPassword) => extractDocument(item, ephemeralPassword, protectedPdf.operation)} onCancel={() => setProtectedPdf(null)} /> : null })()}
      {rescuePreviewId && householdId && (() => { const item = previews.find((preview) => preview.id === rescuePreviewId); return item?.fileBytes ? <CustomParserRescueDialog householdId={householdId} filename={item.filename} bytes={item.fileBytes} accounts={accounts} returnFocus={rescueTriggerRef.current} onCancel={() => setRescuePreviewId(null)} onSaved={(profile, accountId) => { setParserProfiles((current) => [...current.filter((candidate) => candidate.id !== profile.id), profile]); setSelectedParserProfiles((current) => ({ ...current, [item.id]: profile.id })); applyCustomParserProfile(item, profile, accountId); setRescuePreviewId(null) }} /> : null })()}
    </section>
    <div className="import-production-review-column">
    {notice && <div className="import-notice" role="status">{notice}</div>}
    {householdId && Object.entries(staged).map(([previewId, stagedImport]) => <DuplicateReviewGate key={`duplicate:${stagedImport.summary.runId}`} preview={stagedImport} onResolution={(candidateId, resolution) => setDuplicateResolution(previewId, candidateId, resolution)} />)}
    {householdId && Object.entries(staged).map(([previewId, stagedImport]) => <ImportReviewSection key={stagedImport.summary.runId} stagedImport={stagedImport} accounts={accounts} householdId={householdId} busy={activeRun === stagedImport.summary.runId} isReceipt={receiptStagedIds.has(previewId) || recoveredReceiptRunIds.has(stagedImport.summary.runId)} recovered={previewId.startsWith('recovered:')} sourceCompletionBlocked={sourceResumeRequiredRunIds.has(stagedImport.summary.runId)} onRollback={() => void rollbackRun(previewId, stagedImport.summary.runId)} onCommit={(decisions) => void commitRun(previewId, stagedImport, decisions)} onReceiptLinked={() => refreshAfterReceiptLink(previewId, stagedImport.summary.runId)} />)}
    {Object.keys(staged).length === 0 && <section className="panel import-review-placeholder"><FileCheck2 size={24} /><strong>レビューするファイルを選択</strong><span>左のファイルで「取込開始」を選ぶと、候補・重複・原本をここで確認できます。</span></section>}
    </div>
    </div>
  </>
}

function CardsPage({ cards, householdId, accounts, revision, onChanged, month }: { cards: readonly CardSettlementDto[]; householdId: string | null; accounts: readonly AccountDto[]; revision: number; onChanged: () => void; month: string }) {
  const desktop = platformClient.runtime === 'tauri'
  const [busyId, setBusyId] = useState<string | null>(null)
  const [notice, setNotice] = useState('')
  const [mappings, setMappings] = useState<readonly CardSettlementBankMappingDto[]>([])
  const [coverage, setCoverage] = useState<CardSettlementBalanceCoverageDto | null>(null)
  const [mappingDrafts, setMappingDrafts] = useState<Record<string, string>>({})
  const [dueDateDrafts, setDueDateDrafts] = useState<Record<string, string>>({})
  const [unlinkConfirmId, setUnlinkConfirmId] = useState<string | null>(null)
  const cardAccounts = accounts.filter((account) => account.accountKind === 'LIABILITY' && account.accountSubtype === 'CREDIT_CARD')
  const bankAccounts = accounts.filter((account) => account.accountKind === 'ASSET' && account.accountSubtype === 'BANK')
  useEffect(() => { setDueDateDrafts(Object.fromEntries(cards.map((card) => [card.id, card.paymentDueOn ?? '']))) }, [cards])
  const reloadSettlementPlan = useCallback(async () => {
    if (!householdId || !desktop) return
    const [nextMappings, nextCoverage] = await Promise.all([
      platformClient.listCardSettlementBankMappings(householdId),
      platformClient.queryCardSettlementBalanceCoverage({ householdId, asOf: currentTokyoDate(), horizonDays: 45 }),
    ])
    setMappings(nextMappings)
    setCoverage(nextCoverage)
    setMappingDrafts(Object.fromEntries(nextMappings.map((mapping) => [mapping.cardAccountId, mapping.bankAccountId])))
  }, [desktop, householdId])
  useEffect(() => {
    let active = true
    if (!householdId || !desktop) { setMappings([]); setCoverage(null); return }
    void Promise.all([
      platformClient.listCardSettlementBankMappings(householdId),
      platformClient.queryCardSettlementBalanceCoverage({ householdId, asOf: currentTokyoDate(), horizonDays: 45 }),
    ]).then(([nextMappings, nextCoverage]) => {
      if (!active) return
      setMappings(nextMappings); setCoverage(nextCoverage)
      setMappingDrafts(Object.fromEntries(nextMappings.map((mapping) => [mapping.cardAccountId, mapping.bankAccountId])))
    }).catch(() => { if (active) setNotice('引落口座と支払余力を読み込めませんでした。') })
    return () => { active = false }
  }, [desktop, householdId, revision])
  const displayCards = desktop ? cards.filter((card) => (card.periodStart.slice(0, 7) <= month && card.periodEnd.slice(0, 7) >= month) || card.paymentDueOn?.slice(0, 7) === month || card.payments.some((payment) => payment.paymentOn.slice(0, 7) === month) || card.eligiblePayments.some((payment) => payment.paymentOn.slice(0, 7) === month)) : cardSettlements.map((card, index) => ({
    id: `demo-${index}`, cardAccountId: `demo-${index}`, cardName: card.name, maskedIdentifier: card.mask,
    periodStart: '2026-07-01', periodEnd: '2026-07-31', paymentDueOn: card.dueDate,
    statementAmountJpy: card.statement, detailAmountJpy: card.statement, lineCount: card.name.includes('Rakuten') ? 15 : 14,
    paymentId: card.bankDebit ? `demo-payment-${index}` : null, bankTransactionId: null,
    paymentAmountJpy: card.bankDebit ?? null, paymentOn: null, matchScoreBps: card.bankDebit ? 10000 : null,
    reconciliationStatus: card.status === 'reconciled' ? 'FULLY_RECONCILED' as const : 'UNMATCHED' as const,
    paidAmountJpy: card.bankDebit ?? 0, outstandingAmountJpy: Math.max(card.statement - (card.bankDebit ?? 0), 0), overpaidAmountJpy: Math.max((card.bankDebit ?? 0) - card.statement, 0),
    payments: card.bankDebit ? [{ paymentId: `demo-payment-${index}`, bankTransactionId: `demo-bank-${index}`, paymentAmountJpy: card.bankDebit, paymentOn: card.dueDate, matchScoreBps: 10000 }] : [], eligiblePayments: [],
  }))
  const confirm = async (card: CardSettlementDto, paymentId: string) => {
    if (!householdId) return
    setBusyId(paymentId); setNotice('')
    try { await platformClient.confirmCardPaymentLink(householdId, card.id, paymentId); await reloadSettlementPlan(); onChanged(); setNotice('選択した口座引落を請求に紐付けました。仕訳や支払いは変更していません。') }
    catch { setNotice('照合を確定できませんでした。金額とカード口座を確認してください。') }
    finally { setBusyId(null) }
  }
  const unlink = async (card: CardSettlementDto, paymentId: string) => {
    if (!householdId) return
    if (unlinkConfirmId !== paymentId) { setUnlinkConfirmId(paymentId); setNotice('解除すると請求の照合合計を再計算します。もう一度押して確定してください。'); return }
    setBusyId(paymentId); setNotice('')
    try {
      await platformClient.unlinkCardPaymentLink(householdId, card.id, paymentId)
      setUnlinkConfirmId(null); await reloadSettlementPlan(); onChanged()
      setNotice('誤って紐付けた口座引落を解除しました。銀行取引と仕訳は変更していません。')
    } catch { setNotice('紐付けを解除できませんでした。最新の照合状態を確認してください。') }
    finally { setBusyId(null) }
  }
  const saveMapping = async (cardAccountId: string) => {
    if (!householdId || !mappingDrafts[cardAccountId]) return
    setBusyId(cardAccountId); setNotice('')
    try {
      await platformClient.upsertCardSettlementBankMapping({ householdId, cardAccountId, bankAccountId: mappingDrafts[cardAccountId] })
      await reloadSettlementPlan(); onChanged(); setNotice('明示したカード引落口座を保存しました。')
    } catch { setNotice('カード引落口座を保存できませんでした。') }
    finally { setBusyId(null) }
  }
  const removeMapping = async (cardAccountId: string) => {
    if (!householdId) return
    setBusyId(cardAccountId); setNotice('')
    try {
      await platformClient.deleteCardSettlementBankMapping({ householdId, cardAccountId })
      await reloadSettlementPlan(); onChanged(); setNotice('カード引落口座の設定を解除しました。')
    } catch { setNotice('カード引落口座の設定を解除できませんでした。') }
    finally { setBusyId(null) }
  }
  const saveDueDate = async (statementId: string, paymentDueOn: string | null) => {
    if (!householdId) return
    setBusyId(`due:${statementId}`); setNotice('')
    try {
      const updated = await platformClient.updateCardStatementDueDate({ householdId, statementId, paymentDueOn })
      setDueDateDrafts((current) => ({ ...current, [statementId]: updated.paymentDueOn ?? '' }))
      await reloadSettlementPlan(); onChanged()
      setNotice(paymentDueOn == null ? 'ユーザー登録の支払期日を解除しました。予測から除外されます。' : 'ユーザー確認済みの支払期日を保存し、支払余力と予測を更新しました。')
    } catch { setNotice('支払期日を保存できませんでした。明細期間以降の正しい日付を入力してください。') }
    finally { setBusyId(null) }
  }
  const coverageLabel = (status: 'COVERED' | 'SHORTFALL' | 'OVERDUE') => status === 'COVERED' ? '支払可能' : status === 'SHORTFALL' ? '残高不足' : '期限超過'
  type CardPresentationStatus = CardSettlementDto['reconciliationStatus'] | 'PAYMENT_PENDING'
  const reconciliationPresentation: Record<CardPresentationStatus, { readonly label: string; readonly tone: string }> = {
    UNMATCHED: { label: '⚠ 未照合', tone: 'pending' }, PAYMENT_PENDING: { label: '◐ 支払待ち', tone: 'possible' }, POSSIBLE_MATCH: { label: '◐ 照合候補あり', tone: 'candidate' },
    FULLY_RECONCILED: { label: '✓ 全額照合', tone: 'reconciled' }, PARTIALLY_RECONCILED: { label: '◐ 一部支払済み', tone: 'possible' },
    OVERPAID: { label: '⚠ 過払い', tone: 'overpaid' }, UNDERPAID: { label: '⚠ 支払不足', tone: 'underpaid' },
    MANUAL_OVERRIDE: { label: '✓ 手動確認済み', tone: 'manual' },
  }
  const presentationStatus = (card: CardSettlementDto): CardPresentationStatus => card.reconciliationStatus === 'UNMATCHED' && card.paymentDueOn != null && card.paymentDueOn >= currentTokyoDate() ? 'PAYMENT_PENDING' : card.reconciliationStatus
  return <>
    <PageHeader eyebrow="カード管理" title="カード引落・支払余力" description="請求照合に加え、明示した銀行口座で今後のカード引落を支払えるか確認します。">
    </PageHeader>
    {desktop && <aside className="card-coverage-disclosure"><strong>引落口座はユーザーが明示した設定だけを使用し、取引名から推測しません。</strong><span>残高と予測は「集計対象外」を含むすべての確定済み仕訳を反映します。この画面は確認専用で、振込・カード支払いは実行しません。</span></aside>}
    {notice && <div className="import-notice" role="status">{notice}</div>}
    {desktop && <section className="panel card-bank-mappings" aria-label="カード引落口座設定"><div className="panel-head"><div><h2>カードごとの引落銀行口座</h2><p>{mappings.length}/{cardAccounts.length}枚を明示設定済み</p></div><CreditCard size={19} /></div><div className="card-mapping-list">{cardAccounts.map((card) => { const mapped = mappings.some((mapping) => mapping.cardAccountId === card.id); return <div key={card.id}><span><strong>{card.name}</strong><small>{mapped ? '明示設定済み' : '未設定・銀行口座を推測しません'}</small></span><select id={`card-bank-${card.id}`} aria-label={`${card.name}の引落銀行口座`} value={mappingDrafts[card.id] ?? ''} onChange={(event) => setMappingDrafts((current) => ({ ...current, [card.id]: event.target.value }))}><option value="">銀行口座を選択</option>{bankAccounts.map((bank) => <option key={bank.id} value={bank.id}>{bank.name}</option>)}</select><button className="secondary-btn" disabled={busyId === card.id || !mappingDrafts[card.id]} onClick={() => void saveMapping(card.id)}>{busyId === card.id ? '保存中…' : '保存'}</button>{mapped && <button className="text-btn" disabled={busyId === card.id} onClick={() => void removeMapping(card.id)}>解除</button>}</div> })}{cardAccounts.length === 0 && <p className="empty-state">クレジットカード口座を登録すると引落銀行口座を設定できます。</p>}</div></section>}
    {desktop && coverage && <section className="card-coverage-section" aria-label="カード支払余力"><div className="card-coverage-heading"><div><h2>支払余力</h2><p>{coverage.asOf} 現在 → {coverage.horizonThrough}（{coverage.horizonDays}日）</p></div><small>残高基準: 全確定仕訳</small></div>{coverage.banks.map((bank) => <article className={`panel bank-coverage-card${bank.maxShortfallJpy > 0 ? ' has-shortfall' : ''}`} key={bank.bankAccountId}><header><div><strong>{bank.bankAccountName}</strong><span>現在残高 {yen(bank.balanceAsOfJpy)}</span></div><div><small>引落後の見込み</small><b>{yen(bank.projectedEndingBalanceJpy)}</b></div></header><div className="coverage-statement-list">{bank.statements.map((statement) => <div key={statement.statementId}><span><strong>{statement.cardAccountName}</strong><small>支払期日 {statement.paymentDueOn} ・ 未払 {yen(statement.outstandingAmountJpy)}</small></span><span><small>累積見込残高</small><b>{yen(statement.projectedBankBalanceJpy)}</b></span><em className={`coverage-status ${statement.status.toLowerCase()}`}>{coverageLabel(statement.status)}</em></div>)}{bank.statements.length === 0 && <p className="empty-state">期間内の未払請求はありません。</p>}</div>{bank.maxShortfallJpy > 0 && <footer>最大不足額 <strong>{yen(bank.maxShortfallJpy)}</strong></footer>}</article>)}{coverage.banks.length === 0 && <p className="empty-state">明示された引落口座に、期日付きの未払請求はありません。</p>}{coverage.unmappedStatements.length > 0 && <aside className="unmapped-statements" role="status"><div><strong>引落口座が未設定の請求</strong><span>銀行口座は推測せず、支払余力の計算にも含めません。</span></div>{coverage.unmappedStatements.map((statement) => <div key={statement.statementId}><span><strong>{statement.cardAccountName}</strong><small>支払期日 {statement.paymentDueOn}</small></span><b>{yen(statement.outstandingAmountJpy)}</b><em className={statement.status === 'OVERDUE' ? 'overdue' : ''}>{statement.status === 'OVERDUE' ? '期限超過' : '未設定'}</em></div>)}</aside>}{coverage.missingDueStatements.length > 0 && <aside className="unmapped-statements missing-due-statements" role="status"><div><strong>支払期日が未登録の請求</strong><span>支払期日がないため予測から除外しています。明細で確認した日付だけを登録してください。</span></div>{coverage.missingDueStatements.map((statement) => <div key={statement.statementId}><span><strong>{statement.cardAccountName}</strong><small>{statement.mappingConfigured ? '引落口座は設定済み' : '引落口座も未設定'}</small></span><b>{yen(statement.outstandingAmountJpy)}</b><label className="due-date-editor compact"><span>ユーザー確認日</span><input aria-label={`${statement.cardAccountName}の未登録支払期日`} type="date" value={dueDateDrafts[statement.statementId] ?? ''} onChange={(event) => setDueDateDrafts((current) => ({ ...current, [statement.statementId]: event.target.value }))} /><button className="secondary-btn" disabled={!dueDateDrafts[statement.statementId] || busyId === `due:${statement.statementId}`} onClick={() => void saveDueDate(statement.statementId, dueDateDrafts[statement.statementId])}>{busyId === `due:${statement.statementId}` ? '保存中…' : '保存'}</button></label></div>)}</aside>}</section>}
    <div className="section-divider"><span>請求・口座引落の照合</span></div>
    <section className="cards-page-grid">{displayCards.map((card) => <article className="panel card-detail" aria-labelledby={`card-statement-${card.id}`} key={card.id}>
      <header className="card-statement-identity"><div><h2 id={`card-statement-${card.id}`}>{card.cardName}</h2><code>{card.maskedIdentifier ?? '番号未設定'}</code></div><p>{card.periodStart} – {card.periodEnd} ・ {card.lineCount}件{card.paymentDueOn ? ` ・ 支払期日 ${card.paymentDueOn}` : ''}</p></header>
      <div className="card-detail-head"><div><span>請求額</span><strong>{yen(card.statementAmountJpy)}</strong></div><b className={reconciliationPresentation[presentationStatus(card)].tone}>{reconciliationPresentation[presentationStatus(card)].label}</b></div>
      <dl className="card-settlement-totals"><div><dt>支払済み</dt><dd>{yen(card.paidAmountJpy)}</dd></div><div><dt>未払い</dt><dd>{yen(card.outstandingAmountJpy)}</dd></div><div><dt>過払い</dt><dd>{yen(card.overpaidAmountJpy)}</dd></div></dl>
      <div className="card-payment-history"><h3>紐付け済みの口座引落</h3>{card.payments.map((payment) => <div className="card-payment-row confirmed" key={payment.paymentId}><span><strong>{payment.paymentOn}</strong><small>銀行取引 {payment.bankTransactionId}</small></span><b>{yen(payment.paymentAmountJpy)}</b><em>確認済み</em><button className={unlinkConfirmId === payment.paymentId ? 'secondary-btn card-unlink-confirm' : 'text-btn'} disabled={busyId === payment.paymentId} onClick={() => void unlink(card, payment.paymentId)}>{busyId === payment.paymentId ? '解除中…' : unlinkConfirmId === payment.paymentId ? '解除を確定' : '紐付けを解除'}</button></div>)}{card.payments.length === 0 && <p className="empty-state">紐付け済みの口座引落はありません。</p>}</div>
      {card.eligiblePayments.length > 0 && <div className="card-payment-candidates"><h3>照合候補</h3><p>候補ごとに金額と日付を確認してください。自動確定や支払い処理は行いません。</p>{card.eligiblePayments.map((payment) => <div className="card-payment-row" key={payment.paymentId}><span><strong>{payment.paymentOn}</strong><small>{payment.matchScoreBps == null ? '一致度未算出' : `一致度 ${Math.round(payment.matchScoreBps / 100)}%`} ・ 銀行取引 {payment.bankTransactionId}</small></span><b>{yen(payment.paymentAmountJpy)}</b><button className="secondary-btn" disabled={busyId === payment.paymentId} onClick={() => void confirm(card, payment.paymentId)}>{busyId === payment.paymentId ? '確定中…' : 'この引落を確認して紐付け'}</button></div>)}</div>}
      <dl className="card-statement-meta"><div><dt>期間</dt><dd>{card.periodStart} – {card.periodEnd}</dd></div><div><dt>利用明細</dt><dd>{card.lineCount}件</dd></div><div><dt>支払期日</dt><dd>{card.paymentDueOn ?? '未登録'} <small>ユーザー確認値</small></dd></div></dl>
      {desktop && <><div className="due-date-editor"><label><span>支払期日を登録・訂正</span><input id={`card-due-${card.id}`} aria-label={`${card.cardName}の支払期日`} type="date" min={card.periodEnd} value={dueDateDrafts[card.id] ?? ''} onChange={(event) => setDueDateDrafts((current) => ({ ...current, [card.id]: event.target.value }))} /></label><button className="secondary-btn" disabled={!dueDateDrafts[card.id] || busyId === `due:${card.id}`} onClick={() => void saveDueDate(card.id, dueDateDrafts[card.id])}>{busyId === `due:${card.id}` ? '保存中…' : '保存'}</button>{card.paymentDueOn && <button className="text-btn" disabled={busyId === `due:${card.id}`} onClick={() => void saveDueDate(card.id, null)}>解除</button>}<small>発行会社から自動推測せず、確認した日付だけを使用します。</small></div><footer className="card-detail-actions" aria-label={`${card.cardName}のカード操作`}><button type="button" onClick={() => document.getElementById(`card-bank-${card.cardAccountId}`)?.focus()}>引落口座を変更…</button><button type="button" onClick={() => document.getElementById(`card-due-${card.id}`)?.focus()}>支払日を上書き…</button><button type="button" disabled={card.payments.length === 0 || busyId === card.payments[0]?.paymentId} onClick={() => { const payment = card.payments[0]; if (payment) void unlink(card, payment.paymentId) }}>{unlinkConfirmId === card.payments[0]?.paymentId ? '照合解除を確定' : '照合を解除…'}</button></footer></>}
    </article>)}{desktop && displayCards.length === 0 && <p className="empty-state">カードCSVを取り込むと、ここに請求と照合状況が表示されます。</p>}</section>
  </>
}

function InvestmentsPage({ householdId, revision, openImport }: { householdId: string | null; revision: number; openImport: () => void }) {
  const browserPreview = platformClient.runtime === 'web'
  const [investmentView, setInvestmentView] = useState<'SNAPSHOT' | 'PERFORMANCE' | 'VALUATION'>('SNAPSHOT')
  const [snapshots, setSnapshots] = useState<readonly PortfolioSnapshotSummaryDto[]>(() => browserPreview ? [previewPortfolioSnapshot] : [])
  const [detail, setDetail] = useState<PortfolioSnapshotDetailDto | null>(() => browserPreview ? previewPortfolioSnapshot : null)
  const [notice, setNotice] = useState('')
  const [snapshotExportNotice, setSnapshotExportNotice] = useState('')
  const [savingSnapshotXlsx, setSavingSnapshotXlsx] = useState(false)
  const [savingSnapshotCsv, setSavingSnapshotCsv] = useState(false)
  const [savingSnapshotPdf, setSavingSnapshotPdf] = useState(false)
  const [brokerage, setBrokerage] = useState<BrokerageHistoryDto | null>(null)
  const [holdings, setHoldings] = useState<InvestmentHoldingsDto | null>(null)
  const [performance, setPerformance] = useState<InvestmentPerformanceDto | null>(null)
  const [valuation, setValuation] = useState<InvestmentValuationDto | null>(null)
  const [aggregateAssets, setAggregateAssets] = useState<readonly AggregateAssetSnapshotDto[]>([])
  const [aggregateRange, setAggregateRange] = useState<{ from: string | null; to: string | null }>({ from: null, to: null })
  const [selectedInstrumentCode, setSelectedInstrumentCode] = useState<string | null>(null)
  useEffect(() => {
    if (!householdId || browserPreview) return
    let active = true
    void portfolioPlatform.listSnapshots(householdId).then(async (items) => {
      if (!active) return
      setSnapshots(items)
      // Snapshot selection stays explicit so a newly imported file never
      // silently changes the valuation date the household is reviewing.
      setDetail(null)
    }).catch(() => { if (active) { setSnapshots([]); setDetail(null); setNotice('投資データを読み込めませんでした。') } })
    void brokeragePlatform.queryHistory({ householdId }).then((history) => { if (active) setBrokerage(history) }).catch(() => { if (active) setBrokerage(null) })
    const asOf = periodFromMonth(currentTokyoPeriod().month).toDate
    void Promise.all([investmentPerformancePlatform.queryHoldings({ householdId, asOf }), investmentPerformancePlatform.queryPerformance({ householdId })]).then(([nextHoldings, nextPerformance]) => { if (active) { setHoldings(nextHoldings); setPerformance(nextPerformance) } }).catch(() => { if (active) { setHoldings(null); setPerformance(null) } })
    void investmentMarketPlatform.queryValuation({ householdId, asOf }).then((nextValuation) => { if (active) setValuation(nextValuation) }).catch(() => { if (active) setValuation(null) })
    void aggregateAssetHistoryPlatform.listHistory({ householdId, limit: 240 }).then((items) => { if (active) setAggregateAssets(items) }).catch(() => { if (active) { setAggregateAssets([]); setNotice('Money Forward総資産履歴を読み込めませんでした。') } })
    return () => { active = false }
  }, [browserPreview, householdId, revision])
  const selectSnapshot = async (snapshotId: string) => {
    if (!householdId) return
    try { setDetail(await portfolioPlatform.getSnapshot(householdId, snapshotId)); setSnapshotExportNotice('') }
    catch { setNotice('選択した資産スナップショットを読み込めませんでした。') }
  }
  const saveSelectedSnapshotXlsx = async () => {
    if (!householdId || !detail || savingSnapshotCsv || savingSnapshotXlsx || savingSnapshotPdf) return
    setSavingSnapshotXlsx(true); setSnapshotExportNotice('')
    try {
      const saved = await portfolioPlatform.saveSnapshotXlsx({ householdId, snapshotId: detail.id })
      setSnapshotExportNotice(saved === null ? '資産スナップショットExcelエクスポートをキャンセルしました。' : `${saved.fileName}（${saved.rowCount.toLocaleString('ja-JP')}行）を保存しました。`)
      if (saved) showToast('資産スナップショットExcelを保存しました。')
    } catch { setSnapshotExportNotice('資産スナップショットExcelを書き出せませんでした。選択中のスナップショットを確認してください。') }
    finally { setSavingSnapshotXlsx(false) }
  }
  const saveSelectedSnapshotCsv = async () => {
    if (!householdId || !detail || savingSnapshotCsv || savingSnapshotXlsx || savingSnapshotPdf) return
    setSavingSnapshotCsv(true); setSnapshotExportNotice('')
    try {
      const saved = await portfolioPlatform.saveSnapshotCsv({ householdId, snapshotId: detail.id })
      setSnapshotExportNotice(saved === null ? '資産スナップショットCSVエクスポートをキャンセルしました。' : `${saved.fileName}（${saved.rowCount.toLocaleString('ja-JP')}行）を保存しました。`)
      if (saved) showToast('資産スナップショットCSVを保存しました。')
    } catch { setSnapshotExportNotice('資産スナップショットCSVを書き出せませんでした。選択中のスナップショットを確認してください。') }
    finally { setSavingSnapshotCsv(false) }
  }
  const saveSelectedSnapshotPdf = async () => {
    if (!householdId || !detail || savingSnapshotCsv || savingSnapshotXlsx || savingSnapshotPdf) return
    setSavingSnapshotPdf(true); setSnapshotExportNotice('')
    try {
      const saved = await portfolioPlatform.saveSnapshotPdf({ householdId, snapshotId: detail.id })
      setSnapshotExportNotice(saved === null ? '資産スナップショットPDFエクスポートをキャンセルしました。' : `${saved.fileName}（${saved.pageCount.toLocaleString('ja-JP')}ページ）を保存しました。`)
      if (saved) showToast('資産スナップショットPDFを保存しました。')
    } catch { setSnapshotExportNotice('資産スナップショットPDFを書き出せませんでした。選択中のスナップショットを確認してください。') }
    finally { setSavingSnapshotPdf(false) }
  }
  const maxAssetClass = Math.max(1, ...(detail?.assetClasses.map((item) => item.marketValueJpy) ?? [1]))
  const applyAggregateRange = async (from: string | null, to: string | null) => {
    if (!householdId) return
    try { setAggregateAssets(await aggregateAssetHistoryPlatform.listHistory({ householdId, dateFrom: from, dateTo: to, limit: 240 })); setAggregateRange({ from, to }) }
    catch { setNotice('総資産履歴の期間を読み込めませんでした。開始日と終了日を確認してください。') }
  }
  return <><PageHeader eyebrow="資産形成" title="資産・投資" description="証券会社の資産残高ファイルを、家計取引とは分離した時点スナップショットとして管理します。"><button className="primary-btn" onClick={openImport}><Import size={17} /> 残高ファイルを取り込む</button></PageHeader>
    <div className="workspace-tabs investment-tabs" role="tablist" aria-label="投資表示"><button role="tab" aria-selected={investmentView === 'SNAPSHOT'} className={investmentView === 'SNAPSHOT' ? 'active' : ''} onClick={() => setInvestmentView('SNAPSHOT')}>スナップショット</button><button role="tab" aria-selected={investmentView === 'PERFORMANCE'} className={investmentView === 'PERFORMANCE' ? 'active' : ''} onClick={() => setInvestmentView('PERFORMANCE')}>実現損益（FIFO）</button><button role="tab" aria-selected={investmentView === 'VALUATION'} className={investmentView === 'VALUATION' ? 'active' : ''} onClick={() => setInvestmentView('VALUATION')}>推移・評価</button><span>家計の収支とは分離されたワークスペースです</span></div>
    {notice && <div className="import-notice" role="status">{notice}</div>}
    {snapshotExportNotice && <div className="import-notice" role="status">{snapshotExportNotice}</div>}
    <div hidden={investmentView !== 'SNAPSHOT'}>
    {snapshots.length > 0 && <section className="panel snapshot-selector"><div><strong>表示するスナップショット</strong><small>最新への自動切替は行いません。評価日を明示して表示します。</small></div><select aria-label="資産スナップショット" value={detail?.id ?? ''} onChange={(event) => { if (event.target.value) void selectSnapshot(event.target.value) }}><option value="">スナップショットを選択</option>{snapshots.map((snapshot) => <option key={snapshot.id} value={snapshot.id}>{snapshot.asOf.slice(0, 10)} ・ {snapshot.accountName}</option>)}</select></section>}
    {detail ? <><section className="kpi-grid investment-kpis"><KpiCard label="時価総額" value={yen(detail.marketValueJpy)} meta={`${detail.asOf.slice(0, 10)} 残高`} icon={TrendingUp} accent="#e4edda" /><KpiCard label="現金" value={yen(detail.cashValueJpy)} meta={`${detail.accountName}・残高`} icon={CircleDollarSign} accent="#dce9e6" /><KpiCard label="評価損益" value={yen(detail.unrealizedPnlJpy ?? 0)} meta="未実現・残高" icon={ArrowUpRight} accent="#eee5cf" /><KpiCard label="実現損益 2026" value={yen(performance?.totalsByCurrency.find((total) => total.currency === 'JPY')?.realizedPnl ?? 0)} meta="FIFO・JPY" icon={WalletCards} accent="#f7e3d9" /></section>
      <section className="investment-grid"><article className="panel"><div className="panel-head"><div><h2>資産配分</h2><p>評価額ベース</p></div></div><div className="asset-allocation">{detail.assetClasses.map((item) => <div key={item.id}><span><strong>{item.name}</strong><em>{yen(item.marketValueJpy)}</em></span><div className="progress"><span style={{ width: `${item.marketValueJpy / maxAssetClass * 100}%` }} /></div></div>)}</div></article><article className="panel snapshot-history"><div className="panel-head"><div><h2>スナップショット履歴</h2><p>{snapshots.length}件</p></div></div>{snapshots.map((snapshot) => <button key={snapshot.id} className={snapshot.id === detail.id ? 'active' : ''} onClick={() => void selectSnapshot(snapshot.id)}><span>{snapshot.asOf.slice(0, 10)} ・ {snapshot.accountName}</span><strong>{yen(snapshot.marketValueJpy)}</strong></button>)}</article></section>
      <section className="panel positions-table"><div className="panel-head"><div><h2>保有商品</h2><p>原本の行番号まで追跡可能・銘柄を選ぶと取引履歴を表示</p></div><div className="snapshot-export-actions"><button className="secondary-btn" disabled={savingSnapshotCsv || savingSnapshotXlsx || savingSnapshotPdf} onClick={() => void saveSelectedSnapshotCsv()}>{savingSnapshotCsv ? 'CSVを作成中…' : '選択中の残高CSVを保存'}</button><button className="secondary-btn" disabled={savingSnapshotCsv || savingSnapshotXlsx || savingSnapshotPdf} onClick={() => void saveSelectedSnapshotXlsx()}>{savingSnapshotXlsx ? 'Excelを作成中…' : '選択中の残高Excelを保存'}</button><button className="secondary-btn" disabled={savingSnapshotCsv || savingSnapshotXlsx || savingSnapshotPdf} onClick={() => void saveSelectedSnapshotPdf()}>{savingSnapshotPdf ? 'PDFを作成中…' : '選択中の残高PDFを保存'}</button></div></div><div className="position-row position-head"><span>銘柄</span><span>口座</span><span>数量</span><span>現在値</span><span>評価額</span><span>評価損益</span></div>{detail.positions.map((position) => <button type="button" className={`position-row position-selectable${selectedInstrumentCode === position.instrumentCode ? ' active' : ''}`} key={position.id} onClick={() => setSelectedInstrumentCode(position.instrumentCode || position.instrumentName)}><span><strong>{position.instrumentName}</strong><small>{position.instrumentCode || position.productType} ・ 行 {position.sourceRow}</small></span><span>{position.accountType}</span><span>{position.quantity?.toLocaleString('ja-JP') ?? 'NULL'}</span><span>{position.marketPrice == null ? 'NULL' : `${position.currency} ${position.marketPrice.toLocaleString('ja-JP')}`}</span><strong>{position.marketValueJpy == null ? 'NULL' : yen(position.marketValueJpy)}</strong><em className={(position.unrealizedPnlJpy ?? 0) >= 0 ? 'amount-positive' : ''}>{position.unrealizedPnlJpy == null ? 'NULL' : yen(position.unrealizedPnlJpy)}</em></button>)}</section>{selectedInstrumentCode && <section className="panel brokerage-instrument-history"><div className="panel-head"><div><h2>{selectedInstrumentCode} の取引履歴</h2><p>証券会社原本の約定日・受渡日を保持</p></div><button className="text-btn" onClick={() => setSelectedInstrumentCode(null)}>閉じる</button></div>{brokerage?.events.filter((event) => event.instrumentCode === selectedInstrumentCode || event.instrumentName === selectedInstrumentCode).slice(0, 20).map((event) => <div key={event.id}><span><strong>{event.rawTransactionType}</strong><small>約定 {event.tradeDate ?? 'NULL'} ・ 受渡 {event.settlementDate ?? 'NULL'} ・ 行 {event.sourceRow}</small></span><b>{event.eventType}</b><em>{event.currency} {event.settlementAmount.toLocaleString('ja-JP')}</em></div>)}{!brokerage?.events.some((event) => event.instrumentCode === selectedInstrumentCode || event.instrumentName === selectedInstrumentCode) && <p className="empty-state">この銘柄に対応する取引履歴はありません。</p>}</section>}</> : <section className="panel investment-empty"><TrendingUp size={32} /><h2>資産スナップショットはまだありません</h2><p>設定で証券口座を追加し、`assetbalance(all)_*.csv` をインポートしてください。</p><button className="primary-btn" onClick={openImport}>インポート Inboxを開く</button></section>}
    {holdings && performance && performance.totalsByCurrency.length > 0 && <InvestmentFxSummary householdId={householdId} fxAsOf={holdings.asOf} revision={revision} />}
    </div>
    <div hidden={investmentView !== 'PERFORMANCE'}>
    {brokerage && brokerage.events.length > 0 && <section className="panel brokerage-history"><div className="panel-head"><div><h2>証券取引履歴</h2><p>売買・配当・手数料・税金・入出金（家計支出には含めません）</p></div><strong>{brokerage.events.length}件</strong></div><div className="brokerage-totals">{brokerage.totalsByCurrency.map((total) => <article key={total.currency}><span>{total.currency} 純資金移動</span><strong>{total.netCashMovement.toLocaleString('ja-JP')}</strong><small>配当 {total.dividendGross.toLocaleString('ja-JP')} ・ 手数料 {total.fees.toLocaleString('ja-JP')} ・ 税 {total.taxes.toLocaleString('ja-JP')}</small></article>)}</div><div className="brokerage-event-list">{brokerage.events.slice(0, 20).map((event) => <div key={event.id}><span><strong>{event.instrumentName || event.rawTransactionType}</strong><small>{event.tradeDate ?? event.settlementDate} ・ {event.accountName} ・ 行 {event.sourceRow}</small></span><b>{event.eventType}</b><em>{event.currency} {event.settlementAmount.toLocaleString('ja-JP')}</em></div>)}</div></section>}
    {holdings && (holdings.positions.length > 0 || (performance?.totalsByCurrency.length ?? 0) > 0) && <section className="panel investment-performance"><div className="panel-head"><div><h2>投資パフォーマンス</h2><p>{holdings.costBasisMethod} 原価法・通貨ごとに集計（自動換算なし）</p></div><span>{holdings.asOf} 現在</span></div>{performance && <div className="performance-currency-grid">{performance.totalsByCurrency.map((total) => <article key={total.currency}><span>{total.currency}</span><strong className={total.realizedPnl >= 0 ? 'amount-positive' : ''}>{total.realizedPnl.toLocaleString('ja-JP')} 実現損益</strong><small>配当 {total.dividendGross.toLocaleString('ja-JP')} ・ 手数料 {total.fees.toLocaleString('ja-JP')} ・ 税 {total.taxes.toLocaleString('ja-JP')}</small></article>)}</div>}<div className="performance-position-list">{holdings.positions.map((position) => <div key={`${position.accountId}-${position.instrumentCode}-${position.currency}`}><span><strong>{position.instrumentName}</strong><small>{position.instrumentCode} ・ {position.accountName} ・ {position.openLotCount}ロット</small></span><em>{position.quantity.toLocaleString('ja-JP')} 株</em><b>{position.currency} {position.costBasis.toLocaleString('ja-JP')} 原価</b></div>)}</div>{(holdings.uncoveredSales.length > 0 || holdings.skippedEventIds.length > 0) && <p className="performance-warning">原価未確認の売却 {holdings.uncoveredSales.length}件・計算対象外 {holdings.skippedEventIds.length}件。原本取引を確認してください。</p>}</section>}
    {(brokerage?.events.length ?? 0) > 0 && <InvestmentPeriodReport householdId={householdId} revision={revision} />}
    </div>
    <div hidden={investmentView !== 'VALUATION'}>
      <section className="panel investment-history-disclosure"><strong>スナップショット時点だけを表示</strong><span>点と点の間は補間しません。各値の asOf とソースを分けて確認できます。</span></section>
      <InvestmentValuationSummary valuation={valuation} />
      <AggregateAssetHistoryView snapshots={aggregateAssets} initialDateFrom={aggregateRange.from ?? ''} initialDateTo={aggregateRange.to ?? ''} onApplyRange={(from, to) => void applyAggregateRange(from, to)} />
    </div>
  </>
}

function FinancialIntelligencePanel({ householdId, accountGroupId, attributionScope, month, revision, preferenceRevision, openTransactions, onDecisionChanged }: { householdId: string | null; accountGroupId: string | null; attributionScope: AttributionScopeDto; month: string; revision: number; preferenceRevision: number; openTransactions: () => void; onDecisionChanged: () => void }) {
  const [intelligence, setIntelligence] = useState<FinancialIntelligenceDto | null>(null)
  const [preferences, setPreferences] = useState<readonly RecurringSeriesPreferenceDto[] | null>(null)
  const [notice, setNotice] = useState('')
  const [decisionNotice, setDecisionNotice] = useState('')
  const [busyPayee, setBusyPayee] = useState<string | null>(null)
  useEffect(() => {
    if (!householdId || platformClient.runtime !== 'tauri') return
    let active = true
    const asOf = periodFromMonth(month).toDate
    setIntelligence(null)
    setPreferences(null)
    setNotice('')
    void Promise.allSettled([
      queryFinancialIntelligence(tauriInvoke, { householdId, accountGroupId, attributionScope, asOf }),
      listRecurringSeriesPreferences(tauriInvoke, householdId),
    ]).then(([intelligenceResult, preferenceResult]) => {
      if (!active) return
      if (intelligenceResult.status === 'fulfilled') setIntelligence(intelligenceResult.value)
      if (preferenceResult.status === 'fulfilled') setPreferences(preferenceResult.value)
      const messages: string[] = []
      if (intelligenceResult.status === 'rejected') messages.push('定期支出と異常支出を分析できませんでした。')
      if (preferenceResult.status === 'rejected') messages.push('確認状態を読み込めないため、変更操作は一時停止しています。')
      setNotice(messages.join(' '))
    })
    return () => { active = false }
  }, [accountGroupId, attributionScope, householdId, month, preferenceRevision, revision])
  const changeDecision = async (normalizedPayee: string, decision: RecurringDecision | 'RESTORE') => {
    if (!householdId || preferences === null) return
    const preference = preferences.find((item) => item.normalizedPayee === normalizedPayee)
    if (decision === 'RESTORE' && !preference) return
    setBusyPayee(normalizedPayee); setDecisionNotice('')
    try {
      if (decision === 'RESTORE') await deleteRecurringSeriesPreference(tauriInvoke, { householdId, normalizedPayee, expectedVersion: preference!.version })
      else await upsertRecurringSeriesPreference(tauriInvoke, { householdId, normalizedPayee, decision, expectedVersion: preference?.version ?? null })
      setDecisionNotice(decision === 'CONFIRMED' ? '定期支出として確認しました。関連する分析を更新しています。' : decision === 'IGNORED' ? '対象外にしました。関連する分析を更新しています。' : '自動検出へ戻しました。関連する分析を更新しています。')
      onDecisionChanged()
    } catch {
      setDecisionNotice('確認状態を更新できませんでした。表示中の状態は変更していません。再読み込み後にもう一度お試しください。')
    } finally { setBusyPayee(null) }
  }
  if (notice && !intelligence) return <section className="panel"><p className="empty-state">{notice}</p></section>
  if (!intelligence) return <section className="panel"><p className="empty-state">家計履歴を分析しています…</p></section>
  const cadenceLabel = { WEEKLY: '毎週', BIWEEKLY: '隔週', MONTHLY: '毎月', QUARTERLY: '四半期', ANNUAL: '毎年' } as const
  const allRecurringItems = [...intelligence.recurringItems, ...intelligence.ignoredRecurringItems]
  const statusLabel = { AUTO_DETECTED: '自動検出', CONFIRMED: '確認済み', IGNORED: '対象外' } as const
  return <><section className="intelligence-grid"><article className="panel recurring-panel"><div className="panel-head"><div><h2>定期支出・サブスクリプション</h2><p>{intelligence.historyFrom} 以降の計算対象の確定取引から推定（集計対象外を除く）</p></div><Repeat2 size={19} /></div>{notice && <p className="recurring-decision-notice" role="status">{notice}</p>}{decisionNotice && <p className="recurring-decision-notice" role="status">{decisionNotice}</p>}{allRecurringItems.length === 0 ? <p className="empty-state">十分な反復履歴はまだありません。</p> : allRecurringItems.map((item) => { const preference = preferences?.find((candidate) => candidate.normalizedPayee === item.normalizedPayee); const requiresPreference = item.decisionStatus !== 'AUTO_DETECTED'; const disabled = busyPayee !== null || preferences === null || (requiresPreference && !preference); return <div className={`recurring-row recurring-${item.decisionStatus.toLowerCase()}`} key={item.normalizedPayee}><div><span className={`recurring-status recurring-status-${item.decisionStatus.toLowerCase()}`}>{statusLabel[item.decisionStatus]}</span><strong>{item.displayPayee}</strong><span>{cadenceLabel[item.cadence]} ・ {item.occurrenceCount}回 ・ 信頼度 {Math.round(item.confidenceBps / 100)}%</span></div><div><small>次回見込み</small><strong>{item.nextExpectedOn}</strong></div><div><small>標準金額</small><strong>{yen(item.typicalAmountJpy)}</strong>{item.priceChangeBps != null && item.priceChangeBps !== 0 && <em>{item.priceChangeBps > 0 ? '+' : ''}{(item.priceChangeBps / 100).toFixed(1)}%</em>}</div><div className="recurring-decision-actions">{item.decisionStatus === 'AUTO_DETECTED' && <button className="mini-btn" disabled={disabled} onClick={() => void changeDecision(item.normalizedPayee, 'CONFIRMED')}>定期支出として確認</button>}{item.decisionStatus !== 'IGNORED' && <button className="text-btn" disabled={disabled} onClick={() => void changeDecision(item.normalizedPayee, 'IGNORED')}>対象外にする</button>}{item.decisionStatus === 'IGNORED' && <button className="secondary-btn" disabled={disabled} onClick={() => void changeDecision(item.normalizedPayee, 'RESTORE')}>自動検出へ戻す</button>}{busyPayee === item.normalizedPayee && <small>更新中…</small>}</div></div> })}</article><article className="panel anomaly-panel"><div className="panel-head"><div><h2>異常支出</h2><p>同じ支払先の計算対象の過去実績と比較</p></div><Bell size={19} /></div>{intelligence.anomalies.length === 0 ? <p className="empty-state">確認が必要な異常支出はありません。</p> : intelligence.anomalies.map((item) => <button key={item.transactionId} onClick={openTransactions}><span><strong>{item.displayPayee}</strong><small>{item.occurredOn} ・ 基準 {yen(item.baselineAmountJpy)} ({item.baselineSampleCount}件)</small></span><strong>{yen(item.amountJpy)}</strong><em>スコア {Math.round(item.scoreBps / 100)}</em></button>)}</article></section></>
}

function FixedCostReviewPanel({ householdId, accountGroupId, attributionScope, month, revision, preferenceRevision, openTransactions }: { householdId: string | null; accountGroupId: string | null; attributionScope: AttributionScopeDto; month: string; revision: number; preferenceRevision: number; openTransactions: () => void }) {
  const [review, setReview] = useState<FixedCostReviewDto | null>(null)
  const [notice, setNotice] = useState('')
  useEffect(() => {
    if (!householdId || platformClient.runtime !== 'tauri') return
    let active = true
    setReview(null); setNotice('')
    void queryFixedCostReview(tauriInvoke, { householdId, accountGroupId, attributionScope, asOf: periodFromMonth(month).toDate })
      .then((result) => { if (active) setReview(result) })
      .catch(() => { if (active) setNotice('固定費レビューを読み込めませんでした。6か月分の確定取引を確認してください。') })
    return () => { active = false }
  }, [accountGroupId, attributionScope, householdId, month, preferenceRevision, revision])
  if (notice) return <section className="panel"><p className="empty-state">{notice}</p></section>
  if (!review) return <section className="panel report-loading"><Repeat2 size={28} /><p>完了済み6か月の固定費を比較しています…</p></section>
  return <FixedCostReviewView data={review} onOpenTransactions={openTransactions} />
}

function AccountGroupsExportPanel({ householdId, accounts, month, groups, selectedAccountGroupId, attributionScope, onGroupsChanged }: { householdId: string | null; accounts: readonly AccountDto[]; month: string; groups: readonly AccountGroupDto[]; selectedAccountGroupId: string | null; attributionScope: AttributionScopeDto; onGroupsChanged: (groups: readonly AccountGroupDto[]) => void }) {
  const [name, setName] = useState('')
  const [kind, setKind] = useState<AccountGroupKindDto>('FAMILY')
  const [selectedAccounts, setSelectedAccounts] = useState<ReadonlySet<string>>(() => new Set())
  const [exportKind, setExportKind] = useState<ExportKindDto>('TRANSACTIONS')
  const [basis, setBasis] = useState<ExportAccountingBasisDto>('ACCRUAL')
  const [groupId, setGroupId] = useState(selectedAccountGroupId ?? '')
  const [notice, setNotice] = useState('')
  const [busy, setBusy] = useState(false)
  const period = periodFromMonth(month)
  const reload = async () => {
    if (!householdId || platformClient.runtime !== 'tauri') return
    onGroupsChanged(await accountGroupExportPlatform.listGroups(householdId))
  }
  useEffect(() => { setGroupId(selectedAccountGroupId ?? '') }, [selectedAccountGroupId])
  const createGroup = async () => {
    if (!householdId || !name.trim() || selectedAccounts.size === 0) { setNotice('グループ名と1つ以上の口座を選択してください。'); return }
    setBusy(true); setNotice('')
    try { await accountGroupExportPlatform.createGroup({ id: crypto.randomUUID(), householdId, name: name.trim(), groupKind: kind, accountIds: [...selectedAccounts] }); setName(''); setSelectedAccounts(new Set()); await reload(); setNotice('口座グループを保存しました。') }
    catch { setNotice('口座グループを保存できませんでした。') }
    finally { setBusy(false) }
  }
  const deleteGroup = async (group: AccountGroupDto) => {
    if (!householdId) return
    setBusy(true)
    try { await accountGroupExportPlatform.deleteGroup(householdId, group.id); if (groupId === group.id) setGroupId(''); await reload(); setNotice('口座グループを削除しました。') }
    catch { setNotice('口座グループを削除できませんでした。') }
    finally { setBusy(false) }
  }
  const exportCsv = async () => {
    if (!householdId) return
    setBusy(true); setNotice('')
    try {
      const saved = await accountGroupExportPlatform.saveCsv({ householdId, exportKind, accountingBasis: basis, groupId: groupId || null, attributionScope, fromDate: period.fromDate, toDate: period.toDate })
      setNotice(saved ? `${saved.fileName}（${saved.rowCount}行）を保存しました。` : 'エクスポートをキャンセルしました。')
      if (saved) showToast('CSVを保存しました。')
    } catch { setNotice('CSVを書き出せませんでした。対象期間とグループを確認してください。') }
    finally { setBusy(false) }
  }
  const exportXlsx = async () => {
    if (!householdId || exportKind !== 'TRANSACTIONS') return
    setBusy(true); setNotice('')
    try {
      const saved = await accountGroupExportPlatform.saveTransactionLedgerXlsx({ householdId, exportKind, accountingBasis: basis, groupId: groupId || null, attributionScope, fromDate: period.fromDate, toDate: period.toDate })
      setNotice(saved ? `${saved.fileName}（${saved.rowCount}行）を保存しました。` : 'Excelエクスポートをキャンセルしました。')
      if (saved) showToast('取引台帳Excelを保存しました。')
    } catch { setNotice('取引台帳Excelを書き出せませんでした。対象期間とグループを確認してください。') }
    finally { setBusy(false) }
  }
  const exportPdf = async () => {
    if (!householdId || exportKind !== 'TRANSACTIONS') return
    setBusy(true); setNotice('')
    try {
      const saved = await accountGroupExportPlatform.saveTransactionLedgerPdf({ householdId, exportKind, accountingBasis: basis, groupId: groupId || null, attributionScope, fromDate: period.fromDate, toDate: period.toDate })
      setNotice(saved ? `${saved.fileName}（${saved.rowCount}行・${saved.pageCount}ページ）を保存しました。` : 'PDFエクスポートをキャンセルしました。')
      if (saved) showToast('取引台帳PDFを保存しました。')
    } catch { setNotice('取引台帳PDFを書き出せませんでした。対象期間とグループを確認してください。') }
    finally { setBusy(false) }
  }
  const kindLabels: Record<AccountGroupKindDto, string> = { FAMILY: '家族', PERSONAL: '個人', DAILY_SPENDING: '日常支出', INVESTMENT: '投資', BUSINESS: '事業', TAX: '税務', EDUCATION: '教育', CUSTOM: 'カスタム' }
  return <section className="groups-export-grid"><article className="panel account-group-panel"><div className="panel-head"><div><h2>口座グループ</h2><p>ダッシュボードと出力で再利用する保存済みスコープ</p></div><Layers size={19} /></div><div className="group-form"><input aria-label="グループ名" value={name} onChange={(event) => setName(event.target.value)} placeholder="家族の生活費" /><select aria-label="グループ種別" value={kind} onChange={(event) => setKind(event.target.value as AccountGroupKindDto)}>{Object.entries(kindLabels).map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select><div className="group-account-choices">{accounts.map((account) => <label key={account.id}><input type="checkbox" checked={selectedAccounts.has(account.id)} onChange={(event) => setSelectedAccounts((current) => { const next = new Set(current); if (event.target.checked) next.add(account.id); else next.delete(account.id); return next })} /><span>{account.name}</span></label>)}</div><button className="primary-btn" disabled={busy} onClick={() => void createGroup()}>グループを保存</button></div><div className="saved-groups">{groups.map((group) => <div key={group.id}><span><strong>{group.name}</strong><small>{kindLabels[group.groupKind]} ・ {group.accountIds.length}口座</small></span><button className="text-btn" disabled={busy} onClick={() => void deleteGroup(group)}>削除</button></div>)}{groups.length === 0 && <p className="empty-state">保存済みグループはありません。</p>}</div></article><article className="panel export-panel"><div className="panel-head"><div><h2>台帳エクスポート</h2><p>同じ確定データをCSV・Excel・PDFで保存</p></div><Download size={19} /></div><label>データ<select aria-label="エクスポートデータ" value={exportKind} onChange={(event) => setExportKind(event.target.value as ExportKindDto)}><option value="TRANSACTIONS">取引台帳</option><option value="PORTFOLIO_SNAPSHOTS">資産スナップショット</option></select></label><label>計上基準<select aria-label="エクスポート計上基準" value={basis} onChange={(event) => setBasis(event.target.value as ExportAccountingBasisDto)}><option value="ACCRUAL">発生ベース</option><option value="CASH">資金移動</option></select></label><label>口座スコープ<select aria-label="エクスポートグループ" value={groupId} onChange={(event) => setGroupId(event.target.value)}><option value="">すべての口座</option>{groups.map((group) => <option key={group.id} value={group.id}>{group.name}</option>)}</select></label><div className="export-period"><span>対象期間</span><strong>{period.fromDate} → {period.toDate}</strong></div><div className="monthly-review-export-actions"><button className="primary-btn" disabled={busy} onClick={() => void exportCsv()}>{busy ? '処理中…' : 'CSVを保存'}</button>{exportKind === 'TRANSACTIONS' && <><button className="secondary-btn" disabled={busy} onClick={() => void exportXlsx()}>{busy ? '処理中…' : '取引台帳Excelを保存'}</button><button className="secondary-btn" disabled={busy} onClick={() => void exportPdf()}>{busy ? '処理中…' : '取引台帳PDFを保存'}</button></>}</div>{exportKind === 'PORTFOLIO_SNAPSHOTS' && <small>資産スナップショットのExcel/PDFは投資画面から保存できます。</small>}{notice && <p role="status">{notice}</p>}</article></section>
}

type ReportView = 'CALENDAR' | 'MONTHLY' | 'ANNUAL' | 'FORECAST' | 'INTELLIGENCE' | 'FIXED_COST' | 'EXPORT'
function ReportTabs({ view, onChange }: { view: ReportView; onChange: (view: ReportView) => void }) {
  const reviewActive = view === 'MONTHLY' || view === 'ANNUAL'
  const analysisActive = view === 'FORECAST' || view === 'INTELLIGENCE' || view === 'FIXED_COST'
  const items = [
    { id: 'report-tab-calendar', label: 'カレンダー', target: 'CALENDAR' as const, active: view === 'CALENDAR', icon: CalendarDays },
    { id: 'report-tab-review', label: '月次・年次レビュー', target: 'MONTHLY' as const, active: reviewActive, icon: FileText },
    { id: 'report-tab-analysis', label: '分析・予測', target: 'FORECAST' as const, active: analysisActive, icon: TrendingUp },
  ]
  const activeIndex = Math.max(0, items.findIndex((item) => item.active))
  const handleKeyDown = (event: React.KeyboardEvent<HTMLButtonElement>, index: number) => {
    const nextIndex = event.key === 'Home' ? 0 : event.key === 'End' ? items.length - 1 : event.key === 'ArrowRight' ? (index + 1) % items.length : event.key === 'ArrowLeft' ? (index - 1 + items.length) % items.length : -1
    if (nextIndex < 0) return
    event.preventDefault()
    const buttons = event.currentTarget.parentElement?.querySelectorAll<HTMLButtonElement>('[role="tab"]')
    buttons?.[nextIndex]?.focus()
    onChange(items[nextIndex].target)
  }
  return <div className="report-tabs report-tabs-primary" role="tablist" aria-label="レポート表示">{items.map((item, index) => <button key={item.id} id={item.id} role="tab" aria-controls="report-tabpanel" aria-selected={item.active} tabIndex={index === activeIndex ? 0 : -1} className={item.active ? 'active' : ''} onClick={() => onChange(item.target)} onKeyDown={(event) => handleKeyDown(event, index)}><item.icon size={15} /> {item.label}</button>)}</div>
}

function ReportSubTabs({ view, onChange }: { view: ReportView; onChange: (view: ReportView) => void }) {
  const items = view === 'MONTHLY' || view === 'ANNUAL'
    ? [['MONTHLY', '月次レポート'], ['ANNUAL', '年次レビュー']] as const
    : view === 'FORECAST' || view === 'INTELLIGENCE' || view === 'FIXED_COST'
      ? [['FORECAST', '予測とアクション'], ['INTELLIGENCE', '定期・異常レビュー'], ['FIXED_COST', '固定費レビュー']] as const
      : []
  if (items.length === 0) return null
  return <div className="report-subtabs" role="tablist" aria-label="レポート詳細">{items.map(([itemView, label]) => <button key={itemView} id={`report-subtab-${itemView.toLowerCase()}`} role="tab" aria-selected={view === itemView} className={view === itemView ? 'active' : ''} onClick={() => onChange(itemView)}>{label}</button>)}</div>
}

function MonthlyReviewMemo({ householdId, month }: { householdId: string | null; month: string }) {
  const storageKey = `kakeflow:monthly-review-memo:${householdId ?? 'preview'}:${month}`
  const [memo, setMemo] = useState('')
  const [savedMemo, setSavedMemo] = useState('')
  const [notice, setNotice] = useState('')
  const [saving, setSaving] = useState(false)
  useEffect(() => {
    let active = true
    setNotice('')
    if (platformClient.runtime === 'tauri' && householdId) {
      void platformClient.getMonthlyReviewMemo(householdId, month)
        .then((record) => { if (active) { const stored = record?.memo ?? ''; setMemo(stored); setSavedMemo(stored) } })
        .catch(() => { if (active) { setMemo(''); setSavedMemo(''); setNotice('締めメモを読み込めませんでした。') } })
    } else {
      const stored = globalThis.localStorage.getItem(storageKey) ?? ''
      setMemo(stored); setSavedMemo(stored)
    }
    return () => { active = false }
  }, [householdId, month, storageKey])
  const save = async () => {
    const normalized = memo.trim()
    setSaving(true); setNotice('')
    try {
      if (platformClient.runtime === 'tauri' && householdId) {
        await platformClient.upsertMonthlyReviewMemo({ householdId, month, memo: normalized })
      } else if (normalized) globalThis.localStorage.setItem(storageKey, normalized)
      else globalThis.localStorage.removeItem(storageKey)
      setMemo(normalized); setSavedMemo(normalized); setNotice(normalized ? 'この月の締めメモを保存しました。' : '締めメモを削除しました。')
      showToast(normalized ? '月次メモを保存しました。' : '月次メモを削除しました。')
    } catch {
      setNotice('締めメモを保存できませんでした。もう一度お試しください。')
    } finally { setSaving(false) }
  }
  return <section className="panel monthly-review-memo"><div className="panel-head"><div><h2>締めの要約</h2><p>{month}・暗号化台帳に保存</p></div><FileCheck2 size={18} /></div><textarea aria-label="月次レビューの締めメモ" rows={3} maxLength={1200} value={memo} onChange={(event) => setMemo(event.target.value)} placeholder="例: 貯蓄率は目標内。交際費が予算を超えたため、来月は週単位で確認する。" /><footer><small>{memo.length} / 1200</small>{notice && <span role="status">{notice}</span>}<button className="primary-btn" disabled={saving || memo.trim() === savedMemo} onClick={() => void save()}>{saving ? '保存中…' : 'メモを保存'}</button></footer></section>
}

function ReportsPage({ householdId, accountGroupId, attributionScope, accountGroups, onGroupsChanged, accounts, month, revision, initialView, openPage }: { householdId: string | null; accountGroupId: string | null; attributionScope: AttributionScopeDto; accountGroups: readonly AccountGroupDto[]; onGroupsChanged: (groups: readonly AccountGroupDto[]) => void; accounts: readonly AccountDto[]; month: string; revision: number; initialView: ReportView; openPage: (page: PageId) => void }) {
  const [view, setView] = useState<ReportView>(initialView)
  const [recurringPreferenceRevision, setRecurringPreferenceRevision] = useState(0)
  const [calendar, setCalendar] = useState<FinancialCalendarDto | null>(null)
  const [monthlyReport, setMonthlyReport] = useState<MonthlyFinancialReportDto | null>(null)
  const [monthlyCsvSaving, setMonthlyCsvSaving] = useState(false)
  const [monthlyXlsxSaving, setMonthlyXlsxSaving] = useState(false)
  const [monthlyPdfSaving, setMonthlyPdfSaving] = useState(false)
  const [monthlyExportNotice, setMonthlyExportNotice] = useState('')
  const [annualReport, setAnnualReport] = useState<YearlyFinancialReportDto | null>(null)
  const [annualNotice, setAnnualNotice] = useState('')
  const [annualCsvSaving, setAnnualCsvSaving] = useState(false)
  const [annualXlsxSaving, setAnnualXlsxSaving] = useState(false)
  const [annualPdfSaving, setAnnualPdfSaving] = useState(false)
  const [forecast, setForecast] = useState<ForecastActionDto | null>(null)
  const [basis, setBasis] = useState<'ACCRUAL' | 'CASH'>('ACCRUAL')
  const [comparison, setComparison] = useState<'PRIOR_MONTH' | 'PRIOR_YEAR'>('PRIOR_MONTH')
  const [notice, setNotice] = useState('')
  useEffect(() => {
    if (!householdId || platformClient.runtime !== 'tauri') return
    let active = true
    const request = { householdId, accountGroupId, attributionScope, month, asOf: periodFromMonth(month).toDate }
    void Promise.all([financialCalendarPlatform.getCalendar(request), financialCalendarPlatform.getMonthlyReport(request), forecastActionPlatform.query({ householdId, accountGroupId, attributionScope, asOf: request.asOf })])
      .then(([nextCalendar, nextReport, nextForecast]) => { if (active) { setCalendar(nextCalendar); setMonthlyReport(nextReport); setForecast(nextForecast); setNotice(''); setMonthlyExportNotice('') } })
      .catch(() => { if (active) { setCalendar(null); setMonthlyReport(null); setForecast(null); setNotice('家計レビューを読み込めませんでした。') } })
    return () => { active = false }
  }, [accountGroupId, attributionScope, householdId, month, recurringPreferenceRevision, revision])
  const saveMonthlyCsv = async () => {
    if (!householdId) return
    setMonthlyCsvSaving(true); setMonthlyExportNotice('')
    try {
      const saved = await financialCalendarPlatform.saveMonthlyReviewCsv({ householdId, accountGroupId, attributionScope, month, asOf: periodFromMonth(month).toDate })
      setMonthlyExportNotice(saved ? `${saved.fileName}（${saved.rowCount}行）を保存しました。` : '月次CSVエクスポートをキャンセルしました。')
      if (saved) showToast('月次CSVを保存しました。')
    } catch { setMonthlyExportNotice('月次CSVを書き出せませんでした。対象月とスコープを確認してください。') }
    finally { setMonthlyCsvSaving(false) }
  }
  const saveMonthlyXlsx = async () => {
    if (!householdId) return
    setMonthlyXlsxSaving(true); setMonthlyExportNotice('')
    try {
      const saved = await financialCalendarPlatform.saveMonthlyReviewXlsx({ householdId, accountGroupId, attributionScope, month, asOf: periodFromMonth(month).toDate })
      setMonthlyExportNotice(saved ? `${saved.fileName}（${saved.rowCount}行）を保存しました。` : '月次Excelエクスポートをキャンセルしました。')
      if (saved) showToast('月次Excelを保存しました。')
    } catch { setMonthlyExportNotice('月次Excelを書き出せませんでした。対象月とスコープを確認してください。') }
    finally { setMonthlyXlsxSaving(false) }
  }
  const saveMonthlyPdf = async () => {
    if (!householdId) return
    setMonthlyPdfSaving(true); setMonthlyExportNotice('')
    try {
      const saved = await financialCalendarPlatform.saveMonthlyReviewPdf({ householdId, accountGroupId, attributionScope, month, asOf: periodFromMonth(month).toDate })
      setMonthlyExportNotice(saved ? `${saved.fileName}（${saved.pageCount}ページ）を保存しました。` : '月次PDFエクスポートをキャンセルしました。')
      if (saved) showToast('月次PDFを保存しました。')
    } catch { setMonthlyExportNotice('月次PDFを書き出せませんでした。対象月とスコープを確認してください。') }
    finally { setMonthlyPdfSaving(false) }
  }
  useEffect(() => {
    if (view !== 'ANNUAL' || !householdId || platformClient.runtime !== 'tauri') return
    let active = true
    setAnnualReport(null); setAnnualNotice('')
    const request = { householdId, accountGroupId, attributionScope, year: month.slice(0, 4), asOf: currentTokyoDate() }
    void financialCalendarPlatform.getYearlyReport(request)
      .then((result) => { if (active) setAnnualReport(result) })
      .catch(() => { if (active) setAnnualNotice('年次レビューを読み込めませんでした。対象年と確定取引を確認してください。') })
    return () => { active = false }
  }, [accountGroupId, attributionScope, householdId, month, revision, view])
  const saveAnnualCsv = async () => {
    if (!householdId) return
    setAnnualCsvSaving(true); setAnnualNotice('')
    try {
      const saved = await financialCalendarPlatform.saveAnnualReviewCsv({ householdId, accountGroupId, attributionScope, year: month.slice(0, 4), asOf: currentTokyoDate() })
      setAnnualNotice(saved ? `${saved.fileName}（${saved.rowCount}行）を保存しました。` : 'エクスポートをキャンセルしました。')
      if (saved) showToast('年次CSVを保存しました。')
    } catch { setAnnualNotice('年次CSVを書き出せませんでした。対象年とスコープを確認してください。') }
    finally { setAnnualCsvSaving(false) }
  }
  const saveAnnualXlsx = async () => {
    if (!householdId) return
    setAnnualXlsxSaving(true); setAnnualNotice('')
    try {
      const saved = await financialCalendarPlatform.saveAnnualReviewXlsx({ householdId, accountGroupId, attributionScope, year: month.slice(0, 4), asOf: currentTokyoDate() })
      setAnnualNotice(saved ? `${saved.fileName}（${saved.rowCount}行）を保存しました。` : 'Excelエクスポートをキャンセルしました。')
      if (saved) showToast('年次Excelを保存しました。')
    } catch { setAnnualNotice('年次Excelを書き出せませんでした。対象年とスコープを確認してください。') }
    finally { setAnnualXlsxSaving(false) }
  }
  const saveAnnualPdf = async () => {
    if (!householdId) return
    setAnnualPdfSaving(true); setAnnualNotice('')
    try {
      const saved = await financialCalendarPlatform.saveAnnualReviewPdf({ householdId, accountGroupId, attributionScope, year: month.slice(0, 4), asOf: currentTokyoDate() })
      setAnnualNotice(saved ? `${saved.fileName}（${saved.pageCount}ページ）を保存しました。` : 'PDFエクスポートをキャンセルしました。')
      if (saved) showToast('年次PDFを保存しました。')
    } catch { setAnnualNotice('年次PDFを書き出せませんでした。対象年とスコープを確認してください。') }
    finally { setAnnualPdfSaving(false) }
  }
  const reportBodyContent = view === 'CALENDAR'
    ? calendar ? <FinancialCalendarView data={calendar} basis={basis} onBasisChange={setBasis} onSelectDate={() => openPage('transactions')} onSelectEvent={() => openPage('transactions')} onOpenImports={() => openPage('import')} /> : <section className="panel report-loading"><CalendarDays size={28} /><p>{notice || '日次カレンダーを読み込んでいます…'}</p></section>
    : view === 'MONTHLY'
      ? monthlyReport ? <><MonthlyReportView data={monthlyReport} comparison={comparison} savingCsv={monthlyCsvSaving} savingXlsx={monthlyXlsxSaving} savingPdf={monthlyPdfSaving} onComparisonChange={setComparison} onSelectDriver={() => openPage('transactions')} onOpenBudget={() => openPage('budgets')} onOpenGoals={() => openPage('budgets')} onOpenImports={() => openPage('import')} onOpenReconciliation={() => openPage('cards')} onSaveCsv={() => void saveMonthlyCsv()} onSaveXlsx={() => void saveMonthlyXlsx()} onSavePdf={() => void saveMonthlyPdf()} /><MonthlyReviewMemo householdId={householdId} month={month} />{monthlyExportNotice && <p role="status">{monthlyExportNotice}</p>}</> : <section className="panel report-loading"><FileText size={28} /><p>{notice || '月次比較レポートを読み込んでいます…'}</p></section>
      : view === 'ANNUAL' ? annualReport ? <><AnnualReviewView data={annualReport} savingCsv={annualCsvSaving} savingXlsx={annualXlsxSaving} savingPdf={annualPdfSaving} onSelectDriver={() => openPage('transactions')} onOpenBudget={() => openPage('budgets')} onOpenImports={() => openPage('import')} onOpenReconciliation={() => openPage('cards')} onSaveCsv={() => void saveAnnualCsv()} onSaveXlsx={() => void saveAnnualXlsx()} onSavePdf={() => void saveAnnualPdf()} />{annualNotice && <p role="status">{annualNotice}</p>}</> : <section className="panel report-loading"><FileText size={28} /><p>{annualNotice || '前年同期間と年次推移を比較しています…'}</p></section>
      : view === 'FORECAST' ? forecast ? <ForecastActionViews data={forecast} onAction={(action: ActionItemDto) => openPage(pageForAction(action))} /> : <section className="panel report-loading"><TrendingUp size={28} /><p>{notice || '予測とアクションを読み込んでいます…'}</p></section>
        : view === 'INTELLIGENCE' ? <FinancialIntelligencePanel householdId={householdId} accountGroupId={accountGroupId} attributionScope={attributionScope} month={month} revision={revision} preferenceRevision={recurringPreferenceRevision} openTransactions={() => openPage('transactions')} onDecisionChanged={() => setRecurringPreferenceRevision((value) => value + 1)} />
          : view === 'FIXED_COST' ? <FixedCostReviewPanel householdId={householdId} accountGroupId={accountGroupId} attributionScope={attributionScope} month={month} revision={revision} preferenceRevision={recurringPreferenceRevision} openTransactions={() => openPage('transactions')} />
            : <AccountGroupsExportPanel householdId={householdId} accounts={accounts} month={month} groups={accountGroups} selectedAccountGroupId={accountGroupId} attributionScope={attributionScope} onGroupsChanged={onGroupsChanged} />
  const reportGroupId = view === 'CALENDAR' ? 'report-tab-calendar' : view === 'MONTHLY' || view === 'ANNUAL' ? 'report-tab-review' : view === 'EXPORT' ? 'report-tab-export' : 'report-tab-analysis'
  const reportBody = <section id="report-tabpanel" role="tabpanel" aria-labelledby={reportGroupId} tabIndex={0}>{reportBodyContent}</section>
  return <><PageHeader eyebrow="家計レビュー" title="カレンダー・レポート" description="計算対象の確定台帳（集計対象外を除く）を日次、月次、年次、予測、定期支出・異常支出の視点で確認します。"><ReportTabs view={view} onChange={setView} /></PageHeader><ReportSubTabs view={view} onChange={setView} />{reportBody}</>
}

function BudgetsPage({ householdId, accounts, month, revision, onChanged }: { householdId: string | null; accounts: readonly AccountDto[]; month: string; revision: number; onChanged: () => void }) {
  const desktop = platformClient.runtime === 'tauri'
  const [budgets, setBudgets] = useState<readonly MonthlyCategoryBudgetDto[]>([])
  const [goals, setGoals] = useState<readonly SavingsGoalDto[]>([])
  const [budgetAccountId, setBudgetAccountId] = useState('')
  const [budgetAmount, setBudgetAmount] = useState('')
  const [showGoalForm, setShowGoalForm] = useState(false)
  const [goalName, setGoalName] = useState('')
  const [goalTarget, setGoalTarget] = useState('')
  const [goalDate, setGoalDate] = useState(`${Number(month.slice(0, 4)) + 1}-${month.slice(5)}-01`)
  const [goalDrafts, setGoalDrafts] = useState<Record<string, string>>({})
  const [notice, setNotice] = useState('')
  const [busy, setBusy] = useState(false)
  const expenseAccounts = accounts.filter((account) => account.accountKind === 'EXPENSE')

  const reload = async () => {
    if (!desktop || !householdId) return
    const [nextBudgets, nextGoals] = await Promise.all([platformClient.listBudgets(householdId, month), platformClient.listSavingsGoals(householdId)])
    setBudgets(nextBudgets); setGoals(nextGoals)
    setGoalDrafts(Object.fromEntries(nextGoals.map((goal) => [goal.id, String(goal.savedJpy)])))
    setBudgetAccountId((current) => current || expenseAccounts[0]?.id || '')
  }

  useEffect(() => { void reload().catch(() => { setBudgets([]); setGoals([]); setNotice('予算と目標を読み込めませんでした。') }) }, [desktop, householdId, month, revision]) // eslint-disable-line react-hooks/exhaustive-deps

  const saveBudget = async () => {
    if (!householdId || !budgetAccountId || !/^\d+$/.test(budgetAmount)) { setNotice('カテゴリーと0円以上の予算を入力してください。'); return }
    setBusy(true); setNotice('')
    try { await platformClient.upsertBudget({ householdId, month, categoryAccountId: budgetAccountId, budgetJpy: Number(budgetAmount) }); await reload(); onChanged(); setBudgetAmount(''); setNotice('月間予算を保存しました。') }
    catch { setNotice('月間予算を保存できませんでした。') }
    finally { setBusy(false) }
  }

  const createGoal = async () => {
    if (!householdId || !goalName.trim() || !/^\d+$/.test(goalTarget) || Number(goalTarget) <= 0) { setNotice('目標名と1円以上の目標額を入力してください。'); return }
    setBusy(true); setNotice('')
    try { await platformClient.createSavingsGoal({ id: crypto.randomUUID(), householdId, name: goalName.trim(), targetJpy: Number(goalTarget), savedJpy: 0, targetDate: goalDate, status: 'ACTIVE' }); await reload(); onChanged(); setGoalName(''); setGoalTarget(''); setShowGoalForm(false); setNotice('貯蓄目標を追加しました。') }
    catch { setNotice('貯蓄目標を追加できませんでした。') }
    finally { setBusy(false) }
  }

  const updateGoal = async (goal: SavingsGoalDto) => {
    const saved = goalDrafts[goal.id]
    if (!/^\d+$/.test(saved ?? '')) { setNotice('貯蓄済み金額を0円以上で入力してください。'); return }
    setBusy(true)
    try { await platformClient.updateSavingsGoal({ id: goal.id, householdId: goal.householdId, name: goal.name, targetJpy: goal.targetJpy, savedJpy: Number(saved), targetDate: goal.targetDate, status: Number(saved) >= goal.targetJpy ? 'COMPLETED' : goal.status === 'COMPLETED' ? 'ACTIVE' : goal.status }); await reload(); onChanged(); setNotice('貯蓄額を更新しました。') }
    catch { setNotice('貯蓄額を更新できませんでした。') }
    finally { setBusy(false) }
  }

  const deleteGoal = async (goal: SavingsGoalDto) => {
    setBusy(true)
    try { await platformClient.deleteSavingsGoal(goal.householdId, goal.id); await reload(); onChanged(); setNotice('貯蓄目標を削除しました。') }
    catch { setNotice('貯蓄目標を削除できませんでした。') }
    finally { setBusy(false) }
  }

  if (!desktop) {
    const demoGoals = [{ name: '家族旅行', saved: 362_000, target: 600_000, date: '2027-03-31', pace: 22_800 }, { name: '教育資金', saved: 1_480_000, target: 3_000_000, date: '2030-04-01', pace: 33_100 }]
    return <><PageHeader eyebrow="プランニング" title="予算・貯蓄目標" description="計画値と確定済み元帳を比較し、家族の目標を追跡します。" /><section className="budget-layout"><article className="panel budget-panel"><div className="panel-head"><div><h2>カテゴリー予算</h2><p>2026年7月</p></div><strong>{yen(budgetByCategory.reduce((sum, item) => sum + item.amount, 0))}</strong></div>{budgetByCategory.map((item) => { const rate = Math.round(item.amount / item.budget * 100); return <div className={`budget-row budget-row-${rate > 100 ? 'over' : rate > 85 ? 'review' : 'ok'}`} key={item.name}><div><strong>{item.name}</strong><small>{rate > 100 ? `⚠ 超過 ${rate - 100}%` : `${rate}%`}</small></div><span>{yen(item.amount)} <small>/ {yen(item.budget)}</small></span><div className="progress"><span style={{ width: `${Math.min(100, rate)}%` }} /></div></div>})}<p className="budget-caption">予算=計画値 / 実績=確定済み元帳値（発生ベース）</p></article><article className="panel goal-panel"><div className="panel-head"><div><h2>貯蓄目標</h2><p>{demoGoals.length}件進行中</p></div><Goal size={19} /></div>{demoGoals.map((goal) => <div className="goal-editor demo-goal" key={goal.name}><div><strong>{goal.name}</strong><small>目標日 {goal.date}</small></div><span>{yen(goal.saved)} / {yen(goal.target)}</span><div className="progress"><span style={{ width: `${goal.saved / goal.target * 100}%` }} /></div><p>必要ペース: {yen(goal.pace)} / 月 — <b>順調</b></p></div>)}</article></section></>
  }

  const totalBudget = budgets.reduce((sum, budget) => sum + budget.budgetJpy, 0)
  const totalActual = budgets.reduce((sum, budget) => sum + budget.actualJpy, 0)
  const palette = ['#ed714d', '#6f7d57', '#e4aa45', '#7f9ba5']
  const goalPace = (goal: SavingsGoalDto) => {
    const remaining = Math.max(0, goal.targetJpy - goal.savedJpy)
    const today = new Date(); today.setHours(0, 0, 0, 0)
    const target = new Date(`${goal.targetDate}T00:00:00`)
    const days = Math.ceil((target.getTime() - today.getTime()) / 86_400_000)
    const months = Math.max(1, Math.ceil(Math.max(0, days) / (365.25 / 12)))
    return { remaining, months, monthly: remaining === 0 ? 0 : Math.ceil(remaining / months), overdue: days < 0 && remaining > 0 }
  }
  return <>
    <PageHeader eyebrow={`${month.replace('-', '年')}月`} title="予算・貯蓄目標" description="確定済み台帳の支出と月間予算を比較します。"><button className="primary-btn" onClick={() => setShowGoalForm((value) => !value)}><Goal size={17} /> 目標を追加</button></PageHeader>
    {notice && <div className="import-notice" role="status">{notice}</div>}
    {showGoalForm && <section className="panel planning-form"><input aria-label="目標名" value={goalName} onChange={(event) => setGoalName(event.target.value)} placeholder="家族旅行" /><input aria-label="目標額" type="number" min="1" value={goalTarget} onChange={(event) => setGoalTarget(event.target.value)} placeholder="1000000" /><input aria-label="目標日" type="date" value={goalDate} onChange={(event) => setGoalDate(event.target.value)} /><button className="primary-btn" disabled={busy} onClick={() => void createGoal()}>保存</button></section>}
    <section className="budget-layout"><article className="panel budget-panel"><div className="panel-head"><div><h2>カテゴリー予算</h2><p>{budgets.length}カテゴリー</p></div><strong>{yen(totalActual)} / {yen(totalBudget)}</strong></div><div className="planning-form"><select aria-label="予算カテゴリー" value={budgetAccountId} onChange={(event) => setBudgetAccountId(event.target.value)}><option value="">カテゴリーを選択</option>{expenseAccounts.map((account) => <option key={account.id} value={account.id}>{account.name}</option>)}</select><input aria-label="月間予算" type="number" min="0" value={budgetAmount} onChange={(event) => setBudgetAmount(event.target.value)} placeholder="50000" /><button className="secondary-btn" disabled={busy || expenseAccounts.length === 0} onClick={() => void saveBudget()}>予算を保存</button></div>{budgets.length === 0 ? <p className="empty-state">カテゴリー予算はまだありません。</p> : budgets.map((budget, index) => <div className="budget-row" key={budget.categoryAccountId}><div><i style={{ background: palette[index % palette.length] }} /><strong>{budget.categoryName}</strong></div><span>{yen(budget.actualJpy)} <small>/ {yen(budget.budgetJpy)}</small></span><div className="progress"><span style={{ width: `${budget.budgetJpy === 0 ? 100 : Math.min(100, budget.actualJpy / budget.budgetJpy * 100)}%`, background: budget.remainingJpy < 0 ? '#c95b4c' : palette[index % palette.length] }} /></div></div>)}</article><article className="panel goal-panel"><div className="panel-head"><div><h2>貯蓄目標</h2><p>{goals.filter((goal) => goal.status === 'ACTIVE').length}件進行中</p></div><Sparkles size={20} /></div>{goals.length === 0 ? <p className="empty-state">貯蓄目標はまだありません。</p> : goals.map((goal) => { const pace = goalPace(goal); return <div className={`goal-editor goal-editor-${pace.overdue ? 'overdue' : goal.status.toLowerCase()}`} key={goal.id}><strong>{goal.name}</strong><span>{yen(goal.savedJpy)} / {yen(goal.targetJpy)} ・ 目標日 {goal.targetDate}</span><div className="progress"><span style={{ width: `${Math.min(100, goal.savedJpy / goal.targetJpy * 100)}%` }} /></div><p className="goal-pace">{pace.remaining === 0 ? <b>目標達成</b> : pace.overdue ? <b>期限超過・残り {yen(pace.remaining)}</b> : <>必要ペース: <b>{yen(pace.monthly)} / 月</b>・残り {pace.months}か月</>}</p><div><input aria-label={`${goal.name}の貯蓄済み金額`} type="number" min="0" value={goalDrafts[goal.id] ?? ''} onChange={(event) => setGoalDrafts((current) => ({ ...current, [goal.id]: event.target.value }))} /><button className="secondary-btn" disabled={busy} onClick={() => void updateGoal(goal)}>更新</button><button className="text-btn" disabled={busy} onClick={() => void deleteGoal(goal)}>削除</button></div></div> })}</article></section>
  </>
}

function RulesPage({ householdId, accounts }: { householdId: string | null; accounts: readonly AccountDto[] }) {
  const [rules, setRules] = useState<readonly ClassificationRuleDto[]>([])
  const [lastApplication, setLastApplication] = useState<LastClassificationApplicationDto | null>(null)
  const [name, setName] = useState('')
  const [merchant, setMerchant] = useState('')
  const [description, setDescription] = useState('')
  const [categoryAccountId, setCategoryAccountId] = useState('')
  const [labels, setLabels] = useState('')
  const [tags, setTags] = useState('')
  const [priority, setPriority] = useState('100')
  const [busy, setBusy] = useState(false)
  const [notice, setNotice] = useState('')
  const expenseAccounts = accounts.filter((account) => account.accountKind === 'EXPENSE')

  const reload = async () => {
    if (!householdId || platformClient.runtime !== 'tauri') return
    const [nextRules, latest] = await Promise.all([platformClient.listClassificationRules(householdId), platformClient.getLastClassificationApplication(householdId)])
    setRules(nextRules); setLastApplication(latest)
    setCategoryAccountId((current) => current || expenseAccounts[0]?.id || '')
  }
  useEffect(() => { void reload().catch(() => setNotice('分類ルールを読み込めませんでした。')) }, [householdId]) // eslint-disable-line react-hooks/exhaustive-deps

  const createRule = async () => {
    const parsedPriority = Number(priority)
    if (!householdId || !name.trim() || (!merchant.trim() && !description.trim()) || !categoryAccountId || !Number.isSafeInteger(parsedPriority) || parsedPriority < 0) {
      setNotice('ルール名、照合条件、カテゴリー、優先度を確認してください。'); return
    }
    setBusy(true); setNotice('')
    try {
      await platformClient.createClassificationRule({
        id: crypto.randomUUID(), householdId, name: name.trim(), priority: parsedPriority, isEnabled: true,
        merchantContains: merchant.trim() || null, descriptionContains: description.trim() || null, categoryAccountId,
        labels: labels.split(',').map((value) => value.trim()).filter(Boolean), tags: tags.split(',').map((value) => value.trim().replace(/^#/, '')).filter(Boolean),
      })
      setName(''); setMerchant(''); setDescription(''); setLabels(''); setTags(''); await reload(); setNotice('分類ルールを保存しました。')
    } catch { setNotice('分類ルールを保存できませんでした。') }
    finally { setBusy(false) }
  }

  const toggleRule = async (rule: ClassificationRuleDto) => {
    setBusy(true)
    try { await platformClient.updateClassificationRule({ ...rule, isEnabled: !rule.isEnabled }); await reload() }
    catch { setNotice('ルールの状態を変更できませんでした。') }
    finally { setBusy(false) }
  }
  const deleteRule = async (rule: ClassificationRuleDto) => {
    if (!householdId) return
    setBusy(true)
    try { await platformClient.deleteClassificationRule(householdId, rule.id); await reload(); setNotice('分類ルールを削除しました。') }
    catch { setNotice('分類ルールを削除できませんでした。') }
    finally { setBusy(false) }
  }
  const displayedRules: readonly ClassificationRuleDto[] = platformClient.runtime === 'web' ? [
    { id: 'demo-grocery', householdId: 'demo', name: 'スーパーを食費へ', priority: 10, isEnabled: true, merchantContains: '成城石井, サミット', descriptionContains: null, categoryAccountId: 'food', categoryName: '食費', labels: ['共通支出'], tags: ['日常'], createdAt: '', updatedAt: '' },
    { id: 'demo-utilities', householdId: 'demo', name: '電気料金', priority: 20, isEnabled: true, merchantContains: '東京電力', descriptionContains: '電気料金', categoryAccountId: 'utilities', categoryName: '住居・光熱', labels: ['定期'], tags: [], createdAt: '', updatedAt: '' },
    { id: 'demo-legacy', householdId: 'demo', name: '旧コンビニ分類', priority: 90, isEnabled: false, merchantContains: 'コンビニ', descriptionContains: null, categoryAccountId: 'food', categoryName: '食費', labels: [], tags: [], createdAt: '', updatedAt: '' },
  ] : rules
  const displayedApplication: LastClassificationApplicationDto | null = platformClient.runtime === 'web' ? {
    transactionId: 'demo', payee: '成城石井', description: null, ruleId: 'demo-grocery', ruleName: 'スーパーを食費へ', rulePriority: 10,
    merchantContains: '成城石井', descriptionContains: null, categoryAccountId: 'food', categoryName: '食費', labels: ['共通支出'], tags: ['日常'], appliedAt: '2026-07-16T09:00:00Z',
  } : lastApplication
  const createFromApplication = () => {
    if (!displayedApplication) return
    setName(`${displayedApplication.payee ?? displayedApplication.ruleName}の分類`)
    setMerchant(displayedApplication.payee ?? displayedApplication.merchantContains ?? '')
    setDescription(displayedApplication.descriptionContains ?? '')
    if (expenseAccounts.some((account) => account.id === displayedApplication.categoryAccountId)) setCategoryAccountId(displayedApplication.categoryAccountId)
    setLabels(displayedApplication.labels.join(', ')); setTags(displayedApplication.tags.join(', '))
    globalThis.scrollTo({ top: 0, behavior: 'smooth' })
  }

  return <><PageHeader eyebrow="自動化" title="分類ルール" description="店舗名や摘要に一致する取引へ、説明可能なカテゴリー・ラベル・タグを適用します。" />
    {notice && <div className="import-notice" role="status">{notice}</div>}
    {platformClient.runtime === 'tauri' && <section className="panel rule-builder"><div className="panel-head"><div><h2>新しいルール</h2><p>条件と分類結果を設定します。優先度の小さいルールから評価します。</p></div></div><div className="rule-form"><label className="rule-field rule-field--name"><span>ルール名</span><input aria-label="ルール名" value={name} onChange={(event) => setName(event.target.value)} placeholder="コンビニを食費に分類" /></label><label className="rule-field"><span>店舗名の条件</span><input aria-label="店舗名の条件" value={merchant} onChange={(event) => setMerchant(event.target.value)} placeholder="店舗名に含む文字" /></label><label className="rule-field"><span>摘要の条件</span><input aria-label="摘要の条件" value={description} onChange={(event) => setDescription(event.target.value)} placeholder="摘要に含む文字（任意）" /></label><label className="rule-field rule-field--category"><span>分類先カテゴリー</span><select aria-label="分類先カテゴリー" value={categoryAccountId} onChange={(event) => setCategoryAccountId(event.target.value)}><option value="">カテゴリーを選択</option>{expenseAccounts.map((account) => <option key={account.id} value={account.id}>{account.name}</option>)}</select></label><label className="rule-field"><span>ラベル</span><input aria-label="ラベル" value={labels} onChange={(event) => setLabels(event.target.value)} placeholder="subscription, tax deductible" /></label><label className="rule-field"><span>タグ</span><input aria-label="タグ" value={tags} onChange={(event) => setTags(event.target.value)} placeholder="#family, #trip" /></label><label className="rule-field rule-field--priority"><span>優先度</span><input aria-label="ルール優先度" type="number" min="0" value={priority} onChange={(event) => setPriority(event.target.value)} /></label><button className="primary-btn rule-save" disabled={busy || expenseAccounts.length === 0} onClick={() => void createRule()}>ルールを保存</button></div></section>}
    <div className="rules-workspace"><section className="panel rule-list"><div className="panel-head"><div><h2>保存済みルール</h2><p>{displayedRules.length}件・優先度順</p></div></div><div className="rule-table-head"><span>優先</span><span>ルール名・条件</span><span>結果</span><span>状態</span></div>{displayedRules.length === 0 ? <p className="empty-state">分類ルールはまだありません。</p> : displayedRules.map((rule) => <article key={rule.id} className={rule.isEnabled ? '' : 'disabled'}><b>{rule.priority}</b><div><strong>{rule.name}</strong><code>{[rule.merchantContains && `店名 ⊃ [${rule.merchantContains}]`, rule.descriptionContains && `摘要 ⊃ [${rule.descriptionContains}]`].filter(Boolean).join(' AND ')}</code></div><div><strong>{rule.categoryName}</strong><span className="rule-chips">{rule.labels.map((label) => <span key={`l-${label}`}>{label}</span>)}{rule.tags.map((tag) => <span key={`t-${tag}`}>#{tag}</span>)}</span></div><button role="switch" aria-checked={rule.isEnabled} className="rule-switch" disabled={busy || platformClient.runtime === 'web'} onClick={() => void toggleRule(rule)}><span />{rule.isEnabled ? '有効' : '無効'}</button>{platformClient.runtime === 'tauri' && <button className="text-btn" disabled={busy} onClick={() => void deleteRule(rule)}>削除</button>}</article>)}</section><aside className="panel rule-explanation"><div className="panel-head"><div><h2>なぜ一致したか</h2><p>最後に適用した分類</p></div><FileCheck2 size={18} /></div>{displayedApplication ? <><dl><div><dt>取引</dt><dd>{displayedApplication.payee ?? displayedApplication.description ?? displayedApplication.transactionId}</dd></div><div><dt>一致条件</dt><dd><code>{[displayedApplication.merchantContains && `店名 ⊃ [${displayedApplication.merchantContains}]`, displayedApplication.descriptionContains && `摘要 ⊃ [${displayedApplication.descriptionContains}]`].filter(Boolean).join(' AND ') || '保存済み条件'}</code></dd></div><div><dt>採用ルール</dt><dd>{displayedApplication.ruleName}{displayedApplication.rulePriority == null ? '' : `（優先度 ${displayedApplication.rulePriority}）`}</dd></div><div><dt>結果</dt><dd>{[displayedApplication.categoryName, ...displayedApplication.labels, ...displayedApplication.tags.map((tag) => `#${tag}`)].join(' ・ ')}</dd></div><div><dt>適用日時</dt><dd>{new Date(displayedApplication.appliedAt).toLocaleString('ja-JP')}</dd></div></dl><p>ルール適用履歴から読み込んだ結果です。信頼度スコアによる自動確定は行いません。</p><button className="primary-btn" disabled={platformClient.runtime === 'web'} onClick={createFromApplication}>修正からルールを作成</button></> : <div className="rule-explanation-empty"><p>まだ分類ルールの適用履歴がありません。</p><small>取引詳細からルールを適用すると、採用条件と結果がここに残ります。</small></div>}</aside></div>
  </>
}

function AccountEditor({ householdId, account, members, onChanged, setNotice }: { householdId: string; account: AccountDto; members: readonly HouseholdMemberDto[]; onChanged: () => Promise<void>; setNotice: (notice: string) => void }) {
  const [name, setName] = useState(account.name)
  const [owner, setOwner] = useState(account.ownerMemberId ?? 'HOUSEHOLD')
  const [visibility, setVisibility] = useState<AccountVisibilityDto>(account.visibility)
  const [busy, setBusy] = useState(false)
  const rename = async () => { if (!name.trim()) return; setBusy(true); try { await platformClient.renameAccount({ householdId, accountId: account.id, name: name.trim() }); await onChanged(); setNotice('口座名を更新しました。') } catch { setNotice('口座名を更新できませんでした。') } finally { setBusy(false) } }
  const updateOwnership = async () => {
    const ownershipKind: AccountOwnershipKindDto = owner === 'HOUSEHOLD' ? 'HOUSEHOLD' : 'MEMBER'
    setBusy(true)
    try { await platformClient.updateAccountOwnership({ householdId, accountId: account.id, ownershipKind, ownerMemberId: owner === 'HOUSEHOLD' ? null : owner, visibility }); await onChanged(); setNotice('口座の所有者と共有区分を更新しました。') }
    catch { setNotice('口座の所有者と共有区分を更新できませんでした。') }
    finally { setBusy(false) }
  }
  const archive = async () => { setBusy(true); try { await platformClient.archiveAccount({ householdId, accountId: account.id }); await onChanged(); setNotice('未使用の口座をアーカイブしました。') } catch { setNotice('この口座は台帳・取込・予算で使用中、または必須口座のためアーカイブできません。') } finally { setBusy(false) } }
  const ownershipChanged = owner !== (account.ownerMemberId ?? 'HOUSEHOLD') || visibility !== account.visibility
  return <div className="account-editor"><span>{account.accountKind} / {account.accountSubtype}</span><input aria-label={`${account.name}の口座名`} value={name} onChange={(event) => setName(event.target.value)} /><label>所有者<select aria-label={`${account.name}の所有者`} value={owner} onChange={(event) => { const next = event.target.value; setOwner(next); if (next === 'HOUSEHOLD') setVisibility('SHARED') }}><option value="HOUSEHOLD">世帯共有</option>{members.filter((member) => member.status === 'ACTIVE' || member.id === account.ownerMemberId).map((member) => <option key={member.id} value={member.id}>{member.displayName}{member.status === 'ARCHIVED' ? '（アーカイブ済み）' : ''}</option>)}</select></label><label>共有区分<select aria-label={`${account.name}の共有区分`} disabled={owner === 'HOUSEHOLD'} value={visibility} onChange={(event) => setVisibility(event.target.value as AccountVisibilityDto)}><option value="SHARED">共有</option>{owner !== 'HOUSEHOLD' && <option value="PERSONAL">個人</option>}</select></label><div className="account-classification"><span>{account.ownerMemberName ?? '世帯共有'}</span><span>{account.visibility === 'SHARED' ? '共有' : '個人'}</span></div><button className="secondary-btn" disabled={busy || name.trim() === account.name} onClick={() => void rename()}>名前を保存</button><button className="secondary-btn" disabled={busy || !ownershipChanged} onClick={() => void updateOwnership()}>区分を保存</button><button className="text-btn" disabled={busy} onClick={() => void archive()}>アーカイブ</button></div>
}

function SettingsPage({ householdId, accounts, members, preferences, onPreferencesChanged, onAccountsChanged }: { householdId: string | null; accounts: readonly AccountDto[]; members: readonly HouseholdMemberDto[]; preferences: DashboardPreferencesDto; onPreferencesChanged: (change: DashboardPreferenceChange) => void; onAccountsChanged: () => Promise<void> }) {
  const { locale, setLocale } = useI18n()
  const [passphrase, setPassphrase] = useState('')
  const [confirmation, setConfirmation] = useState('')
  const [notice, setNotice] = useState('')
  const [busy, setBusy] = useState(false)
  const [restorePassphrase, setRestorePassphrase] = useState('')
  const [restoreConfirmation, setRestoreConfirmation] = useState('')
  const [restoreNotice, setRestoreNotice] = useState('')
  const [restoreBusy, setRestoreBusy] = useState(false)
  const [accountNotice, setAccountNotice] = useState('')
  const [accountName, setAccountName] = useState('')
  const [accountKind, setAccountKind] = useState<AccountDto['accountKind']>('ASSET')
  const [accountSubtype, setAccountSubtype] = useState<AccountDto['accountSubtype']>('BANK')
  const [accountOwner, setAccountOwner] = useState('HOUSEHOLD')
  const [accountVisibility, setAccountVisibility] = useState<AccountVisibilityDto>('SHARED')
  const [accountBusy, setAccountBusy] = useState(false)
  const subtypes: Record<AccountDto['accountKind'], readonly AccountDto['accountSubtype'][]> = { ASSET: ['BANK', 'CASH', 'WALLET', 'SECURITIES', 'RECEIVABLE', 'OTHER'], LIABILITY: ['CREDIT_CARD', 'OTHER'], EQUITY: ['OTHER'], INCOME: ['OTHER'], EXPENSE: ['OTHER'] }

  const createAccount = async () => {
    if (!householdId || !accountName.trim()) { setAccountNotice('口座名を入力してください。'); return }
    setAccountBusy(true); setAccountNotice('')
    try { await platformClient.createAccount({ id: `${householdId}-${crypto.randomUUID()}`, householdId, name: accountName.trim(), accountKind, accountSubtype, currency: 'JPY', ownershipKind: accountOwner === 'HOUSEHOLD' ? 'HOUSEHOLD' : 'MEMBER', ownerMemberId: accountOwner === 'HOUSEHOLD' ? null : accountOwner, visibility: accountVisibility }); await onAccountsChanged(); setAccountName(''); setAccountNotice('口座を追加しました。') }
    catch { setAccountNotice('口座を追加できませんでした。名前と種類を確認してください。') }
    finally { setAccountBusy(false) }
  }

  const createBackup = async () => {
    if (passphrase.length < 12) { setNotice('12文字以上のパスフレーズを入力してください。'); return }
    if (passphrase !== confirmation) { setNotice('パスフレーズが一致しません。'); return }
    setBusy(true); setNotice('')
    try {
      const result = await platformClient.createBackup(passphrase)
      if (!result) return
      setPassphrase(''); setConfirmation('')
      setNotice(`Portable v${result.formatVersion} ・ ${result.entryCount}件・${(result.plaintextBytes / 1024 / 1024).toFixed(1)} MB の暗号化バックアップを作成しました。`)
    } catch {
      setNotice('バックアップを作成できませんでした。保存先とパスフレーズを確認してください。')
    } finally { setBusy(false) }
  }

  const restoreBackup = async () => {
    if (restorePassphrase.length < 12) { setRestoreNotice('バックアップ作成時の12文字以上のパスフレーズを入力してください。'); return }
    if (restorePassphrase !== restoreConfirmation) { setRestoreNotice('復元用パスフレーズが一致しません。'); return }
    setRestoreBusy(true); setRestoreNotice('')
    try {
      const result = await platformClient.stageBackupRestore(restorePassphrase)
      if (!result) { setRestoreBusy(false); return }
      setRestorePassphrase(''); setRestoreConfirmation('')
      setRestoreNotice(`Portable v${result.formatVersion} の復元準備が完了しました。安全に再起動します…`)
    } catch {
      setRestoreNotice('バックアップを復元できませんでした。ファイルとパスフレーズを確認してください。現在のデータは変更されていません。')
      setRestoreBusy(false)
      return
    }
    try {
      await platformClient.restartForRestore()
    } catch {
      setRestoreNotice('復元準備は完了しています。復元を適用するため、KakeFlowを終了してもう一度起動してください。')
      setRestoreBusy(false)
    }
  }

  return <><PageHeader eyebrow="ローカルデータ" title="設定" description="口座、表示環境、バックアップを管理します。" /><section className="panel preferences-panel"><div className="panel-head"><div><h2>環境設定</h2><p>言語、テーマ、画面密度はこの端末に保存されます。</p></div></div><div className="preference-row"><span><strong>言語</strong><small>Language / Ngôn ngữ</small></span><div className="settings-segment" role="group" aria-label="言語">{([['ja', '日本語'], ['en', 'English'], ['vi', 'Tiếng Việt']] as const).map(([value, label]) => <button key={value} className={locale === value ? 'active' : ''} aria-pressed={locale === value} onClick={() => setLocale(value)}>{label}</button>)}</div></div><div className="preference-row"><span><strong>テーマ</strong><small>外観</small></span><div className="settings-segment" role="group" aria-label="テーマ">{([['LIGHT', 'ライト'], ['DARK', 'ダーク'], ['SYSTEM', 'システム']] as const).map(([value, label]) => <button key={value} className={preferences.theme === value ? 'active' : ''} aria-pressed={preferences.theme === value} onClick={() => onPreferencesChanged({ theme: value })}>{label}</button>)}</div></div><div className="preference-row"><span><strong>密度</strong><small>一覧とカードの間隔</small></span><div className="settings-segment" role="group" aria-label="画面密度">{([['COMFORTABLE', '標準'], ['COMPACT', 'コンパクト']] as const).map(([value, label]) => <button key={value} className={preferences.density === value ? 'active' : ''} aria-pressed={preferences.density === value} onClick={() => onPreferencesChanged({ density: value })}>{label}</button>)}</div></div></section><section className="panel account-settings"><div className="panel-head"><div><h2>口座・カテゴリー</h2><p>銀行、ウォレット、カード、収入・支出カテゴリーを管理します。</p></div></div><p className="account-visibility-note">「個人」はこの端末内の整理区分であり、閲覧制限やアクセス制御ではありません。</p>{platformClient.runtime === 'tauri' && householdId ? <><div className="planning-form account-create-form"><input aria-label="新しい口座名" value={accountName} onChange={(event) => setAccountName(event.target.value)} placeholder="ゆうちょ銀行" /><select aria-label="口座種別" value={accountKind} onChange={(event) => { const kind = event.target.value as AccountDto['accountKind']; setAccountKind(kind); setAccountSubtype(subtypes[kind][0]) }}>{Object.keys(subtypes).map((kind) => <option key={kind}>{kind}</option>)}</select><select aria-label="口座サブタイプ" value={accountSubtype} onChange={(event) => setAccountSubtype(event.target.value as AccountDto['accountSubtype'])}>{subtypes[accountKind].map((subtype) => <option key={subtype}>{subtype}</option>)}</select><select aria-label="新しい口座の所有者" value={accountOwner} onChange={(event) => { const next = event.target.value; setAccountOwner(next); if (next === 'HOUSEHOLD') setAccountVisibility('SHARED') }}><option value="HOUSEHOLD">世帯共有</option>{members.filter((member) => member.status === 'ACTIVE').map((member) => <option key={member.id} value={member.id}>{member.displayName}</option>)}</select><select aria-label="新しい口座の共有区分" disabled={accountOwner === 'HOUSEHOLD'} value={accountVisibility} onChange={(event) => setAccountVisibility(event.target.value as AccountVisibilityDto)}><option value="SHARED">共有</option>{accountOwner !== 'HOUSEHOLD' && <option value="PERSONAL">個人</option>}</select><button className="primary-btn" disabled={accountBusy} onClick={() => void createAccount()}>口座を追加</button></div><div className="account-list">{accounts.map((account) => <AccountEditor key={account.id} householdId={householdId} account={account} members={members} onChanged={onAccountsChanged} setNotice={setAccountNotice} />)}</div>{accountNotice && <p role="status">{accountNotice}</p>}</> : <p className="empty-state">口座管理はデスクトップ版で利用できます。</p>}</section><section className="panel settings-panel"><div><h2>暗号化バックアップ</h2><p>SQLCipher台帳と暗号化済み原本を、認証付きアーカイブに保存します。パスフレーズを失うと復元できません。</p></div><div className="backup-form"><label htmlFor="backup-passphrase">パスフレーズ</label><input id="backup-passphrase" type="password" autoComplete="new-password" value={passphrase} onChange={(event) => setPassphrase(event.target.value)} placeholder="12文字以上" /><label htmlFor="backup-confirmation">パスフレーズを確認</label><input id="backup-confirmation" type="password" autoComplete="new-password" value={confirmation} onChange={(event) => setConfirmation(event.target.value)} /><button className="primary-btn" disabled={busy || platformClient.runtime !== 'tauri'} onClick={() => void createBackup()}>{busy ? 'データを固定中…' : 'バックアップを作成'}</button>{platformClient.runtime === 'web' && <small>デスクトップ版で利用できます。</small>}{notice && <p role="status">{notice}</p>}</div></section><section className="panel settings-panel restore-panel"><div><h2>バックアップから復元</h2><p><strong>注意:</strong> 現在の台帳と原本は、選択したバックアップの内容に置き換わります。復元前に現在のバックアップを作成してください。置き換えの最終確認はOSのダイアログで行います。</p></div><div className="backup-form"><label htmlFor="restore-passphrase">復元用パスフレーズ</label><input id="restore-passphrase" type="password" autoComplete="off" value={restorePassphrase} onChange={(event) => setRestorePassphrase(event.target.value)} placeholder="バックアップ作成時のパスフレーズ" /><label htmlFor="restore-confirmation">復元用パスフレーズを確認</label><input id="restore-confirmation" type="password" autoComplete="off" value={restoreConfirmation} onChange={(event) => setRestoreConfirmation(event.target.value)} /><button className="danger-btn" disabled={restoreBusy || platformClient.runtime !== 'tauri'} onClick={() => void restoreBackup()}>{restoreBusy ? 'バックアップを検証中…' : 'バックアップを選択して復元'}</button>{platformClient.runtime === 'web' && <small>復元はデスクトップ版で利用できます。</small>}{restoreNotice && <p role="status">{restoreNotice}</p>}</div></section></>
}

function Onboarding({ onCreated, onCancel }: { onCreated: (household: HouseholdDto) => void; onCancel?: () => void }) {
  const [name, setName] = useState('')
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)

  const submit = async (event: React.FormEvent) => {
    event.preventDefault()
    const trimmed = name.trim()
    if (!trimmed) {
      setError('世帯名を入力してください。')
      return
    }
    setBusy(true)
    setError('')
    try {
      const id = globalThis.crypto.randomUUID()
      onCreated(platformClient.runtime === 'web' ? { id, name: trimmed, baseCurrency: 'JPY', createdAt: new Date().toISOString() } : await platformClient.createHousehold({ id, name: trimmed }))
    } catch {
      setError('世帯を作成できませんでした。もう一度お試しください。')
    } finally {
      setBusy(false)
    }
  }

  return <div className="onboarding-backdrop"><section className="onboarding-card" role="dialog" aria-modal="true" aria-labelledby="onboarding-title">{onCancel && <button className="icon-btn onboarding-close" aria-label="閉じる" onClick={onCancel}><X size={18} /></button>}<div className="brand-mark"><Leaf size={22} /></div><p>KakeFlowへようこそ</p><h1 id="onboarding-title">家計簿をはじめましょう</h1><span>データはこの端末で暗号化して保存されます。</span><form onSubmit={(event) => void submit(event)}><label htmlFor="household-name">世帯名</label><input id="household-name" autoFocus maxLength={80} value={name} onChange={(event) => setName(event.target.value)} placeholder="例：田中家" />{error && <small role="alert">{error}</small>}<button className="primary-btn" disabled={busy}>{busy ? '作成中…' : '安全な家計簿を作成'}</button></form></section></div>
}

function defaultDashboardPreferences(householdId = ''): DashboardPreferencesDto {
  return {
    householdId,
    template: 'FINANCIAL_OVERVIEW',
    theme: 'SYSTEM',
    density: 'COMFORTABLE',
    templateLayouts: {
      FINANCIAL_OVERVIEW: { widgetOrder: exhaustiveWidgetOrder('FINANCIAL_OVERVIEW'), hiddenWidgets: [] },
      HOUSEHOLD_LEDGER: { widgetOrder: exhaustiveWidgetOrder('HOUSEHOLD_LEDGER'), hiddenWidgets: [] },
      ASSETS_LIABILITIES: { widgetOrder: exhaustiveWidgetOrder('ASSETS_LIABILITIES'), hiddenWidgets: [] },
      CARD_RECONCILIATION: { widgetOrder: exhaustiveWidgetOrder('CARD_RECONCILIATION'), hiddenWidgets: [] },
      CASH_FLOW: { widgetOrder: exhaustiveWidgetOrder('CASH_FLOW'), hiddenWidgets: [] },
    },
    updatedAt: new Date(0).toISOString(),
  }
}

function SyncSettingsPanels({ householdId, members }: { readonly householdId: string | null; readonly members: readonly HouseholdMemberDto[] }) {
  return <>
    <MobileCaptureConnectorPanel householdId={householdId} />
    <LocalSyncFoundationPanel householdId={householdId} />
    <DesktopRelayPanel householdId={householdId} />
    <FamilyDeliveryPanel householdId={householdId} members={members} view="CONFIG" />
  </>
}

function SettingsDisclosure({ title, description, children }: { readonly title: string; readonly description: string; readonly children: React.ReactNode }) {
  return <details className="panel settings-disclosure"><summary><span><strong>{title}</strong><small>{description}</small></span><ChevronDown size={17} /></summary><div className="settings-disclosure-content">{children}</div></details>
}

function IcloudDriveInboxSettingsPanel({ householdId }: { readonly householdId: string | null }) {
  const [folders, setFolders] = useState<readonly WatchedFolderDto[]>([])
  const [busy, setBusy] = useState(false)
  const [notice, setNotice] = useState('')
  useEffect(() => {
    if (!householdId || platformClient.runtime !== 'tauri') { setFolders([]); return }
    let active = true
    void platformClient.listWatchedFolders(householdId)
      .then((items) => { if (active) setFolders(items.filter((folder) => folder.provider === 'ICLOUD')) })
      .catch(() => { if (active) setNotice('iCloud Drive Inbox の接続状態を読み込めませんでした。') })
    return () => { active = false }
  }, [householdId])
  const connect = async () => {
    if (!householdId) return
    setBusy(true); setNotice('')
    try {
      const selected = await platformClient.selectIcloudFolder(householdId, 'iCloud Drive Inbox')
      if (!selected) { setNotice('iCloud Drive フォルダーの接続をキャンセルしました。'); return }
      setFolders((current) => [...current.filter((folder) => folder.id !== selected.id), selected])
      await platformClient.scanWatchedFolder(householdId, selected.id)
      setNotice('iCloud Drive の同期済みローカルフォルダーを永続 Inbox に接続しました。')
    } catch {
      setNotice('iCloud Drive フォルダーを接続できませんでした。macOS または Windows の iCloud Drive がローカルに同期済みか確認してください。')
    } finally { setBusy(false) }
  }
  return <section className="panel settings-panel" aria-labelledby="icloud-inbox-settings-title"><div><h2 id="icloud-inbox-settings-title">iCloud Drive Inbox</h2><p>Apple API への直接接続ではありません。macOS、または Windows の iCloud Drive が端末へ同期したフォルダーをKakeFlowがローカルで監視します。</p>{folders.map((folder) => <small key={folder.id}>接続済み ・ iCloud Drive ・ {folder.displayName}</small>)}</div><div className="backup-form"><button className="primary-btn" disabled={busy || platformClient.runtime !== 'tauri' || !householdId} onClick={() => void connect()}>{busy ? 'iCloud Drive を接続中…' : 'iCloud Drive を接続'}</button><small>新着ファイルは確認候補になり、台帳へ自動反映されません。</small>{notice && <p role="status">{notice}</p>}</div></section>
}

function App() {
  const [page, setPage] = useState<PageId>('overview')
  const [reportsInitialView, setReportsInitialView] = useState<ReportView>('CALENDAR')
  const [sidebarOpen, setSidebarOpen] = useState(false)
  const [showCreateHousehold, setShowCreateHousehold] = useState(false)
  const [importPreviews, setImportPreviews] = useState<ImportPreview[]>([])
  const [bootstrap, setBootstrap] = useState<AppBootstrapDto | null>(null)
  const [households, setHouseholds] = useState<readonly HouseholdDto[]>([])
  const [activeHouseholdId, setActiveHouseholdId] = useState<string | null>(() => globalThis.localStorage?.getItem('kakeflow.activeHouseholdId') ?? null)
  const [accounts, setAccounts] = useState<readonly AccountDto[]>([])
  const [householdMembers, setHouseholdMembers] = useState<readonly HouseholdMemberDto[]>([])
  const [accountGroups, setAccountGroups] = useState<readonly AccountGroupDto[]>([])
  const [activeAccountGroupId, setActiveAccountGroupId] = useState<string | null>(null)
  const [activeAttributionScope, setActiveAttributionScope] = useState<AttributionScopeDto>(ALL_ATTRIBUTION_SCOPE)
  const [liveDashboard, setLiveDashboard] = useState<DashboardMonthlyTotalsDto | null>(null)
  const [liveTransactions, setLiveTransactions] = useState<readonly TransactionRowDto[]>([])
  const [importCounts, setImportCounts] = useState<ImportRunCountsDto | null>(null)
  const [liveCards, setLiveCards] = useState<readonly CardSettlementDto[]>([])
  const [dashboardLoading, setDashboardLoading] = useState(platformClient.runtime === 'tauri')
  const [ledgerRevision, setLedgerRevision] = useState(0)
  const [desktopLoaded, setDesktopLoaded] = useState(platformClient.runtime === 'web')
  const [selectedMonth, setSelectedMonth] = useState(() => globalThis.localStorage?.getItem('kakeflow.selectedMonth') ?? currentTokyoPeriod().month)
  const [folderInboxItems, setFolderInboxItems] = useState<readonly WatchedFileInboxItemDto[]>([])
  const [folderInboxCounts, setFolderInboxCounts] = useState<WatchedFileInboxCountsDto | null>(null)
  const [capturePendingCount, setCapturePendingCount] = useState(0)
  const [folderInboxBusy, setFolderInboxBusy] = useState(false)
  const [folderAutoScan, setFolderAutoScanState] = useState(() => globalThis.localStorage?.getItem('kakeflow.folder-auto-scan') !== 'off')
  const [dashboardPreferences, setDashboardPreferences] = useState<DashboardPreferencesDto>(() => defaultDashboardPreferences())
  const [dashboardPreferencesBusy, setDashboardPreferencesBusy] = useState(false)
  const [workspaceBasis, setWorkspaceBasis] = useState<WorkspaceBasis>('ACCRUAL')
  const dashboardPreferencesHouseholdRef = useRef(activeHouseholdId)
  dashboardPreferencesHouseholdRef.current = activeHouseholdId
  const dashboardRequestGenerationRef = useRef(0)
  const homeBasis = dashboardPreferences.template === 'CASH_FLOW' ? 'CASH' : 'ACCRUAL'
  const folderAutoScanRef = useRef(folderAutoScan)
  const hydratedFolderItemsRef = useRef(new Set<string>())
  const folderRefreshBusyRef = useRef(false)

  useEffect(() => {
    const workspaceScroller = document.querySelector<HTMLElement>('.main-shell > main')
    if (!workspaceScroller) return
    if (typeof workspaceScroller.scrollTo === 'function') workspaceScroller.scrollTo({ top: 0, left: 0 })
    else workspaceScroller.scrollTop = 0
  }, [page])

  const refreshFolderInbox = useCallback(async (hydrate = folderAutoScanRef.current) => {
    const householdId = activeHouseholdId
    if (!householdId || platformClient.runtime !== 'tauri' || folderRefreshBusyRef.current) return
    folderRefreshBusyRef.current = true
    setFolderInboxBusy(true)
    try {
      let items = await platformClient.listWatchedFileInbox(householdId, undefined, 200)
      setFolderInboxItems(items)
      setImportPreviews((current) => retainActiveFolderPreviews(current, items))
      setFolderInboxCounts(await platformClient.countWatchedFileInbox(householdId))
      const captureFolderIds = new Set((await platformClient.listWatchedFolders(householdId)).filter((folder) => folder.label === 'レシート Inbox').map((folder) => folder.id))
      const batch = hydrate ? selectFolderInboxHydrationBatch(items, hydratedFolderItemsRef.current).filter((item) => !captureFolderIds.has(item.watchedFolderId)) : []
      if (batch.length > 0) {
        const claim = await platformClient.claimWatchedFileInboxItems(householdId, batch.map((item) => item.id))
        recordClaimedFolderItems(hydratedFolderItemsRef.current, claim.items)
        for (const item of claim.items) {
          try {
            const loaded = await platformClient.readWatchedFile(householdId, item.watchedFolderId, item.relativePath)
            if (loaded.relativePath !== item.relativePath || loaded.byteSize !== item.byteSize || loaded.modifiedUnixMs !== item.modifiedUnixMs || loaded.mediaType !== item.mediaType) {
              await platformClient.markWatchedFileInboxFailed(householdId, item.id, claim.leaseToken, 'FILE_CHANGED_DURING_READ')
              hydratedFolderItemsRef.current.delete(item.id)
              continue
            }
            const file = new File([new Uint8Array(loaded.fileBytes)], loaded.fileName, { type: loaded.mediaType, lastModified: loaded.modifiedUnixMs ?? Date.now() })
            const parsed = (await previewImportFiles([file]))[0]
            if (!parsed) throw new Error('Preview was not produced')
            const preview = attachFolderInboxIdentity(parsed, item)
            setImportPreviews((current) => [...current.filter((candidate) => candidate.folderInboxItemId !== item.id), preview])
            const outcome = folderInboxPreviewOutcome(preview)
            if (outcome === 'READY') await platformClient.markWatchedFileInboxReady(householdId, item.id, claim.leaseToken)
            else if (outcome === 'NEEDS_MAPPING') await platformClient.markWatchedFileInboxNeedsMapping(householdId, item.id, claim.leaseToken)
            else { await platformClient.markWatchedFileInboxFailed(householdId, item.id, claim.leaseToken, folderInboxFailureCode(preview)); hydratedFolderItemsRef.current.delete(item.id) }
          } catch (error) {
            const failureCode = error instanceof PlatformIpcError && error.code === 'CLOUD_FILE_UNAVAILABLE'
              ? 'CLOUD_FILE_UNAVAILABLE'
              : 'PREVIEW_FAILED'
            try { await platformClient.markWatchedFileInboxFailed(householdId, item.id, claim.leaseToken, failureCode) } catch { /* stale leases are recovered natively */ }
            hydratedFolderItemsRef.current.delete(item.id)
          }
        }
        items = await platformClient.listWatchedFileInbox(householdId, undefined, 200)
        setFolderInboxItems(items)
        setImportPreviews((current) => retainActiveFolderPreviews(current, items))
        setFolderInboxCounts(await platformClient.countWatchedFileInbox(householdId))
      }
    } catch {
      // Durable native state remains authoritative. A later discovery event,
      // manual refresh, or scan interval retries without duplicating a post.
    } finally {
      folderRefreshBusyRef.current = false
      setFolderInboxBusy(false)
    }
  }, [activeHouseholdId])

  const retryFolderInboxItem = useCallback(async (itemId: string) => {
    if (!activeHouseholdId) return
    await platformClient.retryWatchedFileInboxItem(activeHouseholdId, itemId)
    hydratedFolderItemsRef.current.delete(itemId)
    await refreshFolderInbox(true)
  }, [activeHouseholdId, refreshFolderInbox])

  const ignoreFolderInboxItem = useCallback(async (itemId: string) => {
    if (!activeHouseholdId) return
    await platformClient.ignoreWatchedFileInboxItem(activeHouseholdId, itemId)
    hydratedFolderItemsRef.current.add(itemId)
    setImportPreviews((current) => current.filter((preview) => preview.folderInboxItemId !== itemId))
    await refreshFolderInbox()
  }, [activeHouseholdId, refreshFolderInbox])

  const setFolderAutoScan = (enabled: boolean) => {
    folderAutoScanRef.current = enabled
    setFolderAutoScanState(enabled)
    globalThis.localStorage?.setItem('kakeflow.folder-auto-scan', enabled ? 'on' : 'off')
  }

  useEffect(() => {
    let active = true
    void Promise.all([platformClient.bootstrap(), platformClient.listHouseholds()]).then(([result, householdList]) => {
      if (active) {
        setBootstrap(result)
        setHouseholds(householdList)
        setActiveHouseholdId((current) => {
          const available = householdList.some((household) => household.id === current) ? current : householdList[0]?.id ?? null
          if (available) globalThis.localStorage?.setItem('kakeflow.activeHouseholdId', available)
          return available
        })
        setDesktopLoaded(true)
      }
    }).catch(() => {
      if (active) {
        setBootstrap(null)
        setDesktopLoaded(true)
      }
    })
    return () => { active = false }
  }, [])

  useEffect(() => {
    const householdId = activeHouseholdId
    if (!householdId || platformClient.runtime !== 'tauri') {
      setAccounts([])
      setHouseholdMembers([])
      setActiveAttributionScope(ALL_ATTRIBUTION_SCOPE)
      return
    }
    let active = true
    void Promise.all([platformClient.listAccounts(householdId), platformClient.listHouseholdMembers(householdId)]).then(([accountList, memberList]) => {
      if (active) {
        setAccounts(accountList)
        setHouseholdMembers(memberList)
        const saved = readSavedAttributionScopes()[householdId] ?? ALL_ATTRIBUTION_SCOPE
        const restored = saved.kind !== 'MEMBER' || memberList.some((member) => member.id === saved.memberId) ? saved : ALL_ATTRIBUTION_SCOPE
        setActiveAttributionScope(restored)
        if (restored.kind === 'ALL' && saved.kind === 'MEMBER') writeSavedAttributionScope(householdId, restored)
      }
    }).catch(() => {
      if (active) { setAccounts([]); setHouseholdMembers([]); setActiveAttributionScope(ALL_ATTRIBUTION_SCOPE) }
    })
    return () => { active = false }
  }, [activeHouseholdId])

  useEffect(() => {
    const householdId = activeHouseholdId
    if (!householdId || platformClient.runtime !== 'tauri') { setCapturePendingCount(0); return }
    let active = true
    const refresh = async () => {
      try {
        const items = await platformClient.listMobileCaptureInbox(householdId)
        if (active) setCapturePendingCount(items.filter((item) => ['RECEIVED', 'OCR_READY', 'OCR_REVIEW_REQUIRED', 'FAILED_RETRYABLE'].includes(item.state)).length)
      } catch { /* keep the last known count until the next local refresh */ }
    }
    void refresh()
    const timer = globalThis.setInterval(() => void refresh(), 30_000)
    return () => { active = false; globalThis.clearInterval(timer) }
  }, [activeHouseholdId, ledgerRevision])

  useEffect(() => {
    const householdId = activeHouseholdId
    let active = true
    setDashboardPreferences(defaultDashboardPreferences(householdId ?? ''))
    if (!householdId) { setDashboardPreferencesBusy(false); return () => { active = false } }
    setDashboardPreferencesBusy(true)
    void platformClient.getDashboardPreferences(householdId).then((preferences) => {
      if (active && preferences.householdId === householdId) setDashboardPreferences(preferences)
    }).catch(() => {
      if (active) setDashboardPreferences(defaultDashboardPreferences(householdId))
    }).finally(() => {
      if (active) setDashboardPreferencesBusy(false)
    })
    return () => { active = false }
  }, [activeHouseholdId])

  useEffect(() => {
    const root = document.documentElement
    const media = globalThis.matchMedia?.('(prefers-color-scheme: dark)')
    const apply = () => {
      const resolvedTheme = dashboardPreferences.theme === 'SYSTEM' ? media?.matches ? 'dark' : 'light' : dashboardPreferences.theme.toLowerCase()
      root.dataset.theme = resolvedTheme
      root.dataset.themePreference = dashboardPreferences.theme.toLowerCase()
      root.dataset.density = dashboardPreferences.density.toLowerCase()
    }
    apply()
    if (dashboardPreferences.theme === 'SYSTEM') media?.addEventListener?.('change', apply)
    return () => media?.removeEventListener?.('change', apply)
  }, [dashboardPreferences.density, dashboardPreferences.theme])

  useEffect(() => {
    const householdId = activeHouseholdId
    setAccountGroups([])
    setActiveAccountGroupId(null)
    if (!householdId || platformClient.runtime !== 'tauri') return
    let active = true
    void accountGroupExportPlatform.listGroups(householdId).then((groups) => {
      if (!active) return
      setAccountGroups(groups)
      const saved = readSavedAccountScope()
      const restored = saved?.householdId === householdId && groups.some((group) => group.id === saved.groupId) ? saved.groupId : null
      setActiveAccountGroupId(restored)
      if (!restored) globalThis.localStorage?.removeItem(ACCOUNT_SCOPE_STORAGE_KEY)
    }).catch(() => {
      if (active) {
        setAccountGroups([])
        setActiveAccountGroupId(null)
        globalThis.localStorage?.removeItem(ACCOUNT_SCOPE_STORAGE_KEY)
      }
    })
    return () => { active = false }
  }, [activeHouseholdId])

  useEffect(() => {
    const householdId = activeHouseholdId
    if (!householdId || platformClient.runtime !== 'tauri') {
      setLiveDashboard(null)
      setLiveTransactions([])
      setImportCounts(null)
      setLiveCards([])
      setDashboardLoading(false)
      return
    }
    let active = true
    setDashboardLoading(true)
    setLiveDashboard(null)
    const requestGeneration = ++dashboardRequestGenerationRef.current
    const period = periodFromMonth(selectedMonth)
    void Promise.all([
      platformClient.queryDashboard({ householdId, accountGroupId: activeAccountGroupId, attributionScope: activeAttributionScope, month: period.month, accountingBasis: homeBasis }),
      platformClient.queryTransactions({ householdId, accountGroupId: activeAccountGroupId, attributionScope: activeAttributionScope, accountingBasis: homeBasis, fromDate: period.fromDate, toDate: period.toDate, page: 1, pageSize: 4 }),
      platformClient.importSummary(householdId),
      platformClient.listCardSettlements(householdId),
    ]).then(([dashboard, page, summary, cards]) => {
      if (active && dashboardRequestGenerationRef.current === requestGeneration && dashboard.accountingBasis === homeBasis) { setLiveDashboard(dashboard); setLiveTransactions(page.items); setImportCounts(summary); setLiveCards(cards); setDashboardLoading(false) }
    }).catch(() => {
      if (active && dashboardRequestGenerationRef.current === requestGeneration) { setLiveDashboard(null); setLiveTransactions([]); setImportCounts(null); setLiveCards([]); setDashboardLoading(false) }
    })
    return () => { active = false }
  }, [activeAccountGroupId, activeAttributionScope, activeHouseholdId, homeBasis, ledgerRevision, selectedMonth])

  useEffect(() => {
    hydratedFolderItemsRef.current.clear()
    setFolderInboxItems([])
    setFolderInboxCounts(null)
    setImportPreviews((current) => current.filter((preview) => !preview.folderInboxItemId))
    if (!activeHouseholdId || platformClient.runtime !== 'tauri') return
    void refreshFolderInbox()
  }, [activeHouseholdId, refreshFolderInbox])

  useEffect(() => {
    const householdId = activeHouseholdId
    if (!householdId || platformClient.runtime !== 'tauri' || !folderAutoScan) return
    let disposed = false
    const scan = async () => {
      try {
        const folders = await platformClient.listWatchedFolders(householdId)
        for (const folder of folders) await platformClient.scanWatchedFolder(householdId, folder.id)
        if (!disposed) await refreshFolderInbox()
      } catch { /* the next bounded interval retries discovery without posting data */ }
    }
    void scan()
    const timer = globalThis.setInterval(() => void scan(), DEFAULT_FOLDER_SCAN_INTERVAL_MS)
    return () => { disposed = true; globalThis.clearInterval(timer) }
  }, [activeHouseholdId, folderAutoScan, refreshFolderInbox])

  useEffect(() => {
    if (!activeHouseholdId || platformClient.runtime !== 'tauri') return
    let disposed = false
    let unlisten: (() => void) | undefined
    void watchedFolderDiscoveryPlatform.subscribe((event) => {
      if (!disposed && event.householdId === activeHouseholdId) void refreshFolderInbox()
    }).then((stop) => { if (disposed) stop(); else unlisten = stop }).catch(() => undefined)
    return () => { disposed = true; unlisten?.() }
  }, [activeHouseholdId, refreshFolderInbox])

  const selectMonth = (month: string) => {
    const selected = periodFromMonth(month).month
    globalThis.localStorage?.setItem('kakeflow.selectedMonth', selected)
    setSelectedMonth(selected)
  }

  const activeHousehold = households.find((household) => household.id === activeHouseholdId) ?? null
  const activeAccountGroup = accountGroups.find((group) => group.id === activeAccountGroupId) ?? null
  const activeAttributionLabel = activeAttributionScope.kind === 'HOUSEHOLD_COMMON'
    ? '世帯共通'
    : activeAttributionScope.kind === 'MEMBER'
      ? householdMembers.find((member) => member.id === activeAttributionScope.memberId)?.displayName ?? '不明なメンバー'
      : '世帯全体'
  const scopeAppliesToPage = page === 'overview' || page === 'transactions' || page === 'cards' || page === 'investments' || page === 'reports'
  const basisAppliesToPage = page === 'transactions' || page === 'reports'
  const scopedCards = activeAccountGroup
    ? liveCards.filter((card) => activeAccountGroup.accountIds.includes(card.cardAccountId))
    : liveCards
  const selectAccountGroup = (groupId: string | null) => {
    const selected = groupId && accountGroups.some((group) => group.id === groupId) ? groupId : null
    setActiveAccountGroupId(selected)
    if (selected && activeHouseholdId) globalThis.localStorage?.setItem(ACCOUNT_SCOPE_STORAGE_KEY, JSON.stringify({ householdId: activeHouseholdId, groupId: selected }))
    else globalThis.localStorage?.removeItem(ACCOUNT_SCOPE_STORAGE_KEY)
  }
  const selectAttributionScope = (scope: AttributionScopeDto) => {
    const selected = scope.kind === 'MEMBER' && !householdMembers.some((member) => member.id === scope.memberId) ? ALL_ATTRIBUTION_SCOPE : scope
    setActiveAttributionScope(selected)
    if (activeHouseholdId) writeSavedAttributionScope(activeHouseholdId, selected)
  }
  const replaceAccountGroups = (groups: readonly AccountGroupDto[]) => {
    setAccountGroups(groups)
    if (activeAccountGroupId && !groups.some((group) => group.id === activeAccountGroupId)) {
      setActiveAccountGroupId(null)
      globalThis.localStorage?.removeItem(ACCOUNT_SCOPE_STORAGE_KEY)
    }
  }
  const selectHousehold = (id: string) => {
    if (!households.some((household) => household.id === id)) return
    globalThis.localStorage?.setItem('kakeflow.activeHouseholdId', id)
    globalThis.localStorage?.removeItem(ACCOUNT_SCOPE_STORAGE_KEY)
    setActiveAccountGroupId(null)
    setActiveAttributionScope(ALL_ATTRIBUTION_SCOPE)
    setActiveHouseholdId(id)
  }
  const updateDashboardPreferences = (change: DashboardPreferenceChange) => {
    const householdId = activeHouseholdId
    if (dashboardPreferencesBusy) return
    const previous = dashboardPreferences
    const { widgetOrder, hiddenWidgets, ...globalChange } = change
    const currentLayout = activeDashboardLayout(dashboardPreferences)
    const templateLayouts = widgetOrder || hiddenWidgets ? {
      ...dashboardPreferences.templateLayouts,
      [dashboardPreferences.template]: { widgetOrder: widgetOrder ?? currentLayout.widgetOrder, hiddenWidgets: hiddenWidgets ?? currentLayout.hiddenWidgets },
    } : dashboardPreferences.templateLayouts
    const next = { ...dashboardPreferences, ...globalChange, templateLayouts, householdId: householdId ?? dashboardPreferences.householdId }
    setDashboardPreferences(next)
    if (!householdId || platformClient.runtime === 'web') return
    setDashboardPreferencesBusy(true)
    void platformClient.upsertDashboardPreferences({ householdId, template: next.template, theme: next.theme, density: next.density, templateLayouts: next.templateLayouts }).then((saved) => {
      setDashboardPreferences((current) => current.householdId === saved.householdId ? saved : current)
    }).catch(() => {
      setDashboardPreferences((current) => current.householdId === previous.householdId ? previous : current)
    }).finally(() => {
      if (dashboardPreferencesHouseholdRef.current === householdId) setDashboardPreferencesBusy(false)
    })
  }

  const navigateToPage = (next: PageId) => {
    if (next === 'reports') setReportsInitialView('CALENDAR')
    setPage(next)
  }
  const openAllActions = () => {
    setReportsInitialView('FORECAST')
    setPage('reports')
  }

  const pageContent = {
    overview: <Overview setPage={navigateToPage} openAllActions={openAllActions} householdId={activeHouseholdId} accountGroupId={activeAccountGroupId} attributionScope={activeAttributionScope} revision={ledgerRevision} liveDashboard={liveDashboard} liveTransactions={liveTransactions} liveCards={scopedCards} importCounts={importCounts} dashboardLoading={dashboardLoading} desktop={platformClient.runtime === 'tauri'} householdName={activeHousehold?.name ?? (platformClient.runtime === 'web' ? '田中家' : '家計')} month={selectedMonth} preferences={dashboardPreferences} preferencesBusy={dashboardPreferencesBusy} updatePreferences={updateDashboardPreferences} />,
    transactions: <TransactionsPage householdId={activeHouseholdId} accountGroupId={activeAccountGroupId} accountGroups={accountGroups} onAccountGroupChange={selectAccountGroup} attributionScope={activeAttributionScope} revision={ledgerRevision} month={selectedMonth} basis={workspaceBasis === 'CASH' ? 'CASH' : 'ACCRUAL'} onBasisChange={setWorkspaceBasis} accounts={accounts} members={householdMembers} onChanged={() => setLedgerRevision((value) => value + 1)} />,
    import: <ImportPage previews={importPreviews} setPreviews={setImportPreviews} householdId={activeHouseholdId} accounts={accounts} members={householdMembers} summary={importCounts} onChanged={() => setLedgerRevision((value) => value + 1)} folderInbox={{ items: folderInboxItems, counts: folderInboxCounts, autoScan: folderAutoScan, busy: folderInboxBusy, setAutoScan: setFolderAutoScan, refresh: refreshFolderInbox, retry: retryFolderInboxItem, ignore: ignoreFolderInboxItem }} />,
    capture: <CaptureInboxWorkspace householdId={activeHouseholdId} accounts={accounts} onOpenImport={() => setPage('import')} onChanged={() => setLedgerRevision((value) => value + 1)} onInboxCountChanged={setCapturePendingCount} />,
    cards: <CardsPage cards={liveCards} householdId={activeHouseholdId} accounts={accounts} revision={ledgerRevision} onChanged={() => setLedgerRevision((value) => value + 1)} month={selectedMonth} />,
    investments: <InvestmentsPage householdId={activeHouseholdId} revision={ledgerRevision} openImport={() => setPage('import')} />,
    reports: <ReportsPage householdId={activeHouseholdId} accountGroupId={activeAccountGroupId} attributionScope={activeAttributionScope} accountGroups={accountGroups} onGroupsChanged={replaceAccountGroups} accounts={accounts} month={selectedMonth} revision={ledgerRevision} initialView={reportsInitialView} openPage={navigateToPage} />,
    budgets: <BudgetsPage householdId={activeHouseholdId} accounts={accounts} month={selectedMonth} revision={ledgerRevision} onChanged={() => setLedgerRevision((value) => value + 1)} />,
    rules: <RulesPage householdId={activeHouseholdId} accounts={accounts} />,
    family: <FamilyPage householdId={activeHouseholdId} members={householdMembers} accounts={accounts} onMembersChanged={async () => { if (activeHouseholdId) { const next = await platformClient.listHouseholdMembers(activeHouseholdId); setHouseholdMembers(next); if (activeAttributionScope.kind === 'MEMBER' && !next.some((member) => member.id === activeAttributionScope.memberId)) selectAttributionScope(ALL_ATTRIBUTION_SCOPE) } }} />,
    settings: <><SettingsPage householdId={activeHouseholdId} accounts={accounts} members={householdMembers} preferences={dashboardPreferences} onPreferencesChanged={updateDashboardPreferences} onAccountsChanged={async () => { if (activeHouseholdId) setAccounts(await platformClient.listAccounts(activeHouseholdId)) }} /><SettingsDisclosure title="コネクタ" description="Drive、Gmail、iCloud、モバイル・デスクトップリレー"><IcloudDriveInboxSettingsPanel householdId={activeHouseholdId} /><GoogleDriveSettingsPanel householdId={activeHouseholdId} /><GmailSettingsPanel householdId={activeHouseholdId} /><SyncSettingsPanels householdId={activeHouseholdId} members={householdMembers} /></SettingsDisclosure><SettingsDisclosure title="口座グループ・出力" description="保存済みスコープと台帳エクスポートを管理"><AccountGroupsExportPanel householdId={activeHouseholdId} accounts={accounts} month={selectedMonth} groups={accountGroups} selectedAccountGroupId={activeAccountGroupId} attributionScope={activeAttributionScope} onGroupsChanged={replaceAccountGroups} /></SettingsDisclosure>{platformClient.runtime === 'tauri' && <SettingsDisclosure title="パーサープロファイル" description="未対応CSVの区切り・文字コード・列対応を管理"><DelimitedParserProfilesPanel householdId={activeHouseholdId} /></SettingsDisclosure>}</>,
  }[page]
  const displayedHouseholdName = activeHousehold?.name ?? (platformClient.runtime === 'web' ? '田中家' : '家計')
  const completeHouseholdCreation = (household: HouseholdDto) => {
    setHouseholds((current) => [...current.filter((item) => item.id !== household.id), household])
    globalThis.localStorage?.setItem('kakeflow.activeHouseholdId', household.id)
    setActiveHouseholdId(household.id)
    setShowCreateHousehold(false)
  }
  const showFirstRun = platformClient.runtime === 'tauri' && desktopLoaded && households.length === 0
  const nativeWindow = platformClient.runtime === 'tauri'
  return <div className={`app-shell${nativeWindow ? ' app-shell--native' : ''}`}>{!nativeWindow && <DesktopTitleBar householdName={displayedHouseholdName} />}<Sidebar page={page} setPage={navigateToPage} open={sidebarOpen} close={() => setSidebarOpen(false)} bootstrap={bootstrap} households={households} activeHouseholdId={activeHouseholdId} selectHousehold={selectHousehold} createHousehold={() => setShowCreateHousehold(true)} importActionableCount={folderInboxCounts?.actionable ?? 0} capturePendingCount={capturePendingCount} /><div className="main-shell"><Topbar page={page} openMenu={() => setSidebarOpen(true)} month={selectedMonth} setMonth={selectMonth} accountGroups={accountGroups} accountGroupId={activeAccountGroupId} setAccountGroupId={selectAccountGroup} attributionScope={activeAttributionScope} setAttributionScope={selectAttributionScope} members={householdMembers} showAccountScope={scopeAppliesToPage} showBasis={basisAppliesToPage} basis={workspaceBasis} setBasis={setWorkspaceBasis} /><main><div className="workspace-content">{activeAttributionScope.kind !== 'ALL' && scopeAppliesToPage && <p className="attribution-scope-disclosure">家族集計範囲: <strong>{activeAttributionLabel}</strong>。収支・取引・予測のみを絞り込みます。純資産・資産残高・貯蓄目標・インポート状況は世帯全体です。</p>}{pageContent}{scopeAppliesToPage && <p className="scope-footnote">口座スコープ: <strong>{activeAccountGroup?.name ?? 'すべての口座'}</strong>{activeAccountGroup ? ` ・ ${activeAccountGroup.accountIds.length}口座` : ''}</p>}</div></main></div><ToastCenter />{(showFirstRun || showCreateHousehold) && <Onboarding onCancel={showFirstRun ? undefined : () => setShowCreateHousehold(false)} onCreated={completeHouseholdCreation} />}</div>
}

export default App
