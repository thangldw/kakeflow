import { useEffect, useMemo, useRef, useState } from 'react'

import { platformClient } from '../../platform'
import type { ChangePackageReviewDto, ChangePackageResolutionInputDto } from '../../platform'
import { showToast } from '../../toast'

interface Props { readonly householdId: string | null }
type Choice = ChangePackageResolutionInputDto['resolution']

const kindLabels: Readonly<Record<string, string>> = {
  HOUSEHOLD: '世帯', HOUSEHOLD_MEMBER: 'メンバー', ACCOUNT: '口座', TRANSACTION: '取引',
  CARD_STATEMENT: 'カード請求', CARD_PAYMENT: 'カード引落照合',
  PORTFOLIO_SNAPSHOT: '資産残高', BROKERAGE_EVENT: '証券取引',
  INVESTMENT_FX_RATE: '投資用為替レート', INVESTMENT_MARKET_PRICE: '市場価格',
  AGGREGATE_ASSET_SNAPSHOT: '総資産履歴',
  MONTHLY_BUDGET_PLAN: '月間予算', SAVINGS_GOAL: '貯蓄目標', CLASSIFICATION_RULE: '分類ルール',
  ACCOUNT_GROUP: '口座グループ', CARD_SETTLEMENT_MAPPING: 'カード引落口座',
  DASHBOARD_PREFERENCES: 'ダッシュボード設定', DELIMITED_PARSER_PROFILE: 'CSV読込設定',
  RECURRING_SERIES_PREFERENCES: '定期支出の確認状態',
}

export function LocalChangePackagePanel({ householdId }: Props) {
  const [review, setReview] = useState<ChangePackageReviewDto | null>(null)
  const [choices, setChoices] = useState<Record<string, Choice>>({})
  const [busy, setBusy] = useState(false)
  const [notice, setNotice] = useState('')
  const request = useRef(0)
  const heading = useRef<HTMLHeadingElement>(null)
  const pending = useMemo(() => review?.records.filter((record) => record.resolution === 'PENDING') ?? [], [review])
  const choiceKey = (kind: string, id: string) => `${kind}\u0000${id}`

  const load = async () => {
    if (!householdId || platformClient.runtime !== 'tauri') { setReview(null); return }
    const current = ++request.current
    setBusy(true); setNotice('')
    try {
      const next = await platformClient.getActiveChangePackageReview(householdId)
      if (current === request.current) setReview(next)
    } catch { if (current === request.current) setNotice('変更パッケージの状態を確認できませんでした。') }
    finally { if (current === request.current) setBusy(false) }
  }

  useEffect(() => { setReview(null); setChoices({}); void load(); return () => { request.current += 1 } }, [householdId]) // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => { if (review) heading.current?.focus() }, [review?.packageId, review?.state]) // eslint-disable-line react-hooks/exhaustive-deps

  const pick = async () => {
    if (!householdId) return
    const current = ++request.current
    setBusy(true); setNotice('パッケージを検証しています…')
    try {
      const next = await platformClient.pickAndStageChangePackage(householdId)
      if (current !== request.current) return
      if (next) { setReview(next); setChoices({}); setNotice('内容を確認してください。まだ台帳へ反映されていません。') }
      else setNotice('ファイルの選択をキャンセルしました。')
    } catch { if (current === request.current) setNotice('このパッケージを検証できませんでした。元の端末でもう一度作成してください。') }
    finally { if (current === request.current) setBusy(false) }
  }

  const exportPackage = async () => {
    if (!householdId) return
    const current = ++request.current
    setBusy(true); setNotice('')
    try {
      const name = await platformClient.exportChangePackage(householdId)
      if (current === request.current) { setNotice(name ? `${name} を保存しました。` : '保存をキャンセルしました。'); if (name) showToast('変更パッケージを保存しました。') }
    } catch { if (current === request.current) setNotice('変更パッケージを作成できませんでした。') }
    finally { if (current === request.current) setBusy(false) }
  }

  const confirmChoices = async () => {
    if (!review) return
    const current = ++request.current; const packageId = review.packageId
    const resolutions = pending.map((record) => ({
      entityKind: record.entityKind, entityId: record.entityId,
      resolution: choices[choiceKey(record.entityKind, record.entityId)],
    })).filter((item): item is ChangePackageResolutionInputDto => Boolean(item.resolution))
    if (resolutions.length !== pending.length) { setNotice('要確認の項目すべてで、どちらを残すか選択してください。'); return }
    setBusy(true); setNotice('')
    try { const next = await platformClient.resolveChangePackage(packageId, resolutions); if (current === request.current) { setReview(next); setNotice('選択内容を確認しました。') } }
    catch { if (current === request.current) setNotice('選択内容を保存できませんでした。') }
    finally { if (current === request.current) setBusy(false) }
  }

  const apply = async () => {
    if (!review) return
    const current = ++request.current; const packageId = review.packageId
    setBusy(true); setNotice('台帳へまとめて反映しています…')
    try { const next = await platformClient.applyChangePackage(packageId); if (current === request.current) { setReview(next); setNotice('変更パッケージを台帳へ反映しました。'); showToast('変更パッケージを台帳へ反映しました。') } }
    catch { if (current === request.current) { setNotice('反映できませんでした。台帳への変更は行われていません。内容を再確認してください。'); showToast('変更パッケージを反映できませんでした。', 'error') } }
    finally { if (current === request.current) setBusy(false) }
  }

  const discard = async () => {
    if (!review) return
    const current = ++request.current; const packageId = review.packageId
    setBusy(true); setNotice('')
    try { await platformClient.discardChangePackage(packageId); if (current === request.current) { setReview(null); setChoices({}); setNotice('確認中のパッケージを破棄しました。') } }
    catch { if (current === request.current) setNotice('パッケージを破棄できませんでした。') }
    finally { if (current === request.current) setBusy(false) }
  }

  return <section className="panel local-change-package" aria-busy={busy}>
    <div className="panel-head"><div><h2 ref={heading} tabIndex={-1}>変更パッケージ</h2><p>取引・計画・設定・カード照合・投資データを確認して、この端末へまとめて反映します。投資データを含む場合は、先に原本カプセルを読み込んでください。</p></div><span className="local-only-badge">手順 2 / 2</span></div>
    <p className="evidence-bundle-scope">ネットワーク送受信は行いません。パッケージを選択しただけでは台帳を変更せず、原本との対応を確認できない投資データは反映されません。</p>
    <p className="change-package-layout-scope"><strong>ホームのレイアウト:</strong> 「財務概要」「家計簿」「資産・負債」「カード照合」「キャッシュフロー」の5テンプレート分の並びと表示設定を、このローカルファイルに含めます。</p>
    <p className="change-package-layout-scope"><strong>定期支出の確認状態:</strong> 「確認済み」「対象外」の判断をこのローカルファイルに含めます。反映後の予測と固定費分析に影響しますが、過去の取引は変更しません。</p>
    {platformClient.runtime !== 'tauri' ? <p className="empty-state">変更パッケージはデスクトップ版で利用できます。</p> : <>
      <div className="change-package-actions">
        <button className="primary-btn" disabled={busy || !householdId || Boolean(review && review.state !== 'APPLIED')} onClick={() => void pick()}>ローカルパッケージを選択</button>
        <button className="secondary-btn" disabled={busy || !householdId} onClick={() => void exportPackage()}>現在の状態をパッケージに保存</button>
      </div>
      {!review && !busy && <p className="empty-state">確認中のパッケージはありません。選択しただけでは台帳は変わりません。</p>}
      {review && <div className="change-package-review">
        <div className="change-package-summary" aria-label="変更内容の集計">
          <div><span>追加</span><strong>{review.createCount}</strong></div><div><span>更新</span><strong>{review.updateCount}</strong></div>
          <div><span>削除</span><strong>{review.deleteCount}</strong></div><div><span>要確認</span><strong>{review.conflictCount}</strong></div>
        </div>
        <p className="change-package-meta">作成元 revision #{review.sourceRevision}・全 {review.recordCount} 件</p>
        {pending.length > 0 && <div className="change-package-conflicts">
          <h3 tabIndex={-1}>反映前の確認</h3><p>共通の変更元を証明できない項目、または削除項目があります。各項目で残す内容を選択してください。</p>
          {pending.map((record) => {
            const key = choiceKey(record.entityKind, record.entityId); const deletion = record.operation === 'DELETE'
            return <fieldset key={key}><legend>{kindLabels[record.entityKind] ?? record.entityKind}・{record.entityId}</legend>
              <p>{deletion ? 'パッケージには存在しないため、削除候補です。' : 'この端末とパッケージの内容が異なります。'}</p>
              <label><input type="radio" name={key} checked={choices[key] === 'KEEP_LOCAL'} onChange={() => setChoices((value) => ({ ...value, [key]: 'KEEP_LOCAL' }))} />この端末の内容を残す</label>
              <label><input type="radio" name={key} checked={choices[key] === 'APPLY_INCOMING'} onChange={() => setChoices((value) => ({ ...value, [key]: 'APPLY_INCOMING' }))} />{deletion ? 'パッケージに合わせて削除する' : 'パッケージの内容を使う'}</label>
            </fieldset>
          })}
          <button className="primary-btn" disabled={busy || pending.some((record) => !choices[choiceKey(record.entityKind, record.entityId)])} onClick={() => void confirmChoices()}>選択内容を確定</button>
        </div>}
        {review.state === 'READY' && <div className="change-package-ready"><h3 tabIndex={-1}>反映準備ができました</h3><p>すべての変更をひとまとめに反映します。途中で失敗した場合、台帳は変更されません。</p><button className="primary-btn" disabled={busy} onClick={() => void apply()}>台帳へ反映</button></div>}
        {review.state === 'APPLIED' && <p className="change-package-applied" role="status">このパッケージは反映済みです。</p>}
        {review.state !== 'APPLIED' && <button className="text-btn" disabled={busy} onClick={() => void discard()}>このパッケージを破棄</button>}
      </div>}
    </>}
    {notice && <p className="change-package-notice" role="status" aria-live="polite">{notice}</p>}
  </section>
}
