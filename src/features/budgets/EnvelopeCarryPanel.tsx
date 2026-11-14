import { useEffect, useId, useState } from 'react'
import { localize } from '../../i18n'
import { platformClient } from '../../platform'
import type { MoveMonthlyBudgetInputDto } from '../../platform/types'
import { YenInput } from '../../ui/YenInput'
import { loadEnvelopeMonths } from './envelopeLoader'
import { buildEnvelopeView, movableJpy, type EnvelopeMonthData, type EnvelopeView } from './envelopeView'

const yen = (value: number) => `${value < 0 ? '−' : ''}¥${Math.abs(value).toLocaleString('ja-JP')}`

export function EnvelopeCarryPanel({ householdId, month, revision, onChanged, load = loadEnvelopeMonths, move = (input) => platformClient.moveBudget(input) }: {
  readonly householdId: string | null
  readonly month: string
  readonly revision: number
  readonly onChanged?: () => void
  readonly load?: (householdId: string, month: string) => Promise<readonly EnvelopeMonthData[]>
  readonly move?: (input: MoveMonthlyBudgetInputDto) => Promise<unknown>
}) {
  const id = useId()
  const [view, setView] = useState<EnvelopeView | null>(null)
  const [coverFor, setCoverFor] = useState<string | null>(null)
  const [sourceId, setSourceId] = useState('')
  const [amount, setAmount] = useState(0)
  const [busy, setBusy] = useState(false)
  const [failed, setFailed] = useState(false)

  useEffect(() => {
    if (!householdId) { setView(null); return }
    let active = true
    load(householdId, month).then((months) => { if (active) setView(buildEnvelopeView(months, month)) }).catch(() => { if (active) setView(null) })
    return () => { active = false }
  }, [householdId, load, month, revision])

  if (!view) return null
  const target = view.rows.find((row) => row.categoryAccountId === coverFor)
  // Largest remaining first, so the default source is the one that can cover the most.
  const sources = target ? view.rows.filter((row) => row.categoryAccountId !== target.categoryAccountId && movableJpy(row) > 0).sort((left, right) => movableJpy(right) - movableJpy(left)) : []
  const source = sources.find((row) => row.categoryAccountId === sourceId)
  const cap = source ? movableJpy(source) : 0
  const canMove = !!target && !!source && amount > 0 && amount <= cap && !busy

  const startCover = (categoryId: string) => {
    const row = view.rows.find((item) => item.categoryAccountId === categoryId)!
    const first = [...view.rows].filter((item) => item.categoryAccountId !== categoryId && movableJpy(item) > 0).sort((left, right) => movableJpy(right) - movableJpy(left))[0]
    setCoverFor(categoryId); setFailed(false)
    setSourceId(first?.categoryAccountId ?? '')
    setAmount(first ? Math.min(-row.availableJpy, movableJpy(first)) : 0)
  }
  const submit = async () => {
    if (!householdId || !target || !source) return
    setBusy(true); setFailed(false)
    try {
      await move({ householdId, month, fromCategoryAccountId: source.categoryAccountId, toCategoryAccountId: target.categoryAccountId, amountJpy: amount })
      setCoverFor(null)
      onChanged?.()
    } catch { setFailed(true) } finally { setBusy(false) }
  }

  return <section className="panel envelope-panel" aria-labelledby={`${id}-title`}>
    <div className="panel-head"><div><h2 id={`${id}-title`}>{localize("繰越と未割当")}</h2><p>{view.startMonth} → {view.month}</p></div>
      <strong className={view.readyToAssignJpy < 0 ? 'is-negative' : ''}>{localize("未割当（累計）")} {yen(view.readyToAssignJpy)}{view.readyToAssignJpy < 0 && <> · {localize("割り当て超過")}</>}</strong></div>
    <p className="envelope-note">{localize("表示は試算で保存されません。「不足を補う」は今月の予算額を付け替えます（実績と台帳は変わりません）。")}</p>
    <table className="envelope-table">
      <thead><tr><th scope="col">{localize("カテゴリー")}</th><th scope="col">{localize("前月繰越")}</th><th scope="col">{localize("今月予算")}</th><th scope="col">{localize("実績")}</th><th scope="col">{localize("繰越込みの残り")}</th>{onChanged && <th scope="col"><span className="visually-hidden">{localize("操作")}</span></th>}</tr></thead>
      <tbody>{view.rows.map((row) => <tr key={row.categoryAccountId}>
        <th scope="row">{row.categoryName}</th><td>{yen(row.carryInJpy)}</td><td>{yen(row.assignedJpy)}</td><td>{yen(row.activityJpy)}</td>
        <td className={row.availableJpy < 0 ? 'is-negative' : ''}>{row.availableJpy < 0 && <>{localize("超過")} </>}{yen(row.availableJpy)}</td>
        {onChanged && <td>{row.availableJpy < 0 && <button type="button" className="secondary-btn" disabled={busy} onClick={() => startCover(row.categoryAccountId)}>{localize("不足を補う")}</button>}</td>}
      </tr>)}</tbody>
    </table>
    {target && <div className="envelope-cover" role="group" aria-label={`${target.categoryName} ${localize("不足を補う")}`}>
      {sources.length === 0 ? <p className="envelope-note">{localize("補填元にできるカテゴリーに今月の残りがありません。")}</p> : <>
        <label>{localize("補填元")}<select value={sourceId} onChange={(event) => { setSourceId(event.target.value); const next = sources.find((row) => row.categoryAccountId === event.target.value); if (next) setAmount(Math.min(-target.availableJpy, movableJpy(next))) }}>{sources.map((row) => <option key={row.categoryAccountId} value={row.categoryAccountId}>{row.categoryName} ({yen(movableJpy(row))})</option>)}</select></label>
        <label>{localize("移す金額")}<YenInput value={amount} onChange={setAmount} /></label>
        <span className="envelope-cover-actions">
          <button type="button" className="primary-btn" disabled={!canMove} onClick={() => void submit()}>{localize("移す")}</button>
          <button type="button" className="secondary-btn" disabled={busy} onClick={() => setCoverFor(null)}>{localize("キャンセル")}</button>
        </span>
        {amount > cap && cap > 0 && <p className="transfer-pair-error" role="status">{localize("補填元の残りを超えています。")}</p>}
      </>}
      {failed && <p className="transfer-pair-error" role="alert">{localize("予算の移動に失敗しました。もう一度お試しください。")}</p>}
    </div>}
  </section>
}
