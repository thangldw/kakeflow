import { useEffect, useRef, useState } from 'react'

import { platformClient } from '../../platform'
import type { EvidenceBundleSummaryDto } from '../../platform'
import { showToast } from '../../toast'

interface Props { readonly householdId: string | null }

const formatBytes = (bytes: number) => bytes < 1024 * 1024
  ? `${(bytes / 1024).toFixed(1)} KB`
  : `${(bytes / 1024 / 1024).toFixed(1)} MB`

export function PortableEvidenceBundlePanel({ householdId }: Props) {
  const [passphrase, setPassphrase] = useState('')
  const [busy, setBusy] = useState<'EXPORT' | 'IMPORT' | null>(null)
  const [notice, setNotice] = useState('')
  const [summary, setSummary] = useState<EvidenceBundleSummaryDto | null>(null)
  const request = useRef(0)

  useEffect(() => {
    request.current += 1
    setPassphrase(''); setBusy(null); setNotice(''); setSummary(null)
  }, [householdId])

  const validate = () => {
    if (passphrase.length >= 12) return true
    setNotice('12文字以上のパスフレーズを入力してください。')
    setSummary(null)
    return false
  }

  const exportBundle = async () => {
    if (!householdId || !validate()) return
    const current = ++request.current
    setBusy('EXPORT'); setNotice('確定済み原本をまとめています…'); setSummary(null)
    try {
      const result = await platformClient.exportEvidenceBundle(householdId, passphrase)
      if (current !== request.current) return
      if (!result) setNotice('保存をキャンセルしました。')
      else { setSummary(result); setNotice('確定済み原本カプセルを保存しました。'); setPassphrase(''); showToast('確定済み原本カプセルを保存しました。') }
    } catch { if (current === request.current) setNotice('原本カプセルを作成できませんでした。確定済みデータと保存先を確認してください。') }
    finally { if (current === request.current) setBusy(null) }
  }

  const importBundle = async () => {
    if (!householdId || !validate()) return
    const current = ++request.current
    setBusy('IMPORT'); setNotice('原本カプセルを検証しています…'); setSummary(null)
    try {
      const result = await platformClient.pickAndImportEvidenceBundle(householdId, passphrase)
      if (current !== request.current) return
      if (!result) setNotice('ファイルの選択をキャンセルしました。')
      else { setSummary(result); setNotice(`確定済み原本を${result.importedDocumentCount}件追加しました。既存の原本${result.deduplicatedDocumentCount}件は再利用されています。`); setPassphrase(''); showToast(`${result.importedDocumentCount}件の原本を追加しました。`) }
    } catch { if (current === request.current) setNotice('原本カプセルを読み込めませんでした。パスフレーズとファイルを確認してください。台帳は変更されていません。') }
    finally { if (current === request.current) setBusy(null) }
  }

  return <section className="panel portable-evidence-bundle" aria-busy={busy !== null}>
    <div className="panel-head"><div><h2>確定済み原本カプセル</h2><p>確定取引・カード請求・投資データに紐づく元のCSV・PDF・画像と読み取り行を、別の端末へ持ち運びます。</p></div><span className="local-only-badge">手順 1 / 2</span></div>
    <p className="evidence-bundle-scope">投資データを移すときは、この原本を先に読み込んでから変更パッケージを反映します。Import Inbox の未確定・要確認データは含みません。読み込みは追加のみで、同じ原本は重複せず再利用できます。</p>
    {platformClient.runtime !== 'tauri' ? <p className="empty-state">原本カプセルはデスクトップ版で利用できます。</p> : <>
      <div className="evidence-bundle-controls">
        <label htmlFor="evidence-bundle-passphrase">パスフレーズ</label>
        <input id="evidence-bundle-passphrase" type="password" autoComplete="off" value={passphrase} onChange={(event) => setPassphrase(event.target.value)} placeholder="12文字以上" />
        <div className="change-package-actions">
          <button className="primary-btn" disabled={busy !== null || !householdId} onClick={() => void exportBundle()}>{busy === 'EXPORT' ? '保存中…' : '確定済み原本を保存'}</button>
          <button className="secondary-btn" disabled={busy !== null || !householdId} onClick={() => void importBundle()}>{busy === 'IMPORT' ? '読込中…' : '原本カプセルを読み込む'}</button>
        </div>
      </div>
      {summary && <dl className="evidence-bundle-summary" aria-label="原本カプセルの集計">
        <div><dt>原本</dt><dd>{summary.documentCount}件</dd></div>
        <div><dt>読み取り行</dt><dd>{summary.recordCount}件</dd></div>
        <div><dt>データ量</dt><dd>{formatBytes(summary.plaintextBytes)}</dd></div>
        <div><dt>新しく追加</dt><dd>{summary.importedDocumentCount}件</dd></div>
        <div><dt>既存を再利用</dt><dd>{summary.deduplicatedDocumentCount}件</dd></div>
      </dl>}
    </>}
    {notice && <p className="change-package-notice" role="status" aria-live="polite">{notice}</p>}
  </section>
}
