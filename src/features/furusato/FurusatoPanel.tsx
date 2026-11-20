import { useState } from 'react'
import { localize } from '../../i18n'
import { estimateFurusatoLimit } from './furusatoLimit'

const toNumber = (text: string): number | null => (text.trim() === '' ? null : Number(text.replace(/[,，\s]/gu, '')))
const yen = (value: number) => `¥${value.toLocaleString('ja-JP')}`

/** An estimate of the yearly furusato nozei limit from two figures on the salary slip and resident-tax notice. */
export function FurusatoPanel() {
  const [taxable, setTaxable] = useState('')
  const [portion, setPortion] = useState('')
  const [donated, setDonated] = useState('')
  const taxableValue = toNumber(taxable)
  const portionValue = toNumber(portion)
  const donatedValue = toNumber(donated)
  const estimate = taxableValue !== null && portionValue !== null
    ? estimateFurusatoLimit(taxableValue, portionValue, donated.trim() === '' ? null : donatedValue)
    : null

  return <section className="panel furusato-panel" aria-label={localize("ふるさと納税の上限額（目安）")}>
    <div className="panel-head"><div><h2>{localize("ふるさと納税の上限額（目安）")}</h2>
      <p>{localize("源泉徴収票の課税所得と、住民税決定通知書の所得割額から概算します。あくまで目安です。寄附する前に、自治体や各サイトのシミュレーターで必ず確認してください。")}</p></div></div>
    <label>{localize("課税所得（所得税）")}<input inputMode="numeric" value={taxable} onChange={(event) => setTaxable(event.target.value)} /></label>
    <label>{localize("住民税の所得割額")}<input inputMode="numeric" value={portion} onChange={(event) => setPortion(event.target.value)} /></label>
    <label>{localize("今年すでに寄附した額（任意）")}<input inputMode="numeric" value={donated} onChange={(event) => setDonated(event.target.value)} /></label>
    {estimate && <div role="status">
      <p>{localize("上限額の目安")}: <strong>{yen(estimate.limitJpy)}</strong></p>
      {estimate.remainingJpy !== null && <p>{localize("あと寄附できる目安")}: <strong>{yen(estimate.remainingJpy)}</strong></p>}
      <small>{localize("目安であり、確定額ではありません。")}</small>
    </div>}
  </section>
}
