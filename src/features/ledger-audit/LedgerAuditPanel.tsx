import { useState } from 'react'
import { localize } from '../../i18n'
import type { LedgerAuditFindingKindDto, LedgerAuditReportDto } from '../../platform/types'

export interface LedgerAuditPanelProps {
  readonly run: () => Promise<LedgerAuditReportDto>
  /** Opens the transactions page so a flagged entry can be reviewed. */
  readonly onOpenTransactions?: () => void
}

const yen = (value: number) => `¥${value.toLocaleString('ja-JP')}`

function kindLabel(kind: LedgerAuditFindingKindDto): string {
  switch (kind) {
    case 'UNBALANCED_JOURNAL': return localize("借方と貸方が一致しません")
    case 'TOO_FEW_ENTRIES': return localize("仕訳行が2行未満です")
    case 'CROSS_HOUSEHOLD_ACCOUNT': return localize("別の世帯の口座が使われています")
  }
}

/** Runs the read-only ledger audit and lists anything that breaks a double-entry rule. */
export function LedgerAuditPanel({ run, onOpenTransactions }: LedgerAuditPanelProps) {
  const [report, setReport] = useState<LedgerAuditReportDto | null>(null)
  const [busy, setBusy] = useState(false)
  const [failed, setFailed] = useState(false)

  const start = async () => {
    setBusy(true); setFailed(false)
    try { setReport(await run()) } catch { setReport(null); setFailed(true) } finally { setBusy(false) }
  }

  return <section className="panel ledger-audit-panel" aria-label={localize("帳簿の整合性チェック")}>
    <div className="panel-head"><div><h2>{localize("帳簿の整合性チェック")}</h2><p>{localize("確定済みの取引がすべて複式簿記のルールを満たしているか、読み取り専用で確認します。")}</p></div></div>
    <button type="button" className="secondary-btn" disabled={busy} onClick={() => void start()}>{busy ? localize("確認中…") : localize("チェックを実行")}</button>
    {failed && <p role="alert">{localize("チェックを実行できませんでした。")}</p>}
    {report && <div role="status">
      <p>{report.ok ? localize("問題は見つかりませんでした。") : localize("確認が必要な取引があります。")} <small>{report.postedTransactions} {localize("取引")} / {report.journalEntries} {localize("仕訳行")}</small></p>
      {report.truncated && <p>{localize("見つかった問題が多いため、一部のみ表示しています。")}</p>}
      {report.findings.length > 0 && <ul>
        {report.findings.map((finding) => <li key={`${finding.kind}-${finding.transactionId}`}>
          <span>{finding.occurredOn}</span><span>{kindLabel(finding.kind)}</span>
          {finding.kind === 'UNBALANCED_JOURNAL' && <small>{yen(finding.debitTotalJpy)} / {yen(finding.creditTotalJpy)}</small>}
        </li>)}
      </ul>}
      {!report.ok && onOpenTransactions && <button type="button" className="text-btn" onClick={onOpenTransactions}>{localize("取引を開く")}</button>}
    </div>}
  </section>
}
