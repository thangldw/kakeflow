import { useEffect, useRef, useState } from 'react'
import {
  ArrowDownLeft,
  ArrowRight,
  ArrowUpRight,
  CircleDollarSign,
  CreditCard,
  FileCheck2,
  Goal,
  Home,
  Import,
  Leaf,
  Menu,
  MoreHorizontal,
  Search,
  Settings,
  Sparkles,
  TrainFront,
  TrendingUp,
  Utensils,
  WalletCards,
  X,
  Zap,
} from 'lucide-react'
import { cardSettlements, categoryData, importItems, spendingTrend, transactions } from './data'
import { save } from '@tauri-apps/plugin-dialog'
import { previewImportFiles } from './features/import/importService'
import type { ImportPreview } from './features/import/importService'
import { sha256Text } from './features/import/importService'
import { mapParsedImportToStartImport } from './features/import/importMapper'
import { buildReceiptImport } from './features/import/receiptText'
import { toTransactionViewModel } from './features/transactions/transactionViewModel'
import { budgetByCategory, budgetUsage, currentMonthMetrics, savings, savingsRate } from './metrics'
import { platformClient } from './platform'
import type { AccountDto, AppBootstrapDto, CardSettlementDto, DashboardMonthlyTotalsDto, HouseholdDto, ImportPreviewDto, ImportRunCountsDto, PostingDecisionDto, PreviewCandidateDto, TransactionRowDto } from './platform'
import type { NavigationItem, PageId, Transaction } from './types'

const yen = (value: number) => `${value < 0 ? '−' : ''}¥${Math.abs(value).toLocaleString('ja-JP')}`

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
  { id: 'budgets', label: '予算・目標', icon: Goal },
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

function TransactionRows({ rows = transactions }: { rows?: Transaction[] }) {
  return <div className="transaction-list">{rows.map((tx) => {
    const Icon = txIcons[tx.icon]
    return <div className="transaction-row" key={tx.id}>
      <div className={`transaction-icon ${tx.amount > 0 ? 'positive' : ''}`}><Icon size={18} /></div>
      <div className="transaction-main"><strong>{tx.merchant}</strong><span>{tx.date} ・ {tx.detail}</span></div>
      <span className="category-pill">{tx.category}</span>
      <span className="account-label">{tx.account}</span>
      <strong className={tx.amount > 0 ? 'amount-positive' : ''}>{yen(tx.amount)}</strong>
      {tx.status === 'review' && <span className="review-dot" title="要確認" />}
    </div>
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

function TransactionsPage({ householdId, revision, month }: { householdId: string | null; revision: number; month: string }) {
  const [query, setQuery] = useState('')
  const [basis, setBasis] = useState<'ACCRUAL' | 'CASH'>('ACCRUAL')
  const [liveRows, setLiveRows] = useState<readonly TransactionRowDto[]>([])
  const [liveTotals, setLiveTotals] = useState<DashboardMonthlyTotalsDto | null>(null)
  const [loadError, setLoadError] = useState(false)
  const desktop = platformClient.runtime === 'tauri'

  useEffect(() => {
    if (!desktop || !householdId) return
    let active = true
    const period = periodFromMonth(month)
    setLoadError(false)
    void Promise.all([
      platformClient.queryTransactions({ householdId, accountingBasis: basis, fromDate: period.fromDate, toDate: period.toDate, page: 1, pageSize: 100 }),
      platformClient.queryDashboard({ householdId, month: period.month, accountingBasis: basis }),
    ]).then(([page, totals]) => {
      if (active) { setLiveRows(page.items); setLiveTotals(totals) }
    }).catch(() => {
      if (active) { setLiveRows([]); setLiveTotals(null); setLoadError(true) }
    })
    return () => { active = false }
  }, [basis, desktop, householdId, month, revision])

  const basisTransactions = transactions.filter((transaction) => basis === 'ACCRUAL' ? transaction.accountingEffect !== 'CASH_ONLY' : transaction.accountingEffect !== 'ACCRUAL_ONLY')
  const displayRows = desktop ? liveRows.map(toTransactionViewModel) : basisTransactions
  const visible = displayRows.filter((t) => `${t.merchant}${t.category}${t.account}`.toLowerCase().includes(query.toLowerCase()))
  const basisExpense = desktop ? liveTotals?.expenseJpy ?? 0 : basis === 'ACCRUAL' ? currentMonthMetrics.expense : currentMonthMetrics.cashOutflow
  const basisIncome = desktop ? liveTotals?.incomeJpy ?? 0 : currentMonthMetrics.income
  return <>
    <PageHeader eyebrow="取引台帳" title="すべての取引" description="確定した取引と元データを一か所で管理します。" />
    <section className="panel table-panel">
      <div className="table-toolbar"><div className="search table-search"><Search size={17} /><input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="店舗、カテゴリー、口座を検索" /></div><div className="basis-toggle" aria-label="計上基準"><button className={basis === 'ACCRUAL' ? 'active' : ''} aria-pressed={basis === 'ACCRUAL'} onClick={() => setBasis('ACCRUAL')}>発生ベース</button><button className={basis === 'CASH' ? 'active' : ''} aria-pressed={basis === 'CASH'} onClick={() => setBasis('CASH')}>資金移動</button></div></div>
      <div className="table-summary"><span>{month}・{basis === 'ACCRUAL' ? '発生ベース' : '資金移動ベース'}</span><strong>収入 {yen(basisIncome)}</strong><strong>{basis === 'ACCRUAL' ? '支出' : '現金流出'} {yen(basisExpense)}</strong><em>{visible.length}件を表示</em></div>
      {loadError ? <p className="empty-state">台帳を読み込めませんでした。</p> : visible.length > 0 ? <TransactionRows rows={visible} /> : <p className="empty-state">条件に一致する取引はありません。</p>}
    </section>
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

function ImportPage({ previews, setPreviews, householdId, accounts, summary, onChanged }: { previews: ImportPreview[]; setPreviews: React.Dispatch<React.SetStateAction<ImportPreview[]>>; householdId: string | null; accounts: readonly AccountDto[]; summary: ImportRunCountsDto | null; onChanged: () => void }) {
  const inputRef = useRef<HTMLInputElement>(null)
  const [busy, setBusy] = useState(false)
  const [activeRun, setActiveRun] = useState<string | null>(null)
  const [staged, setStaged] = useState<Record<string, ImportPreviewDto>>({})
  const [notice, setNotice] = useState('')

  const processFiles = async (files: FileList | readonly File[]) => {
    if (files.length === 0) return
    setBusy(true)
    const next = await previewImportFiles(files)
    setPreviews((current) => {
      const merged = new Map(current.map((item) => [item.id, item]))
      next.forEach((item) => merged.set(item.id, item))
      return Array.from(merged.values()).reverse()
    })
    setBusy(false)
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
          householdId, sourceType: 'MANUAL_UPLOAD', originalFilename: item.filename,
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
        sha256: item.id, sourceModifiedAt: item.sourceModifiedAt ?? null, accountId: `${householdId}-cash`,
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

  const commitRun = async (previewId: string, stagedImport: ImportPreviewDto) => {
    setActiveRun(stagedImport.summary.runId)
    setNotice('')
    try {
      const decisions = stagedImport.candidates.map((candidate) => suggestedPosting(candidate, accounts, householdId!))
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
      <button className="primary-btn" disabled={busy} onClick={() => inputRef.current?.click()}><Import size={17} /> {busy ? '解析中…' : 'ファイルを選択'}</button>
      <input ref={inputRef} className="visually-hidden" type="file" accept=".csv,.xlsx,.pdf,.png,.jpg,.jpeg,text/csv,application/pdf,image/png,image/jpeg,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" multiple onChange={(event) => { const files = event.currentTarget.files; event.currentTarget.value = ''; if (files) void processFiles(files) }} />
    </PageHeader>
    <section className="status-grid">
      {[
        ['取込済み', String(summary?.posted ?? (platformClient.runtime === 'web' ? 79 : 0)), `${summary?.sourceDocuments ?? 0}原本`],
        ['確認待ち', String(summary?.reviewRequired ?? (platformClient.runtime === 'web' ? 6 : 0)), `${summary?.readyCandidates ?? 0}候補`],
        ['処理失敗', String(summary?.failed ?? (platformClient.runtime === 'web' ? 2 : 0)), '再実行可能'],
        ['ソース行', String(summary?.sourceRecords ?? (platformClient.runtime === 'web' ? 4 : 0)), '監査証跡'],
      ].map((x, i) => <article className="status-card" key={x[0]}><span className={`status-orb s${i}`} /><div><strong>{x[1]}</strong><span>{x[0]}</span><small>{x[2]}</small></div></article>)}
    </section>
    <section className="panel import-panel">
      <div className="panel-head"><div><h2>最近のファイル</h2><p>選択またはドロップしたローカルファイル</p></div></div>
      <button className="drop-zone" onClick={() => inputRef.current?.click()} onDragOver={(event) => event.preventDefault()} onDrop={(event) => { event.preventDefault(); void processFiles(event.dataTransfer.files) }}><Import size={20} /><span>CSV / Excel / PDF / レシート画像をここにドロップ</span><small>PayPay・銀行・カード・PNG / JPEGレシート</small></button>
      <div className="import-list">
        {previews.map((item) => <div className="import-row" key={item.id}><div className="file-icon"><FileCheck2 size={19} /></div><div><strong>{item.filename}</strong><span>{item.adapterId ?? '未対応の形式'} ・ {item.encoding}</span></div><span>{item.recordCount} レコード</span><b className={item.status === 'ready' ? 'ready' : 'review'}>{staged[item.id] ? 'レビュー待ち' : item.status === 'ready' ? 'プレビュー完了' : item.status === 'extractable' ? item.mediaType?.startsWith('image/') ? 'OCR待ち' : 'テキスト抽出待ち' : '確認が必要'}</b>{item.status === 'ready' && !staged[item.id] ? <button className="mini-btn" disabled={platformClient.runtime !== 'tauri' || !householdId || accounts.length === 0 || activeRun === item.id} onClick={() => void stageImport(item)}>{activeRun === item.id ? '暗号化中…' : platformClient.runtime === 'tauri' ? '取込開始' : 'Desktopのみ'}</button> : item.status === 'extractable' && !staged[item.id] ? <button className="mini-btn" disabled={platformClient.runtime !== 'tauri' || !householdId || accounts.length === 0 || activeRun === item.id} onClick={() => void extractDocument(item)}>{activeRun === item.id ? '抽出中…' : item.mediaType?.startsWith('image/') ? '画像OCR' : 'PDF抽出'}</button> : <span className="icon-btn" title={item.issues.map((issue) => issue.message).join('\n')}><MoreHorizontal size={18} /></span>}</div>)}
        {platformClient.runtime === 'web' && importItems.map((item) => <div className="import-row" key={item.file}><div className="file-icon"><FileCheck2 size={19} /></div><div><strong>{item.file}</strong><span>{item.source} ・ {item.time}</span></div><span>{item.records} レコード</span><b className={item.state}>{item.state === 'ready' ? '反映可能' : item.state === 'review' ? '確認が必要' : item.state === 'matched' ? '取引に照合済み' : '処理済み'}</b></div>)}
        {platformClient.runtime === 'tauri' && previews.length === 0 && <p className="empty-state">ファイルを選択すると、ここに解析結果が表示されます。</p>}
      </div>
    </section>
    {notice && <div className="import-notice" role="status">{notice}</div>}
    {Object.entries(staged).map(([previewId, stagedImport]) => <section className="panel review-panel" key={stagedImport.summary.runId}><div className="panel-head"><div><h2>{stagedImport.source.originalFilename}</h2><p>{stagedImport.candidates.length}件の候補・原本は暗号化済み</p></div><b>REVIEW</b></div><div className="candidate-review-list">{stagedImport.candidates.map((candidate) => { const suggestion = suggestedPosting(candidate, accounts, householdId!); return <div className="candidate-review-row" key={candidate.id}><div><strong>{candidate.merchantRaw ?? candidate.descriptionRaw ?? '名称未設定'}</strong><span>{candidate.occurredOn} ・ {candidate.direction}</span></div><span>{suggestion.transactionType}</span><strong>{yen(candidate.amountJpy)}</strong>{candidate.issues.length > 0 && <small>{candidate.issues.join(', ')}</small>}</div> })}</div><div className="review-actions"><button className="secondary-btn" disabled={activeRun === stagedImport.summary.runId} onClick={() => void rollbackRun(previewId, stagedImport.summary.runId)}>取り消す</button><button className="primary-btn" disabled={activeRun === stagedImport.summary.runId || stagedImport.candidates.length === 0} onClick={() => void commitRun(previewId, stagedImport)}>{activeRun === stagedImport.summary.runId ? '処理中…' : '確認して台帳へ反映'}</button></div></section>)}
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

function BudgetsPage() {
  const budgets = budgetByCategory
  return <>
    <PageHeader eyebrow="プランニング" title="予算・貯蓄目標" description="今月使える金額と、家族の将来のための貯蓄を見通します。" />
    <section className="budget-layout"><article className="panel budget-panel"><div className="panel-head"><div><h2>7月のカテゴリー予算</h2><p>全体の {(budgetUsage * 100).toFixed(1)}% を使用</p></div><strong>{yen(currentMonthMetrics.expense)} / {yen(currentMonthMetrics.budget)}</strong></div>{budgets.map((b) => <div className="budget-row" key={b.name}><div><i style={{background:b.color}} /><strong>{b.name}</strong></div><span>{yen(b.amount)} <small>/ {yen(b.budget)}</small></span><div className="progress"><span style={{width:`${Math.min(100,b.amount/b.budget*100)}%`,background:b.color}} /></div></div>)}</article><article className="panel goal-panel"><div className="panel-head"><div><h2>貯蓄目標</h2><p>家族旅行 2027</p></div><Sparkles size={20} /></div><div className="goal-ring"><div><strong>68%</strong><span>達成</span></div></div><strong>{yen(680000)} <small>/ {yen(1000000)}</small></strong><span>毎月 ¥40,000 であと8か月</span></article></section>
  </>
}

function SettingsPage() {
  const [passphrase, setPassphrase] = useState('')
  const [confirmation, setConfirmation] = useState('')
  const [notice, setNotice] = useState('')
  const [busy, setBusy] = useState(false)
  const [restorePassphrase, setRestorePassphrase] = useState('')
  const [restoreConfirmation, setRestoreConfirmation] = useState('')
  const [restoreNotice, setRestoreNotice] = useState('')
  const [restoreBusy, setRestoreBusy] = useState(false)

  const createBackup = async () => {
    if (passphrase.length < 12) { setNotice('12文字以上のパスフレーズを入力してください。'); return }
    if (passphrase !== confirmation) { setNotice('パスフレーズが一致しません。'); return }
    setBusy(true); setNotice('')
    try {
      const archivePath = await save({ defaultPath: `kakeflow-${currentTokyoPeriod().month}.kakeflow-backup`, filters: [{ name: 'KakeFlow Backup', extensions: ['kakeflow-backup'] }] })
      if (!archivePath) return
      const result = await platformClient.createBackup(archivePath, passphrase)
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

  return <><PageHeader eyebrow="ローカルデータ" title="設定" description="暗号化データの保護とバックアップを管理します。" /><section className="panel settings-panel"><div><h2>暗号化バックアップ</h2><p>SQLCipher台帳と暗号化済み原本を、認証付きアーカイブに保存します。パスフレーズを失うと復元できません。</p></div><div className="backup-form"><label htmlFor="backup-passphrase">パスフレーズ</label><input id="backup-passphrase" type="password" autoComplete="new-password" value={passphrase} onChange={(event) => setPassphrase(event.target.value)} placeholder="12文字以上" /><label htmlFor="backup-confirmation">パスフレーズを確認</label><input id="backup-confirmation" type="password" autoComplete="new-password" value={confirmation} onChange={(event) => setConfirmation(event.target.value)} /><button className="primary-btn" disabled={busy || platformClient.runtime !== 'tauri'} onClick={() => void createBackup()}>{busy ? 'データを固定中…' : 'バックアップを作成'}</button>{platformClient.runtime === 'web' && <small>デスクトップ版で利用できます。</small>}{notice && <p role="status">{notice}</p>}</div></section><section className="panel settings-panel restore-panel"><div><h2>バックアップから復元</h2><p><strong>注意:</strong> 現在の台帳と原本は、選択したバックアップの内容に置き換わります。復元前に現在のバックアップを作成してください。置き換えの最終確認はOSのダイアログで行います。</p></div><div className="backup-form"><label htmlFor="restore-passphrase">復元用パスフレーズ</label><input id="restore-passphrase" type="password" autoComplete="off" value={restorePassphrase} onChange={(event) => setRestorePassphrase(event.target.value)} placeholder="バックアップ作成時のパスフレーズ" /><label htmlFor="restore-confirmation">復元用パスフレーズを確認</label><input id="restore-confirmation" type="password" autoComplete="off" value={restoreConfirmation} onChange={(event) => setRestoreConfirmation(event.target.value)} /><button className="danger-btn" disabled={restoreBusy || platformClient.runtime !== 'tauri'} onClick={() => void restoreBackup()}>{restoreBusy ? 'バックアップを検証中…' : 'バックアップを選択して復元'}</button>{platformClient.runtime === 'web' && <small>復元はデスクトップ版で利用できます。</small>}{restoreNotice && <p role="status">{restoreNotice}</p>}</div></section></>
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
    transactions: <TransactionsPage householdId={activeHouseholdId} revision={ledgerRevision} month={selectedMonth} />,
    import: <ImportPage previews={importPreviews} setPreviews={setImportPreviews} householdId={activeHouseholdId} accounts={accounts} summary={importCounts} onChanged={() => setLedgerRevision((value) => value + 1)} />,
    cards: <CardsPage cards={liveCards} householdId={activeHouseholdId} onChanged={() => setLedgerRevision((value) => value + 1)} month={selectedMonth} />,
    budgets: <BudgetsPage />,
    settings: <SettingsPage />,
  }[page]
  return <div className="app-shell"><Sidebar page={page} setPage={setPage} open={sidebarOpen} close={() => setSidebarOpen(false)} bootstrap={bootstrap} households={households} activeHouseholdId={activeHouseholdId} selectHousehold={selectHousehold} /><div className="main-shell"><Topbar openMenu={() => setSidebarOpen(true)} month={selectedMonth} setMonth={selectMonth} /><main>{pageContent}</main></div>{platformClient.runtime === 'tauri' && desktopLoaded && households.length === 0 && <Onboarding onCreated={(household) => { setHouseholds([household]); globalThis.localStorage?.setItem('kakeflow.activeHouseholdId', household.id); setActiveHouseholdId(household.id) }} />}</div>
}

export default App
