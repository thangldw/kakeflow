import { useCallback, useEffect, useState } from 'react'
import { localize } from '../../i18n'
import type { DecisionDto, DecisionInputDto } from '../../platform/types'

export interface DecisionJournalPanelProps {
  readonly householdId: string
  /** Today's date in Tokyo (YYYY-MM-DD). */
  readonly today: string
  readonly list: (householdId: string) => Promise<readonly DecisionDto[]>
  readonly create: (input: DecisionInputDto) => Promise<DecisionDto>
  readonly recordOutcome: (householdId: string, id: string, outcome: string) => Promise<void>
  readonly remove: (householdId: string, id: string) => Promise<void>
}

const yen = (value: number) => `¥${value.toLocaleString('ja-JP')}`

function addMonths(date: string, months: number): string {
  const [y, m, d] = date.split('-').map(Number) as [number, number, number]
  const total = (y * 12 + (m - 1)) + months
  const year = Math.floor(total / 12); const month = (total % 12) + 1
  const last = new Date(Date.UTC(year, month, 0)).getUTCDate()
  return `${String(year).padStart(4, '0')}-${String(month).padStart(2, '0')}-${String(Math.min(d, last)).padStart(2, '0')}`
}

/** Big decisions written down with their reason and expectation, and looked back on later. Stored only on this device. */
export function DecisionJournalPanel({ householdId, today, list, create, recordOutcome, remove }: DecisionJournalPanelProps) {
  const [items, setItems] = useState<readonly DecisionDto[]>([])
  const [failed, setFailed] = useState(false)
  const [busy, setBusy] = useState(false)
  const [title, setTitle] = useState('')
  const [amount, setAmount] = useState('')
  const [reason, setReason] = useState('')
  const [expectation, setExpectation] = useState('')
  const [reviewOn, setReviewOn] = useState(() => addMonths(today, 6))
  const [outcomes, setOutcomes] = useState<Readonly<Record<string, string>>>({})

  const reload = useCallback(async () => {
    try { setItems(await list(householdId)); setFailed(false) } catch { setFailed(true) }
  }, [householdId, list])
  useEffect(() => { void reload() }, [reload])

  const amountJpy = /^\d+$/u.test(amount.trim()) ? Number(amount.trim()) : null
  const amountInvalid = amount.trim() !== '' && amountJpy === null
  const canAdd = title.trim() !== '' && /^\d{4}-\d{2}-\d{2}$/u.test(reviewOn) && reviewOn >= today && !amountInvalid && !busy

  const act = async (action: () => Promise<unknown>) => {
    setBusy(true)
    try { await action(); await reload() } catch { setFailed(true) } finally { setBusy(false) }
  }

  const add = () => act(async () => {
    await create({ householdId, decidedOn: today, title: title.trim(), amountJpy, reason: reason.trim(), expectation: expectation.trim(), reviewOn })
    setTitle(''); setAmount(''); setReason(''); setExpectation(''); setReviewOn(addMonths(today, 6))
  })

  const pending = items.filter((item) => item.outcome === null)
  const reviewed = items.filter((item) => item.outcome !== null)

  return <section className="panel decision-journal-panel" aria-label={localize("大きな決断の記録")}>
    <div className="panel-head"><div><h2>{localize("大きな決断の記録")}</h2>
      <p>{localize("大きな買い物や契約の理由と期待を書き残し、後で振り返ります。この端末にだけ保存され、台帳は変更しません。")}</p></div></div>
    <div className="decision-journal-form">
      <label>{localize("決めたこと")}<input value={title} maxLength={120} onChange={(event) => setTitle(event.target.value)} /></label>
      <label>{localize("金額（任意）")}<input inputMode="numeric" value={amount} onChange={(event) => setAmount(event.target.value)} aria-invalid={amountInvalid} /></label>
      <label>{localize("理由")}<textarea value={reason} maxLength={1000} onChange={(event) => setReason(event.target.value)} /></label>
      <label>{localize("期待していること")}<textarea value={expectation} maxLength={1000} onChange={(event) => setExpectation(event.target.value)} /></label>
      <label>{localize("振り返る日")}<input type="date" value={reviewOn} min={today} onChange={(event) => setReviewOn(event.target.value)} /></label>
      <button type="button" className="secondary-btn" disabled={!canAdd} onClick={() => void add()}>{localize("記録する")}</button>
    </div>
    {failed && <p role="alert">{localize("決断の記録を読み込めない、または保存できませんでした。")}</p>}
    {pending.length > 0 && <ul aria-label={localize("振り返り待ち")}>{pending.map((item) => <li key={item.id}>
      <strong>{item.title}</strong>{item.amountJpy !== null && ` ${yen(item.amountJpy)}`} — {item.decidedOn}
      {item.reason && <p>{localize("理由")}: {item.reason}</p>}
      {item.expectation && <p>{localize("期待")}: {item.expectation}</p>}
      <p>{item.reviewOn <= today ? localize("振り返りの時期です。") : `${localize("振り返る日")}: ${item.reviewOn}`}</p>
      {item.reviewOn <= today && <>
        <label>{localize("実際はどうだったか")}<textarea value={outcomes[item.id] ?? ''} maxLength={1000} onChange={(event) => setOutcomes({ ...outcomes, [item.id]: event.target.value })} /></label>
        <button type="button" className="secondary-btn" disabled={busy || (outcomes[item.id] ?? '').trim() === ''} onClick={() => void act(() => recordOutcome(householdId, item.id, (outcomes[item.id] ?? '').trim()))}>{localize("振り返りを保存")}</button>
      </>}
      <button type="button" className="secondary-btn" disabled={busy} onClick={() => void act(() => remove(householdId, item.id))}>{localize("削除")}</button>
    </li>)}</ul>}
    {reviewed.length > 0 && <ul aria-label={localize("振り返り済み")}>{reviewed.map((item) => <li key={item.id}>
      <strong>{item.title}</strong>{item.amountJpy !== null && ` ${yen(item.amountJpy)}`} — {item.decidedOn}
      {item.expectation && <p>{localize("期待")}: {item.expectation}</p>}
      <p>{localize("結果")}: {item.outcome}</p>
      <button type="button" className="secondary-btn" disabled={busy} onClick={() => void act(() => remove(householdId, item.id))}>{localize("削除")}</button>
    </li>)}</ul>}
  </section>
}
