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
      setNotice('ローカル主体と家族メンバーの対応を記録しました。')
    } catch { setNotice('対応付けを保存できませんでした。') }
    finally { setLoading(false) }
  }

  return <section className="panel local-sync-foundation" aria-label={allowBinding ? 'この端末の利用者との対応' : '同期基盤（この端末）'}>
    <div className="panel-head"><div><h2>{allowBinding ? 'この端末の利用者との対応' : '同期基盤（この端末）'}</h2><p>クラウド同期・他端末への送信はまだ行いません。端末識別子、ローカル主体、変更エンベロープをこの端末内で準備しています。</p></div><span className="local-only-badge">端末内のみ</span></div>
    {platformClient.runtime !== 'tauri' ? <p className="empty-state">同期基盤の状態はデスクトップ版で確認できます。クラウド同期は接続されていません。</p>
      : loading && !status ? <p className="empty-state">この端末の状態を確認中…</p>
        : status ? <>
          <dl className="local-sync-grid">
            <div><dt>端末</dt><dd>{status.device.displayName}</dd><small>{shortId(status.device.id)}</small></div>
            <div><dt>ローカル主体</dt><dd>{status.principal.displayName}</dd><small>{shortId(status.principal.id)}</small></div>
            <div><dt>変更ログ</dt><dd>{status.outbox.envelopeCount}件・最新 #{status.outbox.latestSequence}</dd><small>送信処理なし</small></div>
            <div><dt>復元検証</dt><dd>{status.restoreValidation === 'ENABLED' ? '対応' : '—'}</dd><small>schema / relation</small></div>
          </dl>
          {allowBinding && <div className="principal-binding-row">
            <label>ローカル主体を家族メンバーに対応付け
              <select value={selectedMemberId} onChange={(event) => setSelectedMemberId(event.target.value)}>
                <option value="">未設定</option>
                {members.filter((member) => member.status === 'ACTIVE').map((member) => <option key={member.id} value={member.id}>{member.displayName}</option>)}
              </select>
            </label>
            <button className="secondary-btn" disabled={loading || selectedMemberId === (status.binding.memberId ?? '')} onClick={() => void saveBinding()}>対応を保存</button>
          </div>}
          {allowBinding && <p className="account-visibility-note">この対応付けは将来の同期準備用です。現在はログイン、閲覧制限、アクセス制御を行いません。</p>}
        </> : <div><p className="empty-state">{notice || '状態を確認できませんでした。'}</p><button className="secondary-btn" disabled={loading} onClick={() => void load()}>再試行</button></div>}
    {status && notice && <p role="status">{notice}</p>}
  </section>
}
