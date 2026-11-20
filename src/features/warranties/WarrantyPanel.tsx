import { useCallback, useEffect, useState } from 'react'
import { localize } from '../../i18n'
import { warrantyState } from './warrantyState'
import type { WarrantyDto, WarrantyInputDto } from '../../platform/types'

export interface WarrantyPanelProps {
  readonly householdId: string
  /** Today's date in Tokyo (YYYY-MM-DD). */
  readonly today: string
  readonly list: (householdId: string) => Promise<readonly WarrantyDto[]>
  readonly create: (input: WarrantyInputDto) => Promise<WarrantyDto>
  readonly remove: (householdId: string, id: string) => Promise<void>
}

const yen = (value: number) => `¥${value.toLocaleString('ja-JP')}`

/** Things bought with a warranty and the day the cover ends. Stored only on this device. */
export function WarrantyPanel({ householdId, today, list, create, remove }: WarrantyPanelProps) {
  const [items, setItems] = useState<readonly WarrantyDto[]>([])
  const [failed, setFailed] = useState(false)
  const [busy, setBusy] = useState(false)
  const [item, setItem] = useState('')
  const [store, setStore] = useState('')
  const [purchasedOn, setPurchasedOn] = useState(today)
  const [months, setMonths] = useState('12')
  const [amount, setAmount] = useState('')

  const reload = useCallback(async () => {
    try { setItems(await list(householdId)); setFailed(false) } catch { setFailed(true) }
  }, [householdId, list])
  useEffect(() => { void reload() }, [reload])

  const monthsValue = /^\d+$/u.test(months.trim()) ? Number(months.trim()) : null
  const amountJpy = /^\d+$/u.test(amount.trim()) ? Number(amount.trim()) : null
  const amountInvalid = amount.trim() !== '' && amountJpy === null
  const canAdd = item.trim() !== '' && /^\d{4}-\d{2}-\d{2}$/u.test(purchasedOn) && monthsValue !== null && monthsValue >= 1 && monthsValue <= 120 && !amountInvalid && !busy

  const act = async (action: () => Promise<unknown>) => {
    setBusy(true)
    try { await action(); await reload() } catch { setFailed(true) } finally { setBusy(false) }
  }

  const add = () => act(async () => {
    await create({ householdId, item: item.trim(), store: store.trim(), purchasedOn, warrantyMonths: monthsValue ?? 12, amountJpy, note: '' })
    setItem(''); setStore(''); setAmount(''); setPurchasedOn(today); setMonths('12')
  })

  return <section className="panel warranty-panel" aria-label={localize("保証期間の一覧")}>
    <div className="panel-head"><div><h2>{localize("保証期間の一覧")}</h2>
      <p>{localize("買ったものの保証が切れる日を記録します。この端末にだけ保存され、台帳は変更しません。")}</p></div></div>
    <div className="warranty-form">
      <label>{localize("品名")}<input value={item} maxLength={120} onChange={(event) => setItem(event.target.value)} /></label>
      <label>{localize("購入した店（任意）")}<input value={store} maxLength={120} onChange={(event) => setStore(event.target.value)} /></label>
      <label>{localize("購入日")}<input type="date" value={purchasedOn} onChange={(event) => setPurchasedOn(event.target.value)} /></label>
      <label>{localize("保証期間（月）")}<input inputMode="numeric" value={months} onChange={(event) => setMonths(event.target.value)} /></label>
      <label>{localize("購入金額（任意）")}<input inputMode="numeric" value={amount} onChange={(event) => setAmount(event.target.value)} aria-invalid={amountInvalid} /></label>
      <button type="button" className="secondary-btn" disabled={!canAdd} onClick={() => void add()}>{localize("追加する")}</button>
    </div>
    {failed && <p role="alert">{localize("保証の一覧を読み込めない、または保存できませんでした。")}</p>}
    {items.length > 0 && <ul aria-label={localize("保証中のもの")}>{items.map((entry) => {
      const { state, daysLeft } = warrantyState(entry.expiresOn, today)
      return <li key={entry.id}>
        <strong>{entry.item}</strong>{entry.amountJpy !== null && ` ${yen(entry.amountJpy)}`}{entry.store && ` — ${entry.store}`}
        <p>{localize("購入日")}: {entry.purchasedOn} / {localize("保証期限")}: {entry.expiresOn}</p>
        <p>{state === 'ENDED' ? localize("保証は終了しています。") : <>{state === 'SOON' && `${localize("保証期限が近づいています。")} `}{localize("期限までの日数")}: {daysLeft}</>}</p>
        <button type="button" className="secondary-btn" disabled={busy} onClick={() => void act(() => remove(householdId, entry.id))}>{localize("削除")}</button>
      </li>
    })}</ul>}
  </section>
}
