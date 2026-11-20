import { useState } from 'react'
import { localize } from '../../i18n'

export interface EmergencySheetPanelProps {
  /** Saves the PDF; resolves to the saved file name, or null when the save dialog was cancelled. */
  readonly save: () => Promise<string | null>
  readonly available: boolean
}

/** A printable one-page sheet for family: accounts, regular payments, how to restore, and blanks to fill in by hand. */
export function EmergencySheetPanel({ save, available }: EmergencySheetPanelProps) {
  const [busy, setBusy] = useState(false)
  const [savedAs, setSavedAs] = useState<string | null>(null)
  const [failed, setFailed] = useState(false)

  const run = async () => {
    setBusy(true); setFailed(false); setSavedAs(null)
    try { setSavedAs(await save()) } catch { setFailed(true) } finally { setBusy(false) }
  }

  return <section className="panel emergency-sheet-panel" aria-label={localize("緊急時シート")}>
    <div className="panel-head"><div><h2>{localize("緊急時シート")}</h2>
      <p>{localize("万一のときに家族が困らないよう、口座・定期的な支払い・復元方法を1枚にまとめます。パスフレーズや鍵は含まれません。手書き欄に「保管場所」だけを書いてください。")}</p></div></div>
    <button type="button" className="secondary-btn" disabled={busy || !available} onClick={() => void run()}>{busy ? localize("作成中…") : localize("緊急時シートをPDFで保存")}</button>
    {!available && <small>{localize("緊急時シートはデスクトップ版で作成できます。")}</small>}
    {savedAs && <p role="status">{localize("保存しました。")} {savedAs}</p>}
    {failed && <p role="alert">{localize("緊急時シートを作成できませんでした。")}</p>}
  </section>
}
