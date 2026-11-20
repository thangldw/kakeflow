import { useEffect, useState } from 'react'
import { localize } from '../../i18n'
import type { AccountBalanceDto } from '../../platform/types'
import { compareBalance, parseAmount } from './balanceDifference'

export interface BalanceCheckPanelProps {
  readonly asOf: string
  readonly load: () => Promise<readonly AccountBalanceDto[]>
}

const yen = (value: number) => `¥${value.toLocaleString('ja-JP')}`

/** Type the balance an account really shows today and see whether the ledger agrees. Nothing is saved or changed. */
export function BalanceCheckPanel({ asOf, load }: BalanceCheckPanelProps) {
  const [accounts, setAccounts] = useState<readonly AccountBalanceDto[]>([])
  const [entered, setEntered] = useState<Readonly<Record<string, string>>>({})
  useEffect(() => {
    let live = true
    load().then((rows) => { if (live) setAccounts(rows) }).catch(() => { if (live) setAccounts([]) })
    return () => { live = false }
  }, [asOf, load])
  if (accounts.length === 0) return null

  return <section className="panel balance-check-panel" aria-label={localize("実際の残高との照合")}>
    <div className="panel-head"><div><h2>{localize("実際の残高との照合")}</h2>
      <p>{localize("口座アプリや通帳に表示されている今日の残高を入力すると、KakeFlow の帳簿と合っているか確認できます。入力した値は保存されません。")}</p></div></div>
    <ul>{accounts.map((account) => {
      const typed = parseAmount(entered[account.accountId] ?? '')
      const verdict = typed === null ? null : compareBalance(typed, account.balanceJpy)
      return <li key={account.accountId}>
        <label>{account.name}（{localize("帳簿")} {yen(account.balanceJpy)}）
          <input inputMode="numeric" value={entered[account.accountId] ?? ''} onChange={(event) => setEntered({ ...entered, [account.accountId]: event.target.value })} />
        </label>
        {verdict?.kind === 'MATCH' && <small role="status">{localize("一致しています。")}</small>}
        {verdict?.kind === 'BANK_HIGHER' && <small role="status">{localize("実際のほうが多い")}: {yen(verdict.differenceJpy)} — {localize("記録していない収入や入金がないか確認してください。")}</small>}
        {verdict?.kind === 'BANK_LOWER' && <small role="status">{localize("実際のほうが少ない")}: {yen(verdict.differenceJpy)} — {localize("記録していない支出や引き出し、二重の記録がないか確認してください。")}</small>}
      </li>
    })}</ul>
  </section>
}
