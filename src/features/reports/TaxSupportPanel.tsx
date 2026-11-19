import { useState } from 'react'
import { localize } from '../../i18n'
import { buildTaxSupportReport, taxSupportCsv, type TaxItem, type TaxSupportReport, type TaxTransaction } from './taxSupport'

export interface TaxSupportPanelProps {
  readonly year: string
  /** Loads every posted transaction of the year (the panel filters and totals them). */
  readonly loadYear: (year: string) => Promise<readonly TaxTransaction[]>
  /** Saves the CSV; returns false when the user cancelled. Omitted, the panel copies the CSV to the clipboard. */
  readonly onSaveCsv?: (csv: string, fileName: string) => Promise<boolean>
}

const yen = (value: number) => `${value < 0 ? '−' : ''}¥${Math.abs(value).toLocaleString('ja-JP')}`

function ItemList({ title, items, total }: { readonly title: string; readonly items: readonly TaxItem[]; readonly total: number }) {
  return <section className="tax-support-group">
    <h3>{title} <strong>{yen(total)}</strong></h3>
    {items.length === 0
      ? <p className="empty-state">{localize("該当する取引はありません。")}</p>
      : <ul>{items.map((item) => <li key={item.transactionId}><span>{item.occurredOn}</span><span>{item.payee || item.description || '—'}</span><strong>{yen(item.amountJpy)}</strong></li>)}</ul>}
  </section>
}

/** 確定申告 support: medical-expense and donation candidates of one year, with a CSV for the tax forms. */
export function TaxSupportPanel({ year, loadYear, onSaveCsv }: TaxSupportPanelProps) {
  const [income, setIncome] = useState('')
  const [report, setReport] = useState<TaxSupportReport | null>(null)
  const [transactions, setTransactions] = useState<readonly TaxTransaction[] | null>(null)
  const [busy, setBusy] = useState(false)
  const [notice, setNotice] = useState('')

  const incomeJpy = /^\d+$/u.test(income.trim()) ? Number(income.trim()) : null

  const load = async () => {
    setBusy(true); setNotice('')
    try {
      const loaded = await loadYear(year)
      setTransactions(loaded)
      setReport(buildTaxSupportReport(loaded, year, incomeJpy))
    } catch {
      setNotice(localize("取引を読み込めませんでした。"))
    } finally {
      setBusy(false)
    }
  }

  const recalculate = (value: string) => {
    setIncome(value)
    if (transactions) setReport(buildTaxSupportReport(transactions, year, /^\d+$/u.test(value.trim()) ? Number(value.trim()) : null))
  }

  const exportCsv = async () => {
    if (!report) return
    const csv = taxSupportCsv(report)
    const fileName = `kakeflow-tax-support-${year}.csv`
    try {
      if (onSaveCsv) {
        setNotice((await onSaveCsv(csv, fileName)) ? `${fileName} ${localize("を保存しました。")}` : localize("エクスポートをキャンセルしました。"))
      } else {
        await navigator.clipboard.writeText(csv)
        setNotice(localize("CSVをクリップボードにコピーしました。"))
      }
    } catch {
      setNotice(localize("CSVを書き出せませんでした。"))
    }
  }

  return <section className="panel tax-support-panel" aria-label={localize("確定申告サポート")}>
    <div className="panel-head"><div><h2>{localize("確定申告サポート")}</h2><p>{year}{localize("年の医療費・寄附金の候補（確認用）")}</p></div></div>
    <p className="tax-support-note">{localize("候補の一覧です。保険金などで補填された額や対象外の支出は、申告前にご確認ください。")}</p>
    <div className="tax-support-controls">
      <label>{localize("年間の総所得（任意）")}<input inputMode="numeric" value={income} onChange={(event) => recalculate(event.target.value)} placeholder="5000000" /></label>
      <button type="button" className="secondary-btn" disabled={busy} onClick={() => void load()}>{report ? localize("再読み込み") : localize("候補を表示")}</button>
      {report && <button type="button" className="primary-btn" onClick={() => void exportCsv()}>{localize("CSVを書き出す")}</button>}
    </div>
    {notice && <p role="status">{notice}</p>}
    {report && <>
      <ItemList title={localize("医療費")} items={report.medical} total={report.medicalTotalJpy} />
      {report.medicalDeductionJpy != null && <p className="tax-support-deduction">{localize("医療費控除額（参考）")}: <strong>{yen(report.medicalDeductionJpy)}</strong></p>}
      <ItemList title={localize("ふるさと納税")} items={report.furusato} total={report.furusatoTotalJpy} />
      <ItemList title={localize("その他の寄附金")} items={report.donations} total={report.donationTotalJpy} />
    </>}
  </section>
}
