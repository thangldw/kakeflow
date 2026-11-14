import { useEffect, useId, useMemo, useState } from 'react'
import { localize } from '../../i18n'
import { platformClient } from '../../platform'
import type { PlatformClient } from '../../platform/types'
import type { TransactionRowDto, TransferPairActionDto, TransferPairDecisionDto } from '../../platform/types'
import { proposeFromRows } from './transferPairs'

const yen = (value: number) => `¥${value.toLocaleString('ja-JP')}`
// A leg that is not among the loaded rows (voided by a merge, or outside the visible range) must not leak its internal id.
const label = (row: TransactionRowDto | undefined) => row?.payee || row?.description || localize("表示範囲外または無効化済みの取引")

type TransferClient = Pick<PlatformClient, 'listTransferPairDecisions' | 'decideTransferPair'>

/**
 * Possible own-account transfers found among the loaded rows. Confirming retypes
 * both legs as a calculation-excluded transfer (journals and balances are not
 * changed); dismissed pairs are remembered on this device only.
 */
export function TransferPairStrip({ householdId, rows, revision, onChanged, client = platformClient }: {
  readonly householdId: string | null
  readonly rows: readonly TransactionRowDto[]
  readonly revision: number
  readonly onChanged: () => void
  readonly client?: TransferClient
}) {
  const id = useId()
  const [decisions, setDecisions] = useState<readonly TransferPairDecisionDto[]>([])
  const [busy, setBusy] = useState(false)
  const [failed, setFailed] = useState(false)

  useEffect(() => {
    if (!householdId) { setDecisions([]); return }
    let active = true
    Promise.resolve().then(() => client.listTransferPairDecisions(householdId)).then((next) => { if (active) setDecisions(next) }).catch(() => { if (active) setDecisions([]) })
    return () => { active = false }
  }, [client, householdId, revision])

  const byId = useMemo(() => new Map(rows.map((row) => [row.id, row])), [rows])
  const result = useMemo(() => proposeFromRows(rows, decisions), [rows, decisions])

  if (!householdId || (result.proposals.length === 0 && result.ambiguousIds.length === 0 && decisions.length === 0 && !failed)) return null

  const decide = async (action: TransferPairActionDto, outTransactionId: string, inTransactionId: string) => {
    setBusy(true); setFailed(false)
    try {
      setDecisions(await client.decideTransferPair({ householdId, outTransactionId, inTransactionId, action }))
      if (action !== 'REJECT') onChanged()
    } catch { setFailed(true) } finally { setBusy(false) }
  }

  return <section className="panel transfer-pair-strip" aria-labelledby={`${id}-title`}>
    <div className="panel-head"><div><h2 id={`${id}-title`}>{localize("振替の候補")}</h2><p>{localize("金額が同じで、別々の口座・近い日付の入出金です。確定すると両方が振替になり、収支の集計から外れます（仕訳と口座残高は変わりません）。")}</p><p>{localize("「一つの仕訳に統合」は支払側の取引に振替の仕訳（受取口座の借方・支払口座の貸方）を作り、受取側の取引は無効（VOID）になります。原本の紐づけは保持され、履歴から元に戻せます。")}</p></div></div>
    {failed && <p className="transfer-pair-error" role="alert">{localize("振替の操作に失敗しました。もう一度お試しください。")}</p>}
    {result.proposals.length > 0 && <ul className="transfer-pair-list">{result.proposals.map((proposal) => {
      const out = byId.get(proposal.outId); const inn = byId.get(proposal.inId); const rowId = `${id}-${proposal.outId}-${proposal.inId}`
      return <li key={rowId} id={rowId}>
        <span className="transfer-pair-legs"><strong>{label(out)}</strong> <small>{out?.creditAccountName}</small> → <strong>{label(inn)}</strong> <small>{inn?.debitAccountName}</small></span>
        <span className="transfer-pair-meta">{yen(proposal.amountJpy)} · {proposal.dayGap === 0 ? localize("同日") : <>{proposal.dayGap}{localize("日差")}</>}</span>
        <span className="transfer-pair-actions">
          <button type="button" className="primary-btn" disabled={busy} aria-describedby={rowId} onClick={() => void decide('LINK', proposal.outId, proposal.inId)}>{localize("振替として確定")}</button>
          <button type="button" className="secondary-btn" disabled={busy} aria-describedby={rowId} onClick={() => void decide('MERGE', proposal.outId, proposal.inId)}>{localize("一つの仕訳に統合")}</button>
          <button type="button" className="secondary-btn" disabled={busy} aria-describedby={rowId} onClick={() => void decide('REJECT', proposal.outId, proposal.inId)}>{localize("振替ではない")}</button>
        </span>
      </li>
    })}</ul>}
    {result.ambiguousIds.length > 0 && <p className="transfer-pair-note">{result.ambiguousIds.length}{localize("件は同条件の相手が複数あるため候補にしていません。")}</p>}
    {decisions.length > 0 && <details className="transfer-pair-history"><summary>{localize("確定・却下の履歴")} ({decisions.length})</summary>
      <ul className="transfer-pair-list">{decisions.map((decision) => <li key={decision.pairKey}>
        <span className="transfer-pair-legs"><strong>{label(byId.get(decision.outTransactionId))}</strong> → <strong>{label(byId.get(decision.inTransactionId))}</strong></span>
        <span className="transfer-pair-meta">{decision.state === 'MERGED' ? localize("統合済み") : decision.state === 'LINKED' ? localize("確定済み") : localize("却下済み")}</span>
        <span className="transfer-pair-actions"><button type="button" className="secondary-btn" disabled={busy} onClick={() => void decide('CLEAR', decision.outTransactionId, decision.inTransactionId)}>{localize("元に戻す")}</button></span>
      </li>)}</ul></details>}
  </section>
}
