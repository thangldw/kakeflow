import { useState } from 'react'
import { localize } from '../../i18n'

export interface IncomeStatementPanelProps {
  /** Saves the PDF for the last `months` months; resolves to the file name, or null when the dialog was cancelled. */
  readonly save: (months: number) => Promise<string | null>
  readonly available: boolean
}

const PERIODS = [3, 6, 12] as const

/** A PDF the household prepares itself: income and spending by month, with the original file hash behind each large income. */
export function IncomeStatementPanel({ save, available }: IncomeStatementPanelProps) {
  const [months, setMonths] = useState<number>(12)
  const [busy, setBusy] = useState(false)
  const [savedAs, setSavedAs] = useState<string | null>(null)
  const [failed, setFailed] = useState(false)

  const run = async () => {
    setBusy(true); setFailed(false); setSavedAs(null)
    try { setSavedAs(await save(months)) } catch { setFailed(true) } finally { setBusy(false) }
  }

  return <section className="panel income-statement-panel" aria-label={localize("収支のまとめ（自己作成）")}>
    <div className="panel-head"><div><h2>{localize("収支のまとめ（自己作成）")}</h2>
      <p>{localize("月ごとの収入と支出を、主な収入の原本ファイルのハッシュ付きでPDFにします。世帯自身が作成した記録であり、第三者の証明書ではありません。")}</p></div></div>
    <label>{localize("対象期間")}<select value={months} onChange={(event) => setMonths(Number(event.target.value))}>
      {PERIODS.map((period) => <option key={period} value={period}>{localize(`直近${period}か月`)}</option>)}
    </select></label>
    <button type="button" className="secondary-btn" disabled={busy || !available} onClick={() => void run()}>{busy ? localize("作成中…") : localize("収支のまとめをPDFで保存")}</button>
    {!available && <small>{localize("収支のまとめはデスクトップ版で作成できます。")}</small>}
    {savedAs && <p role="status">{localize("保存しました。")} {savedAs}</p>}
    {failed && <p role="alert">{localize("収支のまとめを作成できませんでした。")}</p>}
  </section>
}
