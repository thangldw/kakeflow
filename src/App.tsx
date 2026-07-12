import { useEffect, useRef, useState } from 'react'
import { invoke as tauriInvoke } from '@tauri-apps/api/core'
import {
  ArrowDownLeft,
  ArrowRight,
  ArrowUpRight,
  CircleDollarSign,
  CalendarDays,
  Bell,
  CreditCard,
  FileCheck2,
  FileText,
  Download,
  Goal,
  Home,
  Import,
  Leaf,
  Layers,
  Menu,
  MoreHorizontal,
  Search,
  Settings,
  Sparkles,
  Repeat2,
  TrainFront,
  TrendingUp,
  Utensils,
  WalletCards,
  X,
  Zap,
} from 'lucide-react'
import { cardSettlements, categoryData, importItems, spendingTrend, transactions } from './data'
import { previewImportFiles } from './features/import/importService'
import type { ImportPreview } from './features/import/importService'
import { sha256Text } from './features/import/importService'
import { mapParsedImportToStartImport } from './features/import/importMapper'
import { buildReceiptImport } from './features/import/receiptText'
import { createPortfolioPlatform, mapPortfolioSnapshotImport } from './features/investments/portfolioPlatform'
import type { PortfolioSnapshotDetailDto, PortfolioSnapshotSummaryDto } from './features/investments/portfolioPlatform'
import { createBrokeragePlatform, mapBrokerageEventsImport } from './features/investments/brokeragePlatform'
import type { BrokerageHistoryDto } from './features/investments/brokeragePlatform'
import { createInvestmentPerformancePlatform } from './features/investments/investmentPerformancePlatform'
import type { InvestmentHoldingsDto, InvestmentPerformanceDto } from './features/investments/investmentPerformancePlatform'
import { InvestmentFxSummary } from './features/investments/InvestmentFxSummary'
import { InvestmentPeriodReport } from './features/investments/InvestmentPeriodReport'
import { InvestmentValuationSummary } from './features/investments/InvestmentValuationSummary'
import { createInvestmentMarketPlatform } from './features/investments/investmentMarketPlatform'
import type { InvestmentValuationDto } from './features/investments/investmentMarketPlatform'
import { createWatchedFolderDiscoveryPlatform } from './features/import/watchedFolderDiscoveryPlatform'
import { queryFinancialIntelligence } from './features/financial-intelligence/platform'
import type { FinancialIntelligenceDto } from './features/financial-intelligence/platform'
import { createAccountGroupExportPlatform } from './features/export/accountGroupExportPlatform'
import type { AccountGroupDto, AccountGroupKindDto, ExportAccountingBasisDto, ExportKindDto } from './features/export/accountGroupExportPlatform'
import { createFinancialCalendarPlatform } from './features/calendar/financialCalendarPlatform'
import type { FinancialCalendarDto, MonthlyFinancialReportDto } from './features/calendar/financialCalendarPlatform'
import { FinancialCalendarView, MonthlyReportView } from './features/reports/ReportViews'
import { createForecastActionPlatform } from './features/forecast/forecastActionPlatform'
import type { ActionItemDto, ForecastActionDto } from './features/forecast/forecastActionPlatform'
import { ForecastActionViews } from './features/forecast/ForecastActionViews'
import { buildDocumentEvidence } from './features/source-viewer/documentEvidence'
import { DocumentEvidenceViewer } from './features/source-viewer/DocumentEvidenceViewer'
import { createSourceImagePreviewPlatform } from './features/source-viewer/sourceImagePreviewPlatform'
import type { SourceImagePreviewDto } from './features/source-viewer/sourceImagePreviewPlatform'
import type { BrokerageEventCandidate, PortfolioSnapshotCandidate } from './ingestion'
import {
  DEFAULT_FOLDER_SCAN_INTERVAL_MS,
  discoverWatchedFiles,
  markWatchedFilePreviewed,
  readWatchedFileCheckpoints,
  watchedFileKey,
  writeWatchedFileCheckpoints,
} from './features/import/folderAutomation'
import type { WatchedFileCheckpoints } from './features/import/folderAutomation'
import { toTransactionViewModel } from './features/transactions/transactionViewModel'
import { budgetByCategory, budgetUsage, currentMonthMetrics, savings, savingsRate } from './metrics'
import { platformClient } from './platform'
import type { AccountDto, AppBootstrapDto, CardSettlementDto, ClassificationRuleDto, DashboardMonthlyTotalsDto, HouseholdDto, ImportPreviewDto, ImportRunCountsDto, ManualTransactionTypeDto, MonthlyCategoryBudgetDto, PostingDecisionDto, PreviewCandidateDto, SavingsGoalDto, SourceRecordViewDto, TransactionDetailDto, TransactionRowDto, UpdatePostedTransactionInputDto, WatchedFileMetadataDto, WatchedFolderDto } from './platform'
import type { NavigationItem, PageId, Transaction } from './types'

const yen = (value: number) => `${value < 0 ? '−' : ''}¥${Math.abs(value).toLocaleString('ja-JP')}`
const portfolioPlatform = createPortfolioPlatform()
const brokeragePlatform = createBrokeragePlatform()
const investmentPerformancePlatform = createInvestmentPerformancePlatform()
const investmentMarketPlatform = createInvestmentMarketPlatform()
const watchedFolderDiscoveryPlatform = createWatchedFolderDiscoveryPlatform()
const sourceImagePreviewPlatform = createSourceImagePreviewPlatform()
const accountGroupExportPlatform = createAccountGroupExportPlatform()
const financialCalendarPlatform = createFinancialCalendarPlatform()
const forecastActionPlatform = createForecastActionPlatform()

function currentTokyoPeriod(now = new Date()) {
  const parts = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Tokyo', year: 'numeric', month: '2-digit' }).formatToParts(now)
  const year = Number(parts.find((part) => part.type === 'year')?.value)
  const monthNumber = Number(parts.find((part) => part.type === 'month')?.value)
  const month = `${year}-${String(monthNumber).padStart(2, '0')}`
  const lastDay = new Date(Date.UTC(year, monthNumber, 0)).getUTCDate()
  return { month, fromDate: `${month}-01`, toDate: `${month}-${String(lastDay).padStart(2, '0')}` }
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

const navigation: NavigationItem[] = [
  { id: 'overview', label: 'ホーム', icon: Home },
  { id: 'transactions', label: '取引', icon: WalletCards },
  { id: 'import', label: 'インポート', icon: Import },
  { id: 'cards', label: 'カード照合', icon: CreditCard },
  { id: 'investments', label: '資産・投資', icon: TrendingUp },
  { id: 'reports', label: 'カレンダー・レポート', icon: CalendarDays },
  { id: 'budgets', label: '予算・目標', icon: Goal },
  { id: 'rules', label: '分類ルール', icon: Sparkles },
]

function Sidebar({ page, setPage, open, close, bootstrap, households, activeHouseholdId, selectHousehold }: { page: PageId; setPage: (page: PageId) => void; open: boolean; close: () => void; bootstrap: AppBootstrapDto | null; households: readonly HouseholdDto[]; activeHouseholdId: string | null; selectHousehold: (id: string) => void }) {
  return (
    <>
      {open && <button className="sidebar-backdrop" aria-label="メニューを閉じる" onClick={close} />}
      <aside className={`sidebar ${open ? 'sidebar--open' : ''}`} aria-label="メインナビゲーション">
        <div className="brand">
          <div className="brand-mark"><Leaf size={21} strokeWidth={2.4} /></div>
          <span>kake<span>flow</span></span>
          <button className="icon-btn mobile-close" aria-label="メニューを閉じる" onClick={close}><X size={19} /></button>
        </div>

        <div className="household-picker">
          <div className="avatar">TK</div>
          <div><select aria-label="世帯を切り替える" value={activeHouseholdId ?? ''} disabled={households.length < 2} onChange={(event) => selectHousehold(event.target.value)}>{households.length === 0 ? <option value="">家計</option> : households.map((household) => <option key={household.id} value={household.id}>{household.name}</option>)}</select><small>{households.length > 1 ? `${households.length}世帯` : 'ローカル世帯'}</small></div>
        </div>

        <nav>
          <p className="nav-caption">メニュー</p>
          {navigation.map((item) => (
            <button
              key={item.id}
              className={`nav-item ${page === item.id ? 'active' : ''}`}
              onClick={() => { setPage(item.id); close() }}
            >
              <item.icon size={19} />
              <span>{item.label}</span>
              {item.badge && <b>{item.badge}</b>}
            </button>
          ))}
        </nav>

        <div className="sidebar-foot">
          <div className={`sync-status ${bootstrap?.database.healthy ? '' : 'sync-status--offline'}`}><span /><div><strong>{bootstrap?.database.healthy ? '暗号化DB 接続済み' : platformClient.runtime === 'web' ? 'ブラウザプレビュー' : 'データベース確認中'}</strong><small>{bootstrap?.database.healthy ? `スキーマ v${bootstrap.database.schemaVersion}` : 'デスクトップ版で安全に保存'}</small></div></div>
          <button className={`nav-item ${page === 'settings' ? 'active' : ''}`} onClick={() => { setPage('settings'); close() }}><Settings size={19} /><span>設定</span></button>
        </div>
      </aside>
    </>
  )
}

function Topbar({ openMenu, month, setMonth }: { openMenu: () => void; month: string; setMonth: (month: string) => void }) {
  return (
    <header className="topbar">
      <button className="icon-btn menu-btn" aria-label="メニューを開く" onClick={openMenu}><Menu size={21} /></button>
      <div className="top-actions"><label className="period-picker"><span>対象月</span><input aria-label="対象月" type="month" value={month} onChange={(event) => setMonth(event.target.value)} /></label><div className="top-avatar">TK</div></div>
    </header>
  )
}

function PageHeader({ eyebrow, title, description, children }: { eyebrow: string; title: string; description: string; children?: React.ReactNode }) {
  return (
    <div className="page-header">
      <div><p>{eyebrow}</p><h1>{title}</h1><span>{description}</span></div>
      <div className="page-actions">{children}</div>
    </div>
  )
}

function KpiCard({ label, value, meta, trend, icon: Icon, accent }: { label: string; value: string; meta: string; trend?: string; icon: typeof TrendingUp; accent: string }) {
  return (
    <article className="kpi-card">
      <div className="kpi-head"><div className="kpi-icon" style={{ background: accent }}><Icon size={18} /></div><span>{label}</span></div>
      <strong>{value}</strong>
      <div className="kpi-meta">{trend && <em><ArrowUpRight size={13} />{trend}</em>}<span>{meta}</span></div>
    </article>
  )
}

function TrendChart({ data = spendingTrend.map((point) => ({ month: point.month, income: point.income * 1000, expense: point.expense * 1000 })) }: { data?: readonly { month: string; income: number; expense: number }[] }) {
  if (data.length === 0) return <p className="empty-state">トレンドを表示する取引はまだありません。</p>
  const max = Math.max(1, ...data.flatMap((point) => [point.income, point.expense])) * 1.08
  const width = 620
  const height = 215
  const pad = 18
  const x = (i: number) => data.length === 1 ? width / 2 : pad + i * ((width - pad * 2) / (data.length - 1))
  const y = (v: number) => height - 10 - (v / max) * 170
  const path = (key: 'income' | 'expense') => data.map((d, i) => `${i ? 'L' : 'M'} ${x(i)} ${y(d[key])}`).join(' ')
  return (
    <div className="chart-wrap">
      <div className="chart-y"><span>{yen(Math.round(max))}</span><span>{yen(Math.round(max * .67))}</span><span>{yen(Math.round(max * .34))}</span><span>¥0</span></div>
      <svg viewBox={`0 0 ${width} ${height}`} role="img" aria-label="直近6か月の収入と支出">
        {[44, 87, 130, 173].map((line) => <line key={line} x1="18" y1={line} x2="602" y2={line} className="gridline" />)}
        <path d={`${path('income')} L ${x(data.length - 1)} ${height - 10} L ${x(0)} ${height - 10} Z`} className="area-income" />
        <path d={path('income')} className="line-income" />
        <path d={path('expense')} className="line-expense" />
        {data.map((d, i) => <circle key={`i${d.month}`} cx={x(i)} cy={y(d.income)} r="3.5" className="dot-income" />)}
        {data.map((d, i) => <circle key={`e${d.month}`} cx={x(i)} cy={y(d.expense)} r="3.5" className="dot-expense" />)}
      </svg>
      <div className="chart-x">{data.map((d) => <span key={d.month}>{d.month.includes('-') ? `${Number(d.month.slice(5))}月` : d.month}</span>)}</div>
    </div>
  )
}

function SpendingCard({ expense = currentMonthMetrics.expense, categories, onDetails }: { expense?: number; categories?: readonly { name: string; amount: number }[]; onDetails: () => void }) {
  const palette = ['#ed714d', '#6f7d57', '#e4aa45', '#7f9ba5', '#c7b8a0', '#8d7ca8']
  const source = categories ? categories.filter((item) => item.amount > 0).slice(0, 6).map((item, index) => ({ ...item, color: palette[index % palette.length] })) : categoryData
  const categoryTotal = source.reduce((total, item) => total + item.amount, 0)
  const legend = source.map((item) => ({ ...item, pct: categoryTotal > 0 ? Math.round(item.amount / categoryTotal * 100) : 0 }))
  const gradient = legend.length > 0 ? `conic-gradient(${legend.map((d, i) => `${d.color} ${legend.slice(0, i).reduce((a, b) => a + b.pct, 0)}% ${legend.slice(0, i + 1).reduce((a, b) => a + b.pct, 0)}%`).join(',')})` : '#e8ebe4'
  return (
    <article className="panel spending-card">
      <div className="panel-head"><div><h2>支出の内訳</h2><p>今月のカテゴリー別</p></div><button className="text-btn" onClick={onDetails}>詳細を見る <ArrowRight size={14} /></button></div>
      <div className="spending-body">
        <div className="donut" style={{ background: gradient }}><div><small>合計</small><strong>{yen(expense)}</strong></div></div>
        <div className="legend">{legend.length > 0 ? legend.map((item) => <div key={item.name}><i style={{ background: item.color }} /><span>{item.name}</span><strong>{yen(item.amount)}</strong><small>{item.pct}%</small></div>) : <p className="empty-state">支出はまだありません。</p>}</div>
      </div>
    </article>
  )
}

const txIcons = { food: Utensils, home: Zap, transport: TrainFront, income: ArrowDownLeft, subscription: Sparkles }

function TransactionRows({ rows = transactions, onSelect }: { rows?: readonly Transaction[]; onSelect?: (id: string) => void }) {
  return <div className="transaction-list">{rows.map((tx) => {
    const Icon = txIcons[tx.icon]
    const content = <>
      <div className={`transaction-icon ${tx.amount > 0 ? 'positive' : ''}`}><Icon size={18} /></div>
      <div className="transaction-main"><strong>{tx.merchant}</strong><span>{tx.date} ・ {tx.detail}</span></div>
      <span className="category-pill">{tx.category}</span>
      <span className="account-label">{tx.account}</span>
      <strong className={tx.amount > 0 ? 'amount-positive' : ''}>{yen(tx.amount)}</strong>
      {tx.status === 'review' && <span className="review-dot" title="要確認" />}
    </>
    return onSelect
      ? <button type="button" className="transaction-row selectable" key={tx.id} onClick={() => onSelect(tx.id)}>{content}</button>
      : <div className="transaction-row" key={tx.id}>{content}</div>
  })}</div>
}

function ReconciliationMini({ liveCards, desktop, onOpen }: { liveCards: readonly CardSettlementDto[]; desktop: boolean; onOpen: () => void }) {
  const cards = desktop ? liveCards.map((card) => ({
    name: card.cardName, mask: card.maskedIdentifier ?? '番号未設定', dueDate: card.paymentDueOn ?? card.periodEnd,
    statement: card.statementAmountJpy, bankDebit: card.paymentAmountJpy ?? undefined,
    progress: card.reconciliationStatus === 'FULLY_RECONCILED' ? 100 : card.reconciliationStatus === 'POSSIBLE_MATCH' ? 80 : 0,
    status: card.reconciliationStatus === 'FULLY_RECONCILED' ? 'reconciled' as const : card.reconciliationStatus === 'POSSIBLE_MATCH' ? 'possible' as const : 'pending' as const,
    color: card.cardName.includes('Rakuten') ? '#b15b68' : '#394b5a',
  })) : cardSettlements
  return (
    <article className="panel reconciliation">
      <div className="panel-head"><div><h2>カード支払い</h2><p>請求と口座引落の照合</p></div><button className="text-btn" onClick={onOpen}>照合を開く <ArrowRight size={14} /></button></div>
      <div className="card-stack">{cards.length > 0 ? cards.map((card) => <div className="settlement" key={card.name}>
        <div className="settlement-title"><i style={{ background: card.color }} /><div><strong>{card.name}</strong><span>{card.mask} ・ {card.dueDate}</span></div><b className={card.status}>{card.status === 'reconciled' ? '照合済み' : '引落待ち'}</b></div>
        <div className="settlement-values"><span>請求額 <strong>{yen(card.statement)}</strong></span><span>口座引落 <strong>{card.bankDebit ? yen(card.bankDebit) : '—'}</strong></span></div>
        <div className="progress"><span style={{ width: `${card.progress}%` }} /></div>
      </div>) : <p className="empty-state">カード明細はまだありません。</p>}</div>
    </article>
  )
}

function Overview({ setPage, liveDashboard, liveTransactions, liveCards, desktop, householdName, month }: { setPage: (page: PageId) => void; liveDashboard: DashboardMonthlyTotalsDto | null; liveTransactions: readonly TransactionRowDto[]; liveCards: readonly CardSettlementDto[]; desktop: boolean; householdName: string; month: string }) {
  const income = desktop ? liveDashboard?.incomeJpy ?? 0 : currentMonthMetrics.income
  const expense = desktop ? liveDashboard?.expenseJpy ?? 0 : currentMonthMetrics.expense
  const projectedSavings = desktop ? liveDashboard?.savingsJpy ?? 0 : savings
  const displayTransactions = desktop ? liveTransactions.map(toTransactionViewModel) : transactions.slice(0, 4)
  const trend = desktop ? (liveDashboard?.accrualTrend ?? []).map((point) => ({ month: point.month, income: point.incomeJpy, expense: point.expenseJpy })) : undefined
  const categories = desktop ? (liveDashboard?.expenseCategories ?? []).map((item) => ({ name: item.name, amount: item.amountJpy })) : undefined
  return <>
    <PageHeader eyebrow={`${month.replace('-', '年')}月`} title={householdName === '家計' ? '家計の概要' : `${householdName}の家計`} description={desktop ? `選択月の確定取引 ${liveDashboard?.postedTransactionCount ?? 0}件を集計しています。` : `家計は順調です。予算の ${(budgetUsage * 100).toFixed(1)}% を使いました。`}>
      <button className="primary-btn" onClick={() => setPage('import')}><Import size={17} /> ファイルを取り込む</button>
    </PageHeader>
    <section className="kpi-grid">
      <KpiCard label="純資産" value={yen(desktop ? liveDashboard?.netWorthJpy ?? 0 : currentMonthMetrics.netWorth)} meta={desktop ? `${liveDashboard?.netWorthAsOf ?? '月末'} 現在` : '前月比'} trend={desktop ? undefined : '2.8%'} icon={TrendingUp} accent="#e4edda" />
      <KpiCard label="今月の収入" value={yen(income)} meta={desktop ? '発生ベース' : '予定の 104%'} trend={desktop ? undefined : '4.2%'} icon={ArrowDownLeft} accent="#dce9e6" />
      <KpiCard label="今月の支出" value={yen(expense)} meta={desktop ? 'カード引落は二重計上しません' : `予算 ${yen(currentMonthMetrics.budget)}`} icon={ArrowUpRight} accent="#f7e3d9" />
      <KpiCard label="貯蓄見込み" value={yen(projectedSavings)} meta={desktop ? '収入 − 支出' : `貯蓄率 ${(savingsRate * 100).toFixed(1)}%`} trend={desktop ? undefined : '6.1%'} icon={CircleDollarSign} accent="#eee5cf" />
    </section>
    <section className="dashboard-grid">
      <article className="panel trend-panel">
        <div className="panel-head"><div><h2>収支の推移</h2><p>発生ベース・直近6か月</p></div><div className="chart-legend"><span className="income">収入</span><span className="expense">支出</span></div></div>
        <TrendChart data={trend} />
      </article>
      <SpendingCard expense={expense} categories={categories} onDetails={() => setPage('transactions')} />
      <article className="panel recent-panel">
        <div className="panel-head"><div><h2>最近の取引</h2><p>確認済みの最新データ</p></div><button className="text-btn" onClick={() => setPage('transactions')}>すべて見る <ArrowRight size={14} /></button></div>
        {displayTransactions.length > 0 ? <TransactionRows rows={displayTransactions} /> : <p className="empty-state">確定した取引はまだありません。</p>}
      </article>
      <ReconciliationMini liveCards={liveCards} desktop={desktop} onOpen={() => setPage('cards')} />
    </section>
    <div className="data-footnote"><FileCheck2 size={15} /> 確定済み台帳から集計 ・ 未確認の候補は含みません</div>
  </>
}

function TransactionDetailPanel({ detail, accounts, onClose, onSave, onChanged }: { detail: TransactionDetailDto; accounts: readonly AccountDto[]; onClose: () => void; onSave: (input: UpdatePostedTransactionInputDto) => Promise<void>; onChanged: () => void }) {
  const [occurredOn, setOccurredOn] = useState(detail.occurredOn)
  const [transactionType, setTransactionType] = useState(detail.transactionType)
  const [payee, setPayee] = useState(detail.payee ?? '')
  const [description, setDescription] = useState(detail.description ?? '')
  const [entries, setEntries] = useState(() => detail.entries.map((entry) => ({ id: entry.id, accountId: entry.accountId, side: entry.side, amountJpy: String(entry.amountJpy) })))
  const [busy, setBusy] = useState(false)
  const [notice, setNotice] = useState('')
  const [sourceRecords, setSourceRecords] = useState<readonly SourceRecordViewDto[]>([])
  const [selectedSourceRecordId, setSelectedSourceRecordId] = useState<string | null>(null)
  const [sourceBusy, setSourceBusy] = useState(false)
  const [sourceImagePreview, setSourceImagePreview] = useState<SourceImagePreviewDto | null>(null)
  const [sourceImageSize, setSourceImageSize] = useState<{ width: number; height: number } | null>(null)
  const [ruleBusy, setRuleBusy] = useState(false)
  const debitTotal = entries.filter((entry) => entry.side === 'DEBIT').reduce((sum, entry) => sum + (Number(entry.amountJpy) || 0), 0)
  const creditTotal = entries.filter((entry) => entry.side === 'CREDIT').reduce((sum, entry) => sum + (Number(entry.amountJpy) || 0), 0)
  const updateEntry = (index: number, change: Partial<(typeof entries)[number]>) => setEntries((current) => current.map((entry, currentIndex) => currentIndex === index ? { ...entry, ...change } : entry))
  const showSourceRecord = async (sourceRecordId: string) => {
    setSelectedSourceRecordId(sourceRecordId)
    setSourceImagePreview(null); setSourceImageSize(null)
    setSourceBusy(true)
    try {
      if (!sourceRecords.some((record) => record.id === sourceRecordId)) setSourceRecords(await platformClient.listTransactionSourceRecords(detail.householdId, detail.id))
      const evidence = detail.sourceEvidence.find((item) => item.sourceRecordId === sourceRecordId)
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
        entries: entries.map((entry) => ({ id: entry.id || crypto.randomUUID(), accountId: entry.accountId, side: entry.side, amountJpy: Number(entry.amountJpy) })),
      })
    } catch { setNotice('変更を保存できませんでした。入力内容を確認してください。') }
    finally { setBusy(false) }
  }
  const pageImages = sourceImagePreview && sourceImageSize ? { 1: { src: sourceImagePreview.dataUrl, width: sourceImageSize.width, height: sourceImageSize.height, alt: `${sourceImagePreview.filename} 原本` } } : undefined
  return <div className="detail-backdrop" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) onClose() }}><section className="transaction-detail-panel" role="dialog" aria-modal="true" aria-labelledby="transaction-detail-title"><div className="panel-head"><div><p>取引詳細</p><h2 id="transaction-detail-title">{detail.payee ?? detail.description ?? detail.id}</h2></div><button className="icon-btn" aria-label="取引詳細を閉じる" onClick={onClose}><X size={18} /></button></div><div className="detail-fields"><label>取引日<input type="date" value={occurredOn} onChange={(event) => setOccurredOn(event.target.value)} /></label><label>取引種別<select value={transactionType} onChange={(event) => setTransactionType(event.target.value as ManualTransactionTypeDto)}>{['EXPENSE', 'INCOME', 'TRANSFER', 'CARD_PURCHASE', 'CARD_PAYMENT', 'REFUND', 'FEE', 'INTEREST', 'ADJUSTMENT'].map((type) => <option key={type}>{type}</option>)}</select></label><label>支払先<input value={payee} onChange={(event) => setPayee(event.target.value)} /></label><label>メモ<input value={description} onChange={(event) => setDescription(event.target.value)} /></label></div><div className="detail-section-head"><div><h3>仕訳</h3><span>借方 {yen(debitTotal)} / 貸方 {yen(creditTotal)}</span></div><div><button className="secondary-btn" disabled={ruleBusy} onClick={() => void applyBestRule()}>{ruleBusy ? '照合中…' : '分類ルールを適用'}</button><button className="secondary-btn" onClick={() => setEntries((current) => [...current, { id: crypto.randomUUID(), accountId: '', side: 'DEBIT' as const, amountJpy: '' }])}>分割行を追加</button></div></div><div className="journal-editor">{entries.map((entry, index) => <div className="journal-line" key={entry.id}><select aria-label={`仕訳${index + 1}の借貸`} value={entry.side} onChange={(event) => updateEntry(index, { side: event.target.value as 'DEBIT' | 'CREDIT' })}><option value="DEBIT">借方</option><option value="CREDIT">貸方</option></select><select aria-label={`仕訳${index + 1}の口座`} value={entry.accountId} onChange={(event) => updateEntry(index, { accountId: event.target.value })}><option value="">口座を選択</option>{accounts.map((account) => <option key={account.id} value={account.id}>{account.name}</option>)}</select><input aria-label={`仕訳${index + 1}の金額`} inputMode="numeric" value={entry.amountJpy} onChange={(event) => updateEntry(index, { amountJpy: event.target.value })} /><button className="text-btn" aria-label={`仕訳${index + 1}を削除`} disabled={entries.length <= 2} onClick={() => setEntries((current) => current.filter((_, currentIndex) => currentIndex !== index))}>削除</button></div>)}</div><div className="evidence-list"><h3>原本・証跡</h3>{detail.sourceEvidence.length === 0 ? <p>手動入力のため原本はありません。</p> : detail.sourceEvidence.map((evidence) => <button type="button" className={`source-evidence-button ${selectedSourceRecordId === evidence.sourceRecordId ? 'active' : ''}`} key={`${evidence.sourceRecordId}-${evidence.evidenceRole}`} onClick={() => void showSourceRecord(evidence.sourceRecordId)}><FileCheck2 size={16} /><span><strong>{evidence.originalFilename}</strong><small>{evidence.sourceType} ・ 行 {evidence.rowNumber} ・ {evidence.evidenceRole}</small></span><em>{sourceBusy && selectedSourceRecordId === evidence.sourceRecordId ? '読込中…' : '原本行を表示'}</em></button>)}</div>{selectedSource && (documentEvidence ? <DocumentEvidenceViewer evidence={documentEvidence} filename={selectedSourceFilename} pageImages={pageImages} pdfSource={selectedSourceEvidence?.mediaType === 'application/pdf' ? { householdId: detail.householdId, sourceDocumentId: selectedSourceEvidence.sourceDocumentId } : undefined} /> : <section className="source-record-viewer" aria-label="原本レコード"><div><strong>{selectedSource.evidenceRole ?? 'SOURCE'} ・ 行 {selectedSource.rowNumber}</strong><small>改変されていない取込時の値</small></div><pre>{formattedSourcePayload}</pre></section>)}{notice && <p role="status">{notice}</p>}<div className="detail-actions"><span>{detail.sourceEvidence.length > 0 ? '原本とのリンクを保持したまま修正します。' : '手動取引'}</span><button className="secondary-btn" onClick={onClose}>キャンセル</button><button className="primary-btn" disabled={busy || debitTotal !== creditTotal} onClick={() => void save()}>{busy ? '保存中…' : '変更を保存'}</button></div></section></div>
}

function TransactionsPage({ householdId, revision, month, accounts, onChanged }: { householdId: string | null; revision: number; month: string; accounts: readonly AccountDto[]; onChanged: () => void }) {
  const [query, setQuery] = useState('')
  const [basis, setBasis] = useState<'ACCRUAL' | 'CASH'>('ACCRUAL')
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
  const [manualBusy, setManualBusy] = useState(false)
  const [manualNotice, setManualNotice] = useState('')
  const [selectedDetail, setSelectedDetail] = useState<TransactionDetailDto | null>(null)
  const [detailNotice, setDetailNotice] = useState('')
  const desktop = platformClient.runtime === 'tauri'

  useEffect(() => {
    if (!desktop || !householdId) return
    let active = true
    const period = periodFromMonth(month)
    setLoadError(false)
    void Promise.all([
      platformClient.queryTransactions({ householdId, accountingBasis: basis, fromDate: period.fromDate, toDate: period.toDate, search: query.trim() || null, page: ledgerPage, pageSize: 25 }),
      platformClient.queryDashboard({ householdId, month: period.month, accountingBasis: basis }),
    ]).then(([page, totals]) => {
      if (active) { setLiveRows(page.items); setLiveTotals(totals); setTotalPages(page.totalPages); setTotalItems(page.totalItems) }
    }).catch(() => {
      if (active) { setLiveRows([]); setLiveTotals(null); setTotalPages(0); setTotalItems(0); setLoadError(true) }
    })
    return () => { active = false }
  }, [basis, desktop, householdId, ledgerPage, month, query, revision])

  useEffect(() => { setLedgerPage(1) }, [basis, householdId, month, query])
  useEffect(() => { setManualDate(`${month}-01`) }, [month])

  const basisTransactions = transactions.filter((transaction) => basis === 'ACCRUAL' ? transaction.accountingEffect !== 'CASH_ONLY' : transaction.accountingEffect !== 'ACCRUAL_ONLY')
  const displayRows = desktop ? liveRows.map(toTransactionViewModel) : basisTransactions
  const visible = desktop ? displayRows : displayRows.filter((t) => `${t.merchant}${t.category}${t.account}`.toLowerCase().includes(query.toLowerCase()))
  const basisExpense = desktop ? liveTotals?.expenseJpy ?? 0 : basis === 'ACCRUAL' ? currentMonthMetrics.expense : currentMonthMetrics.cashOutflow
  const basisIncome = desktop ? liveTotals?.incomeJpy ?? 0 : currentMonthMetrics.income
  const openDetail = async (transactionId: string) => {
    if (!desktop || !householdId) return
    setDetailNotice('')
    try { setSelectedDetail(await platformClient.getTransactionDetail(householdId, transactionId)) }
    catch { setDetailNotice('取引詳細を読み込めませんでした。') }
  }
  const saveDetail = async (input: UpdatePostedTransactionInputDto) => {
    await platformClient.updateTransaction(input)
    setSelectedDetail(null); onChanged(); setDetailNotice('取引と仕訳を更新しました。')
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
        entries: [
          { id: crypto.randomUUID(), accountId: manualDebit, side: 'DEBIT', amountJpy: amount },
          { id: crypto.randomUUID(), accountId: manualCredit, side: 'CREDIT', amountJpy: amount },
        ],
      })
      setManualPayee(''); setManualDescription(''); setManualAmount(''); setShowManual(false); setLedgerPage(1); onChanged(); setManualNotice('手動取引を台帳に記録しました。')
    } catch { setManualNotice('取引を記録できませんでした。日付と口座を確認してください。') }
    finally { setManualBusy(false) }
  }

  return <>
    <PageHeader eyebrow="取引台帳" title="すべての取引" description="確定した取引と元データを一か所で管理します。">
      {desktop && <button className="primary-btn" onClick={() => setShowManual((value) => !value)}>{showManual ? '入力を閉じる' : '手動取引を追加'}</button>}
    </PageHeader>
    {showManual && <section className="panel manual-transaction-form"><div className="panel-head"><div><h2>複式簿記で手動入力</h2><p>同額の借方・貸方を確定台帳へ記録します。</p></div></div><div className="planning-form"><input aria-label="取引日" type="date" value={manualDate} onChange={(event) => setManualDate(event.target.value)} /><select aria-label="手動取引種別" value={manualType} onChange={(event) => setManualType(event.target.value as ManualTransactionTypeDto)}>{['EXPENSE', 'INCOME', 'TRANSFER', 'CARD_PURCHASE', 'CARD_PAYMENT', 'REFUND', 'FEE', 'INTEREST', 'ADJUSTMENT'].map((type) => <option key={type}>{type}</option>)}</select><input aria-label="手動取引の支払先" value={manualPayee} onChange={(event) => setManualPayee(event.target.value)} placeholder="店舗・支払先" /><input aria-label="手動取引のメモ" value={manualDescription} onChange={(event) => setManualDescription(event.target.value)} placeholder="メモ（任意）" /><input aria-label="手動取引の金額" inputMode="numeric" value={manualAmount} onChange={(event) => setManualAmount(event.target.value)} placeholder="金額 (JPY)" /><select aria-label="手動取引の借方口座" value={manualDebit} onChange={(event) => setManualDebit(event.target.value)}><option value="">借方口座</option>{accounts.map((account) => <option key={account.id} value={account.id}>{account.name}</option>)}</select><select aria-label="手動取引の貸方口座" value={manualCredit} onChange={(event) => setManualCredit(event.target.value)}><option value="">貸方口座</option>{accounts.map((account) => <option key={account.id} value={account.id}>{account.name}</option>)}</select><button className="primary-btn" disabled={manualBusy} onClick={() => void createManual()}>{manualBusy ? '記録中…' : '取引を記録'}</button></div>{manualNotice && <p role="status">{manualNotice}</p>}</section>}
    {!showManual && manualNotice && <div className="import-notice" role="status">{manualNotice}</div>}
    {detailNotice && <div className="import-notice" role="status">{detailNotice}</div>}
    <section className="panel table-panel">
      <div className="table-toolbar"><div className="search table-search"><Search size={17} /><input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="店舗、カテゴリー、口座を検索" /></div><div className="basis-toggle" aria-label="計上基準"><button className={basis === 'ACCRUAL' ? 'active' : ''} aria-pressed={basis === 'ACCRUAL'} onClick={() => setBasis('ACCRUAL')}>発生ベース</button><button className={basis === 'CASH' ? 'active' : ''} aria-pressed={basis === 'CASH'} onClick={() => setBasis('CASH')}>資金移動</button></div></div>
      <div className="table-summary"><span>{month}・{basis === 'ACCRUAL' ? '発生ベース' : '資金移動ベース'}</span><strong>収入 {yen(basisIncome)}</strong><strong>{basis === 'ACCRUAL' ? '支出' : '現金流出'} {yen(basisExpense)}</strong><em>{desktop ? `${totalItems}件中 ${visible.length}件` : `${visible.length}件を表示`}</em></div>
      {loadError ? <p className="empty-state">台帳を読み込めませんでした。</p> : visible.length > 0 ? <TransactionRows rows={visible} onSelect={desktop ? (id) => void openDetail(id) : undefined} /> : <p className="empty-state">条件に一致する取引はありません。</p>}
      {desktop && totalPages > 1 && <div className="pagination"><button className="secondary-btn" disabled={ledgerPage <= 1} onClick={() => setLedgerPage((value) => value - 1)}>前へ</button><span>{ledgerPage} / {totalPages}</span><button className="secondary-btn" disabled={ledgerPage >= totalPages} onClick={() => setLedgerPage((value) => value + 1)}>次へ</button></div>}
    </section>
    {selectedDetail && <TransactionDetailPanel key={selectedDetail.updatedAt} detail={selectedDetail} accounts={accounts} onClose={() => setSelectedDetail(null)} onSave={saveDetail} onChanged={onChanged} />}
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
  if (looksLikeCardPayment && candidate.direction === 'OUT') {
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
    entries: [
      { id: globalThis.crypto.randomUUID(), accountId: debitAccount.id, side: 'DEBIT', amountJpy: candidate.amountJpy },
      { id: globalThis.crypto.randomUUID(), accountId: creditAccount.id, side: 'CREDIT', amountJpy: candidate.amountJpy },
    ],
  }
}

function ImportReviewSection({ stagedImport, accounts, householdId, busy, onRollback, onCommit }: { stagedImport: ImportPreviewDto; accounts: readonly AccountDto[]; householdId: string; busy: boolean; onRollback: () => void; onCommit: (decisions: readonly PostingDecisionDto[]) => void }) {
  const [drafts, setDrafts] = useState(() => Object.fromEntries(stagedImport.candidates.map((candidate) => [candidate.id, { approved: false, decision: suggestedPosting(candidate, accounts, householdId) }])))
  const updateDecision = (candidateId: string, change: (decision: PostingDecisionDto) => PostingDecisionDto) => setDrafts((current) => ({ ...current, [candidateId]: { ...current[candidateId], decision: change(current[candidateId].decision) } }))
  const approved = stagedImport.candidates.every((candidate) => drafts[candidate.id]?.approved)
  const decisions = stagedImport.candidates.map((candidate) => drafts[candidate.id]?.decision).filter((decision): decision is PostingDecisionDto => Boolean(decision))

  return <section className="panel review-panel"><div className="panel-head"><div><h2>{stagedImport.source.originalFilename}</h2><p>{stagedImport.candidates.length}件の候補・原本は暗号化済み</p></div><b>REVIEW</b></div><div className="candidate-review-list">{stagedImport.candidates.map((candidate) => { const draft = drafts[candidate.id]; const debit = draft.decision.entries.find((entry) => entry.side === 'DEBIT')!; const credit = draft.decision.entries.find((entry) => entry.side === 'CREDIT')!; return <div className="candidate-review-row candidate-review-edit" key={candidate.id}><label><input aria-label={`${candidate.merchantRaw ?? candidate.descriptionRaw ?? candidate.id}を承認`} type="checkbox" checked={draft.approved} onChange={(event) => setDrafts((current) => ({ ...current, [candidate.id]: { ...current[candidate.id], approved: event.target.checked } }))} /><span>承認</span></label><div><input aria-label={`${candidate.id}の支払先`} value={draft.decision.payee ?? ''} onChange={(event) => updateDecision(candidate.id, (decision) => ({ ...decision, payee: event.target.value || null }))} /><span>{candidate.occurredOn} ・ {candidate.direction} ・ {yen(candidate.amountJpy)}</span></div><select aria-label={`${candidate.id}の取引種別`} value={draft.decision.transactionType} onChange={(event) => updateDecision(candidate.id, (decision) => ({ ...decision, transactionType: event.target.value }))}>{['EXPENSE', 'CARD_PURCHASE', 'CARD_PAYMENT', 'INCOME', 'REFUND', 'TRANSFER'].map((type) => <option key={type}>{type}</option>)}</select><select aria-label={`${candidate.id}の借方口座`} value={debit.accountId} onChange={(event) => updateDecision(candidate.id, (decision) => ({ ...decision, entries: decision.entries.map((entry) => entry.side === 'DEBIT' ? { ...entry, accountId: event.target.value } : entry) }))}>{accounts.map((account) => <option key={account.id} value={account.id}>{account.name}</option>)}</select><select aria-label={`${candidate.id}の貸方口座`} value={credit.accountId} onChange={(event) => updateDecision(candidate.id, (decision) => ({ ...decision, entries: decision.entries.map((entry) => entry.side === 'CREDIT' ? { ...entry, accountId: event.target.value } : entry) }))}>{accounts.map((account) => <option key={account.id} value={account.id}>{account.name}</option>)}</select>{candidate.issues.length > 0 && <small>{candidate.issues.join(', ')}</small>}</div> })}</div><div className="review-actions"><span>{approved ? '全候補を承認済み' : '各候補の口座と種別を確認して承認してください'}</span><button className="secondary-btn" disabled={busy} onClick={onRollback}>取り消す</button><button className="primary-btn" disabled={busy || !approved || decisions.length !== stagedImport.candidates.length} onClick={() => onCommit(decisions)}>{busy ? '処理中…' : '承認済みを台帳へ反映'}</button></div></section>
}

function ImportPage({ previews, setPreviews, householdId, accounts, summary, onChanged, backgroundChanges, clearBackgroundChanges }: { previews: ImportPreview[]; setPreviews: React.Dispatch<React.SetStateAction<ImportPreview[]>>; householdId: string | null; accounts: readonly AccountDto[]; summary: ImportRunCountsDto | null; onChanged: () => void; backgroundChanges: number; clearBackgroundChanges: () => void }) {
  const inputRef = useRef<HTMLInputElement>(null)
  const [busy, setBusy] = useState(false)
  const [activeRun, setActiveRun] = useState<string | null>(null)
  const [staged, setStaged] = useState<Record<string, ImportPreviewDto>>({})
  const [notice, setNotice] = useState('')
  const [watchedFolders, setWatchedFolders] = useState<readonly WatchedFolderDto[]>([])
  const [watchedFiles, setWatchedFiles] = useState<Record<string, readonly WatchedFileMetadataDto[]>>({})
  const [folderBusy, setFolderBusy] = useState<string | null>(null)
  const [autoScan, setAutoScan] = useState(() => globalThis.localStorage?.getItem('kakeflow.folder-auto-scan') !== 'off')
  const [checkpoints, setCheckpoints] = useState<WatchedFileCheckpoints>({})
  const checkpointsRef = useRef<WatchedFileCheckpoints>({})
  const [portfolioImported, setPortfolioImported] = useState<ReadonlySet<string>>(() => new Set())

  const processFiles = async (files: FileList | readonly File[], sourceType: 'MANUAL_UPLOAD' | 'LOCAL_FOLDER' = 'MANUAL_UPLOAD') => {
    if (files.length === 0) return
    setBusy(true)
    const next = (await previewImportFiles(files)).map((preview) => ({ ...preview, sourceType }))
    setPreviews((current) => {
      const merged = new Map(current.map((item) => [item.id, item]))
      next.forEach((item) => merged.set(item.id, item))
      return Array.from(merged.values()).reverse()
    })
    setBusy(false)
  }

  useEffect(() => {
    if (platformClient.runtime !== 'tauri' || !householdId) { setWatchedFolders([]); return }
    const restored = readWatchedFileCheckpoints(globalThis.localStorage, householdId)
    checkpointsRef.current = restored
    setCheckpoints(restored)
    void platformClient.listWatchedFolders(householdId).then(setWatchedFolders).catch(() => setNotice('監視フォルダーを読み込めませんでした。'))
  }, [householdId])

  const saveCheckpoints = (next: WatchedFileCheckpoints) => {
    checkpointsRef.current = next
    setCheckpoints(next)
    if (householdId) writeWatchedFileCheckpoints(globalThis.localStorage, householdId, next)
  }

  const loadWatchedFile = async (folder: WatchedFolderDto, file: WatchedFileMetadataDto) => {
    if (!householdId) return
    const loaded = await platformClient.readWatchedFile(householdId, folder.id, file.relativePath)
    const browserFile = new File([new Uint8Array(loaded.fileBytes)], loaded.fileName, { type: loaded.mediaType, lastModified: loaded.modifiedUnixMs ?? Date.now() })
    await processFiles([browserFile], 'LOCAL_FOLDER')
    saveCheckpoints(markWatchedFilePreviewed(checkpointsRef.current, folder.id, file))
  }

  const scanForNewFiles = async (folders: readonly WatchedFolderDto[], automatic: boolean) => {
    if (!householdId || folders.length === 0) return 0
    let discoveredCount = 0
    for (const folder of folders) {
      const scan = await platformClient.scanWatchedFolder(householdId, folder.id)
      setWatchedFiles((current) => ({ ...current, [folder.id]: scan.files }))
      const discovery = discoverWatchedFiles(checkpointsRef.current, folder.id, scan.files)
      saveCheckpoints(discovery.checkpoints)
      discoveredCount += discovery.discovered.length
      if (automatic) {
        for (const file of discovery.discovered) await loadWatchedFile(folder, file)
      }
    }
    return discoveredCount
  }

  useEffect(() => {
    if (!autoScan || platformClient.runtime !== 'tauri' || !householdId || watchedFolders.length === 0) return
    let active = true
    const scan = async () => {
      try {
        const count = await scanForNewFiles(watchedFolders, true)
        if (active && count > 0) setNotice(`${count}件の新しいファイルを自動プレビューしました。`)
      } catch {
        if (active) setNotice('自動スキャンを完了できませんでした。次の周期で再試行します。')
      }
    }
    void scan()
    const timer = globalThis.setInterval(() => void scan(), DEFAULT_FOLDER_SCAN_INTERVAL_MS)
    return () => { active = false; globalThis.clearInterval(timer) }
  }, [autoScan, householdId, watchedFolders]) // eslint-disable-line react-hooks/exhaustive-deps

  const addWatchedFolder = async () => {
    if (!householdId) return
    setFolderBusy('select'); setNotice('')
    try {
      const selected = await platformClient.selectWatchedFolder(householdId, '家計簿 Inbox')
      if (selected) setWatchedFolders((current) => [...current.filter((folder) => folder.id !== selected.id), selected])
    } catch { setNotice('フォルダーを登録できませんでした。シンボリックリンクではないローカルフォルダーを選択してください。') }
    finally { setFolderBusy(null) }
  }
  const scanWatchedFolder = async (folder: WatchedFolderDto) => {
    if (!householdId) return
    setFolderBusy(folder.id); setNotice('')
    try { const count = await scanForNewFiles([folder], false); setNotice(count > 0 ? `${count}件の新しいファイルを検出しました。` : '新しいファイルはありません。') }
    catch { setNotice('フォルダーを安全にスキャンできませんでした。同期状態とアクセス権を確認してください。') }
    finally { setFolderBusy(null) }
  }
  const previewWatchedFile = async (folder: WatchedFolderDto, file: WatchedFileMetadataDto) => {
    if (!householdId) return
    setFolderBusy(`${folder.id}:${file.relativePath}`); setNotice('')
    try {
      await loadWatchedFile(folder, file); setNotice(`${file.fileName} をローカルフォルダーからプレビューしました。`)
    } catch { setNotice('ファイルを安全に読み込めませんでした。同期完了後に再試行してください。') }
    finally { setFolderBusy(null) }
  }
  const removeWatchedFolder = async (folder: WatchedFolderDto) => {
    if (!householdId) return
    setFolderBusy(folder.id)
    try { await platformClient.removeWatchedFolder(householdId, folder.id); setWatchedFolders((current) => current.filter((item) => item.id !== folder.id)); setWatchedFiles((current) => { const next = { ...current }; delete next[folder.id]; return next }) }
    catch { setNotice('監視フォルダーを解除できませんでした。') }
    finally { setFolderBusy(null) }
  }

  const stageImport = async (item: ImportPreview) => {
    if (!householdId || !item.fileBytes || !item.parsed || !item.detectedAdapterId) return
    setActiveRun(item.id)
    setNotice('')
    try {
      const rakutenCard = accounts.find((account) => account.accountSubtype === 'CREDIT_CARD' && /Rakuten|楽天/i.test(account.name))?.id
      const amazonCard = accounts.find((account) => account.accountSubtype === 'CREDIT_CARD' && /Amazon/i.test(account.name))?.id
      const defaultAccount = item.detectedAdapterId === 'japanese-bank-ledger-v1'
        ? `${householdId}-bank`
        : item.detectedAdapterId === 'paypay-history-v1' ? `${householdId}-wallet`
          : item.detectedAdapterId === 'rakuten-enavi-v1' ? rakutenCard ?? `${householdId}-card`
            : item.detectedAdapterId === 'amazon-mastercard-statement-v1' ? amazonCard ?? `${householdId}-card` : `${householdId}-card`
      const mapping = await mapParsedImportToStartImport({
        file: {
          householdId, sourceType: item.sourceType ?? 'MANUAL_UPLOAD', originalFilename: item.filename,
          mediaType: item.mediaType ?? 'text/csv', byteSize: item.fileBytes.byteLength,
          sha256: item.id, sourceModifiedAt: item.sourceModifiedAt ?? null,
          accountId: defaultAccount, adapterVersion: '1',
        },
        detectedAdapterId: item.detectedAdapterId,
        parsed: item.parsed,
      }, { next: () => globalThis.crypto.randomUUID() }, sha256Text)
      if (mapping.issues.some((issue) => issue.severity === 'error') || mapping.request.candidates.length === 0) {
        setPreviews((current) => current.map((preview) => preview.id === item.id ? {
          ...preview, status: 'error', issues: [...preview.issues, ...mapping.issues.map((issue) => ({ code: issue.code, message: issue.message, severity: issue.severity, row: issue.sourceRow }))],
        } : preview))
        setNotice('正規化できない行があります。ファイル内容を確認してください。')
        return
      }
      const summary = await platformClient.startImport(mapping.request, item.fileBytes)
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

  const extractDocument = async (item: ImportPreview) => {
    if (!householdId || !item.fileBytes || !item.mediaType) return
    setActiveRun(item.id); setNotice('')
    try {
      const isImage = item.mediaType.startsWith('image/')
      const extracted = isImage
        ? await platformClient.ocrDocument(item.fileBytes, item.mediaType)
        : await platformClient.extractDocument(item.fileBytes, item.mediaType)
      const normalized = await buildReceiptImport(extracted, {
        householdId, filename: item.filename, mediaType: item.mediaType, byteSize: item.fileBytes.byteLength,
        sha256: item.id, sourceModifiedAt: item.sourceModifiedAt ?? null, accountId: `${householdId}-cash`, sourceType: item.sourceType,
      }, () => globalThis.crypto.randomUUID(), sha256Text)
      if (!normalized.request) {
        setNotice(normalized.fields.issues.includes('STATEMENT_LIKELY') ? 'この書類は明細書の可能性があるため、1件の支出としては取り込みません。' : '日付または合計金額を読み取れませんでした。内容を確認してください。')
        return
      }
      const started = await platformClient.startImport(normalized.request, item.fileBytes)
      const backendPreview = await platformClient.previewImport(started.runId)
      setStaged((current) => ({ ...current, [item.id]: backendPreview })); onChanged()
      const confidence = Math.min(extracted.confidenceBps, normalized.fields.confidenceBps)
      setNotice(`${isImage ? 'レシート画像のOCR' : 'PDFの埋め込みテキスト'}から支出候補を抽出しました（信頼度 ${Math.round(confidence / 100)}%）。${confidence < 7500 ? '確認待ちとして保持します。' : ''}`)
    } catch {
      setNotice(item.mediaType.startsWith('image/') ? '画像をOCRで読み取れませんでした。対応形式と画質を確認してください。' : 'PDFの埋め込みテキストを抽出できませんでした。スキャンPDFには画像OCRが必要です。')
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
      const started = await platformClient.startImport({
        runId, documentId, householdId, sourceType: item.sourceType ?? 'MANUAL_UPLOAD', originalFilename: item.filename,
        mediaType: item.mediaType ?? 'text/csv', byteSize: item.fileBytes.byteLength, sha256: item.id,
        sourceModifiedAt: item.sourceModifiedAt ?? null, adapterId: item.detectedAdapterId, adapterVersion: '1',
        records: [{ id: recordId, rowNumber: snapshot.lineage.sourceRow, recordHash: await sha256Text(payloadJson), payloadJson }],
        candidates: [], cardStatements: [],
      }, item.fileBytes)
      if (!started.reusedExisting) {
        await portfolioPlatform.importSnapshot(mapPortfolioSnapshotImport(snapshot, { snapshotId: crypto.randomUUID(), householdId, accountId: securitiesAccount.id, sourceDocumentId: started.documentId }))
        await platformClient.commitImport(started.runId, [])
      }
      setPortfolioImported((current) => new Set([...current, item.id])); onChanged()
      setNotice(started.reusedExisting ? 'この資産スナップショットはすでに取り込み済みです。' : `${snapshot.positions.length}銘柄の資産スナップショットを保存しました。`)
    } catch { setNotice('資産スナップショットを保存できませんでした。証券口座と原本を確認してください。') }
    finally { setActiveRun(null) }
  }

  const importBrokerageHistory = async (item: ImportPreview) => {
    if (!householdId || !item.fileBytes || item.detectedAdapterId !== 'japanese-brokerage-transactions-v1' || !item.parsed) return
    const securitiesAccount = accounts.find((account) => account.accountKind === 'ASSET' && account.accountSubtype === 'SECURITIES')
    if (!securitiesAccount) { setNotice('先に設定で「ASSET / SECURITIES」の証券口座を追加してください。'); return }
    const events = item.parsed.records.filter((record): record is BrokerageEventCandidate => typeof record === 'object' && record !== null && (record as { kind?: unknown }).kind === 'brokerage-event')
    if (events.length === 0) { setNotice('証券取引を正規化できませんでした。'); return }
    setActiveRun(item.id); setNotice('')
    try {
      const runId = crypto.randomUUID(); const documentId = crypto.randomUUID()
      const records = await Promise.all(events.map(async (event) => { const payloadJson = JSON.stringify(event); return { id: crypto.randomUUID(), rowNumber: event.lineage.sourceRow, recordHash: await sha256Text(payloadJson), payloadJson } }))
      const started = await platformClient.startImport({ runId, documentId, householdId, sourceType: item.sourceType ?? 'MANUAL_UPLOAD', originalFilename: item.filename, mediaType: item.mediaType ?? 'text/csv', byteSize: item.fileBytes.byteLength, sha256: item.id, sourceModifiedAt: item.sourceModifiedAt ?? null, adapterId: item.detectedAdapterId, adapterVersion: '1', records, candidates: [], cardStatements: [] }, item.fileBytes)
      if (!started.reusedExisting) {
        await brokeragePlatform.importEvents(mapBrokerageEventsImport(events, { householdId, accountId: securitiesAccount.id, sourceDocumentId: started.documentId, idPrefix: runId }))
        await platformClient.commitImport(started.runId, [])
      }
      setPortfolioImported((current) => new Set([...current, item.id])); onChanged()
      setNotice(started.reusedExisting ? 'この証券取引ファイルはすでに取り込み済みです。' : `${events.length}件の証券取引を保存しました。`)
    } catch { setNotice('証券取引を保存できませんでした。口座、通貨、原本の合計を確認してください。') }
    finally { setActiveRun(null) }
  }

  const commitRun = async (previewId: string, stagedImport: ImportPreviewDto, decisions: readonly PostingDecisionDto[]) => {
    setActiveRun(stagedImport.summary.runId)
    setNotice('')
    try {
      const result = await platformClient.commitImport(stagedImport.summary.runId, decisions)
      setStaged((current) => { const next = { ...current }; delete next[previewId]; return next })
      onChanged()
      setNotice(`${result.postedCount}件の取引を台帳へ反映しました。`)
    } catch {
      setNotice('台帳へ反映できませんでした。候補の口座と仕訳を確認してください。')
    } finally {
      setActiveRun(null)
    }
  }

  const rollbackRun = async (previewId: string, runId: string) => {
    setActiveRun(runId)
    try {
      await platformClient.rollbackImport(runId)
      setStaged((current) => { const next = { ...current }; delete next[previewId]; return next })
      onChanged()
      setNotice('未確定のインポートを取り消しました。')
    } catch {
      setNotice('インポートを取り消せませんでした。')
    } finally {
      setActiveRun(null)
    }
  }

  return <>
    <PageHeader eyebrow="データ取り込み" title="インポート Inbox" description="ファイルから読み取った候補を確認して台帳へ反映します。">
      {platformClient.runtime === 'tauri' && <button className="secondary-btn" disabled={folderBusy === 'select'} onClick={() => void addWatchedFolder()}>{folderBusy === 'select' ? '選択中…' : '同期フォルダーを追加'}</button>}
      <button className="primary-btn" disabled={busy} onClick={() => inputRef.current?.click()}><Import size={17} /> {busy ? '解析中…' : 'ファイルを選択'}</button>
      <input ref={inputRef} className="visually-hidden" type="file" accept=".csv,.xlsx,.pdf,.png,.jpg,.jpeg,text/csv,application/pdf,image/png,image/jpeg,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" multiple onChange={(event) => { const files = event.currentTarget.files; event.currentTarget.value = ''; if (files) void processFiles(files) }} />
    </PageHeader>
    {backgroundChanges > 0 && <div className="import-notice folder-discovery-notice" role="status"><span>バックグラウンド監視で {backgroundChanges} 件のファイル変更を検出しました。同期フォルダーを確認してください。</span><button className="text-btn" onClick={clearBackgroundChanges}>確認済みにする</button></div>}
    <section className="status-grid">
      {[
        ['取込済み', String(summary?.posted ?? (platformClient.runtime === 'web' ? 79 : 0)), `${summary?.sourceDocuments ?? 0}原本`],
        ['確認待ち', String(summary?.reviewRequired ?? (platformClient.runtime === 'web' ? 6 : 0)), `${summary?.readyCandidates ?? 0}候補`],
        ['処理失敗', String(summary?.failed ?? (platformClient.runtime === 'web' ? 2 : 0)), '再実行可能'],
        ['ソース行', String(summary?.sourceRecords ?? (platformClient.runtime === 'web' ? 4 : 0)), '監査証跡'],
      ].map((x, i) => <article className="status-card" key={x[0]}><span className={`status-orb s${i}`} /><div><strong>{x[1]}</strong><span>{x[0]}</span><small>{x[2]}</small></div></article>)}
    </section>
    {platformClient.runtime === 'tauri' && watchedFolders.length > 0 && <section className="panel watched-folders"><div className="panel-head"><div><h2>同期フォルダー</h2><p>Google Drive・iCloud Drive・OneDrive・ローカル/NASを60秒ごとに確認します。</p></div><label className="auto-scan-toggle"><input type="checkbox" checked={autoScan} onChange={(event) => { const enabled = event.target.checked; setAutoScan(enabled); globalThis.localStorage?.setItem('kakeflow.folder-auto-scan', enabled ? 'on' : 'off') }} /><span>自動取り込み</span></label></div>{watchedFolders.map((folder) => <div className="watched-folder" key={folder.id}><div><strong>{folder.label}</strong><span>{folder.displayName}</span></div><button className="secondary-btn" disabled={folderBusy === folder.id} onClick={() => void scanWatchedFolder(folder)}>{folderBusy === folder.id ? 'スキャン中…' : '新しいファイルを確認'}</button><button className="text-btn" disabled={folderBusy === folder.id} onClick={() => void removeWatchedFolder(folder)}>解除</button>{watchedFiles[folder.id]?.map((file) => { const checkpoint = checkpoints[watchedFileKey(folder.id, file)]; return <div className="watched-file" key={file.relativePath}><FileCheck2 size={15} /><span><strong>{file.fileName}</strong><small>{file.relativePath} ・ {(file.byteSize / 1024).toFixed(1)} KB</small></span><b className={checkpoint?.state === 'PREVIEWED' ? 'ready' : 'review'}>{checkpoint?.state === 'PREVIEWED' ? '確認済み' : '新規'}</b><button className="mini-btn" disabled={folderBusy === `${folder.id}:${file.relativePath}`} onClick={() => void previewWatchedFile(folder, file)}>{folderBusy === `${folder.id}:${file.relativePath}` ? '読込中…' : checkpoint?.state === 'PREVIEWED' ? '再プレビュー' : 'プレビュー'}</button></div> })}</div>)}</section>}
    <section className="panel import-panel">
      <div className="panel-head"><div><h2>最近のファイル</h2><p>選択またはドロップしたローカルファイル</p></div></div>
      <button className="drop-zone" onClick={() => inputRef.current?.click()} onDragOver={(event) => event.preventDefault()} onDrop={(event) => { event.preventDefault(); void processFiles(event.dataTransfer.files) }}><Import size={20} /><span>CSV / Excel / PDF / レシート画像をここにドロップ</span><small>PayPay・銀行・カード・PNG / JPEGレシート</small></button>
      <div className="import-list">
        {previews.map((item) => <div className="import-row" key={item.id}><div className="file-icon"><FileCheck2 size={19} /></div><div><strong>{item.filename}</strong><span>{item.adapterId ?? '未対応の形式'} ・ {item.encoding}</span></div><span>{item.recordCount} レコード</span><b className={item.status === 'ready' ? 'ready' : 'review'}>{portfolioImported.has(item.id) ? '資産に反映済み' : staged[item.id] ? 'レビュー待ち' : item.status === 'ready' ? 'プレビュー完了' : item.status === 'extractable' ? item.mediaType?.startsWith('image/') ? 'OCR待ち' : 'テキスト抽出待ち' : '確認が必要'}</b>{item.status === 'ready' && item.detectedAdapterId === 'securities-asset-snapshot-v1' && !portfolioImported.has(item.id) ? <button className="mini-btn" disabled={platformClient.runtime !== 'tauri' || !householdId || activeRun === item.id} onClick={() => void importPortfolioSnapshot(item)}>{activeRun === item.id ? '保存中…' : '資産に保存'}</button> : item.status === 'ready' && item.detectedAdapterId === 'japanese-brokerage-transactions-v1' && !portfolioImported.has(item.id) ? <button className="mini-btn" disabled={platformClient.runtime !== 'tauri' || !householdId || activeRun === item.id} onClick={() => void importBrokerageHistory(item)}>{activeRun === item.id ? '保存中…' : '証券取引に保存'}</button> : item.status === 'ready' && !staged[item.id] && !portfolioImported.has(item.id) ? <button className="mini-btn" disabled={platformClient.runtime !== 'tauri' || !householdId || accounts.length === 0 || activeRun === item.id} onClick={() => void stageImport(item)}>{activeRun === item.id ? '暗号化中…' : platformClient.runtime === 'tauri' ? '取込開始' : 'Desktopのみ'}</button> : item.status === 'extractable' && !staged[item.id] ? <button className="mini-btn" disabled={platformClient.runtime !== 'tauri' || !householdId || accounts.length === 0 || activeRun === item.id} onClick={() => void extractDocument(item)}>{activeRun === item.id ? '抽出中…' : item.mediaType?.startsWith('image/') ? '画像OCR' : 'PDF抽出'}</button> : <span className="icon-btn" title={item.issues.map((issue) => issue.message).join('\n')}><MoreHorizontal size={18} /></span>}</div>)}
        {platformClient.runtime === 'web' && importItems.map((item) => <div className="import-row" key={item.file}><div className="file-icon"><FileCheck2 size={19} /></div><div><strong>{item.file}</strong><span>{item.source} ・ {item.time}</span></div><span>{item.records} レコード</span><b className={item.state}>{item.state === 'ready' ? '反映可能' : item.state === 'review' ? '確認が必要' : item.state === 'matched' ? '取引に照合済み' : '処理済み'}</b></div>)}
        {platformClient.runtime === 'tauri' && previews.length === 0 && <p className="empty-state">ファイルを選択すると、ここに解析結果が表示されます。</p>}
      </div>
    </section>
    {notice && <div className="import-notice" role="status">{notice}</div>}
    {householdId && Object.entries(staged).map(([previewId, stagedImport]) => <ImportReviewSection key={stagedImport.summary.runId} stagedImport={stagedImport} accounts={accounts} householdId={householdId} busy={activeRun === stagedImport.summary.runId} onRollback={() => void rollbackRun(previewId, stagedImport.summary.runId)} onCommit={(decisions) => void commitRun(previewId, stagedImport, decisions)} />)}
  </>
}

function CardsPage({ cards, householdId, onChanged, month }: { cards: readonly CardSettlementDto[]; householdId: string | null; onChanged: () => void; month: string }) {
  const desktop = platformClient.runtime === 'tauri'
  const [busyId, setBusyId] = useState<string | null>(null)
  const [notice, setNotice] = useState('')
  const displayCards = desktop ? cards.filter((card) => (card.periodStart.slice(0, 7) <= month && card.periodEnd.slice(0, 7) >= month) || card.paymentDueOn?.slice(0, 7) === month || card.paymentOn?.slice(0, 7) === month) : cardSettlements.map((card, index) => ({
    id: `demo-${index}`, cardAccountId: `demo-${index}`, cardName: card.name, maskedIdentifier: card.mask,
    periodStart: '2026-07-01', periodEnd: '2026-07-31', paymentDueOn: card.dueDate,
    statementAmountJpy: card.statement, detailAmountJpy: card.statement, lineCount: card.name.includes('Rakuten') ? 15 : 14,
    paymentId: card.bankDebit ? `demo-payment-${index}` : null, bankTransactionId: null,
    paymentAmountJpy: card.bankDebit ?? null, paymentOn: null, matchScoreBps: card.bankDebit ? 10000 : null,
    reconciliationStatus: card.status === 'reconciled' ? 'FULLY_RECONCILED' as const : 'UNMATCHED' as const,
  }))
  const confirm = async (card: CardSettlementDto) => {
    if (!householdId || !card.paymentId) return
    setBusyId(card.id); setNotice('')
    try { await platformClient.confirmCardMatch(householdId, card.id, card.paymentId); onChanged(); setNotice('請求と口座引落を照合済みにしました。') }
    catch { setNotice('照合を確定できませんでした。金額とカード口座を確認してください。') }
    finally { setBusyId(null) }
  }
  return <>
    <PageHeader eyebrow="カード管理" title="請求・口座引落の照合" description="カード利用は支出、銀行引落は負債の返済として正しく区別します。">
    </PageHeader>
    {notice && <div className="import-notice" role="status">{notice}</div>}
    <section className="cards-page-grid">{displayCards.map((card) => <article className="panel card-detail" key={card.id}>
      <div className="card-visual" style={{ background: card.cardName.includes('Rakuten') ? '#b15b68' : '#394b5a' }}><span>KAKEFLOW CARD</span><strong>{card.cardName}</strong><small>{card.maskedIdentifier ?? '番号未設定'}</small></div>
      <div className="card-detail-head"><div><span>請求額</span><strong>{yen(card.statementAmountJpy)}</strong></div><b className={card.reconciliationStatus === 'FULLY_RECONCILED' ? 'reconciled' : card.reconciliationStatus === 'POSSIBLE_MATCH' ? 'possible' : 'pending'}>{card.reconciliationStatus === 'FULLY_RECONCILED' ? '✓ 照合済み' : card.reconciliationStatus === 'POSSIBLE_MATCH' ? '照合候補' : '引落待ち'}</b></div>
      <dl><div><dt>期間</dt><dd>{card.periodStart} – {card.periodEnd}</dd></div><div><dt>口座引落</dt><dd>{card.paymentAmountJpy ? yen(card.paymentAmountJpy) : '未検出'}</dd></div><div><dt>利用明細</dt><dd>{card.lineCount}件</dd></div></dl>
      {card.reconciliationStatus === 'POSSIBLE_MATCH' && <button className="full-btn" disabled={busyId === card.id} onClick={() => void confirm(card)}>{busyId === card.id ? '確定中…' : '金額と口座を確認して照合'} <ArrowRight size={15} /></button>}
    </article>)}{desktop && displayCards.length === 0 && <p className="empty-state">カードCSVを取り込むと、ここに請求と照合状況が表示されます。</p>}</section>
  </>
}

function InvestmentsPage({ householdId, revision, openImport }: { householdId: string | null; revision: number; openImport: () => void }) {
  const [snapshots, setSnapshots] = useState<readonly PortfolioSnapshotSummaryDto[]>([])
  const [detail, setDetail] = useState<PortfolioSnapshotDetailDto | null>(null)
  const [notice, setNotice] = useState('')
  const [brokerage, setBrokerage] = useState<BrokerageHistoryDto | null>(null)
  const [holdings, setHoldings] = useState<InvestmentHoldingsDto | null>(null)
  const [performance, setPerformance] = useState<InvestmentPerformanceDto | null>(null)
  const [valuation, setValuation] = useState<InvestmentValuationDto | null>(null)
  useEffect(() => {
    if (!householdId || platformClient.runtime !== 'tauri') return
    let active = true
    void portfolioPlatform.listSnapshots(householdId).then(async (items) => {
      if (!active) return
      setSnapshots(items)
      setDetail(items[0] ? await portfolioPlatform.getSnapshot(householdId, items[0].id) : null)
    }).catch(() => { if (active) { setSnapshots([]); setDetail(null); setNotice('投資データを読み込めませんでした。') } })
    void brokeragePlatform.queryHistory({ householdId }).then((history) => { if (active) setBrokerage(history) }).catch(() => { if (active) setBrokerage(null) })
    const asOf = periodFromMonth(currentTokyoPeriod().month).toDate
    void Promise.all([investmentPerformancePlatform.queryHoldings({ householdId, asOf }), investmentPerformancePlatform.queryPerformance({ householdId })]).then(([nextHoldings, nextPerformance]) => { if (active) { setHoldings(nextHoldings); setPerformance(nextPerformance) } }).catch(() => { if (active) { setHoldings(null); setPerformance(null) } })
    void investmentMarketPlatform.queryValuation({ householdId, asOf }).then((nextValuation) => { if (active) setValuation(nextValuation) }).catch(() => { if (active) setValuation(null) })
    return () => { active = false }
  }, [householdId, revision])
  const selectSnapshot = async (snapshotId: string) => {
    if (!householdId) return
    try { setDetail(await portfolioPlatform.getSnapshot(householdId, snapshotId)) }
    catch { setNotice('選択した資産スナップショットを読み込めませんでした。') }
  }
  const maxAssetClass = Math.max(1, ...(detail?.assetClasses.map((item) => item.marketValueJpy) ?? [1]))
  return <><PageHeader eyebrow="資産形成" title="資産・投資" description="証券会社の資産残高ファイルを、家計取引とは分離した時点スナップショットとして管理します。"><button className="primary-btn" onClick={openImport}><Import size={17} /> 残高ファイルを取り込む</button></PageHeader>
    {notice && <div className="import-notice" role="status">{notice}</div>}
    {detail ? <><section className="kpi-grid investment-kpis"><KpiCard label="評価額" value={yen(detail.marketValueJpy)} meta={`${detail.asOf.slice(0, 10)} 現在`} icon={TrendingUp} accent="#e4edda" /><KpiCard label="証券口座内の現金" value={yen(detail.cashValueJpy)} meta={detail.accountName} icon={CircleDollarSign} accent="#dce9e6" /><KpiCard label="評価損益" value={yen(detail.unrealizedPnlJpy ?? 0)} meta="未実現損益" icon={ArrowUpRight} accent="#eee5cf" /><KpiCard label="保有銘柄" value={`${detail.positionCount}銘柄`} meta={`${detail.fxRateCount}通貨レート`} icon={WalletCards} accent="#f7e3d9" /></section>
      <section className="investment-grid"><article className="panel"><div className="panel-head"><div><h2>資産配分</h2><p>評価額ベース</p></div></div><div className="asset-allocation">{detail.assetClasses.map((item) => <div key={item.id}><span><strong>{item.name}</strong><em>{yen(item.marketValueJpy)}</em></span><div className="progress"><span style={{ width: `${item.marketValueJpy / maxAssetClass * 100}%` }} /></div></div>)}</div></article><article className="panel snapshot-history"><div className="panel-head"><div><h2>スナップショット履歴</h2><p>{snapshots.length}件</p></div></div>{snapshots.map((snapshot) => <button key={snapshot.id} className={snapshot.id === detail.id ? 'active' : ''} onClick={() => void selectSnapshot(snapshot.id)}><span>{snapshot.asOf.slice(0, 10)} ・ {snapshot.accountName}</span><strong>{yen(snapshot.marketValueJpy)}</strong></button>)}</article></section>
      <section className="panel positions-table"><div className="panel-head"><div><h2>保有商品</h2><p>原本の行番号まで追跡可能</p></div></div><div className="position-row position-head"><span>銘柄</span><span>口座</span><span>数量</span><span>現在値</span><span>評価額</span><span>評価損益</span></div>{detail.positions.map((position) => <div className="position-row" key={position.id}><span><strong>{position.instrumentName}</strong><small>{position.instrumentCode || position.productType} ・ 行 {position.sourceRow}</small></span><span>{position.accountType}</span><span>{position.quantity?.toLocaleString('ja-JP') ?? '—'}</span><span>{position.marketPrice == null ? '—' : `${position.currency} ${position.marketPrice.toLocaleString('ja-JP')}`}</span><strong>{position.marketValueJpy == null ? '—' : yen(position.marketValueJpy)}</strong><em className={(position.unrealizedPnlJpy ?? 0) >= 0 ? 'amount-positive' : ''}>{position.unrealizedPnlJpy == null ? '—' : yen(position.unrealizedPnlJpy)}</em></div>)}</section></> : <section className="panel investment-empty"><TrendingUp size={32} /><h2>資産スナップショットはまだありません</h2><p>設定で証券口座を追加し、`assetbalance(all)_*.csv` をインポートしてください。</p><button className="primary-btn" onClick={openImport}>インポート Inboxを開く</button></section>}
    {brokerage && brokerage.events.length > 0 && <section className="panel brokerage-history"><div className="panel-head"><div><h2>証券取引履歴</h2><p>売買・配当・手数料・税金・入出金（家計支出には含めません）</p></div><strong>{brokerage.events.length}件</strong></div><div className="brokerage-totals">{brokerage.totalsByCurrency.map((total) => <article key={total.currency}><span>{total.currency} 純資金移動</span><strong>{total.netCashMovement.toLocaleString('ja-JP')}</strong><small>配当 {total.dividendGross.toLocaleString('ja-JP')} ・ 手数料 {total.fees.toLocaleString('ja-JP')} ・ 税 {total.taxes.toLocaleString('ja-JP')}</small></article>)}</div><div className="brokerage-event-list">{brokerage.events.slice(0, 20).map((event) => <div key={event.id}><span><strong>{event.instrumentName || event.rawTransactionType}</strong><small>{event.tradeDate ?? event.settlementDate} ・ {event.accountName} ・ 行 {event.sourceRow}</small></span><b>{event.eventType}</b><em>{event.currency} {event.settlementAmount.toLocaleString('ja-JP')}</em></div>)}</div></section>}
    {holdings && (holdings.positions.length > 0 || (performance?.totalsByCurrency.length ?? 0) > 0) && <section className="panel investment-performance"><div className="panel-head"><div><h2>投資パフォーマンス</h2><p>{holdings.costBasisMethod} 原価法・通貨ごとに集計（自動換算なし）</p></div><span>{holdings.asOf} 現在</span></div>{performance && <div className="performance-currency-grid">{performance.totalsByCurrency.map((total) => <article key={total.currency}><span>{total.currency}</span><strong className={total.realizedPnl >= 0 ? 'amount-positive' : ''}>{total.realizedPnl.toLocaleString('ja-JP')} 実現損益</strong><small>配当 {total.dividendGross.toLocaleString('ja-JP')} ・ 手数料 {total.fees.toLocaleString('ja-JP')} ・ 税 {total.taxes.toLocaleString('ja-JP')}</small></article>)}</div>}<div className="performance-position-list">{holdings.positions.map((position) => <div key={`${position.accountId}-${position.instrumentCode}-${position.currency}`}><span><strong>{position.instrumentName}</strong><small>{position.instrumentCode} ・ {position.accountName} ・ {position.openLotCount}ロット</small></span><em>{position.quantity.toLocaleString('ja-JP')} 株</em><b>{position.currency} {position.costBasis.toLocaleString('ja-JP')} 原価</b></div>)}</div>{(holdings.uncoveredSales.length > 0 || holdings.skippedEventIds.length > 0) && <p className="performance-warning">原価未確認の売却 {holdings.uncoveredSales.length}件・計算対象外 {holdings.skippedEventIds.length}件。原本取引を確認してください。</p>}</section>}
    <InvestmentValuationSummary valuation={valuation} />
    {holdings && performance && performance.totalsByCurrency.length > 0 && <InvestmentFxSummary householdId={householdId} fxAsOf={holdings.asOf} revision={revision} />}
    {(brokerage?.events.length ?? 0) > 0 && <InvestmentPeriodReport householdId={householdId} revision={revision} />}
  </>
}

function FinancialIntelligencePanel({ householdId, month, revision, openTransactions }: { householdId: string | null; month: string; revision: number; openTransactions: () => void }) {
  const [intelligence, setIntelligence] = useState<FinancialIntelligenceDto | null>(null)
  const [notice, setNotice] = useState('')
  useEffect(() => {
    if (!householdId || platformClient.runtime !== 'tauri') return
    let active = true
    const asOf = periodFromMonth(month).toDate
    void queryFinancialIntelligence(tauriInvoke, { householdId, asOf }).then((result) => { if (active) { setIntelligence(result); setNotice('') } }).catch(() => { if (active) { setIntelligence(null); setNotice('定期支出と異常支出を分析できませんでした。') } })
    return () => { active = false }
  }, [householdId, month, revision])
  if (notice) return <section className="panel"><p className="empty-state">{notice}</p></section>
  if (!intelligence) return <section className="panel"><p className="empty-state">家計履歴を分析しています…</p></section>
  const cadenceLabel = { WEEKLY: '毎週', BIWEEKLY: '隔週', MONTHLY: '毎月', QUARTERLY: '四半期', ANNUAL: '毎年' } as const
  return <section className="intelligence-grid"><article className="panel recurring-panel"><div className="panel-head"><div><h2>定期支出・サブスクリプション</h2><p>{intelligence.historyFrom} 以降の確定取引から推定</p></div><Repeat2 size={19} /></div>{intelligence.recurringItems.length === 0 ? <p className="empty-state">十分な反復履歴はまだありません。</p> : intelligence.recurringItems.map((item) => <div className="recurring-row" key={item.normalizedPayee}><div><strong>{item.displayPayee}</strong><span>{cadenceLabel[item.cadence]} ・ {item.occurrenceCount}回 ・ 信頼度 {Math.round(item.confidenceBps / 100)}%</span></div><div><small>次回見込み</small><strong>{item.nextExpectedOn}</strong></div><div><small>標準金額</small><strong>{yen(item.typicalAmountJpy)}</strong>{item.priceChangeBps != null && item.priceChangeBps !== 0 && <em>{item.priceChangeBps > 0 ? '+' : ''}{(item.priceChangeBps / 100).toFixed(1)}%</em>}</div></div>)}</article><article className="panel anomaly-panel"><div className="panel-head"><div><h2>異常支出</h2><p>同じ支払先の過去実績と比較</p></div><Bell size={19} /></div>{intelligence.anomalies.length === 0 ? <p className="empty-state">確認が必要な異常支出はありません。</p> : intelligence.anomalies.map((item) => <button key={item.transactionId} onClick={openTransactions}><span><strong>{item.displayPayee}</strong><small>{item.occurredOn} ・ 基準 {yen(item.baselineAmountJpy)} ({item.baselineSampleCount}件)</small></span><strong>{yen(item.amountJpy)}</strong><em>スコア {Math.round(item.scoreBps / 100)}</em></button>)}</article></section>
}

function AccountGroupsExportPanel({ householdId, accounts, month }: { householdId: string | null; accounts: readonly AccountDto[]; month: string }) {
  const [groups, setGroups] = useState<readonly AccountGroupDto[]>([])
  const [name, setName] = useState('')
  const [kind, setKind] = useState<AccountGroupKindDto>('FAMILY')
  const [selectedAccounts, setSelectedAccounts] = useState<ReadonlySet<string>>(() => new Set())
  const [exportKind, setExportKind] = useState<ExportKindDto>('TRANSACTIONS')
  const [basis, setBasis] = useState<ExportAccountingBasisDto>('ACCRUAL')
  const [groupId, setGroupId] = useState('')
  const [notice, setNotice] = useState('')
  const [busy, setBusy] = useState(false)
  const period = periodFromMonth(month)
  const reload = async () => {
    if (!householdId || platformClient.runtime !== 'tauri') return
    setGroups(await accountGroupExportPlatform.listGroups(householdId))
  }
  useEffect(() => { void reload().catch(() => setNotice('口座グループを読み込めませんでした。')) }, [householdId]) // eslint-disable-line react-hooks/exhaustive-deps
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
      const saved = await accountGroupExportPlatform.saveCsv({ householdId, exportKind, accountingBasis: basis, groupId: groupId || null, fromDate: period.fromDate, toDate: period.toDate })
      setNotice(saved ? `${saved.fileName}（${saved.rowCount}行）を保存しました。` : 'エクスポートをキャンセルしました。')
    } catch { setNotice('CSVを書き出せませんでした。対象期間とグループを確認してください。') }
    finally { setBusy(false) }
  }
  const kindLabels: Record<AccountGroupKindDto, string> = { FAMILY: '家族', PERSONAL: '個人', DAILY_SPENDING: '日常支出', INVESTMENT: '投資', BUSINESS: '事業', TAX: '税務', EDUCATION: '教育', CUSTOM: 'カスタム' }
  return <section className="groups-export-grid"><article className="panel account-group-panel"><div className="panel-head"><div><h2>口座グループ</h2><p>ダッシュボードと出力で再利用する保存済みスコープ</p></div><Layers size={19} /></div><div className="group-form"><input aria-label="グループ名" value={name} onChange={(event) => setName(event.target.value)} placeholder="家族の生活費" /><select aria-label="グループ種別" value={kind} onChange={(event) => setKind(event.target.value as AccountGroupKindDto)}>{Object.entries(kindLabels).map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select><div className="group-account-choices">{accounts.map((account) => <label key={account.id}><input type="checkbox" checked={selectedAccounts.has(account.id)} onChange={(event) => setSelectedAccounts((current) => { const next = new Set(current); if (event.target.checked) next.add(account.id); else next.delete(account.id); return next })} /><span>{account.name}</span></label>)}</div><button className="primary-btn" disabled={busy} onClick={() => void createGroup()}>グループを保存</button></div><div className="saved-groups">{groups.map((group) => <div key={group.id}><span><strong>{group.name}</strong><small>{kindLabels[group.groupKind]} ・ {group.accountIds.length}口座</small></span><button className="text-btn" disabled={busy} onClick={() => void deleteGroup(group)}>削除</button></div>)}{groups.length === 0 && <p className="empty-state">保存済みグループはありません。</p>}</div></article><article className="panel export-panel"><div className="panel-head"><div><h2>CSVエクスポート</h2><p>UTF-8 BOM・確定データのみ</p></div><Download size={19} /></div><label>データ<select aria-label="エクスポートデータ" value={exportKind} onChange={(event) => setExportKind(event.target.value as ExportKindDto)}><option value="TRANSACTIONS">取引台帳</option><option value="PORTFOLIO_SNAPSHOTS">資産スナップショット</option></select></label><label>計上基準<select aria-label="エクスポート計上基準" value={basis} onChange={(event) => setBasis(event.target.value as ExportAccountingBasisDto)}><option value="ACCRUAL">発生ベース</option><option value="CASH">資金移動</option></select></label><label>口座スコープ<select aria-label="エクスポートグループ" value={groupId} onChange={(event) => setGroupId(event.target.value)}><option value="">すべての口座</option>{groups.map((group) => <option key={group.id} value={group.id}>{group.name}</option>)}</select></label><div className="export-period"><span>対象期間</span><strong>{period.fromDate} → {period.toDate}</strong></div><button className="primary-btn" disabled={busy} onClick={() => void exportCsv()}>{busy ? '処理中…' : '保存先を選んでCSV出力'}</button>{notice && <p role="status">{notice}</p>}</article></section>
}

function ReportsPage({ householdId, accounts, month, revision, openPage }: { householdId: string | null; accounts: readonly AccountDto[]; month: string; revision: number; openPage: (page: PageId) => void }) {
  const [view, setView] = useState<'CALENDAR' | 'MONTHLY' | 'FORECAST' | 'INTELLIGENCE' | 'EXPORT'>('CALENDAR')
  const [calendar, setCalendar] = useState<FinancialCalendarDto | null>(null)
  const [monthlyReport, setMonthlyReport] = useState<MonthlyFinancialReportDto | null>(null)
  const [forecast, setForecast] = useState<ForecastActionDto | null>(null)
  const [basis, setBasis] = useState<'ACCRUAL' | 'CASH'>('ACCRUAL')
  const [comparison, setComparison] = useState<'PRIOR_MONTH' | 'PRIOR_YEAR'>('PRIOR_MONTH')
  const [notice, setNotice] = useState('')
  useEffect(() => {
    if (!householdId || platformClient.runtime !== 'tauri') return
    let active = true
    const request = { householdId, month, asOf: periodFromMonth(month).toDate }
    void Promise.all([financialCalendarPlatform.getCalendar(request), financialCalendarPlatform.getMonthlyReport(request), forecastActionPlatform.query({ householdId, asOf: request.asOf })])
      .then(([nextCalendar, nextReport, nextForecast]) => { if (active) { setCalendar(nextCalendar); setMonthlyReport(nextReport); setForecast(nextForecast); setNotice('') } })
      .catch(() => { if (active) { setCalendar(null); setMonthlyReport(null); setForecast(null); setNotice('家計レビューを読み込めませんでした。') } })
    return () => { active = false }
  }, [householdId, month, revision])
  const reportBody = view === 'CALENDAR'
    ? calendar ? <FinancialCalendarView data={calendar} basis={basis} onBasisChange={setBasis} onSelectDate={() => openPage('transactions')} onSelectEvent={() => openPage('transactions')} onOpenImports={() => openPage('import')} /> : <section className="panel report-loading"><CalendarDays size={28} /><p>{notice || '日次カレンダーを読み込んでいます…'}</p></section>
    : view === 'MONTHLY'
      ? monthlyReport ? <MonthlyReportView data={monthlyReport} comparison={comparison} onComparisonChange={setComparison} onSelectDriver={() => openPage('transactions')} onOpenBudget={() => openPage('budgets')} onOpenGoals={() => openPage('budgets')} onOpenImports={() => openPage('import')} onOpenReconciliation={() => openPage('cards')} /> : <section className="panel report-loading"><FileText size={28} /><p>{notice || '月次比較レポートを読み込んでいます…'}</p></section>
      : view === 'FORECAST' ? forecast ? <ForecastActionViews data={forecast} onAction={(action: ActionItemDto) => openPage(action.kind.startsWith('IMPORT_') ? 'import' : action.kind.startsWith('CARD_') ? 'cards' : action.kind === 'BUDGET_OVERRUN' || action.kind === 'GOAL_DUE' ? 'budgets' : 'transactions')} /> : <section className="panel report-loading"><TrendingUp size={28} /><p>{notice || '予測とアクションを読み込んでいます…'}</p></section>
        : view === 'INTELLIGENCE' ? <FinancialIntelligencePanel householdId={householdId} month={month} revision={revision} openTransactions={() => openPage('transactions')} />
        : <AccountGroupsExportPanel householdId={householdId} accounts={accounts} month={month} />
  return <><PageHeader eyebrow="家計レビュー" title="カレンダー・レポート" description="確定台帳を日次、月次、予測、定期支出・異常支出の視点で確認します。"><div className="report-tabs" role="tablist" aria-label="レポート表示"><button role="tab" aria-selected={view === 'CALENDAR'} className={view === 'CALENDAR' ? 'active' : ''} onClick={() => setView('CALENDAR')}><CalendarDays size={15} /> カレンダー</button><button role="tab" aria-selected={view === 'MONTHLY'} className={view === 'MONTHLY' ? 'active' : ''} onClick={() => setView('MONTHLY')}><FileText size={15} /> 月次レポート</button><button role="tab" aria-selected={view === 'FORECAST'} className={view === 'FORECAST' ? 'active' : ''} onClick={() => setView('FORECAST')}><TrendingUp size={15} /> 予測・アクション</button><button role="tab" aria-selected={view === 'INTELLIGENCE'} className={view === 'INTELLIGENCE' ? 'active' : ''} onClick={() => setView('INTELLIGENCE')}><Bell size={15} /> 定期・異常</button><button role="tab" aria-selected={view === 'EXPORT'} className={view === 'EXPORT' ? 'active' : ''} onClick={() => setView('EXPORT')}><Download size={15} /> グループ・出力</button></div></PageHeader>{reportBody}</>
}

function BudgetsPage({ householdId, accounts, month, revision }: { householdId: string | null; accounts: readonly AccountDto[]; month: string; revision: number }) {
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
    try { await platformClient.upsertBudget({ householdId, month, categoryAccountId: budgetAccountId, budgetJpy: Number(budgetAmount) }); await reload(); setBudgetAmount(''); setNotice('月間予算を保存しました。') }
    catch { setNotice('月間予算を保存できませんでした。') }
    finally { setBusy(false) }
  }

  const createGoal = async () => {
    if (!householdId || !goalName.trim() || !/^\d+$/.test(goalTarget) || Number(goalTarget) <= 0) { setNotice('目標名と1円以上の目標額を入力してください。'); return }
    setBusy(true); setNotice('')
    try { await platformClient.createSavingsGoal({ id: crypto.randomUUID(), householdId, name: goalName.trim(), targetJpy: Number(goalTarget), savedJpy: 0, targetDate: goalDate, status: 'ACTIVE' }); await reload(); setGoalName(''); setGoalTarget(''); setShowGoalForm(false); setNotice('貯蓄目標を追加しました。') }
    catch { setNotice('貯蓄目標を追加できませんでした。') }
    finally { setBusy(false) }
  }

  const updateGoal = async (goal: SavingsGoalDto) => {
    const saved = goalDrafts[goal.id]
    if (!/^\d+$/.test(saved ?? '')) { setNotice('貯蓄済み金額を0円以上で入力してください。'); return }
    setBusy(true)
    try { await platformClient.updateSavingsGoal({ id: goal.id, householdId: goal.householdId, name: goal.name, targetJpy: goal.targetJpy, savedJpy: Number(saved), targetDate: goal.targetDate, status: Number(saved) >= goal.targetJpy ? 'COMPLETED' : goal.status === 'COMPLETED' ? 'ACTIVE' : goal.status }); await reload(); setNotice('貯蓄額を更新しました。') }
    catch { setNotice('貯蓄額を更新できませんでした。') }
    finally { setBusy(false) }
  }

  const deleteGoal = async (goal: SavingsGoalDto) => {
    setBusy(true)
    try { await platformClient.deleteSavingsGoal(goal.householdId, goal.id); await reload(); setNotice('貯蓄目標を削除しました。') }
    catch { setNotice('貯蓄目標を削除できませんでした。') }
    finally { setBusy(false) }
  }

  if (!desktop) {
    return <><PageHeader eyebrow="プランニング" title="予算・貯蓄目標" description="デスクトップ版では予算と目標を暗号化台帳に保存します。" /><section className="budget-layout"><article className="panel budget-panel">{budgetByCategory.map((item) => <div className="budget-row" key={item.name}><strong>{item.name}</strong><span>{yen(item.amount)} / {yen(item.budget)}</span></div>)}</article></section></>
  }

  const totalBudget = budgets.reduce((sum, budget) => sum + budget.budgetJpy, 0)
  const totalActual = budgets.reduce((sum, budget) => sum + budget.actualJpy, 0)
  const palette = ['#ed714d', '#6f7d57', '#e4aa45', '#7f9ba5']
  return <>
    <PageHeader eyebrow={`${month.replace('-', '年')}月`} title="予算・貯蓄目標" description="確定済み台帳の支出と月間予算を比較します。"><button className="primary-btn" onClick={() => setShowGoalForm((value) => !value)}><Goal size={17} /> 目標を追加</button></PageHeader>
    {notice && <div className="import-notice" role="status">{notice}</div>}
    {showGoalForm && <section className="panel planning-form"><input aria-label="目標名" value={goalName} onChange={(event) => setGoalName(event.target.value)} placeholder="家族旅行" /><input aria-label="目標額" type="number" min="1" value={goalTarget} onChange={(event) => setGoalTarget(event.target.value)} placeholder="1000000" /><input aria-label="目標日" type="date" value={goalDate} onChange={(event) => setGoalDate(event.target.value)} /><button className="primary-btn" disabled={busy} onClick={() => void createGoal()}>保存</button></section>}
    <section className="budget-layout"><article className="panel budget-panel"><div className="panel-head"><div><h2>カテゴリー予算</h2><p>{budgets.length}カテゴリー</p></div><strong>{yen(totalActual)} / {yen(totalBudget)}</strong></div><div className="planning-form"><select aria-label="予算カテゴリー" value={budgetAccountId} onChange={(event) => setBudgetAccountId(event.target.value)}><option value="">カテゴリーを選択</option>{expenseAccounts.map((account) => <option key={account.id} value={account.id}>{account.name}</option>)}</select><input aria-label="月間予算" type="number" min="0" value={budgetAmount} onChange={(event) => setBudgetAmount(event.target.value)} placeholder="50000" /><button className="secondary-btn" disabled={busy || expenseAccounts.length === 0} onClick={() => void saveBudget()}>予算を保存</button></div>{budgets.length === 0 ? <p className="empty-state">カテゴリー予算はまだありません。</p> : budgets.map((budget, index) => <div className="budget-row" key={budget.categoryAccountId}><div><i style={{ background: palette[index % palette.length] }} /><strong>{budget.categoryName}</strong></div><span>{yen(budget.actualJpy)} <small>/ {yen(budget.budgetJpy)}</small></span><div className="progress"><span style={{ width: `${budget.budgetJpy === 0 ? 100 : Math.min(100, budget.actualJpy / budget.budgetJpy * 100)}%`, background: budget.remainingJpy < 0 ? '#c95b4c' : palette[index % palette.length] }} /></div></div>)}</article><article className="panel goal-panel"><div className="panel-head"><div><h2>貯蓄目標</h2><p>{goals.filter((goal) => goal.status === 'ACTIVE').length}件進行中</p></div><Sparkles size={20} /></div>{goals.length === 0 ? <p className="empty-state">貯蓄目標はまだありません。</p> : goals.map((goal) => <div className="goal-editor" key={goal.id}><strong>{goal.name}</strong><span>{yen(goal.savedJpy)} / {yen(goal.targetJpy)} ・ {goal.targetDate}</span><div className="progress"><span style={{ width: `${Math.min(100, goal.savedJpy / goal.targetJpy * 100)}%` }} /></div><div><input aria-label={`${goal.name}の貯蓄済み金額`} type="number" min="0" value={goalDrafts[goal.id] ?? ''} onChange={(event) => setGoalDrafts((current) => ({ ...current, [goal.id]: event.target.value }))} /><button className="secondary-btn" disabled={busy} onClick={() => void updateGoal(goal)}>更新</button><button className="text-btn" disabled={busy} onClick={() => void deleteGoal(goal)}>削除</button></div></div>)}</article></section>
  </>
}

function RulesPage({ householdId, accounts }: { householdId: string | null; accounts: readonly AccountDto[] }) {
  const [rules, setRules] = useState<readonly ClassificationRuleDto[]>([])
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
    setRules(await platformClient.listClassificationRules(householdId))
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

  return <><PageHeader eyebrow="自動化" title="分類ルール" description="店舗名や摘要に一致する取引へ、説明可能なカテゴリー・ラベル・タグを適用します。" />
    {notice && <div className="import-notice" role="status">{notice}</div>}
    <section className="panel rule-builder"><div className="panel-head"><div><h2>新しいルール</h2><p>優先度の小さいルールから評価します。</p></div></div><div className="rule-form"><input aria-label="ルール名" value={name} onChange={(event) => setName(event.target.value)} placeholder="コンビニを食費に分類" /><input aria-label="店舗名の条件" value={merchant} onChange={(event) => setMerchant(event.target.value)} placeholder="店舗名に含む文字" /><input aria-label="摘要の条件" value={description} onChange={(event) => setDescription(event.target.value)} placeholder="摘要に含む文字（任意）" /><select aria-label="分類先カテゴリー" value={categoryAccountId} onChange={(event) => setCategoryAccountId(event.target.value)}><option value="">カテゴリーを選択</option>{expenseAccounts.map((account) => <option key={account.id} value={account.id}>{account.name}</option>)}</select><input aria-label="ラベル" value={labels} onChange={(event) => setLabels(event.target.value)} placeholder="subscription, tax deductible" /><input aria-label="タグ" value={tags} onChange={(event) => setTags(event.target.value)} placeholder="#family, #trip" /><input aria-label="ルール優先度" type="number" min="0" value={priority} onChange={(event) => setPriority(event.target.value)} /><button className="primary-btn" disabled={busy || expenseAccounts.length === 0} onClick={() => void createRule()}>ルールを保存</button></div></section>
    <section className="panel rule-list"><div className="panel-head"><div><h2>保存済みルール</h2><p>{rules.length}件・ローカル台帳に保存</p></div></div>{rules.length === 0 ? <p className="empty-state">分類ルールはまだありません。</p> : rules.map((rule) => <article key={rule.id} className={rule.isEnabled ? '' : 'disabled'}><div><strong>{rule.name}</strong><span>優先度 {rule.priority} ・ {rule.categoryName}</span></div><p>{[rule.merchantContains && `店舗: ${rule.merchantContains}`, rule.descriptionContains && `摘要: ${rule.descriptionContains}`].filter(Boolean).join(' / ')}</p><div className="rule-chips">{rule.labels.map((label) => <span key={`l-${label}`}>{label}</span>)}{rule.tags.map((tag) => <span key={`t-${tag}`}>#{tag}</span>)}</div><button className="secondary-btn" disabled={busy} onClick={() => void toggleRule(rule)}>{rule.isEnabled ? '無効にする' : '有効にする'}</button><button className="text-btn" disabled={busy} onClick={() => void deleteRule(rule)}>削除</button></article>)}</section>
  </>
}

function AccountEditor({ householdId, account, onChanged, setNotice }: { householdId: string; account: AccountDto; onChanged: () => Promise<void>; setNotice: (notice: string) => void }) {
  const [name, setName] = useState(account.name)
  const [busy, setBusy] = useState(false)
  const rename = async () => { if (!name.trim()) return; setBusy(true); try { await platformClient.renameAccount({ householdId, accountId: account.id, name: name.trim() }); await onChanged(); setNotice('口座名を更新しました。') } catch { setNotice('口座名を更新できませんでした。') } finally { setBusy(false) } }
  const archive = async () => { setBusy(true); try { await platformClient.archiveAccount({ householdId, accountId: account.id }); await onChanged(); setNotice('未使用の口座をアーカイブしました。') } catch { setNotice('この口座は台帳・取込・予算で使用中、または必須口座のためアーカイブできません。') } finally { setBusy(false) } }
  return <div className="account-editor"><span>{account.accountKind} / {account.accountSubtype}</span><input aria-label={`${account.name}の口座名`} value={name} onChange={(event) => setName(event.target.value)} /><button className="secondary-btn" disabled={busy || name.trim() === account.name} onClick={() => void rename()}>名前を保存</button><button className="text-btn" disabled={busy} onClick={() => void archive()}>アーカイブ</button></div>
}

function SettingsPage({ householdId, accounts, onAccountsChanged }: { householdId: string | null; accounts: readonly AccountDto[]; onAccountsChanged: () => Promise<void> }) {
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
  const [accountBusy, setAccountBusy] = useState(false)
  const subtypes: Record<AccountDto['accountKind'], readonly AccountDto['accountSubtype'][]> = { ASSET: ['BANK', 'CASH', 'WALLET', 'SECURITIES', 'RECEIVABLE', 'OTHER'], LIABILITY: ['CREDIT_CARD', 'OTHER'], EQUITY: ['OTHER'], INCOME: ['OTHER'], EXPENSE: ['OTHER'] }

  const createAccount = async () => {
    if (!householdId || !accountName.trim()) { setAccountNotice('口座名を入力してください。'); return }
    setAccountBusy(true); setAccountNotice('')
    try { await platformClient.createAccount({ id: `${householdId}-${crypto.randomUUID()}`, householdId, name: accountName.trim(), accountKind, accountSubtype, currency: 'JPY' }); await onAccountsChanged(); setAccountName(''); setAccountNotice('口座を追加しました。') }
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

  return <><PageHeader eyebrow="ローカルデータ" title="設定" description="口座、暗号化データ、バックアップを管理します。" /><section className="panel account-settings"><div className="panel-head"><div><h2>口座・カテゴリー</h2><p>銀行、ウォレット、カード、収入・支出カテゴリーを管理します。</p></div></div>{platformClient.runtime === 'tauri' && householdId ? <><div className="planning-form"><input aria-label="新しい口座名" value={accountName} onChange={(event) => setAccountName(event.target.value)} placeholder="ゆうちょ銀行" /><select aria-label="口座種別" value={accountKind} onChange={(event) => { const kind = event.target.value as AccountDto['accountKind']; setAccountKind(kind); setAccountSubtype(subtypes[kind][0]) }}>{Object.keys(subtypes).map((kind) => <option key={kind}>{kind}</option>)}</select><select aria-label="口座サブタイプ" value={accountSubtype} onChange={(event) => setAccountSubtype(event.target.value as AccountDto['accountSubtype'])}>{subtypes[accountKind].map((subtype) => <option key={subtype}>{subtype}</option>)}</select><button className="primary-btn" disabled={accountBusy} onClick={() => void createAccount()}>口座を追加</button></div><div className="account-list">{accounts.map((account) => <AccountEditor key={account.id} householdId={householdId} account={account} onChanged={onAccountsChanged} setNotice={setAccountNotice} />)}</div>{accountNotice && <p role="status">{accountNotice}</p>}</> : <p className="empty-state">口座管理はデスクトップ版で利用できます。</p>}</section><section className="panel settings-panel"><div><h2>暗号化バックアップ</h2><p>SQLCipher台帳と暗号化済み原本を、認証付きアーカイブに保存します。パスフレーズを失うと復元できません。</p></div><div className="backup-form"><label htmlFor="backup-passphrase">パスフレーズ</label><input id="backup-passphrase" type="password" autoComplete="new-password" value={passphrase} onChange={(event) => setPassphrase(event.target.value)} placeholder="12文字以上" /><label htmlFor="backup-confirmation">パスフレーズを確認</label><input id="backup-confirmation" type="password" autoComplete="new-password" value={confirmation} onChange={(event) => setConfirmation(event.target.value)} /><button className="primary-btn" disabled={busy || platformClient.runtime !== 'tauri'} onClick={() => void createBackup()}>{busy ? 'データを固定中…' : 'バックアップを作成'}</button>{platformClient.runtime === 'web' && <small>デスクトップ版で利用できます。</small>}{notice && <p role="status">{notice}</p>}</div></section><section className="panel settings-panel restore-panel"><div><h2>バックアップから復元</h2><p><strong>注意:</strong> 現在の台帳と原本は、選択したバックアップの内容に置き換わります。復元前に現在のバックアップを作成してください。置き換えの最終確認はOSのダイアログで行います。</p></div><div className="backup-form"><label htmlFor="restore-passphrase">復元用パスフレーズ</label><input id="restore-passphrase" type="password" autoComplete="off" value={restorePassphrase} onChange={(event) => setRestorePassphrase(event.target.value)} placeholder="バックアップ作成時のパスフレーズ" /><label htmlFor="restore-confirmation">復元用パスフレーズを確認</label><input id="restore-confirmation" type="password" autoComplete="off" value={restoreConfirmation} onChange={(event) => setRestoreConfirmation(event.target.value)} /><button className="danger-btn" disabled={restoreBusy || platformClient.runtime !== 'tauri'} onClick={() => void restoreBackup()}>{restoreBusy ? 'バックアップを検証中…' : 'バックアップを選択して復元'}</button>{platformClient.runtime === 'web' && <small>復元はデスクトップ版で利用できます。</small>}{restoreNotice && <p role="status">{restoreNotice}</p>}</div></section></>
}

function Onboarding({ onCreated }: { onCreated: (household: HouseholdDto) => void }) {
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
      onCreated(await platformClient.createHousehold({ id: globalThis.crypto.randomUUID(), name: trimmed }))
    } catch {
      setError('世帯を作成できませんでした。もう一度お試しください。')
    } finally {
      setBusy(false)
    }
  }

  return <div className="onboarding-backdrop"><section className="onboarding-card" role="dialog" aria-modal="true" aria-labelledby="onboarding-title"><div className="brand-mark"><Leaf size={22} /></div><p>KakeFlowへようこそ</p><h1 id="onboarding-title">家計簿をはじめましょう</h1><span>データはこの端末で暗号化して保存されます。</span><form onSubmit={(event) => void submit(event)}><label htmlFor="household-name">世帯名</label><input id="household-name" autoFocus maxLength={80} value={name} onChange={(event) => setName(event.target.value)} placeholder="例：田中家" />{error && <small role="alert">{error}</small>}<button className="primary-btn" disabled={busy}>{busy ? '作成中…' : '安全な家計簿を作成'}</button></form></section></div>
}

function App() {
  const [page, setPage] = useState<PageId>('overview')
  const [sidebarOpen, setSidebarOpen] = useState(false)
  const [importPreviews, setImportPreviews] = useState<ImportPreview[]>([])
  const [bootstrap, setBootstrap] = useState<AppBootstrapDto | null>(null)
  const [households, setHouseholds] = useState<readonly HouseholdDto[]>([])
  const [activeHouseholdId, setActiveHouseholdId] = useState<string | null>(() => globalThis.localStorage?.getItem('kakeflow.activeHouseholdId') ?? null)
  const [accounts, setAccounts] = useState<readonly AccountDto[]>([])
  const [liveDashboard, setLiveDashboard] = useState<DashboardMonthlyTotalsDto | null>(null)
  const [liveTransactions, setLiveTransactions] = useState<readonly TransactionRowDto[]>([])
  const [importCounts, setImportCounts] = useState<ImportRunCountsDto | null>(null)
  const [liveCards, setLiveCards] = useState<readonly CardSettlementDto[]>([])
  const [ledgerRevision, setLedgerRevision] = useState(0)
  const [desktopLoaded, setDesktopLoaded] = useState(platformClient.runtime === 'web')
  const [selectedMonth, setSelectedMonth] = useState(() => globalThis.localStorage?.getItem('kakeflow.selectedMonth') ?? currentTokyoPeriod().month)
  const [backgroundFolderChanges, setBackgroundFolderChanges] = useState(0)

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
      return
    }
    let active = true
    void platformClient.listAccounts(householdId).then((result) => {
      if (active) setAccounts(result)
    }).catch(() => {
      if (active) setAccounts([])
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
      return
    }
    let active = true
    const period = periodFromMonth(selectedMonth)
    void Promise.all([
      platformClient.queryDashboard({ householdId, month: period.month, accountingBasis: 'ACCRUAL' }),
      platformClient.queryTransactions({ householdId, accountingBasis: 'ACCRUAL', fromDate: period.fromDate, toDate: period.toDate, page: 1, pageSize: 4 }),
      platformClient.importSummary(householdId),
      platformClient.listCardSettlements(householdId),
    ]).then(([dashboard, page, summary, cards]) => {
      if (active) { setLiveDashboard(dashboard); setLiveTransactions(page.items); setImportCounts(summary); setLiveCards(cards) }
    }).catch(() => {
      if (active) { setLiveDashboard(null); setLiveTransactions([]); setImportCounts(null); setLiveCards([]) }
    })
    return () => { active = false }
  }, [activeHouseholdId, ledgerRevision, selectedMonth])

  useEffect(() => {
    if (!activeHouseholdId || platformClient.runtime !== 'tauri') return
    let disposed = false
    let unlisten: (() => void) | undefined
    void watchedFolderDiscoveryPlatform.subscribe((event) => {
      if (!disposed && event.householdId === activeHouseholdId) setBackgroundFolderChanges((current) => current + event.changes.length)
    }).then((stop) => { if (disposed) stop(); else unlisten = stop }).catch(() => undefined)
    return () => { disposed = true; unlisten?.() }
  }, [activeHouseholdId])

  const selectMonth = (month: string) => {
    const selected = periodFromMonth(month).month
    globalThis.localStorage?.setItem('kakeflow.selectedMonth', selected)
    setSelectedMonth(selected)
  }

  const activeHousehold = households.find((household) => household.id === activeHouseholdId) ?? null
  const selectHousehold = (id: string) => {
    if (!households.some((household) => household.id === id)) return
    globalThis.localStorage?.setItem('kakeflow.activeHouseholdId', id)
    setActiveHouseholdId(id)
  }

  const pageContent = {
    overview: <Overview setPage={setPage} liveDashboard={liveDashboard} liveTransactions={liveTransactions} liveCards={liveCards} desktop={platformClient.runtime === 'tauri'} householdName={activeHousehold?.name ?? '家計'} month={selectedMonth} />,
    transactions: <TransactionsPage householdId={activeHouseholdId} revision={ledgerRevision} month={selectedMonth} accounts={accounts} onChanged={() => setLedgerRevision((value) => value + 1)} />,
    import: <ImportPage previews={importPreviews} setPreviews={setImportPreviews} householdId={activeHouseholdId} accounts={accounts} summary={importCounts} onChanged={() => setLedgerRevision((value) => value + 1)} backgroundChanges={backgroundFolderChanges} clearBackgroundChanges={() => setBackgroundFolderChanges(0)} />,
    cards: <CardsPage cards={liveCards} householdId={activeHouseholdId} onChanged={() => setLedgerRevision((value) => value + 1)} month={selectedMonth} />,
    investments: <InvestmentsPage householdId={activeHouseholdId} revision={ledgerRevision} openImport={() => setPage('import')} />,
    reports: <ReportsPage householdId={activeHouseholdId} accounts={accounts} month={selectedMonth} revision={ledgerRevision} openPage={setPage} />,
    budgets: <BudgetsPage householdId={activeHouseholdId} accounts={accounts} month={selectedMonth} revision={ledgerRevision} />,
    rules: <RulesPage householdId={activeHouseholdId} accounts={accounts} />,
    settings: <SettingsPage householdId={activeHouseholdId} accounts={accounts} onAccountsChanged={async () => { if (activeHouseholdId) setAccounts(await platformClient.listAccounts(activeHouseholdId)) }} />,
  }[page]
  return <div className="app-shell"><Sidebar page={page} setPage={setPage} open={sidebarOpen} close={() => setSidebarOpen(false)} bootstrap={bootstrap} households={households} activeHouseholdId={activeHouseholdId} selectHousehold={selectHousehold} /><div className="main-shell"><Topbar openMenu={() => setSidebarOpen(true)} month={selectedMonth} setMonth={selectMonth} /><main>{pageContent}</main></div>{platformClient.runtime === 'tauri' && desktopLoaded && households.length === 0 && <Onboarding onCreated={(household) => { setHouseholds([household]); globalThis.localStorage?.setItem('kakeflow.activeHouseholdId', household.id); setActiveHouseholdId(household.id) }} />}</div>
}

export default App
