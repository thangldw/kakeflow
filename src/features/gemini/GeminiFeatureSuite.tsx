import { useEffect, useMemo, useState } from 'react'
import {
  Calculator,
  CalendarClock,
  CheckCircle2,
  FileCheck2,
  Globe2,
  Search,
  ShieldCheck,
  Sparkles,
  TrendingUp,
} from 'lucide-react'
import type { ImportRunCountsDto } from '../../platform'
import { localize, useI18n } from '../../i18n'

const yen = (value: number) => `${value < 0 ? '−' : ''}¥${Math.abs(Math.round(value)).toLocaleString('ja-JP')}`

export function GlobalLedgerSearch({ onSearch }: { onSearch: (query: string) => void }) {
  const { text } = useI18n()
  const [query, setQuery] = useState('')
  return <form className="global-search" role="search" onSubmit={(event) => { event.preventDefault(); if (query.trim()) onSearch(query.trim()) }}>
    <Search size={14} aria-hidden="true" />
    <input className="global-search-input" value={query} onChange={(event) => setQuery(event.target.value)} placeholder={text('自然言語で台帳を検索…')} aria-label={text('台帳を検索')} />
    <button className="icon-btn" type="submit" aria-label={text('検索を実行')} disabled={!query.trim()}><Sparkles size={13} /></button>
  </form>
}

export function PlanningTools() {
  const [debt, setDebt] = useState(1_200_000)
  const [rate, setRate] = useState(14.5)
  const [payment, setPayment] = useState(60_000)
  const [monthlySpend, setMonthlySpend] = useState(620_000)
  const [change, setChange] = useState(-10)
  const monthlyRate = rate / 1200
  const payoffMonths = payment <= debt * monthlyRate
    ? null
    : Math.ceil(-Math.log(1 - debt * monthlyRate / payment) / Math.log(1 + monthlyRate))
  const payoffInterest = payoffMonths === null ? null : Math.max(0, payoffMonths * payment - debt)
  const projectedSpend = monthlySpend * (1 + change / 100)

  return <section className="gemini-tools-grid" aria-label={localize('家計シミュレーション')}>
    <article className="panel gemini-tool">
      <header><span><Calculator size={18} /></span><div><h2>{localize('負債返済シミュレーター')}</h2><p>{localize('残高、金利、毎月返済額から完済時期を試算します。')}</p></div></header>
      <div className="gemini-form-grid">
        <label>{localize('現在の残高')}<input type="number" min="0" value={debt} onChange={(event) => setDebt(Number(event.target.value))} /></label>
        <label>{localize('年利（%）')}<input type="number" min="0" step="0.1" value={rate} onChange={(event) => setRate(Number(event.target.value))} /></label>
        <label>{localize('毎月返済額')}<input type="number" min="0" value={payment} onChange={(event) => setPayment(Number(event.target.value))} /></label>
      </div>
      <div className="gemini-result">{payoffMonths === null ? <><strong>{localize('返済額を増やしてください')}</strong><span>{localize('毎月の利息を上回る返済額が必要です。')}</span></> : <><strong>{payoffMonths}{localize('か月で完済')}</strong><span>{localize('推定利息')} {yen(payoffInterest ?? 0)} · {localize('総返済額')} {yen(debt + (payoffInterest ?? 0))}</span></>}</div>
    </article>
    <article className="panel gemini-tool">
      <header><span><TrendingUp size={18} /></span><div><h2>{localize('将来支出シミュレーター')}</h2><p>{localize('現在の支出ペースを増減させ、年間インパクトを確認します。')}</p></div></header>
      <div className="gemini-form-grid">
        <label>{localize('現在の月間支出')}<input type="number" min="0" value={monthlySpend} onChange={(event) => setMonthlySpend(Number(event.target.value))} /></label>
        <label>{localize('支出変化（%）')}<input type="number" min="-100" max="300" value={change} onChange={(event) => setChange(Number(event.target.value))} /></label>
      </div>
      <div className="gemini-result"><strong>{yen(projectedSpend)} / {localize('月')}</strong><span>{localize('年間')} {yen(projectedSpend * 12)} · {localize('現在比')} {change >= 0 ? '+' : ''}{change}%</span></div>
    </article>
  </section>
}

const currencyRates: Readonly<Record<string, { symbol: string; jpy: number }>> = {
  USD: { symbol: '$', jpy: 158.0 }, EUR: { symbol: '€', jpy: 171.5 }, GBP: { symbol: '£', jpy: 201.2 }, AUD: { symbol: 'A$', jpy: 103.4 },
}

export function SecondaryCurrencySummary({ netWorth, income, expense }: { netWorth: number; income: number; expense: number }) {
  const [currency, setCurrency] = useState('USD')
  const selected = currencyRates[currency]
  const format = (value: number) => `${selected.symbol}${(value / selected.jpy).toLocaleString('en-US', { maximumFractionDigits: 2 })}`
  return <section className="panel currency-strip" aria-label={localize('サブ通貨換算')}>
    <label><span><Globe2 size={14} /> {localize('サブ通貨')}</span><select value={currency} onChange={(event) => setCurrency(event.target.value)}>{Object.keys(currencyRates).map((code) => <option key={code}>{code}</option>)}</select></label>
    <div className="currency-value"><span>{localize('換算純資産')}</span><strong>{format(netWorth)}</strong></div>
    <div className="currency-value"><span>{localize('今月収入')}</span><strong>{format(income)}</strong></div>
    <div className="currency-value"><span>{localize('今月支出')}</span><strong>{format(expense)}</strong></div>
  </section>
}

export function MonthlyContextNotes({ householdId, month }: { householdId: string | null; month: string }) {
  const key = `kakeflow.monthly-context.${householdId ?? 'preview'}.${month}`
  const [note, setNote] = useState(() => globalThis.localStorage?.getItem(key) ?? '')
  const [saved, setSaved] = useState(false)
  useEffect(() => { setNote(globalThis.localStorage?.getItem(key) ?? ''); setSaved(false) }, [key])
  const save = () => { globalThis.localStorage?.setItem(key, note.trim()); setSaved(true) }
  return <section className="panel context-note">
    <div className="panel-head"><div><h2>{localize('月次コンテキストメモ')}</h2><p>{localize('突発支出や臨時収入の背景を月単位で記録します。')}</p></div><CalendarClock size={19} /></div>
    <textarea value={note} onChange={(event) => { setNote(event.target.value); setSaved(false) }} placeholder={localize('例：今月はエアコンの買い替えで一時的な支出が増加。翌月以降は通常ペースへ戻る見込み。')} />
    <footer><small>{saved ? localize('この端末に保存しました。') : localize('監査や月次レビューで参照できます。')}</small><button className="primary-btn" onClick={save}><CheckCircle2 size={15} /> {localize('メモを保存')}</button></footer>
  </section>
}

export function AuditReadinessPage({ counts, onOpenImport, onOpenTransactions }: { counts: ImportRunCountsDto | null; onOpenImport: () => void; onOpenTransactions: () => void }) {
  const preview = counts ?? { sourceDocuments: 15, sourceRecords: 1_286, pendingCandidates: 4, readyCandidates: 2, posted: 12, failed: 0 }
  const stats = useMemo(() => [
    { label: localize('原本ドキュメント'), value: preview.sourceDocuments },
    { label: localize('原本レコード'), value: preview.sourceRecords },
    { label: localize('確認待ち'), value: preview.pendingCandidates + preview.readyCandidates },
    { label: localize('転記済み'), value: preview.posted },
  ], [preview.pendingCandidates, preview.posted, preview.readyCandidates, preview.sourceDocuments, preview.sourceRecords])
  const ready = preview.failed === 0 && preview.pendingCandidates === 0
  return <>
    <div className="page-header"><div><p>{localize('Source Evidence')}</p><h1>{localize('監査・証跡')}</h1><span>{localize('原本、レビュー状態、確定台帳への来歴を一か所で確認します。')}</span></div><div className="page-actions"><button className="secondary-btn" onClick={onOpenTransactions}><FileCheck2 size={16} /> {localize('証跡付き取引')}</button><button className="primary-btn" onClick={onOpenImport}>{localize('Inboxを確認')}</button></div></div>
    <section className="audit-grid">{stats.map((stat) => <article className="audit-stat" key={stat.label}><span>{stat.label}</span><strong>{stat.value.toLocaleString('ja-JP')}</strong></article>)}</section>
    <section className="panel gemini-tool" style={{ marginTop: 16 }}><header><span>{ready ? <ShieldCheck size={18} /> : <Search size={18} />}</span><div><h2 className={ready ? 'audit-ready' : ''}>{ready ? localize('監査準備は良好です') : localize('レビューが必要です')}</h2><p>{ready ? localize('失敗した取込や未確認候補はありません。取引から原本行まで追跡できます。') : localize('未確認候補または失敗した取込を解消すると、監査可能な状態になります。')}</p></div></header></section>
  </>
}
