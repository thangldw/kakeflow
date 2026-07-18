import { useEffect, useRef, useState } from 'react'
import { Cloud, FolderOpen, Link2Off, RefreshCw } from 'lucide-react'

import { platformClient } from '../../platform'
import type { GoogleDriveAvailabilityDto, GoogleDriveConnectionDto, GoogleDriveSyncScheduleDto } from '../../platform'
import { googleDriveSyncEventPlatform } from './googleDriveSyncEventPlatform'
import './GoogleDriveSettingsPanel.css'
import { localize } from '../../i18n'

interface Props { readonly householdId: string | null }
type BusyAction = 'LOAD' | 'CONNECT' | 'BIND' | 'SCHEDULE' | 'SYNC' | 'DISCONNECT' | null

const statusLabel: Readonly<Record<GoogleDriveConnectionDto['status'], string>> = {
  AUTHORIZING: '認証中', SELECTING_FOLDER: 'フォルダー未選択', CONNECTED: '接続済み',
  AUTH_REQUIRED: '再認証が必要', DISCONNECTED: '未接続',
}

export function GoogleDriveSettingsPanel({ householdId }: Props) {
  const [availability, setAvailability] = useState<GoogleDriveAvailabilityDto | null>(null)
  const [connection, setConnection] = useState<GoogleDriveConnectionDto | null>(null)
  const [schedule, setSchedule] = useState<GoogleDriveSyncScheduleDto | null>(null)
  const [folderReference, setFolderReference] = useState('')
  const [intervalMinutes, setIntervalMinutes] = useState<15 | 30 | 60>(30)
  const [scheduleEnabled, setScheduleEnabled] = useState(false)
  const [busy, setBusy] = useState<BusyAction>(null)
  const [notice, setNotice] = useState('')
  const request = useRef(0)

  const loadSchedule = async (next: GoogleDriveConnectionDto, current: number) => {
    if (next.status !== 'CONNECTED' || !householdId) { setSchedule(null); return }
    const result = await platformClient.getGoogleDriveSchedule(householdId, next.id)
    if (current !== request.current) return
    setSchedule(result); setIntervalMinutes(result.intervalMinutes); setScheduleEnabled(result.enabled)
  }

  const load = async () => {
    const current = ++request.current; setBusy('LOAD'); setNotice('')
    try {
      const available = await platformClient.getGoogleDriveAvailability()
      if (current !== request.current) return
      setAvailability(available)
      if (!available.available || !householdId) { setConnection(null); setSchedule(null); return }
      const connections = await platformClient.listGoogleDriveConnections(householdId)
      if (current !== request.current) return
      const next = connections.find((item) => item.status !== 'DISCONNECTED') ?? connections[0] ?? null
      setConnection(next)
      if (next) await loadSchedule(next, current); else setSchedule(null)
    } catch { if (current === request.current) { setAvailability(null); setConnection(null); setSchedule(null); setNotice(localize("Google Drive の状態を確認できませんでした。")) } }
    finally { if (current === request.current) setBusy(null) }
  }

  useEffect(() => {
    setAvailability(null); setConnection(null); setSchedule(null); setFolderReference(''); setNotice(''); void load()
    return () => { request.current += 1 }
  }, [householdId]) // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (platformClient.runtime !== 'tauri' || !householdId) return
    let disposed = false
    let unlisten: (() => void) | undefined
    void googleDriveSyncEventPlatform.subscribe((event) => {
      if (disposed || event.householdId !== householdId) return
      const current = ++request.current
      void platformClient.listGoogleDriveConnections(householdId).then(async (connections) => {
        if (disposed || current !== request.current) return
        const next = connections.find((item) => item.id === event.connectionId)
          ?? connections.find((item) => item.status !== 'DISCONNECTED')
          ?? connections[0]
          ?? null
        setConnection(next)
        if (next?.status === 'CONNECTED') await loadSchedule(next, current)
        else setSchedule(null)
      }).catch(() => undefined)
    }).then((stop) => { if (disposed) stop(); else unlisten = stop }).catch(() => undefined)
    return () => { disposed = true; unlisten?.() }
  }, [householdId]) // eslint-disable-line react-hooks/exhaustive-deps

  const connect = async () => {
    if (!householdId) return
    const current = ++request.current; setBusy('CONNECT'); setNotice(localize("システムブラウザーで Google Drive を認証しています…"))
    try {
      const next = await platformClient.connectGoogleDrive(householdId)
      if (current !== request.current) return
      setConnection(next); setSchedule(null)
      setNotice(next.status === 'SELECTING_FOLDER' ? localize("認証が完了しました。取り込み元フォルダーを選択してください。") : localize("Google Drive の接続状態を更新しました。"))
      await loadSchedule(next, current)
    } catch { if (current === request.current) setNotice(localize("Google Drive を接続できませんでした。認証をやり直してください。")) }
    finally { if (current === request.current) setBusy(null) }
  }

  const bindFolder = async () => {
    if (!householdId || !connection || !folderReference.trim()) { setNotice(localize("Google Drive のフォルダー URL またはフォルダー ID を入力してください。")); return }
    const current = ++request.current; setBusy('BIND'); setNotice(localize("フォルダーを確認しています…"))
    try {
      const next = await platformClient.bindGoogleDriveFolder({ householdId, connectionId: connection.id, folderReference: folderReference.trim() })
      if (current !== request.current) return
      setConnection(next); setFolderReference(''); setNotice(localize("フォルダーを接続しました。ファイルは確認待ちとして取り込まれます。"))
      await loadSchedule(next, current)
    } catch { if (current === request.current) setNotice(localize("フォルダーを確認できませんでした。URL、ID、閲覧権限を確認してください。")) }
    finally { if (current === request.current) setBusy(null) }
  }

  const saveSchedule = async () => {
    if (!householdId || !connection) return
    const current = ++request.current; setBusy('SCHEDULE'); setNotice('')
    try {
      const next = await platformClient.updateGoogleDriveSchedule({ householdId, connectionId: connection.id, enabled: scheduleEnabled, intervalMinutes })
      if (current !== request.current) return
      setSchedule(next); setScheduleEnabled(next.enabled); setIntervalMinutes(next.intervalMinutes)
      setNotice(next.enabled ? localize(`${next.intervalMinutes}分ごとの確認を有効にしました。`) : localize("自動確認を停止しました。"))
    } catch { if (current === request.current) setNotice(localize("同期スケジュールを更新できませんでした。")) }
    finally { if (current === request.current) setBusy(null) }
  }

  const syncNow = async () => {
    if (!householdId || !connection) return
    const current = ++request.current; setBusy('SYNC'); setNotice(localize("Google Drive の変更を確認しています…"))
    try {
      const next = await platformClient.syncGoogleDriveNow(householdId, connection.id)
      if (current !== request.current) return
      setSchedule(next); setNotice(localize(`${next.lastDiscoveredCount}件の新しい候補を確認しました。台帳にはまだ反映されていません。`))
    } catch { if (current === request.current) setNotice(localize("Google Drive の変更を確認できませんでした。後でもう一度お試しください。")) }
    finally { if (current === request.current) setBusy(null) }
  }

  const disconnect = async () => {
    if (!householdId || !connection) return
    const current = ++request.current; setBusy('DISCONNECT'); setNotice('')
    try {
      const next = await platformClient.disconnectGoogleDrive(householdId, connection.id)
      if (current !== request.current) return
      setConnection(next); setSchedule(null); setNotice(localize("Google Drive の接続を解除しました。取り込み済みの原本と台帳は残ります。"))
    } catch { if (current === request.current) setNotice(localize("Google Drive の接続を解除できませんでした。")) }
    finally { if (current === request.current) setBusy(null) }
  }

  const unavailable = availability && !availability.available
  const canConnect = availability?.available && householdId && (!connection || connection.status === 'DISCONNECTED' || connection.status === 'AUTH_REQUIRED')
  return <section className="panel google-drive-settings" aria-labelledby="google-drive-settings-title" aria-busy={busy != null}>
    <div className="panel-head"><div><h2 id="google-drive-settings-title"><Cloud size={16} /> Google Drive</h2><p>{localize("指定したフォルダーを読み取り専用で確認し、CSV・Excel・PDF・レシート画像を取り込み候補へ追加します。")}</p></div><b className={`drive-state drive-state-${connection?.status ?? (unavailable ? 'UNAVAILABLE' : 'LOADING')}`}>{unavailable ? localize("利用不可") : connection ? localize(statusLabel[connection.status]) : availability?.available ? localize("未接続") : localize("確認中")}</b></div>
    <p className="drive-review-gate"><strong>{localize("確認ゲート:")}</strong> {localize("Google Drive のファイルは自動で台帳へ記帳されません。Import Inbox で内容・重複・口座・カテゴリーを確認し、確定したものだけが台帳へ反映されます。")}</p>
    {busy === 'LOAD' && !availability ? <p className="empty-state">{localize("Google Drive の利用可否を確認中…")}</p> : unavailable ? <div className="drive-unavailable"><p>{availability.unavailableReason === 'CLIENT_ID_NOT_COMPILED' ? localize("このビルドには Google Drive の接続設定が含まれていません。") : localize("Google Drive の直接接続はデスクトップ版で利用できます。")}</p></div> : !availability ? <div className="drive-retry"><p className="empty-state">{notice || localize("Google Drive の状態を確認できませんでした。")}</p><button className="secondary-btn" onClick={() => void load()}>{localize("再試行")}</button></div> : <>
      {canConnect && <button className="primary-btn drive-connect" disabled={busy != null} onClick={() => void connect()}><Cloud size={15} /> {busy === 'CONNECT' ? localize("認証中…") : connection?.status === 'AUTH_REQUIRED' ? localize("Google Drive を再認証") : localize("Google Drive を接続")}</button>}
      {connection?.status === 'AUTHORIZING' && <p className="empty-state">{localize("システムブラウザーで認証を完了してください。")}</p>}
      {connection?.status === 'SELECTING_FOLDER' && <div className="drive-folder-form"><label htmlFor="google-drive-folder-reference">{localize("フォルダー URL または ID")}</label><div><input id="google-drive-folder-reference" value={folderReference} disabled={busy != null} placeholder="https://drive.google.com/drive/folders/…" onChange={(event) => setFolderReference(event.target.value)} /><button className="primary-btn" disabled={busy != null || !folderReference.trim()} onClick={() => void bindFolder()}><FolderOpen size={15} /> {busy === 'BIND' ? localize("確認中…") : localize("フォルダーを選択")}</button></div><small>{localize("My Drive と共有ドライブの読み取り可能なフォルダーに対応します。")}</small></div>}
      {connection?.status === 'CONNECTED' && <><dl className="drive-summary"><div><dt>{localize("Google アカウント")}</dt><dd>{connection.accountEmail}</dd></div><div><dt>{localize("対象フォルダー")}</dt><dd>{connection.folderName}</dd></div><div><dt>{localize("最終同期")}</dt><dd>{schedule?.lastSuccessAt ?? connection.lastFullScanAt ?? localize("未実行")}</dd></div><div><dt>{localize("確認待ち候補")}</dt><dd>{schedule?.lastDiscoveredCount ?? 0}{localize("件")}</dd></div></dl><div className="drive-schedule"><label><input type="checkbox" checked={scheduleEnabled} disabled={busy != null} onChange={(event) => setScheduleEnabled(event.target.checked)} /> {localize("自動で変更を確認")}</label><label>{localize("間隔")}<select aria-label={localize("Google Drive 同期間隔")} value={intervalMinutes} disabled={busy != null || !scheduleEnabled} onChange={(event) => setIntervalMinutes(Number(event.target.value) as 15 | 30 | 60)}><option value={15}>{localize("15分")}</option><option value={30}>{localize("30分")}</option><option value={60}>{localize("60分")}</option></select></label><button className="secondary-btn" disabled={busy != null} onClick={() => void saveSchedule()}>{busy === 'SCHEDULE' ? localize("保存中…") : localize("スケジュールを保存")}</button></div><div className="drive-actions"><button className="primary-btn" disabled={busy != null} onClick={() => void syncNow()}><RefreshCw size={15} /> {busy === 'SYNC' ? localize("確認中…") : localize("今すぐ同期")}</button><button className="text-btn" disabled={busy != null} onClick={() => void disconnect()}><Link2Off size={14} /> {busy === 'DISCONNECT' ? localize("解除中…") : localize("接続を解除")}</button></div>{schedule?.suspensionReason && <p role="alert" className="drive-warning">{localize("同期が停止しています（")}{schedule.suspensionReason}{localize("）。再認証または再試行が必要です。")}</p>}</>}
    </>}
    {notice && busy !== 'LOAD' && <p className="drive-notice" role="status" aria-live="polite">{notice}</p>}
  </section>
}
