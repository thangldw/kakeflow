import { useState } from 'react'
import type { ExtractedRegionDto } from '../../platform'
import type { DocumentEvidenceReadModel } from './documentEvidence'
import { EvidencePageOverlay } from './EvidencePageOverlay'
import type { EvidencePageImage } from './EvidencePageOverlay'
import './documentEvidenceViewer.css'

export interface DocumentEvidenceViewerProps {
  readonly evidence: DocumentEvidenceReadModel
  readonly filename?: string
  readonly pageImages?: Readonly<Record<number, EvidencePageImage>>
  readonly onSelectRegion?: (pageNumber: number, region: ExtractedRegionDto, regionIndex: number) => void
}

const yen = (value: number) => `¥${value.toLocaleString('ja-JP')}`
const confidence = (value: number) => `${(value / 100).toFixed(0)}%`
const methodLabels = { EMBEDDED_TEXT: '埋込テキスト', OCR: 'OCR', UNKNOWN: '不明' } as const

function RegionLocation({ region }: { readonly region: ExtractedRegionDto }) {
  if (!region.boundingBox || region.coordinateSpace === 'UNLOCATED') return <span>位置情報なし</span>
  const box = region.boundingBox
  return <span>{region.coordinateSpace === 'PIXELS' ? 'px' : 'pt'}: x {box.left}, y {box.top}, w {box.width}, h {box.height}</span>
}

export function DocumentEvidenceViewer({ evidence, filename, pageImages, onSelectRegion }: DocumentEvidenceViewerProps) {
  const receipt = evidence.receipt
  const [selected, setSelected] = useState<{ pageNumber: number; regionIndex: number } | null>(null)
  const selectRegion = (pageNumber: number, region: ExtractedRegionDto, regionIndex: number) => {
    setSelected({ pageNumber, regionIndex })
    onSelectRegion?.(pageNumber, region, regionIndex)
  }
  return <article className="evidence-viewer" aria-labelledby="evidence-title">
    <header className="evidence-header"><div><p>Source Evidence · v{evidence.evidenceVersion}</p><h2 id="evidence-title">{filename ?? `ソースレコード ${evidence.sourceRecordId}`}</h2></div><div className="evidence-confidence"><span>{methodLabels[evidence.method]}</span><strong>{confidence(evidence.confidenceBps)}</strong></div></header>
    {evidence.issues.length > 0 && <aside className="evidence-issues" role="status"><strong>抽出時の注意</strong><ul>{evidence.issues.map((issue) => <li key={issue}>{issue}</li>)}</ul></aside>}

    {receipt && <section className="receipt-evidence" aria-labelledby="receipt-evidence-title">
      <header><div><p>Receipt</p><h3 id="receipt-evidence-title">{receipt.merchant ?? '店舗名未確認'}</h3></div><div><span>{receipt.occurredOn ?? '日付未確認'}</span><strong>{receipt.totalAmountJpy == null ? '金額未確認' : yen(receipt.totalAmountJpy)}</strong></div></header>
      <div className="receipt-adjustments" aria-label="税・値引・ポイント">
        {receipt.subtotalJpy != null && <span><b>小計</b>{yen(receipt.subtotalJpy)}</span>}
        {receipt.taxes.map((tax, index) => <span key={`${tax.ratePercent}-${index}`}><b>消費税 {tax.ratePercent}%</b>{tax.taxAmountJpy != null ? yen(tax.taxAmountJpy) : '税額不明'}<small>line {tax.provenance.lineNumber} · {confidence(tax.confidenceBps)}</small></span>)}
        {receipt.couponAmountJpy != null && <span><b>クーポン・値引</b>−{yen(receipt.couponAmountJpy)}</span>}
        {receipt.pointsUsedJpy != null && <span><b>ポイント利用</b>−{yen(receipt.pointsUsedJpy)}</span>}
        {receipt.changeJpy != null && <span><b>お釣り</b>{yen(receipt.changeJpy)}</span>}
        {receipt.paymentMethod && <span><b>支払方法</b>{receipt.paymentMethod}</span>}
        {receipt.taxMode && <span><b>税方式</b>{receipt.taxMode === 'INCLUDED' ? '内税' : receipt.taxMode === 'EXCLUDED' ? '外税' : '内税・外税混在'}</span>}
      </div>
      {receipt.items.length > 0 && <div className="receipt-items-wrap"><table className="receipt-items"><caption>レシート明細と抽出元</caption><thead><tr><th scope="col">品目</th><th scope="col">数量</th><th scope="col">金額</th><th scope="col">根拠</th></tr></thead><tbody>{receipt.items.map((item, index) => <tr key={`${item.description}-${index}`}><th scope="row">{item.description}</th><td>{item.quantity ?? '—'}</td><td>{yen(item.amountJpy)}</td><td>line {item.provenance.lineNumber} · region {item.provenance.regionIndexes.length ? item.provenance.regionIndexes.join(', ') : '—'} · {confidence(item.confidenceBps)}</td></tr>)}</tbody></table></div>}
    </section>}

    <section className="evidence-pages" aria-labelledby="evidence-pages-title"><header><div><p>Located evidence</p><h3 id="evidence-pages-title">ページ・領域</h3></div><span>{evidence.pages.length}ページ</span></header>
      {evidence.pages.length === 0 ? <p className="evidence-empty">この抽出結果には座標情報がありません。</p> : evidence.pages.map((page) => <section className="evidence-page" key={page.pageNumber} aria-labelledby={`evidence-page-${page.pageNumber}`}><header><h4 id={`evidence-page-${page.pageNumber}`}>Page {page.pageNumber}</h4><span>{page.regions.length} regions</span></header><EvidencePageOverlay pageNumber={page.pageNumber} regions={page.regions} image={pageImages?.[page.pageNumber]} selectedRegionIndexes={selected?.pageNumber === page.pageNumber ? [selected.regionIndex] : []} onSelectRegion={(region, index) => selectRegion(page.pageNumber, region, index)} /><ol>{page.regions.map((region, index) => {
          const content = <><div className="region-copy"><q>{region.text || '（空の領域）'}</q><span>{region.provenance}</span></div><div className="region-meta"><RegionLocation region={region} /><strong>{confidence(region.confidenceBps)}</strong></div></>
          return <li key={`${region.provenance}-${index}`} className={selected?.pageNumber === page.pageNumber && selected.regionIndex === index ? 'selected' : ''}><button type="button" onClick={() => selectRegion(page.pageNumber, region, index)} aria-label={`Page ${page.pageNumber} region ${index + 1}を表示`}>{content}</button></li>
        })}</ol></section>)}
    </section>

    <details className="evidence-raw"><summary>抽出テキスト全文</summary><pre>{evidence.text || '抽出テキストなし'}</pre></details>
  </article>
}
