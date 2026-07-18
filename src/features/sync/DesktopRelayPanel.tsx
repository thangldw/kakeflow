import { useEffect, useRef, useState } from 'react'
import { CloudDownload, CloudUpload, Link2Off, RefreshCw } from 'lucide-react'

import { platformClient } from '../../platform'
import type { DesktopRelayInboundArtifactDto, DesktopRelayStatusDto } from '../../platform'
import { downloadDesktopRelayArtifact, identifyDesktopRelay, listDesktopRelayArtifacts, uploadDesktopRelayArtifact } from './desktopRelayHttp'
import './DesktopRelayPanel.css'
import { localize } from '../../i18n'

interface Props { readonly householdId: string | null; readonly onReviewStaged?: () => void }
type BusyAction = 'LOAD' | 'CONNECT' | 'DISCONNECT' | 'SEND' | 'REFRESH' | `STAGE:${string}` | null

const inboundLabels: Readonly<Record<DesktopRelayInboundArtifactDto['state'], string>> = {
  AVAILABLE: '受信可能', WAITING_FOR_REVIEW: '確認待ち', DUPLICATE: '受信済み',
  REJECTED_INVALID: '検証不可', FAILED_RETRYABLE: '再取得可能',
}

const shortId = (value: string) => value.length <= 20 ? value : `${value.slice(0, 12)}…${value.slice(-5)}`

export function DesktopRelayPanel({ householdId, onReviewStaged }: Props) {
  const [status, setStatus] = useState<DesktopRelayStatusDto | null>(null)
  const [endpoint, setEndpoint] = useState('')
  const [bearerToken, setBearerToken] = useState('')
  const [busy, setBusy] = useState<BusyAction>(null)
  const [notice, setNotice] = useState('')
  const request = useRef(0)

  const load = async () => {
    if (!householdId || platformClient.runtime !== 'tauri') { setStatus(null); return }
    const current = ++request.current; setBusy('LOAD'); setNotice('')
    try {
      const next = await platformClient.getDesktopRelayStatus(householdId)
      if (current !== request.current) return
      setStatus(next); setEndpoint(next.endpoint ?? '')
    } catch { if (current === request.current) { setStatus(null); setNotice(localize("リレーの状態を確認できませんでした。")) } }
    finally { if (current === request.current) setBusy(null) }
  }

  useEffect(() => {
    setStatus(null); setEndpoint(''); setBearerToken(''); setNotice(''); void load()
    return () => { request.current += 1 }
  }, [householdId]) // eslint-disable-line react-hooks/exhaustive-deps

  const connect = async () => {
    if (!householdId || !endpoint.trim() || !bearerToken) { setNotice(localize("エンドポイントと、このセッションで使う接続トークンを入力してください。")); return }
    const current = ++request.current; setBusy('CONNECT'); setNotice(localize("同じプリンシパルの接続先を確認しています…"))
    try {
      const normalizedEndpoint = new URL(endpoint.trim()).toString().replace(/\/$/, '')
      const remotePrincipalId = await identifyDesktopRelay(normalizedEndpoint, bearerToken)
      if (current !== request.current) return
      const next = await platformClient.saveDesktopRelayConnection({ householdId, endpoint: normalizedEndpoint, remotePrincipalId })
      if (current !== request.current) return
      setStatus(next); setEndpoint(next.endpoint ?? normalizedEndpoint)
      setNotice(localize("リレー接続を確認しました。データはまだ送信されていません。"))
    } catch { if (current === request.current) setNotice(localize("接続を確認できませんでした。エンドポイント、トークン、リレー側のCORS設定を確認して再試行してください。")) }
    finally { if (current === request.current) setBusy(null) }
  }

  const disconnect = async () => {
    if (!householdId) return
    const current = ++request.current; setBusy('DISCONNECT'); setNotice('')
    try {
      const next = await platformClient.disconnectDesktopRelay(householdId)
      if (current !== request.current) return
      setStatus(next); setEndpoint(''); setBearerToken(''); setNotice(localize("リレー接続を解除しました。未送信の変更はこの端末に残っています。"))
    } catch { if (current === request.current) setNotice(localize("リレー接続を解除できませんでした。")) }
    finally { if (current === request.current) setBusy(null) }
  }

  const send = async () => {
    if (!householdId || !status?.endpoint || !bearerToken) { setNotice(localize("送信には、このセッション用の接続トークンが必要です。")); return }
    const current = ++request.current; let preparedDeliveryId: string | null = null
    setBusy('SEND'); setNotice(localize("変更パッケージをリレーへ送信しています…"))
    try {
      const remotePrincipalId = await identifyDesktopRelay(status.endpoint, bearerToken)
      if (remotePrincipalId !== status.remotePrincipalId) throw new Error('relay principal changed')
      const delivery = await platformClient.prepareDesktopRelaySend(householdId)
      preparedDeliveryId = delivery.deliveryId
      const accepted = await uploadDesktopRelayArtifact(status.endpoint, bearerToken, delivery)
      if (accepted.artifactId !== delivery.artifactId || accepted.digest !== delivery.digest) throw new Error('relay receipt mismatch')
      if (current !== request.current) return
      const next = await platformClient.acceptDesktopRelaySend({ householdId, deliveryId: delivery.deliveryId, artifactId: accepted.artifactId, digest: accepted.digest, acceptedAt: accepted.acceptedAt })
      if (current !== request.current) return
      setStatus(next); setNotice(localize("リレーが変更パッケージを受理しました。別端末での受信・反映完了を意味しません。"))
    } catch {
      if (preparedDeliveryId) {
        try {
          const failed = await platformClient.failDesktopRelaySend(householdId, preparedDeliveryId)
          if (current === request.current) setStatus(failed)
        } catch { /* keep the last known state */ }
      }
      if (current === request.current) setNotice(localize("送信を完了できませんでした。未送信の変更は残っています。接続を確認して再試行してください。"))
    }
    finally { if (current === request.current) setBusy(null) }
  }

  const refresh = async () => {
    if (!householdId || !status?.endpoint || !bearerToken) { setNotice(localize("受信確認には、このセッション用の接続トークンが必要です。")); return }
    const current = ++request.current; setBusy('REFRESH'); setNotice(localize("リレーの受信一覧を確認しています…"))
    try {
      const remotePrincipalId = await identifyDesktopRelay(status.endpoint, bearerToken)
      if (remotePrincipalId !== status.remotePrincipalId) throw new Error('relay principal changed')
      const artifacts = await listDesktopRelayArtifacts(status.endpoint, bearerToken, householdId, status.localDeviceId)
      if (current !== request.current) return
      const next = await platformClient.registerDesktopRelayInbound({ householdId, artifacts })
      if (current !== request.current) return
      setStatus(next); setNotice(localize(`${artifacts.length}件のリレー項目を確認しました。台帳へは自動反映していません。`))
    } catch { if (current === request.current) setNotice(localize("受信一覧を確認できませんでした。接続、トークン、CORS設定を確認して再試行してください。")) }
    finally { if (current === request.current) setBusy(null) }
  }

  const stage = async (artifact: DesktopRelayInboundArtifactDto) => {
    if (!householdId || !status?.endpoint || !bearerToken) { setNotice(localize("受信には、このセッション用の接続トークンが必要です。")); return }
    const current = ++request.current; setBusy(`STAGE:${artifact.artifactId}`); setNotice(localize("受信データを検証しています…"))
    try {
      const remotePrincipalId = await identifyDesktopRelay(status.endpoint, bearerToken)
      if (remotePrincipalId !== status.remotePrincipalId) throw new Error('relay principal changed')
      const packageBytes = await downloadDesktopRelayArtifact(status.endpoint, bearerToken, artifact)
      if (current !== request.current) return
      const next = await platformClient.stageDesktopRelayInbound({ householdId, artifactId: artifact.artifactId, packageBytes })
      if (current !== request.current) return
      setStatus(next); onReviewStaged?.(); setNotice(localize("変更パッケージを確認待ちに追加しました。内容を選択しても、最終確定までは台帳へ反映されません。"))
    } catch { if (current === request.current) setNotice(localize("受信データを検証できませんでした。台帳は変更されていません。再取得できます。")) }
    finally { if (current === request.current) setBusy(null) }
  }

  if (platformClient.runtime !== 'tauri') return null
  const connected = status?.connectionState === 'CONNECTED' || status?.connectionState === 'DEGRADED'
  return <section className="panel desktop-relay" aria-busy={busy != null}>
    <div className="panel-head"><div><h2>{localize("デスクトップ リレー")}</h2><p>{localize("同じプリンシパルとして確認された端末間で、確定済みデータの変更パッケージを手動で受け渡します。")}</p></div><b className={`relay-state relay-state-${status?.connectionState ?? 'loading'}`}>{status?.connectionState === 'CONNECTED' ? localize("接続済み") : status?.connectionState === 'DEGRADED' ? localize("要再接続") : localize("未接続")}</b></div>
    <p className="relay-boundary">{localize("接続、送信、受信だけでは台帳を変更しません。受信後も変更パッケージの確認と最終確定が必要です。接続済み表示は別端末での適用完了を意味しません。")}</p>
    {!status && busy === 'LOAD' ? <p className="empty-state">{localize("リレーの状態を確認中…")}</p> : !status ? <div className="relay-retry"><p className="empty-state">{notice || localize("リレーの状態を確認できませんでした。")}</p><button className="secondary-btn" onClick={() => void load()}>{localize("再試行")}</button></div> : <>
      <div className="relay-connection-form">
        <label>{localize("リレー エンドポイント")}<input aria-label={localize("リレー エンドポイント")} type="url" value={endpoint} disabled={busy != null || connected} placeholder="https://relay.example" onChange={(event) => setEndpoint(event.target.value)} /></label>
        <label>{localize("接続トークン（この画面のセッションのみ）")}<input aria-label={localize("リレー接続トークン")} type="password" autoComplete="off" value={bearerToken} disabled={busy != null} onChange={(event) => setBearerToken(event.target.value)} /></label>
        {!connected ? <button className="primary-btn" disabled={busy != null} onClick={() => void connect()}>{busy === 'CONNECT' ? localize("確認中…") : localize("リレーを接続")}</button> : <button className="text-btn" disabled={busy != null} onClick={() => void disconnect()}><Link2Off size={14} /> {localize("接続を解除")}</button>}
      </div>
      {connected && <>
        <dl className="relay-summary"><div><dt>{localize("接続先")}</dt><dd>{status.endpoint}</dd></div><div><dt>{localize("接続先プリンシパル")}</dt><dd>{shortId(status.remotePrincipalId ?? '')}</dd></div><div><dt>{localize("未送信")}</dt><dd>{status.outbound.pendingEnvelopeCount}{localize("件")}</dd></div><div><dt>{localize("直近の受理")}</dt><dd>{status.outbound.latestAcceptedAt ?? '—'}</dd></div></dl>
        {status.connectionState === 'DEGRADED' && <p role="alert" className="relay-warning">{localize("前回の通信を完了できませんでした。トークンを確認して送信または受信確認を再試行してください。")}</p>}
        <div className="relay-actions"><button className="primary-btn" disabled={busy != null || status.outbound.pendingEnvelopeCount === 0 || !bearerToken} onClick={() => void send()}><CloudUpload size={15} /> {busy === 'SEND' ? localize("送信中…") : localize("未送信の変更を送る")}</button><button className="secondary-btn" disabled={busy != null || !bearerToken} onClick={() => void refresh()}><RefreshCw size={15} /> {busy === 'REFRESH' ? localize("確認中…") : localize("受信を確認")}</button></div>
        <div className="relay-inbox"><h3>{localize("受信一覧")}</h3>{status.inbound.length === 0 ? <p className="empty-state">{localize("受信済みの変更パッケージはありません。")}</p> : status.inbound.map((artifact) => <article key={artifact.artifactId}><span><strong>{localize(inboundLabels[artifact.state])}</strong><small>{artifact.createdAt} ・ {shortId(artifact.originDeviceId)} ・ {artifact.digest.slice(0, 12)}…</small></span>{(artifact.state === 'AVAILABLE' || artifact.state === 'FAILED_RETRYABLE') && <button className="secondary-btn" disabled={busy != null || !bearerToken} onClick={() => void stage(artifact)}><CloudDownload size={14} /> {busy === `STAGE:${artifact.artifactId}` ? localize("検証中…") : artifact.state === 'FAILED_RETRYABLE' ? localize("再取得") : localize("受信して確認")}</button>}{artifact.state === 'WAITING_FOR_REVIEW' && <button className="secondary-btn" disabled={busy != null} onClick={onReviewStaged}>{localize("確認画面を更新")}</button>}</article>)}</div>
      </>}
    </>}
    {status && notice && <p className="relay-notice" role="status" aria-live="polite">{notice}</p>}
  </section>
}
