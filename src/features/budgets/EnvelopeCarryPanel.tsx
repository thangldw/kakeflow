import { useEffect, useId, useState } from 'react'
import { localize } from '../../i18n'
import { loadEnvelopeMonths } from './envelopeLoader'
import { buildEnvelopeView, type EnvelopeMonthData, type EnvelopeView } from './envelopeView'

const yen = (value: number) => `${value < 0 ? '−' : ''}¥${Math.abs(value).toLocaleString('ja-JP')}`

export function EnvelopeCarryPanel({ householdId, month, revision, load = loadEnvelopeMonths }: {
  readonly householdId: string | null
  readonly month: string
  readonly revision: number
  readonly load?: (householdId: string, month: string) => Promise<readonly EnvelopeMonthData[]>
}) {
  const id = useId()
  const [view, setView] = useState<EnvelopeView | null>(null)

  useEffect(() => {
    if (!householdId) { setView(null); return }
    let active = true
    load(householdId, month).then((months) => { if (active) setView(buildEnvelopeView(months, month)) }).catch(() => { if (active) setView(null) })
    return () => { active = false }
  }, [householdId, load, month, revision])

  if (!view) return null
  return <section className="panel envelope-panel" aria-labelledby={`${id}-title`}>
    <div className="panel-head"><div><h2 id={`${id}-title`}>{localize("繰越と未割当")}</h2><p>{view.startMonth} → {view.month}</p></div>
      <strong className={view.readyToAssignJpy < 0 ? 'is-negative' : ''}>{localize("未割当（累計）")} {yen(view.readyToAssignJpy)}{view.readyToAssignJpy < 0 && <> · {localize("割り当て超過")}</>}</strong></div>
    <p className="envelope-note">{localize("試算であり保存されません。予算が設定されたカテゴリーのみ、最初の予算月から繰り越して計算します。")}</p>
    <table className="envelope-table">
      <thead><tr><th scope="col">{localize("カテゴリー")}</th><th scope="col">{localize("前月繰越")}</th><th scope="col">{localize("今月予算")}</th><th scope="col">{localize("実績")}</th><th scope="col">{localize("繰越込みの残り")}</th></tr></thead>
      <tbody>{view.rows.map((row) => <tr key={row.categoryAccountId}>
        <th scope="row">{row.categoryName}</th><td>{yen(row.carryInJpy)}</td><td>{yen(row.assignedJpy)}</td><td>{yen(row.activityJpy)}</td>
        <td className={row.availableJpy < 0 ? 'is-negative' : ''}>{row.availableJpy < 0 && <>{localize("超過")} </>}{yen(row.availableJpy)}</td>
      </tr>)}</tbody>
    </table>
  </section>
}
