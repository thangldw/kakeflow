import { useRef, useState } from 'react'
import {
  ArrowDownLeft,
  ArrowRight,
  ArrowUpRight,
  Bell,
  BookOpen,
  CalendarDays,
  ChevronDown,
  CircleDollarSign,
  CreditCard,
  FileCheck2,
  Goal,
  Home,
  Import,
  LayoutDashboard,
  Leaf,
  Menu,
  MoreHorizontal,
  Search,
  Settings,
  SlidersHorizontal,
  Sparkles,
  Tags,
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
import { budgetByCategory, budgetUsage, currentMonthMetrics, savings, savingsRate } from './metrics'
import type { NavigationItem, PageId, Transaction } from './types'

const yen = (value: number) => `${value < 0 ? '−' : ''}¥${Math.abs(value).toLocaleString('ja-JP')}`

const navigation: NavigationItem[] = [
  { id: 'overview', label: 'ホーム', icon: Home },
  { id: 'transactions', label: '取引', icon: WalletCards },
  { id: 'import', label: 'インポート', icon: Import, badge: 6 },
  { id: 'cards', label: 'カード照合', icon: CreditCard, badge: 1 },
  { id: 'budgets', label: '予算・目標', icon: Goal },
]

function Sidebar({ page, setPage, open, close }: { page: PageId; setPage: (page: PageId) => void; open: boolean; close: () => void }) {
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
          <div><strong>田中家</strong><small>ファミリープラン</small></div>
          <ChevronDown size={16} />
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
          <p className="nav-caption nav-caption--second">管理</p>
          <button className="nav-item"><Tags size={19} /><span>カテゴリー・ルール</span></button>
          <button className="nav-item"><LayoutDashboard size={19} /><span>レポート</span></button>
        </nav>

        <div className="sidebar-foot">
          <div className="sync-status"><span /><div><strong>データは最新です</strong><small>本日 15:42 に更新</small></div></div>
          <button className="nav-item"><Settings size={19} /><span>設定</span></button>
        </div>
      </aside>
    </>
  )
}

function Topbar({ openMenu }: { openMenu: () => void }) {
  return (
    <header className="topbar">
      <button className="icon-btn menu-btn" aria-label="メニューを開く" onClick={openMenu}><Menu size={21} /></button>
      <div className="search"><Search size={18} /><input aria-label="検索" placeholder="取引、店舗、金額を検索" /><kbd>⌘ K</kbd></div>
      <div className="top-actions">
        <button className="icon-btn notification" aria-label="通知"><Bell size={19} /><span /></button>
        <div className="top-avatar">TK</div>
      </div>
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
      <div className="kpi-head"><div className="kpi-icon" style={{ background: accent }}><Icon size={18} /></div><span>{label}</span><MoreHorizontal size={18} /></div>
      <strong>{value}</strong>
      <div className="kpi-meta">{trend && <em><ArrowUpRight size={13} />{trend}</em>}<span>{meta}</span></div>
    </article>
  )
}

function TrendChart() {
  const max = 720
  const width = 620
  const height = 215
  const pad = 18
  const x = (i: number) => pad + i * ((width - pad * 2) / (spendingTrend.length - 1))
  const y = (v: number) => height - 10 - (v / max) * 170
  const path = (key: 'income' | 'expense') => spendingTrend.map((d, i) => `${i ? 'L' : 'M'} ${x(i)} ${y(d[key])}`).join(' ')
  return (
    <div className="chart-wrap">
      <div className="chart-y"><span>¥700k</span><span>¥500k</span><span>¥300k</span><span>¥100k</span></div>
      <svg viewBox={`0 0 ${width} ${height}`} role="img" aria-label="直近6か月の収入と支出">
        {[44, 87, 130, 173].map((line) => <line key={line} x1="18" y1={line} x2="602" y2={line} className="gridline" />)}
        <path d={`${path('income')} L ${x(5)} ${height - 10} L ${x(0)} ${height - 10} Z`} className="area-income" />
        <path d={path('income')} className="line-income" />
        <path d={path('expense')} className="line-expense" />
        {spendingTrend.map((d, i) => <circle key={`i${d.month}`} cx={x(i)} cy={y(d.income)} r="3.5" className="dot-income" />)}
        {spendingTrend.map((d, i) => <circle key={`e${d.month}`} cx={x(i)} cy={y(d.expense)} r="3.5" className="dot-expense" />)}
      </svg>
      <div className="chart-x">{spendingTrend.map((d) => <span key={d.month}>{d.month}</span>)}</div>
    </div>
  )
}

function SpendingCard() {
  const gradient = `conic-gradient(${categoryData.map((d, i) => `${d.color} ${categoryData.slice(0, i).reduce((a, b) => a + b.pct, 0)}% ${categoryData.slice(0, i + 1).reduce((a, b) => a + b.pct, 0)}%`).join(',')})`
  return (
    <article className="panel spending-card">
      <div className="panel-head"><div><h2>支出の内訳</h2><p>今月のカテゴリー別</p></div><button className="text-btn">詳細を見る <ArrowRight size={14} /></button></div>
      <div className="spending-body">
        <div className="donut" style={{ background: gradient }}><div><small>合計</small><strong>{yen(currentMonthMetrics.expense)}</strong></div></div>
        <div className="legend">{categoryData.map((item) => <div key={item.name}><i style={{ background: item.color }} /><span>{item.name}</span><strong>{yen(item.amount)}</strong><small>{item.pct}%</small></div>)}</div>
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

function ReconciliationMini() {
  return (
    <article className="panel reconciliation">
      <div className="panel-head"><div><h2>カード支払い</h2><p>請求と口座引落の照合</p></div><button className="icon-btn" aria-label="カード照合メニュー"><MoreHorizontal size={18} /></button></div>
      <div className="card-stack">{cardSettlements.map((card) => <div className="settlement" key={card.name}>
        <div className="settlement-title"><i style={{ background: card.color }} /><div><strong>{card.name}</strong><span>{card.mask} ・ {card.dueDate}</span></div><b className={card.status}>{card.status === 'reconciled' ? '照合済み' : '引落待ち'}</b></div>
        <div className="settlement-values"><span>請求額 <strong>{yen(card.statement)}</strong></span><span>口座引落 <strong>{card.bankDebit ? yen(card.bankDebit) : '—'}</strong></span></div>
        <div className="progress"><span style={{ width: `${card.progress}%` }} /></div>
      </div>)}</div>
    </article>
  )
}

function Overview({ setPage }: { setPage: (page: PageId) => void }) {
  return <>
    <PageHeader eyebrow="2026年7月12日 日曜日" title="こんにちは、田中さん" description={`今月の家計は順調です。予算の ${(budgetUsage * 100).toFixed(1)}% を使いました。`}>
      <button className="secondary-btn"><CalendarDays size={17} /> 2026年7月 <ChevronDown size={15} /></button>
      <button className="primary-btn" onClick={() => setPage('import')}><Import size={17} /> ファイルを取り込む</button>
    </PageHeader>
    <section className="kpi-grid">
      <KpiCard label="純資産" value={yen(currentMonthMetrics.netWorth)} meta="前月比" trend="2.8%" icon={TrendingUp} accent="#e4edda" />
      <KpiCard label="今月の収入" value={yen(currentMonthMetrics.income)} meta="予定の 104%" trend="4.2%" icon={ArrowDownLeft} accent="#dce9e6" />
      <KpiCard label="今月の支出" value={yen(currentMonthMetrics.expense)} meta={`予算 ${yen(currentMonthMetrics.budget)}`} icon={ArrowUpRight} accent="#f7e3d9" />
      <KpiCard label="貯蓄見込み" value={yen(savings)} meta={`貯蓄率 ${(savingsRate * 100).toFixed(1)}%`} trend="6.1%" icon={CircleDollarSign} accent="#eee5cf" />
    </section>
    <section className="dashboard-grid">
      <article className="panel trend-panel">
        <div className="panel-head"><div><h2>収支の推移</h2><p>資金移動ベース・直近6か月</p></div><div className="chart-legend"><span className="income">現金流入</span><span className="expense">現金流出</span></div></div>
        <TrendChart />
      </article>
      <SpendingCard />
      <article className="panel recent-panel">
        <div className="panel-head"><div><h2>最近の取引</h2><p>確認済みの最新データ</p></div><button className="text-btn" onClick={() => setPage('transactions')}>すべて見る <ArrowRight size={14} /></button></div>
        <TransactionRows rows={transactions.slice(0, 4)} />
      </article>
      <ReconciliationMini />
    </section>
    <div className="data-footnote"><FileCheck2 size={15} /> 最終更新: 本日 15:42 ・ MUFG、PayPay、Rakuten Card ほか3件 <span>データ充足率 96%</span></div>
  </>
}

function TransactionsPage() {
  const [query, setQuery] = useState('')
  const [basis, setBasis] = useState<'ACCRUAL' | 'CASH'>('ACCRUAL')
  const basisTransactions = transactions.filter((transaction) => basis === 'ACCRUAL' ? transaction.accountingEffect !== 'CASH_ONLY' : transaction.accountingEffect !== 'ACCRUAL_ONLY')
  const visible = basisTransactions.filter((t) => `${t.merchant}${t.category}${t.account}`.toLowerCase().includes(query.toLowerCase()))
  const basisExpense = basis === 'ACCRUAL' ? currentMonthMetrics.expense : currentMonthMetrics.cashOutflow
  return <>
    <PageHeader eyebrow="取引台帳" title="すべての取引" description="確定した取引と元データを一か所で管理します。">
      <button className="secondary-btn"><SlidersHorizontal size={17} /> フィルター</button><button className="primary-btn"><BookOpen size={17} /> 手動で追加</button>
    </PageHeader>
    <section className="panel table-panel">
      <div className="table-toolbar"><div className="search table-search"><Search size={17} /><input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="店舗、カテゴリー、口座を検索" /></div><div className="basis-toggle" aria-label="計上基準"><button className={basis === 'ACCRUAL' ? 'active' : ''} aria-pressed={basis === 'ACCRUAL'} onClick={() => setBasis('ACCRUAL')}>発生ベース</button><button className={basis === 'CASH' ? 'active' : ''} aria-pressed={basis === 'CASH'} onClick={() => setBasis('CASH')}>資金移動</button></div></div>
      <div className="table-summary"><span>2026年7月・{basis === 'ACCRUAL' ? '発生ベース' : '資金移動ベース'}</span><strong>収入 {yen(currentMonthMetrics.income)}</strong><strong>{basis === 'ACCRUAL' ? '支出' : '現金流出'} {yen(basisExpense)}</strong><em>{visible.length}件を表示</em></div>
      <TransactionRows rows={visible} />
    </section>
  </>
}

function ImportPage({ previews, setPreviews }: { previews: ImportPreview[]; setPreviews: React.Dispatch<React.SetStateAction<ImportPreview[]>> }) {
  const inputRef = useRef<HTMLInputElement>(null)
  const [busy, setBusy] = useState(false)

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

  return <>
    <PageHeader eyebrow="データ取り込み" title="インポート Inbox" description="ファイルから読み取った候補を確認して台帳へ反映します。">
      <button className="secondary-btn"><Settings size={17} /> 監視フォルダー</button><button className="primary-btn" disabled={busy} onClick={() => inputRef.current?.click()}><Import size={17} /> {busy ? '解析中…' : 'ファイルを選択'}</button>
      <input ref={inputRef} className="visually-hidden" type="file" accept=".csv,text/csv" multiple onChange={(event) => { const files = event.currentTarget.files; event.currentTarget.value = ''; if (files) void processFiles(files) }} />
    </PageHeader>
    <section className="status-grid">
      {[['取込済み','79','今月'],['確認待ち','6','3ファイル'],['重複候補','2','要確認'],['照合候補','4','自動検出']].map((x, i) => <article className="status-card" key={x[0]}><span className={`status-orb s${i}`} /><div><strong>{x[1]}</strong><span>{x[0]}</span><small>{x[2]}</small></div></article>)}
    </section>
    <section className="panel import-panel">
      <div className="panel-head"><div><h2>最近のファイル</h2><p>ローカルの「家計簿 Inbox」から自動検出</p></div><button className="text-btn">処理履歴</button></div>
      <button className="drop-zone" onClick={() => inputRef.current?.click()} onDragOver={(event) => event.preventDefault()} onDrop={(event) => { event.preventDefault(); void processFiles(event.dataTransfer.files) }}><Import size={20} /><span>CSVをここにドロップ</span><small>PayPay・銀行・Rakuten・Amazon Mastercard</small></button>
      <div className="import-list">
        {previews.map((item) => <div className="import-row" key={item.id}><div className="file-icon"><FileCheck2 size={19} /></div><div><strong>{item.filename}</strong><span>{item.adapterId ?? '未対応の形式'} ・ {item.encoding}</span></div><span>{item.recordCount} レコード</span><b className={item.status === 'ready' ? 'ready' : 'review'}>{item.status === 'ready' ? 'プレビュー完了' : '確認が必要'}</b><button className="icon-btn" aria-label={`${item.filename}の解析結果`} title={item.issues.map((issue) => issue.message).join('\n')}><MoreHorizontal size={18} /></button></div>)}
        {importItems.map((item) => <div className="import-row" key={item.file}><div className="file-icon"><FileCheck2 size={19} /></div><div><strong>{item.file}</strong><span>{item.source} ・ {item.time}</span></div><span>{item.records} レコード</span><b className={item.state}>{item.state === 'ready' ? '反映可能' : item.state === 'review' ? '確認が必要' : item.state === 'matched' ? '取引に照合済み' : '処理済み'}</b><button className="icon-btn" aria-label={`${item.file}のメニュー`}><MoreHorizontal size={18} /></button></div>)}
      </div>
    </section>
  </>
}

function CardsPage() {
  return <>
    <PageHeader eyebrow="カード管理" title="請求・口座引落の照合" description="カード利用は支出、銀行引落は負債の返済として正しく区別します。">
      <button className="secondary-btn"><CalendarDays size={17} /> 2026年7月</button>
    </PageHeader>
    <div className="reconcile-banner"><div><FileCheck2 size={22} /><span><strong>1件の請求を自動照合しました</strong><small>Rakuten Card ¥204,987 と MUFG の口座引落が一致しました。</small></span></div><button>詳細を見る</button></div>
    <section className="cards-page-grid">{cardSettlements.map((card) => <article className="panel card-detail" key={card.name}>
      <div className="card-visual" style={{ background: card.color }}><span>KAKEFLOW CARD</span><strong>{card.name}</strong><small>{card.mask}</small></div>
      <div className="card-detail-head"><div><span>7月請求額</span><strong>{yen(card.statement)}</strong></div><b className={card.status}>{card.status === 'reconciled' ? '✓ 照合済み' : '引落待ち'}</b></div>
      <dl><div><dt>支払日</dt><dd>{card.dueDate}</dd></div><div><dt>口座引落</dt><dd>{card.bankDebit ? yen(card.bankDebit) : '未検出'}</dd></div><div><dt>利用明細</dt><dd>{card.name.includes('Rakuten') ? '15件' : '14件'}</dd></div></dl>
      <button className="full-btn">明細と照合を開く <ArrowRight size={15} /></button>
    </article>)}</section>
  </>
}

function BudgetsPage() {
  const budgets = budgetByCategory
  return <>
    <PageHeader eyebrow="プランニング" title="予算・貯蓄目標" description="今月使える金額と、家族の将来のための貯蓄を見通します。"><button className="primary-btn"><Goal size={17} /> 目標を追加</button></PageHeader>
    <section className="budget-layout"><article className="panel budget-panel"><div className="panel-head"><div><h2>7月のカテゴリー予算</h2><p>全体の {(budgetUsage * 100).toFixed(1)}% を使用</p></div><strong>{yen(currentMonthMetrics.expense)} / {yen(currentMonthMetrics.budget)}</strong></div>{budgets.map((b) => <div className="budget-row" key={b.name}><div><i style={{background:b.color}} /><strong>{b.name}</strong></div><span>{yen(b.amount)} <small>/ {yen(b.budget)}</small></span><div className="progress"><span style={{width:`${Math.min(100,b.amount/b.budget*100)}%`,background:b.color}} /></div></div>)}</article><article className="panel goal-panel"><div className="panel-head"><div><h2>貯蓄目標</h2><p>家族旅行 2027</p></div><Sparkles size={20} /></div><div className="goal-ring"><div><strong>68%</strong><span>達成</span></div></div><strong>{yen(680000)} <small>/ {yen(1000000)}</small></strong><span>毎月 ¥40,000 であと8か月</span></article></section>
  </>
}

function App() {
  const [page, setPage] = useState<PageId>('overview')
  const [sidebarOpen, setSidebarOpen] = useState(false)
  const [importPreviews, setImportPreviews] = useState<ImportPreview[]>([])
  const pageContent = {
    overview: <Overview setPage={setPage} />,
    transactions: <TransactionsPage />,
    import: <ImportPage previews={importPreviews} setPreviews={setImportPreviews} />,
    cards: <CardsPage />,
    budgets: <BudgetsPage />,
  }[page]
  return <div className="app-shell"><Sidebar page={page} setPage={setPage} open={sidebarOpen} close={() => setSidebarOpen(false)} /><div className="main-shell"><Topbar openMenu={() => setSidebarOpen(true)} /><main>{pageContent}</main></div></div>
}

export default App
