import { useEffect, useState } from 'react'
import type { AttributionScopeDto } from '../../platform/types'
import { ActionCenter } from './ForecastActionViews'
import { createForecastActionPlatform } from './forecastActionPlatform'
import type { ActionItemDto, ForecastActionRequestDto, ForecastActionDto } from './forecastActionPlatform'
import { homeActionSlice } from './actionCenterModel'
import { localize } from '../../i18n'

const platform = createForecastActionPlatform()
const previewActions: readonly ActionItemDto[] = [
  { id: 'preview-card', kind: 'CARD_PAYMENT_DUE', priority: 'HIGH', title: 'PayPayカード 支払期日 07-27', detail: '三井住友銀行の口座引落 ¥20,170 と全額照合済みです。', dueOn: '2026-07-27', amountJpy: 20_170, entityId: 'preview-card', reasons: ['カード請求と銀行引落を照合済み'] },
  { id: 'preview-import', kind: 'IMPORT_REVIEW', priority: 'MEDIUM', title: '重複6件・振替候補3件', detail: '転記前のレビューが必要です。', dueOn: null, amountJpy: null, entityId: 'preview-import', reasons: ['候補は確定台帳に含まれません'] },
  { id: 'preview-ocr', kind: 'IMPORT_REVIEW', priority: 'MEDIUM', title: '低信頼度OCR 2件', detail: 'レシート原本と抽出値を確認してください。', dueOn: null, amountJpy: null, entityId: 'preview-ocr', reasons: ['OCR信頼度が基準未満です'] },
  { id: 'preview-budget', kind: 'BUDGET_OVERRUN', priority: 'HIGH', title: '教育費が予算の112%', detail: '夏期講習と教材費の支出ペースを確認してください。', dueOn: null, amountJpy: 12_000, entityId: 'preview-budget', reasons: ['予算超過'] },
]

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

  if (!desktop) return <div className="home-action-center home-action-center--preview"><ActionCenter actions={previewActions} totalCount={previewActions.length} onAction={onAction} /></div>
  if (actions === null && !unavailable) return <section className="home-action-status" aria-labelledby="home-action-title" aria-busy="true"><div><p>{localize("対応項目")}</p><h2 id="home-action-title">{localize("対応項目を確認中")}</h2></div></section>
  if (actions === null) return <section className="home-action-status home-action-status--error" aria-labelledby="home-action-title"><div><p>{localize("対応項目")}</p><h2 id="home-action-title">{localize("対応項目を読み込めません")}</h2><span role="status">{localize("ダッシュボードの集計値はそのまま確認できます。")}</span></div><button type="button" className="secondary-btn" onClick={() => setRetry((value) => value + 1)}>{localize("再試行")}</button></section>

  const slice = homeActionSlice(actions)
  return <div className="home-action-center">
    {unavailable && <p className="home-action-stale" role="status">{localize("最新状態を取得できないため、直前に確認した対応項目を表示しています。")}</p>}
    <p className="home-action-context">{localize("基準日")} <time dateTime={asOf}>{asOf}</time>{(accountGroupId || attributionScope.kind !== 'ALL') && localize(" ・ 取込確認は選択中の口座・家族スコープにかかわらず世帯全体を対象にします。")}</p>
    <ActionCenter actions={slice.visible} totalCount={slice.total} onAction={onAction} />
    {slice.total > slice.visible.length && <button type="button" className="home-action-all" onClick={onViewAll}>{slice.total}{localize("件すべて見る")}</button>}
  </div>
}
