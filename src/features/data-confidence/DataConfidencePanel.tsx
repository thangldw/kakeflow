import { useEffect, useState } from 'react'
import { localize } from '../../i18n'
import type { DataConfidenceDto, EvidenceLevelDto, MissingReceiptDto } from '../../platform/types'

export interface DataConfidencePanelProps {
  readonly month: string
  readonly load: () => Promise<DataConfidenceDto>
  /** Large spending with no receipt or scan linked; when given, the panel lists it under the summary. */
  readonly loadMissing?: () => Promise<readonly MissingReceiptDto[]>
  readonly onOpenTransactions?: () => void
}

const yen = (value: number) => `¥${value.toLocaleString('ja-JP')}`

function levelLabel(level: EvidenceLevelDto): string {
  switch (level) {
    case 'DOCUMENT_AND_IMPORT': return localize("原本と取り込みの両方あり")
    case 'DOCUMENT': return localize("原本（レシート・スキャン）あり")
    case 'IMPORT': return localize("取り込み明細あり")
    case 'MANUAL': return localize("手入力のみ")
  }
}

/** How much of the month's spending has a receipt or an imported statement row behind it. Provenance, not proof. */
export function DataConfidencePanel({ month, load, loadMissing, onOpenTransactions }: DataConfidencePanelProps) {
  const [data, setData] = useState<DataConfidenceDto | null>(null)
  const [missing, setMissing] = useState<readonly MissingReceiptDto[]>([])
  const [failed, setFailed] = useState(false)

  useEffect(() => {
    let active = true
    setData(null); setFailed(false); setMissing([])
    // The list is a convenience: if it cannot load, the summary still shows.
    if (loadMissing) Promise.resolve().then(loadMissing).then((items) => { if (active && items) setMissing(items) }).catch(() => undefined)
    // Started inside a promise so a synchronous failure of `load` is handled like a rejected one.
    Promise.resolve().then(load).then((result) => { if (active && result) setData(result) }).catch(() => { if (active) setFailed(true) })
    return () => { active = false }
    // `load` is rebuilt on every render of the parent; the month is what identifies the request.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [month])

  return <section className="panel data-confidence-panel" aria-label={localize("支出の根拠")}>
    <div className="panel-head"><div><h2>{localize("支出の根拠")}</h2><p>{localize("今月の支出に、原本や取り込み明細がどれだけ紐づいているかを示します。金額が正しいことの証明ではありません。")}</p></div></div>
    {failed && <p role="alert">{localize("読み込めませんでした。")}</p>}
    {data && (data.totalTransactions === 0
      ? <p className="empty-state">{localize("この月の支出はまだありません。")}</p>
      : <>
        <p role="status"><strong>{(data.evidencedShareBps / 100).toFixed(0)}%</strong> {localize("の支出に根拠があります")} <small>{data.totalTransactions} {localize("取引")} / {yen(data.totalAmountJpy)}</small></p>
        <ul className="data-confidence-list">
          {data.buckets.map((bucket) => <li key={bucket.level} className={`data-confidence-${bucket.level.toLowerCase().replaceAll('_', '-')}`}>
            <span>{levelLabel(bucket.level)}</span><span>{bucket.transactions} {localize("取引")}</span><strong>{yen(bucket.amountJpy)}</strong>
          </li>)}
        </ul>
        {missing.length > 0 && <div className="data-confidence-missing">
          <h3>{localize("レシートを添付したい支出")}</h3>
          <ul>
            {missing.map((item) => <li key={item.transactionId}>
              <span>{item.occurredOn}</span><span>{item.payee ?? '—'}</span><strong>{yen(item.amountJpy)}</strong>
              <small>{item.hasImport ? localize("取り込み明細のみ") : localize("手入力のみ")}</small>
            </li>)}
          </ul>
          {onOpenTransactions && <button type="button" className="text-btn" onClick={onOpenTransactions}>{localize("取引を開く")}</button>}
        </div>}
      </>)}
  </section>
}
