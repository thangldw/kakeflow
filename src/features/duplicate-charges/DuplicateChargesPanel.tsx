import { useEffect, useState } from 'react'
import { localize } from '../../i18n'
import type { DuplicateChargeDto } from '../../platform/types'

export interface DuplicateChargesPanelProps {
  readonly month: string
  readonly load: () => Promise<readonly DuplicateChargeDto[]>
  readonly onOpenTransactions: () => void
}

const yen = (value: number) => `¥${value.toLocaleString('ja-JP')}`

/** Pairs of charges with the same payee and amount a few days apart. A prompt to look, never a verdict. */
export function DuplicateChargesPanel({ month, load, onOpenTransactions }: DuplicateChargesPanelProps) {
  const [items, setItems] = useState<readonly DuplicateChargeDto[] | null>(null)
  useEffect(() => {
    let live = true
    setItems(null)
    load().then((rows) => { if (live) setItems(rows) }).catch(() => { if (live) setItems([]) })
    return () => { live = false }
  }, [month, load])
  if (!items || items.length === 0) return null
  return <section className="panel duplicate-charges-panel" aria-label={localize("二重請求の可能性")}>
    <div className="panel-head"><div><h2>{localize("二重請求の可能性")}</h2>
      <p>{localize("同じ支払先・同じ金額の支出が数日以内に2回あります。本当に2回の買い物なら問題ありません。")}</p></div></div>
    <ul>{items.map((item) => <li key={`${item.firstTransactionId}-${item.secondTransactionId}`}>
      {item.payee} {yen(item.amountJpy)} — {item.firstOn} / {item.secondOn}
      {item.daysApart > 0 ? ` (${item.daysApart}${localize("日差")})` : ` (${localize("同日")})`}
    </li>)}</ul>
    <button type="button" className="secondary-btn" onClick={onOpenTransactions}>{localize("取引を確認する")}</button>
  </section>
}
