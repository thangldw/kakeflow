import { useEffect, useMemo, useRef, useState } from 'react'

import { platformClient } from '../../platform'
import type { FamilySnapshotResolutionInputDto, FamilySnapshotReviewDto } from '../../platform'
import './FamilySnapshotReviewPanel.css'

interface Props { readonly householdId: string | null; readonly revision?: number }
type Choice = FamilySnapshotResolutionInputDto['resolution']
type ReviewDomain = FamilySnapshotReviewDto['records'][number]['domain']
const domainOrder: readonly ReviewDomain[] = ['LEDGER', 'CARD', 'INVESTMENT', 'PLANNING', 'CONFIG']
const domainLabels: Readonly<Record<ReviewDomain, string>> = {
  LEDGER: '台帳・取引', CARD: 'カード・支払照合', INVESTMENT: '投資・資産', PLANNING: '予算・目標', CONFIG: 'ルール・表示設定',
}

export function FamilySnapshotReviewPanel({ householdId, revision = 0 }: Props) {
  const [review, setReview] = useState<FamilySnapshotReviewDto | null>(null)
  const [choices, setChoices] = useState<Record<string, Choice>>({})
  const [busy, setBusy] = useState(false)
  const [notice, setNotice] = useState<{ readonly kind: 'status' | 'error'; readonly text: string } | null>(null)
  const request = useRef(0); const heading = useRef<HTMLHeadingElement>(null)
  const pending = useMemo(() => review?.records.filter((record) => record.resolution === 'PENDING') ?? [], [review])
  const domainCounts = useMemo(() => domainOrder.map((domain) => ({ domain, count: review?.records.filter((record) => record.domain === domain).length ?? 0 })).filter((item) => item.count > 0), [review])
  const pendingGroups = useMemo(() => domainOrder.map((domain) => ({ domain, records: pending.filter((record) => record.domain === domain) })).filter((group) => group.records.length > 0), [pending])
  const key = (kind: string, id: string) => `${kind}\0${id}`

  const load = async () => {
    if (!householdId || platformClient.runtime !== 'tauri') { setReview(null); return }
    const id = ++request.current; setBusy(true); setNotice(null)
    try { const next = await platformClient.getActiveFamilySnapshotReview(householdId); if (id === request.current) { setReview(next); setChoices({}) } }
    catch { if (id === request.current) setNotice({ kind: 'error', text: '家族から受信した内容を確認できませんでした。' }) }
    finally { if (id === request.current) setBusy(false) }
  }
  useEffect(() => { void load(); return () => { request.current += 1 } }, [householdId, revision]) // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => { if (review) heading.current?.focus() }, [review?.packageId]) // eslint-disable-line react-hooks/exhaustive-deps

  const resolve = async () => {
    if (!review) return
    const resolutions = pending.map((record) => ({ entityKind: record.entityKind, entityId: record.entityId, resolution: choices[key(record.entityKind, record.entityId)] }))
      .filter((item): item is FamilySnapshotResolutionInputDto => Boolean(item.resolution))
    if (resolutions.length !== pending.length) { setNotice({ kind: 'error', text: '要確認の項目すべてで、どちらを残すか選択してください。' }); return }
    setBusy(true); setNotice(null)
    try { setReview(await platformClient.resolveFamilySnapshot(review.packageId, resolutions)); setNotice({ kind: 'status', text: '選択内容を確認しました。まだ台帳へ反映されていません。' }) }
    catch { setNotice({ kind: 'error', text: '選択内容を保存できませんでした。台帳は変更されていません。' }) }
    finally { setBusy(false) }
  }
  const apply = async () => {
    if (!review) return
    setBusy(true); setNotice({ kind: 'status', text: 'この端末の台帳へまとめて反映しています…' })
    try { setReview(await platformClient.applyFamilySnapshot(review.packageId)); setNotice({ kind: 'status', text: `${review.recordCount}件をこの端末へ反映しました。` }) }
    catch { setNotice({ kind: 'error', text: '反映できませんでした。台帳への変更は行われていません。内容を再確認してください。' }) }
    finally { setBusy(false) }
  }
  const discard = async () => {
    if (!review) return
    setBusy(true)
    try { await platformClient.discardFamilySnapshot(review.packageId); setReview(null); setChoices({}); setNotice({ kind: 'status', text: '受信した確認内容を破棄しました。' }) }
    catch { setNotice({ kind: 'error', text: '確認内容を破棄できませんでした。' }) }
    finally { setBusy(false) }
  }

  if (platformClient.runtime !== 'tauri') return null
  return <section className="panel family-snapshot-review" aria-busy={busy}>
    <div className="panel-head"><div><h2 ref={heading} tabIndex={-1}>家族からの変更を確認</h2><p>受信した配信範囲だけを確認し、最後にこの端末の台帳へ反映します。</p></div><span className="local-only-badge">自動反映なし</span></div>
    {!review ? <p className="empty-state">確認待ちの家族データはありません。</p> : <>
      <div className="family-review-source"><strong>{review.senderMemberName}さんから・{review.audienceVisibility === 'SHARED' ? '世帯共有' : `個人・${review.audienceMemberName}`}</strong><span>全{review.recordCount}件</span></div>
      <p className="family-review-boundary">このパッケージに含まれる範囲だけを確認します。含まれない個人データは削除・変更しません。</p>
      <div className="family-review-summary" aria-label="家族からの変更内容の集計"><div><span>追加</span><strong>{review.createCount}</strong></div><div><span>更新</span><strong>{review.updateCount}</strong></div><div><span>削除候補</span><strong>{review.deleteCount}</strong></div><div><span>競合</span><strong>{review.conflictCount}</strong></div></div>
      {domainCounts.length > 0 && <div className="family-review-domain-counts" aria-label="受信内容の分野別内訳">{domainCounts.map((item) => <span key={item.domain}><b>{domainLabels[item.domain]}</b>{item.count}件</span>)}</div>}
      {(review.evidenceFileCount > 0 || review.evidenceRecordCount > 0) && <div className="family-review-evidence-summary" aria-label="受信した原本と証跡"><strong>この配信に含まれる原本</strong><span>{review.evidenceFileCount}ファイル</span><span>{review.evidenceRecordCount}証跡</span><small>カード・投資データと同じ配信範囲で検証し、反映します。</small></div>}
      {review.records.some((record) => record.domain === 'CONFIG') && <p className="family-review-config-warning" role="status">ルールと取込・表示設定は今後の分類、取込、画面表示に影響します。過去の取引は自動変更されません。</p>}
      {pending.length > 0 && <div className="family-review-conflicts"><h3>反映前の確認</h3><p>各項目の現在の内容と、受信した内容を比べて残す方を選んでください。</p>{pendingGroups.map((group) => <section className="family-review-domain" key={group.domain} aria-labelledby={`family-review-domain-${group.domain}`}><h4 id={`family-review-domain-${group.domain}`}>{domainLabels[group.domain]} <span>{group.records.length}件</span></h4>{group.records.map((record) => {
        const choiceKey = key(record.entityKind, record.entityId); const deletion = record.operation === 'DELETE'
        return <fieldset key={choiceKey}><legend>{record.entitySummary}</legend><small>{record.entityLabel}</small><div className="family-review-comparison"><div><span>この端末</span><p>{record.localSummary ?? '該当データなし'}</p></div><div><span>受信内容</span><p>{record.incomingSummary}</p></div></div><label><input type="radio" name={choiceKey} checked={choices[choiceKey] === 'KEEP_LOCAL'} onChange={() => setChoices((current) => ({ ...current, [choiceKey]: 'KEEP_LOCAL' }))} />この端末の内容を残す</label><label><input type="radio" name={choiceKey} checked={choices[choiceKey] === 'APPLY_INCOMING'} onChange={() => setChoices((current) => ({ ...current, [choiceKey]: 'APPLY_INCOMING' }))} />{deletion ? '受信内容に合わせて削除する' : '受信した内容を使う'}</label></fieldset>
      })}</section>)}<button className="primary-btn" disabled={busy || pending.some((record) => !choices[key(record.entityKind, record.entityId)])} onClick={() => void resolve()}>選択内容を確定</button></div>}
      {review.state === 'READY' && <div className="family-review-ready"><h3>反映準備ができました</h3><p>{domainCounts.map((item) => `${domainLabels[item.domain]} ${item.count}件`).join('、')}をこの端末へまとめて反映します。</p><p>途中で失敗した場合は何も反映されません。送信元へ自動で書き戻しません。</p><button className="primary-btn" disabled={busy} onClick={() => void apply()}>この端末の台帳に反映</button></div>}
      {review.state === 'APPLIED' && <p className="family-review-applied" role="status">この家族データは反映済みです。</p>}
      {review.state !== 'APPLIED' && <button className="text-btn" disabled={busy} onClick={() => void discard()}>この確認内容を破棄</button>}
    </>}
    {notice && <p className={notice.kind === 'error' ? 'family-review-error' : 'family-review-notice'} role={notice.kind === 'error' ? 'alert' : 'status'}>{notice.text}</p>}
  </section>
}
