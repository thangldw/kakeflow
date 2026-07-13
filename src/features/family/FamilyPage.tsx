import { useState } from 'react'
import { Users } from 'lucide-react'

import { platformClient } from '../../platform'
import type { AccountDto, HouseholdMemberDto } from '../../platform'
import { LocalSyncFoundationPanel } from '../sync/LocalSyncFoundationPanel'

interface FamilyPageProps {
  readonly householdId: string | null
  readonly members: readonly HouseholdMemberDto[]
  readonly accounts: readonly AccountDto[]
  readonly onMembersChanged: () => Promise<void>
}

export function FamilyPage({ householdId, members, accounts, onMembersChanged }: FamilyPageProps) {
  const [displayName, setDisplayName] = useState('')
  const [relationshipLabel, setRelationshipLabel] = useState('')
  const [busy, setBusy] = useState(false)
  const [notice, setNotice] = useState('')
  const activeMembers = members.filter((member) => member.status === 'ACTIVE')

  const createMember = async () => {
    if (!householdId || !displayName.trim()) { setNotice('表示名を入力してください。'); return }
    setBusy(true); setNotice('')
    try {
      await platformClient.createHouseholdMember({
        id: crypto.randomUUID(), householdId, displayName: displayName.trim(),
        relationshipLabel: relationshipLabel.trim() || null,
      })
      setDisplayName(''); setRelationshipLabel('')
      await onMembersChanged(); setNotice('家族メンバーを追加しました。')
    } catch { setNotice('家族メンバーを追加できませんでした。入力内容を確認してください。') }
    finally { setBusy(false) }
  }

  return <>
    <div className="page-header"><div><p>ローカル家族管理</p><h1>家族スペース</h1><span>家族ごとの口座を、この端末内で整理します。</span></div></div>
    <section className="family-local-notice" aria-label="家族スペースの利用範囲">
      <Users size={20} aria-hidden="true" />
      <div><strong>整理・集計のためのローカル設定です</strong><p>「個人」はこの端末内の表示区分です。ログイン、閲覧制限、アクセス制御ではありません。この端末を利用できる人は、すべての家計データを確認できます。</p></div>
    </section>
    <section className="panel family-panel">
      <div className="panel-head"><div><h2>家族メンバー</h2><p>{activeMembers.length}人が有効・{accounts.filter((account) => account.ownershipKind === 'MEMBER').length}口座をメンバー別に整理</p></div></div>
      {platformClient.runtime === 'tauri' && householdId ? <>
        <div className="family-member-form">
          <label>表示名<input aria-label="新しいメンバーの表示名" maxLength={80} value={displayName} onChange={(event) => setDisplayName(event.target.value)} placeholder="例：太郎" /></label>
          <label>続柄・メモ<input aria-label="新しいメンバーの続柄・メモ" maxLength={80} value={relationshipLabel} onChange={(event) => setRelationshipLabel(event.target.value)} placeholder="例：父" /></label>
          <button className="primary-btn" disabled={busy} onClick={() => void createMember()}>{busy ? '追加中…' : 'メンバーを追加'}</button>
        </div>
        <div className="family-member-list">
          {members.map((member) => <MemberEditor key={member.id} householdId={householdId} member={member} accountCount={accounts.filter((account) => account.ownerMemberId === member.id).length} onChanged={onMembersChanged} setNotice={setNotice} />)}
          {members.length === 0 && <p className="empty-state">メンバーはまだ登録されていません。口座は「世帯共有」のまま利用できます。</p>}
        </div>
        {notice && <p role="status" className="family-notice">{notice}</p>}
      </> : <p className="empty-state">家族メンバーの管理はデスクトップ版で利用できます。</p>}
    </section>
    <LocalSyncFoundationPanel householdId={householdId} members={members} allowBinding />
  </>
}

function MemberEditor({ householdId, member, accountCount, onChanged, setNotice }: { readonly householdId: string; readonly member: HouseholdMemberDto; readonly accountCount: number; readonly onChanged: () => Promise<void>; readonly setNotice: (notice: string) => void }) {
  const [name, setName] = useState(member.displayName)
  const [relationship, setRelationship] = useState(member.relationshipLabel ?? '')
  const [busy, setBusy] = useState(false)
  const changed = name.trim() !== member.displayName || (relationship.trim() || null) !== member.relationshipLabel
  const save = async () => {
    if (!name.trim()) { setNotice('表示名を入力してください。'); return }
    setBusy(true)
    try {
      await platformClient.updateHouseholdMember({ householdId, memberId: member.id, displayName: name.trim(), relationshipLabel: relationship.trim() || null, sortOrder: member.sortOrder })
      await onChanged(); setNotice('メンバー情報を更新しました。')
    } catch { setNotice('メンバー情報を更新できませんでした。') }
    finally { setBusy(false) }
  }
  const archive = async () => {
    setBusy(true)
    try {
      await platformClient.archiveHouseholdMember(householdId, member.id)
      await onChanged(); setNotice('メンバーをアーカイブしました。')
    } catch { setNotice('メンバーをアーカイブできませんでした。所有する口座がある場合は、先に口座の所有者を変更してください。') }
    finally { setBusy(false) }
  }
  return <article className={`family-member-row ${member.status === 'ARCHIVED' ? 'archived' : ''}`}>
    <div className="family-member-avatar" aria-hidden="true">{member.displayName.trim().slice(0, 2)}</div>
    <label>表示名<input aria-label={`${member.displayName}の表示名`} maxLength={80} disabled={member.status === 'ARCHIVED'} value={name} onChange={(event) => setName(event.target.value)} /></label>
    <label>続柄・メモ<input aria-label={`${member.displayName}の続柄・メモ`} maxLength={80} disabled={member.status === 'ARCHIVED'} value={relationship} onChange={(event) => setRelationship(event.target.value)} /></label>
    <div className="family-member-meta"><span>{member.status === 'ACTIVE' ? '有効' : 'アーカイブ済み'}</span><small>{accountCount}口座</small></div>
    {member.status === 'ACTIVE' && <><button className="secondary-btn" disabled={busy || !changed} onClick={() => void save()}>保存</button><button className="text-btn" disabled={busy} onClick={() => void archive()}>アーカイブ</button></>}
  </article>
}
