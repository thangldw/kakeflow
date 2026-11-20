import { useState } from 'react'
import { localize } from '../../i18n'
import type { BackupVerificationDto } from '../../platform/types'
import { markBackupVerified } from './restoreTestReminder'

export interface BackupVerifyPanelProps {
  readonly verify: (passphrase: string) => Promise<BackupVerificationDto | null>
  /** False where the native file picker is unavailable (the browser build). */
  readonly available: boolean
}

/** Proves a chosen backup file can really be restored, on a private copy, without touching the live data. */
export function BackupVerifyPanel({ verify, available }: BackupVerifyPanelProps) {
  const [passphrase, setPassphrase] = useState('')
  const [busy, setBusy] = useState(false)
  const [failed, setFailed] = useState(false)
  const [report, setReport] = useState<BackupVerificationDto | null>(null)

  const start = async () => {
    if (passphrase.length < 12) { setFailed(true); setReport(null); return }
    setBusy(true); setFailed(false); setReport(null)
    try {
      const result = await verify(passphrase)
      if (result) { setReport(result); setPassphrase(''); markBackupVerified() }
    } catch { setFailed(true) } finally { setBusy(false) }
  }

  return <section className="panel backup-verify-panel" aria-label={localize("バックアップの検証")}>
    <div className="panel-head"><div><h2>{localize("バックアップの検証")}</h2><p>{localize("選んだバックアップを一時的な場所で復元できるか確認します。現在のデータは変更されません。")}</p></div></div>
    <label>{localize("バックアップ作成時のパスフレーズ")}<input type="password" autoComplete="off" value={passphrase} onChange={(event) => setPassphrase(event.target.value)} /></label>
    <button type="button" className="secondary-btn" disabled={busy || !available} onClick={() => void start()}>{busy ? localize("検証中…") : localize("バックアップを選んで検証")}</button>
    {!available && <small>{localize("検証はデスクトップ版で利用できます。")}</small>}
    {failed && <p role="alert">{localize("バックアップを検証できませんでした。ファイルとパスフレーズを確認してください。")}</p>}
    {report && <div role="status">
      <p>{report.ok ? localize("このバックアップは復元できます。") : localize("復元はできますが、帳簿に確認が必要な取引があります。")}</p>
      <ul>
        <li>{report.entryCount} {localize("ファイル")} / {(report.plaintextBytes / 1024 / 1024).toFixed(1)} MB</li>
        <li>{report.documentsChecked} {localize("件の原本を確認")}</li>
        <li>{report.postedTransactions} {localize("取引")} / {report.journalEntries} {localize("仕訳行")}</li>
        {report.ledgerFindings > 0 && <li>{report.ledgerFindings} {localize("件の要確認")}</li>}
      </ul>
    </div>}
  </section>
}
