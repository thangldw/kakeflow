import { useEffect, useRef, useState } from 'react'

import { platformClient } from '../../platform'
import type { HouseholdMemberDto, LocalSyncFoundationStatusDto } from '../../platform'

interface Props {
  readonly householdId: string | null
  readonly members?: readonly HouseholdMemberDto[]
  readonly allowBinding?: boolean
}

const shortId = (value: string) => value.length <= 18 ? value : `${value.slice(0, 12)}…${value.slice(-4)}`

export function LocalSyncFoundationPanel({ householdId, members = [], allowBinding = false }: Props) {
  const [status, setStatus] = useState<LocalSyncFoundationStatusDto | null>(null)
  const [selectedMemberId, setSelectedMemberId] = useState('')
  const [loading, setLoading] = useState(false)
  const [notice, setNotice] = useState('')
  const request = useRef(0)
  const currentMember = members.find((member) => member.id === status?.binding.memberId)
  const bindingMembers = members.filter((member) => member.status === 'ACTIVE' || member.id === status?.binding.memberId)

  const load = async () => {
    if (!householdId || platformClient.runtime !== 'tauri') { setStatus(null); return }
    const current = ++request.current
    setLoading(true); setNotice('')
    try {
      const next = await platformClient.getLocalSyncFoundationStatus(householdId)
      if (current !== request.current) return
      setStatus(next); setSelectedMemberId(next.binding.memberId ?? '')
    } catch {
      if (current === request.current) { setStatus(null); setNotice('この端末の同期基盤を確認できませんでした。') }
    } finally { if (current === request.current) setLoading(false) }
  }

  useEffect(() => { void load(); return () => { request.current += 1 } }, [householdId]) // eslint-disable-line react-hooks/exhaustive-deps

  const saveBinding = async () => {
    if (!householdId || !status) return
    setLoading(true); setNotice('')
    try {
      const next = await platformClient.updatePrincipalMemberBinding({
        householdId, principalId: status.principal.id,
        memberId: selectedMemberId || null, mutationId: `binding:${crypto.randomUUID()}`,
      })
      setStatus(next); setSelectedMemberId(next.binding.memberId ?? '')
      setNotice(`この端末の主な利用者を「${next.binding.memberName ?? '未設定'}」として保存しました。`)
    } catch { setNotice('対応付けを保存できませんでした。') }
    finally { setLoading(false) }
  }

  return <section className="panel local-sync-foundation" aria-busy={loading} aria-label={allowBinding ? 'この端末の利用者設定' : 'この端末の変更履歴'}>
    <div className="panel-head"><div><h2>{allowBinding ? 'この端末を主に使うメンバー' : 'この端末の変更履歴'}</h2><p>家計データの変更履歴と復元に必要な情報を、この端末内に保存しています。クラウドや他の端末には送信されません。</p></div><span className="local-only-badge">端末内のみ</span></div>
    {platformClient.runtime !== 'tauri' ? <p className="empty-state">同期基盤の状態はデスクトップ版で確認できます。クラウド同期は接続されていません。</p>
      : loading && !status ? <p className="empty-state">この端末の状態を確認中…</p>
        : status ? <>
          <dl className="local-sync-grid">
            <div><dt>端末</dt><dd>{status.device.displayName}</dd><small>{shortId(status.device.id)}</small></div>
            <div><dt>主な利用者</dt><dd>{status.binding.memberName ?? '未設定'}</dd><small>この端末での整理用</small></div>
            <div><dt>保存済みの変更</dt><dd>{status.outbox.envelopeCount}件・最新 #{status.outbox.latestSequence}</dd><small>他端末への送信なし</small></div>
            <div><dt>復元チェック</dt><dd>{status.restoreValidation === 'ENABLED' ? '有効' : '—'}</dd><small>台帳の整合性を確認</small></div>
          </dl>
          {allowBinding && <div className="principal-binding-row">
            <label>この端末を主に使うメンバー
              <select disabled={loading} value={selectedMemberId} onChange={(event) => setSelectedMemberId(event.target.value)}>
                <option value="">未設定</option>
                {bindingMembers.map((member) => <option key={member.id} value={member.id}>{member.displayName}{member.status === 'ARCHIVED' ? '（アーカイブ済み）' : ''}</option>)}
              </select>
            </label>
            <button className="secondary-btn" disabled={loading || selectedMemberId === (status.binding.memberId ?? '')} onClick={() => void saveBinding()}>利用者を保存</button>
          </div>}
          {allowBinding && currentMember?.status === 'ARCHIVED' && <p className="account-visibility-note" role="alert">現在の利用者はアーカイブ済みです。有効なメンバーへ変更するか、未設定にしてください。</p>}
          {allowBinding && <p className="account-visibility-note">この対応付けは将来の同期準備用です。現在はログイン、閲覧制限、アクセス制御を行いません。</p>}
          <details className="sync-technical-details"><summary>技術情報</summary><dl><div><dt>ローカル主体</dt><dd>{status.principal.displayName}・{shortId(status.principal.id)}</dd></div><div><dt>復元方式</dt><dd>スキーマ・関連整合性検証</dd></div></dl></details>
        </> : <div><p className="empty-state">{notice || '状態を確認できませんでした。'}</p><button className="secondary-btn" disabled={loading} onClick={() => void load()}>再試行</button></div>}
    {status && notice && <p role="status">{notice}</p>}
  </section>
}
