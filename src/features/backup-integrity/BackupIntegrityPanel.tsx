import { useState } from 'react'
import { localize } from '../../i18n'
import type { BackupFileCheckDto } from '../../platform/types'

export interface BackupIntegrityPanelProps {
  readonly check: () => Promise<readonly BackupFileCheckDto[]>
  readonly available: boolean
}

const LABEL: Record<BackupFileCheckDto['status'], string> = {
  OK: '変更なし',
  MISSING: 'ファイルが見つかりません',
  CHANGED: '作成時から変わっています',
  UNREADABLE: '読み取れません',
}

/** Re-reads the backup files this device has written and compares each with its fingerprint. No passphrase needed. */
export function BackupIntegrityPanel({ check, available }: BackupIntegrityPanelProps) {
  const [busy, setBusy] = useState(false)
  const [failed, setFailed] = useState(false)
  const [results, setResults] = useState<readonly BackupFileCheckDto[] | null>(null)

  const run = async () => {
    setBusy(true); setFailed(false)
    try { setResults(await check()) } catch { setFailed(true) } finally { setBusy(false) }
  }

  return <section className="panel backup-integrity-panel" aria-label={localize("バックアップファイルの点検")}>
    <div className="panel-head"><div><h2>{localize("バックアップファイルの点検")}</h2>
      <p>{localize("作成したバックアップのファイルが、今も存在し作成時のままかを確認します。パスフレーズは不要ですが、中身を開いて確かめるものではありません。1週間に1回、自動でも確認します。")}</p></div></div>
    <button type="button" className="secondary-btn" disabled={busy || !available} onClick={() => void run()}>{busy ? localize("確認中…") : localize("今すぐ点検")}</button>
    {!available && <small>{localize("点検はデスクトップ版で利用できます。")}</small>}
    {failed && <p role="alert">{localize("点検できませんでした。")}</p>}
    {results && (results.length === 0
      ? <p role="status">{localize("点検できるバックアップはまだありません。バックアップを作成すると記録されます。")}</p>
      : <ul role="status">{results.map((item) => <li key={item.path}>{item.fileName} — {localize(LABEL[item.status])}</li>)}</ul>)}
  </section>
}
