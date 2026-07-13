import { useEffect, useState } from 'react'
import type { AttributionScopeDto } from '../../platform/types'
import { ActionCenter } from './ForecastActionViews'
import { createForecastActionPlatform } from './forecastActionPlatform'
import type { ActionItemDto, ForecastActionRequestDto, ForecastActionDto } from './forecastActionPlatform'
import { homeActionSlice } from './actionCenterModel'

const platform = createForecastActionPlatform()

export function HomeActionCenter({ householdId, accountGroupId, attributionScope, asOf, revision, desktop, onAction, onViewAll, query = platform.query }: {
  readonly householdId: string | null
  readonly accountGroupId: string | null
  readonly attributionScope: AttributionScopeDto
  readonly asOf: string
  readonly revision: number
  readonly desktop: boolean
  readonly onAction: (action: ActionItemDto) => void
  readonly onViewAll: () => void
  readonly query?: (request: ForecastActionRequestDto) => Promise<ForecastActionDto>
}) {
  const scopeKey = attributionScope.kind === 'MEMBER' ? `MEMBER:${attributionScope.memberId}` : attributionScope.kind
  const requestScope = `${householdId ?? ''}|${accountGroupId ?? ''}|${scopeKey}|${asOf}`
  const [snapshot, setSnapshot] = useState<{ key: string; actions: readonly ActionItemDto[] } | null>(null)
  const [unavailable, setUnavailable] = useState(false)
  const [retry, setRetry] = useState(0)

  useEffect(() => {
    if (!desktop || !householdId) { setSnapshot(null); setUnavailable(false); return }
    let active = true
    setUnavailable(false)
    void query({ householdId, accountGroupId, attributionScope, asOf })
      .then((result) => { if (active) { setSnapshot({ key: requestScope, actions: result.actions }); setUnavailable(false) } })
      .catch(() => { if (active) setUnavailable(true) })
    return () => { active = false }
  }, [accountGroupId, asOf, attributionScope, desktop, householdId, query, requestScope, retry, revision])

  const actions = snapshot?.key === requestScope ? snapshot.actions : null

  if (!desktop) return <section className="home-action-status" aria-labelledby="home-action-title"><div><p>Action Center</p><h2 id="home-action-title">対応が必要な項目</h2></div><span>ブラウザプレビューではデスクトップの対応項目を読み込みません。</span></section>
  if (actions === null && !unavailable) return <section className="home-action-status" aria-labelledby="home-action-title" aria-busy="true"><div><p>Action Center</p><h2 id="home-action-title">対応項目を確認中</h2></div></section>
  if (actions === null) return <section className="home-action-status home-action-status--error" aria-labelledby="home-action-title"><div><p>Action Center</p><h2 id="home-action-title">対応項目を読み込めません</h2><span role="status">ダッシュボードの集計値はそのまま確認できます。</span></div><button type="button" className="secondary-btn" onClick={() => setRetry((value) => value + 1)}>再試行</button></section>

  const slice = homeActionSlice(actions)
  return <div className="home-action-center">
    {unavailable && <p className="home-action-stale" role="status">最新状態を取得できないため、直前に確認した対応項目を表示しています。</p>}
    <p className="home-action-context">基準日 <time dateTime={asOf}>{asOf}</time>{(accountGroupId || attributionScope.kind !== 'ALL') && ' ・ 取込確認は選択中の口座・家族スコープにかかわらず世帯全体を対象にします。'}</p>
    <ActionCenter actions={slice.visible} totalCount={slice.total} onAction={onAction} />
    {slice.total > slice.visible.length && <button type="button" className="home-action-all" onClick={onViewAll}>{slice.total}件すべて見る</button>}
  </div>
}
