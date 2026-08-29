import { useEffect, useRef, useState } from 'react'
import { Link2Off, Mail, RefreshCw } from 'lucide-react'
import { platformClient } from '../../platform'
import type { GmailAvailabilityDto, GmailConnectionDto, GmailLabelDto, GmailSyncScheduleDto } from '../../platform'
import { gmailSyncEventPlatform } from './gmailSyncEventPlatform'
import './GoogleDriveSettingsPanel.css'
import { localize } from '../../i18n'

interface Props { readonly householdId: string | null }
type Busy = 'LOAD' | 'CONNECT' | 'LABEL' | 'SCHEDULE' | 'SYNC' | 'DISCONNECT' | null
const statusLabel: Readonly<Record<GmailConnectionDto['status'], string>> = { AUTHORIZING: '認証中', SELECTING_LABEL: 'ラベル未選択', CONNECTED: '接続済み', AUTH_REQUIRED: '再認証が必要', DISCONNECTED: '未接続' }

export function GmailSettingsPanel({ householdId }: Props) {
  const [availability, setAvailability] = useState<GmailAvailabilityDto | null>(null)
  const [connection, setConnection] = useState<GmailConnectionDto | null>(null)
  const [labels, setLabels] = useState<readonly GmailLabelDto[]>([])
  const [selectedLabelId, setSelectedLabelId] = useState('')
  const [gmailQuery, setGmailQuery] = useState('has:attachment')
  const [schedule, setSchedule] = useState<GmailSyncScheduleDto | null>(null)
  const [enabled, setEnabled] = useState(false); const [interval, setInterval] = useState<15 | 30 | 60>(30)
  const [busy, setBusy] = useState<Busy>(null); const [notice, setNotice] = useState(''); const request = useRef(0)

  const loadSchedule = async (next: GmailConnectionDto, current: number) => {
    if (!householdId || next.status !== 'CONNECTED') { setSchedule(null); return }
    const value = await platformClient.getGmailSchedule(householdId, next.id); if (current !== request.current) return
    setSchedule(value); setEnabled(value.enabled); setInterval(value.intervalMinutes)
  }
  const loadLabels = async (next: GmailConnectionDto, current: number) => {
    if (!householdId || next.status !== 'SELECTING_LABEL') { setLabels([]); return }
    const value = await platformClient.listGmailLabels(householdId, next.id); if (current !== request.current) return
    setLabels(value); setSelectedLabelId(value.find((label) => label.name === 'KakeFlow')?.id ?? value[0]?.id ?? '')
  }
  const load = async () => {
    const current = ++request.current; setBusy('LOAD'); setNotice('')
    try {
      const available = await platformClient.getGmailAvailability(); if (current !== request.current) return; setAvailability(available)
      if (!available.available || !householdId) { setConnection(null); setSchedule(null); return }
      const connections = await platformClient.listGmailConnections(householdId); if (current !== request.current) return
      const next = connections.find((item) => item.status !== 'DISCONNECTED') ?? connections[0] ?? null; setConnection(next)
      if (next) { await loadLabels(next, current); await loadSchedule(next, current) }
    } catch { if (current === request.current) setNotice(localize("Gmail の接続状態を確認できませんでした。")) }
    finally { if (current === request.current) setBusy(null) }
  }
  useEffect(() => { setAvailability(null); setConnection(null); setSchedule(null); setLabels([]); setNotice(''); void load(); return () => { request.current += 1 } }, [householdId]) // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => {
    if (platformClient.runtime !== 'tauri' || !householdId) return
    let disposed = false; let stop: (() => void) | undefined
    void gmailSyncEventPlatform.subscribe((event) => { if (!disposed && event.householdId === householdId) void load() }).then((unlisten) => { if (disposed) unlisten(); else stop = unlisten }).catch(() => undefined)
    return () => { disposed = true; stop?.() }
  }, [householdId]) // eslint-disable-line react-hooks/exhaustive-deps

  const connect = async () => { if (!householdId) return; const current = ++request.current; setBusy('CONNECT'); setNotice(localize("システムブラウザーで Gmail を認証しています…")); try { const next = await platformClient.connectGmail(householdId); if (current !== request.current) return; setConnection(next); await loadLabels(next, current); setNotice(next.status === 'SELECTING_LABEL' ? localize("取込対象の Gmail ラベルを選択してください。") : localize("Gmail の接続状態を更新しました。")) } catch { if (current === request.current) setNotice(localize("Gmail を接続できませんでした。")) } finally { if (current === request.current) setBusy(null) } }
  const bind = async () => { if (!householdId || !connection) return; const label = labels.find((item) => item.id === selectedLabelId); if (!label) { setNotice(localize("ラベルを選択してください。")); return } const current = ++request.current; setBusy('LABEL'); try { const next = await platformClient.bindGmailLabel({ householdId, connectionId: connection.id, labelId: label.id, labelName: label.name, gmailQuery: gmailQuery.trim() }); if (current !== request.current) return; setConnection(next); await loadSchedule(next, current); setNotice(localize("Gmail ラベルを接続しました。添付メールは確認待ちとして取り込まれます。")) } catch { if (current === request.current) setNotice(localize("ラベルを接続できませんでした。検索条件には has:attachment が必要です。")) } finally { if (current === request.current) setBusy(null) } }
  const saveSchedule = async () => { if (!householdId || !connection) return; const current = ++request.current; setBusy('SCHEDULE'); try { const next = await platformClient.updateGmailSchedule({ householdId, connectionId: connection.id, enabled, intervalMinutes: interval }); if (current !== request.current) return; setSchedule(next); setNotice(next.enabled ? localize(`${next.intervalMinutes}分ごとの確認を有効にしました。`) : localize("自動確認を停止しました。")) } catch { if (current === request.current) setNotice(localize("同期スケジュールを更新できませんでした。")) } finally { if (current === request.current) setBusy(null) } }
  const syncNow = async () => { if (!householdId || !connection) return; const current = ++request.current; setBusy('SYNC'); try { const next = await platformClient.syncGmailNow(householdId, connection.id); if (current !== request.current) return; setSchedule(next); setNotice(localize(`${next.lastDiscoveredCount}件の新しいメール候補を確認しました。`)) } catch { if (current === request.current) setNotice(localize("Gmail の変更を確認できませんでした。")) } finally { if (current === request.current) setBusy(null) } }
  const disconnect = async () => { if (!householdId || !connection) return; const current = ++request.current; setBusy('DISCONNECT'); try { const next = await platformClient.disconnectGmail(householdId, connection.id); if (current !== request.current) return; setConnection(next); setSchedule(null); setNotice(localize("Gmail の接続を解除しました。取り込み済みの原本と台帳は残ります。")) } catch { if (current === request.current) setNotice(localize("Gmail の接続を解除できませんでした。")) } finally { if (current === request.current) setBusy(null) } }

  const unavailable = availability && !availability.available; const canConnect = availability?.available && householdId && (!connection || ['DISCONNECTED', 'AUTH_REQUIRED'].includes(connection.status))
  return <section id="connector-settings-gmail" className="panel google-drive-settings" aria-labelledby="gmail-settings-title" aria-busy={busy !== null}><div className="panel-head"><div><h2 id="gmail-settings-title" tabIndex={-1}><Mail size={16} /> Gmail</h2><p>{localize("指定ラベルの添付メールを読み取り専用で同期し、EML原本とCSV・Excel添付をImport Inboxへ追加します。")}</p></div><b className={`drive-state drive-state-${connection?.status ?? (unavailable ? 'UNAVAILABLE' : 'LOADING')}`}>{unavailable ? localize("利用不可") : connection ? localize(statusLabel[connection.status]) : availability?.available ? localize("未接続") : localize("確認中")}</b></div><p className="drive-review-gate"><strong>{localize("確認ゲート:")}</strong> {localize("メール添付は自動記帳されません。Import Inboxで確認した候補だけを台帳へ反映します。")}</p>
    {busy === 'LOAD' && !availability ? <p className="empty-state">{localize("Gmail の利用可否を確認中…")}</p> : unavailable ? <p className="empty-state">{localize("このビルドには Gmail の接続設定が含まれていません。")}</p> : !availability ? <div className="drive-retry"><p className="empty-state">{notice || localize("Gmail の状態を確認できませんでした。")}</p><button className="secondary-btn" onClick={() => void load()}>{localize("再試行")}</button></div> : <>{canConnect && <button className="primary-btn drive-connect" disabled={busy !== null} onClick={() => void connect()}><Mail size={15} />{busy === 'CONNECT' ? localize("認証中…") : connection?.status === 'AUTH_REQUIRED' ? localize("Gmail を再認証") : localize("Gmail を接続")}</button>}{connection?.status === 'SELECTING_LABEL' && <div className="drive-folder-form"><label htmlFor="gmail-label">{localize("取込対象ラベル")}</label><div><select id="gmail-label" value={selectedLabelId} disabled={busy !== null} onChange={(event) => setSelectedLabelId(event.target.value)}><option value="">{localize("ラベルを選択")}</option>{labels.map((label) => <option key={label.id} value={label.id}>{label.name}</option>)}</select><button className="primary-btn" disabled={busy !== null || !selectedLabelId} onClick={() => void bind()}>{busy === 'LABEL' ? localize("接続中…") : localize("ラベルを接続")}</button></div><label htmlFor="gmail-query">{localize("検索条件")}</label><input id="gmail-query" value={gmailQuery} disabled={busy !== null} onChange={(event) => setGmailQuery(event.target.value)} /><small>{localize("has:attachment は必須です。専用ラベルで取込範囲を限定できます。")}</small></div>}{connection?.status === 'CONNECTED' && <><dl className="drive-summary"><div><dt>{localize("Google アカウント")}</dt><dd>{connection.accountEmail}</dd></div><div><dt>{localize("対象ラベル")}</dt><dd>{connection.labelName}</dd></div><div><dt>{localize("検索条件")}</dt><dd>{connection.gmailQuery}</dd></div><div><dt>{localize("最終同期")}</dt><dd>{connection.lastChangeAt ?? connection.lastFullScanAt ?? localize("未実行")}</dd></div></dl><div className="drive-schedule"><label><input type="checkbox" checked={enabled} disabled={busy !== null} onChange={(event) => setEnabled(event.target.checked)} /> {localize("自動で変更を確認")}</label><label>{localize("間隔")}<select aria-label={localize("Gmail 同期間隔")} value={interval} disabled={busy !== null || !enabled} onChange={(event) => setInterval(Number(event.target.value) as 15 | 30 | 60)}><option value={15}>{localize("15分")}</option><option value={30}>{localize("30分")}</option><option value={60}>{localize("60分")}</option></select></label><button className="secondary-btn" disabled={busy !== null} onClick={() => void saveSchedule()}>{busy === 'SCHEDULE' ? localize("保存中…") : localize("スケジュールを保存")}</button></div><div className="drive-actions"><button className="primary-btn" disabled={busy !== null} onClick={() => void syncNow()}><RefreshCw size={15} />{busy === 'SYNC' ? localize("確認中…") : localize("今すぐ同期")}</button><button className="text-btn" disabled={busy !== null} onClick={() => void disconnect()}><Link2Off size={14} />{busy === 'DISCONNECT' ? localize("解除中…") : localize("接続を解除")}</button></div>{schedule?.suspensionReason && <p role="alert" className="drive-warning">{localize("同期が停止しています（")}{schedule.suspensionReason}{localize("）。再認証または再試行してください。")}</p>}</>}</>}
    {notice && busy !== 'LOAD' && <p className="drive-notice" role="status" aria-live="polite">{notice}</p>}</section>
}
