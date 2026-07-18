import { useEffect, useState } from 'react'
import { Camera, RefreshCw } from 'lucide-react'
import { platformClient } from '../../platform'
import type { MobileCaptureBackgroundStatusDto } from '../../platform'
import { localize } from '../../i18n'

interface Props {
  readonly householdId: string | null
}

const formatDateTime = (value: string | null): string => value
  ? new Intl.DateTimeFormat('ja-JP', { dateStyle: 'medium', timeStyle: 'short' }).format(new Date(value))
  : localize("未実行")

export function MobileCaptureConnectorPanel({ householdId }: Props) {
  const [status, setStatus] = useState<MobileCaptureBackgroundStatusDto | null>(null)
  const [token, setToken] = useState('')
  const [intervalMinutes, setIntervalMinutes] = useState<15 | 30 | 60>(30)
  const [busy, setBusy] = useState(false)
  const [notice, setNotice] = useState('')

  useEffect(() => {
    if (!householdId || platformClient.runtime !== 'tauri') { setStatus(null); return }
    let active = true
    void platformClient.getMobileCaptureBackgroundStatus(householdId)
      .then((next) => { if (active) { setStatus(next); setIntervalMinutes(next.intervalMinutes as 15 | 30 | 60) } })
      .catch(() => { if (active) setNotice(localize("モバイル転送の状態を読み込めませんでした。")) })
    return () => { active = false }
  }, [householdId])

  const enable = async () => {
    if (!householdId || !token) return
    setBusy(true); setNotice('')
    try {
      const next = await platformClient.enableMobileCaptureBackground({ householdId, token, intervalMinutes })
      setStatus(next); setToken(''); setNotice(localize("モバイル転送を有効にしました。受信原本は撮影 Inbox に入り、OCRや台帳反映は自動実行しません。"))
    } catch { setNotice(localize("モバイル転送を有効にできませんでした。接続トークンを確認してください。")) }
    finally { setBusy(false) }
  }

  const disable = async () => {
    if (!householdId) return
    setBusy(true); setNotice('')
    try { setStatus(await platformClient.disableMobileCaptureBackground(householdId)); setNotice(localize("モバイル転送を停止しました。保存済み原本は削除していません。")) }
    catch { setNotice(localize("モバイル転送を停止できませんでした。")) }
    finally { setBusy(false) }
  }

  const runNow = async () => {
    if (!householdId) return
    setBusy(true); setNotice('')
    try {
      const next = await platformClient.runMobileCaptureBackgroundNow(householdId)
      setStatus(next); setNotice(next.lastIngestedCount ? localize(`${next.lastIngestedCount}件の原本を撮影 Inbox に保存しました。`) : localize("新しいモバイル原本はありません。"))
    } catch { setNotice(localize("モバイル転送を確認できませんでした。接続状態を確認してください。")) }
    finally { setBusy(false) }
  }

  return <section className="panel settings-panel mobile-capture-connector" aria-labelledby="mobile-capture-connector-title">
    <div><span className="review-pill">{localize("テストユーザー限定")}</span><h2 id="mobile-capture-connector-title"><Camera size={17} /> {localize("モバイル転送（撮影中継）")}</h2><p>{localize("モバイルから届いた暗号化原本を撮影 Inbox に保存します。OCR、分類、照合、台帳反映は別の明示操作です。")}</p></div>
    <div className="backup-form">
      <label>{localize("接続トークン")}<input type="password" autoComplete="off" value={token} disabled={busy} onChange={(event) => setToken(event.target.value)} /></label>
      <label>{localize("確認間隔")}<select value={intervalMinutes} disabled={busy || Boolean(status?.enabled)} onChange={(event) => setIntervalMinutes(Number(event.target.value) as 15 | 30 | 60)}><option value={15}>{localize("15分")}</option><option value={30}>{localize("30分")}</option><option value={60}>{localize("60分")}</option></select></label>
      <div className="settings-connector-actions">{status?.enabled
        ? <><button className="secondary-btn" disabled={busy || status.running} onClick={() => void runNow()}><RefreshCw size={15} />{status.running ? localize("受信中…") : localize("今すぐ確認")}</button><button className="text-btn" disabled={busy} onClick={() => void disable()}>{localize("停止")}</button></>
        : <button className="primary-btn" disabled={busy || !householdId || !token} onClick={() => void enable()}>{localize("モバイル転送を有効にする")}</button>}</div>
      <small>{status?.enabled ? localize(`有効 ・ 最終成功 ${formatDateTime(status.lastSuccessAt)} ・ 次回 ${formatDateTime(status.nextDueAt)}`) : localize("無効 ・ 接続トークンは有効化時だけネイティブ資格情報へ保存されます")}</small>
      {notice && <p role="status">{notice}</p>}
    </div>
  </section>
}
