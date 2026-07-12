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
import { previewImportFiles } from './features/import/importService'
import type { ImportPreview } from './features/import/importService'
import { sha256Text } from './features/import/importService'
import { mapParsedImportToStartImport } from './features/import/importMapper'
import { buildReceiptImport } from './features/import/receiptText'
import { toTransactionViewModel } from './features/transactions/transactionViewModel'
import { budgetByCategory, budgetUsage, currentMonthMetrics, savings, savingsRate } from './metrics'
import { platformClient } from './platform'
import type { AccountDto, AppBootstrapDto, CardSettlementDto, DashboardMonthlyTotalsDto, HouseholdDto, ImportPreviewDto, ImportRunCountsDto, ManualTransactionTypeDto, MonthlyCategoryBudgetDto, PostingDecisionDto, PreviewCandidateDto, SavingsGoalDto, TransactionRowDto } from './platform'
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
    <section className="panel table-panel">
      <div className="table-toolbar"><div className="search table-search"><Search size={17} /><input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="店舗、カテゴリー、口座を検索" /></div><div className="basis-toggle" aria-label="計上基準"><button className={basis === 'ACCRUAL' ? 'active' : ''} aria-pressed={basis === 'ACCRUAL'} onClick={() => setBasis('ACCRUAL')}>発生ベース</button><button className={basis === 'CASH' ? 'active' : ''} aria-pressed={basis === 'CASH'} onClick={() => setBasis('CASH')}>資金移動</button></div></div>
      <div className="table-summary"><span>{month}・{basis === 'ACCRUAL' ? '発生ベース' : '資金移動ベース'}</span><strong>収入 {yen(basisIncome)}</strong><strong>{basis === 'ACCRUAL' ? '支出' : '現金流出'} {yen(basisExpense)}</strong><em>{desktop ? `${totalItems}件中 ${visible.length}件` : `${visible.length}件を表示`}</em></div>
      {loadError ? <p className="empty-state">台帳を読み込めませんでした。</p> : visible.length > 0 ? <TransactionRows rows={visible} /> : <p className="empty-state">条件に一致する取引はありません。</p>}
      {desktop && totalPages > 1 && <div className="pagination"><button className="secondary-btn" disabled={ledgerPage <= 1} onClick={() => setLedgerPage((value) => value - 1)}>前へ</button><span>{ledgerPage} / {totalPages}</span><button className="secondary-btn" disabled={ledgerPage >= totalPages} onClick={() => setLedgerPage((value) => value + 1)}>次へ</button></div>}
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

function ImportReviewSection({ stagedImport, accounts, householdId, busy, onRollback, onCommit }: { stagedImport: ImportPreviewDto; accounts: readonly AccountDto[]; householdId: string; busy: boolean; onRollback: () => void; onCommit: (decisions: readonly PostingDecisionDto[]) => void }) {
  const [drafts, setDrafts] = useState(() => Object.fromEntries(stagedImport.candidates.map((candidate) => [candidate.id, { approved: false, decision: suggestedPosting(candidate, accounts, householdId) }])))
  const updateDecision = (candidateId: string, change: (decision: PostingDecisionDto) => PostingDecisionDto) => setDrafts((current) => ({ ...current, [candidateId]: { ...current[candidateId], decision: change(current[candidateId].decision) } }))
  const approved = stagedImport.candidates.every((candidate) => drafts[candidate.id]?.approved)
  const decisions = stagedImport.candidates.map((candidate) => drafts[candidate.id]?.decision).filter((decision): decision is PostingDecisionDto => Boolean(decision))

  return <section className="panel review-panel"><div className="panel-head"><div><h2>{stagedImport.source.originalFilename}</h2><p>{stagedImport.candidates.length}件の候補・原本は暗号化済み</p></div><b>REVIEW</b></div><div className="candidate-review-list">{stagedImport.candidates.map((candidate) => { const draft = drafts[candidate.id]; const debit = draft.decision.entries.find((entry) => entry.side === 'DEBIT')!; const credit = draft.decision.entries.find((entry) => entry.side === 'CREDIT')!; return <div className="candidate-review-row candidate-review-edit" key={candidate.id}><label><input aria-label={`${candidate.merchantRaw ?? candidate.descriptionRaw ?? candidate.id}を承認`} type="checkbox" checked={draft.approved} onChange={(event) => setDrafts((current) => ({ ...current, [candidate.id]: { ...current[candidate.id], approved: event.target.checked } }))} /><span>承認</span></label><div><input aria-label={`${candidate.id}の支払先`} value={draft.decision.payee ?? ''} onChange={(event) => updateDecision(candidate.id, (decision) => ({ ...decision, payee: event.target.value || null }))} /><span>{candidate.occurredOn} ・ {candidate.direction} ・ {yen(candidate.amountJpy)}</span></div><select aria-label={`${candidate.id}の取引種別`} value={draft.decision.transactionType} onChange={(event) => updateDecision(candidate.id, (decision) => ({ ...decision, transactionType: event.target.value }))}>{['EXPENSE', 'CARD_PURCHASE', 'CARD_PAYMENT', 'INCOME', 'REFUND', 'TRANSFER'].map((type) => <option key={type}>{type}</option>)}</select><select aria-label={`${candidate.id}の借方口座`} value={debit.accountId} onChange={(event) => updateDecision(candidate.id, (decision) => ({ ...decision, entries: decision.entries.map((entry) => entry.side === 'DEBIT' ? { ...entry, accountId: event.target.value } : entry) }))}>{accounts.map((account) => <option key={account.id} value={account.id}>{account.name}</option>)}</select><select aria-label={`${candidate.id}の貸方口座`} value={credit.accountId} onChange={(event) => updateDecision(candidate.id, (decision) => ({ ...decision, entries: decision.entries.map((entry) => entry.side === 'CREDIT' ? { ...entry, accountId: event.target.value } : entry) }))}>{accounts.map((account) => <option key={account.id} value={account.id}>{account.name}</option>)}</select>{candidate.issues.length > 0 && <small>{candidate.issues.join(', ')}</small>}</div> })}</div><div className="review-actions"><span>{approved ? '全候補を承認済み' : '各候補の口座と種別を確認して承認してください'}</span><button className="secondary-btn" disabled={busy} onClick={onRollback}>取り消す</button><button className="primary-btn" disabled={busy || !approved || decisions.length !== stagedImport.candidates.length} onClick={() => onCommit(decisions)}>{busy ? '処理中…' : '承認済みを台帳へ反映'}</button></div></section>
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
    transactions: <TransactionsPage householdId={activeHouseholdId} revision={ledgerRevision} month={selectedMonth} accounts={accounts} onChanged={() => setLedgerRevision((value) => value + 1)} />,
    import: <ImportPage previews={importPreviews} setPreviews={setImportPreviews} householdId={activeHouseholdId} accounts={accounts} summary={importCounts} onChanged={() => setLedgerRevision((value) => value + 1)} />,
    cards: <CardsPage cards={liveCards} householdId={activeHouseholdId} onChanged={() => setLedgerRevision((value) => value + 1)} month={selectedMonth} />,
    budgets: <BudgetsPage householdId={activeHouseholdId} accounts={accounts} month={selectedMonth} revision={ledgerRevision} />,
    settings: <SettingsPage householdId={activeHouseholdId} accounts={accounts} onAccountsChanged={async () => { if (activeHouseholdId) setAccounts(await platformClient.listAccounts(activeHouseholdId)) }} />,
  }[page]
  return <div className="app-shell"><Sidebar page={page} setPage={setPage} open={sidebarOpen} close={() => setSidebarOpen(false)} bootstrap={bootstrap} households={households} activeHouseholdId={activeHouseholdId} selectHousehold={selectHousehold} /><div className="main-shell"><Topbar openMenu={() => setSidebarOpen(true)} month={selectedMonth} setMonth={selectMonth} /><main>{pageContent}</main></div>{platformClient.runtime === 'tauri' && desktopLoaded && households.length === 0 && <Onboarding onCreated={(household) => { setHouseholds([household]); globalThis.localStorage?.setItem('kakeflow.activeHouseholdId', household.id); setActiveHouseholdId(household.id) }} />}</div>
}

export default App
