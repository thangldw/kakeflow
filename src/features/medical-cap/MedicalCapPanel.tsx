import { useState } from 'react'
import { localize } from '../../i18n'
import { estimateMedicalCap, type IncomeBand } from './medicalCap'

const yen = (value: number) => `¥${value.toLocaleString('ja-JP')}`

/** A monthly estimate of the 高額療養費 cap and any amount that may come back. Nothing typed here is saved. */
export function MedicalCapPanel() {
  const [band, setBand] = useState<IncomeBand>('MIDDLE')
  const [paid, setPaid] = useState('')
  const [repeat, setRepeat] = useState(false)
  const paidValue = paid.trim() === '' ? null : Number(paid.replace(/[,，\s]/gu, ''))
  const estimate = paidValue === null ? null : estimateMedicalCap(band, paidValue, repeat)

  return <section className="panel medical-cap-panel" aria-label={localize("高額療養費の目安")}>
    <div className="panel-head"><div><h2>{localize("高額療養費の目安")}</h2>
      <p>{localize("1か月に病院や薬局で払った自己負担額から、高額療養費で戻る可能性がある額を概算します。70歳未満・3割負担を前提にした目安です。入力した内容は保存されません。")}</p></div></div>
    <label>{localize("所得区分")}<select value={band} onChange={(event) => setBand(event.target.value as IncomeBand)}>
      <option value="TOP">{localize("年収 約1,160万円以上")}</option>
      <option value="HIGH">{localize("年収 約770万〜1,160万円")}</option>
      <option value="MIDDLE">{localize("年収 約370万〜770万円")}</option>
      <option value="LOW">{localize("年収 約370万円以下")}</option>
      <option value="EXEMPT">{localize("住民税非課税")}</option>
    </select></label>
    <label>{localize("その月に払った自己負担額")}<input inputMode="numeric" value={paid} onChange={(event) => setPaid(event.target.value)} /></label>
    <label><input type="checkbox" checked={repeat} onChange={(event) => setRepeat(event.target.checked)} />{localize("過去12か月で3回以上、上限に達している")}</label>
    {estimate && <div role="status">
      <p>{localize("自己負担の上限の目安")}: <strong>{yen(estimate.capJpy)}</strong></p>
      <p>{localize("戻る可能性がある額の目安")}: <strong>{yen(estimate.refundJpy)}</strong></p>
      <small>{localize("食事代・差額ベッド代・保険外の費用は対象外です。目安であり、確定額ではありません。加入先の健康保険に必ず確認してください。")}</small>
    </div>}
  </section>
}
