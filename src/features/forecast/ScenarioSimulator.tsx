import { useId, useMemo, useState } from 'react'
import { localize } from '../../i18n'
import type { ForecastMonthDto } from './forecastActionPlatform'
import { projectScenario } from './scenarioModel'

const yen = (value: number) => `${value < 0 ? '−' : ''}¥${Math.abs(value).toLocaleString('ja-JP')}`
const signedYen = (value: number) => `${value > 0 ? '+' : value < 0 ? '−' : ''}${yen(Math.abs(value))}`

/** Whole-yen text field value; an empty field means 0 and anything else invalid yields null. */
function parseYen(value: string): number | null {
  const trimmed = value.trim()
  if (trimmed === '') return 0
  return /^[+-]?\d{1,12}$/.test(trimmed) ? Number(trimmed) : null
}

export function ScenarioSimulator({ months }: { readonly months: readonly ForecastMonthDto[] }) {
  const id = useId()
  const [income, setIncome] = useState('')
  const [expense, setExpense] = useState('')
  const [oneTime, setOneTime] = useState('')
  const parsed = { monthlyIncomeDeltaJpy: parseYen(income), monthlyExpenseDeltaJpy: parseYen(expense), oneTimeOutflowJpy: parseYen(oneTime) }
  const invalid = Object.values(parsed).some((value) => value == null) || (parsed.oneTimeOutflowJpy ?? 0) < 0
  const result = useMemo(() => invalid || months.length === 0 ? null : projectScenario(months, {
    monthlyIncomeDeltaJpy: parsed.monthlyIncomeDeltaJpy!, monthlyExpenseDeltaJpy: parsed.monthlyExpenseDeltaJpy!, oneTimeOutflowJpy: parsed.oneTimeOutflowJpy!,
  }), [invalid, months, parsed.monthlyIncomeDeltaJpy, parsed.monthlyExpenseDeltaJpy, parsed.oneTimeOutflowJpy])

  return <section className="forecast-panel scenario-simulator" aria-labelledby={`${id}-title`}>
    <header><div><p>{localize("もしも試算")}</p><h2 id={`${id}-title`}>{localize("シナリオ試算")}</h2></div></header>
    <p className="scenario-note">{localize("試算は保存されず、台帳や予測の前提には反映されません。")}</p>
    <div className="scenario-fields">
      <label>{localize("毎月の収入の増減（円）")}<input inputMode="numeric" value={income} onChange={(event) => setIncome(event.target.value)} aria-invalid={parsed.monthlyIncomeDeltaJpy == null} /></label>
      <label>{localize("毎月の支出の増減（円）")}<input inputMode="numeric" value={expense} onChange={(event) => setExpense(event.target.value)} aria-invalid={parsed.monthlyExpenseDeltaJpy == null} /></label>
      <label>{localize("初月の一時的な支出（円）")}<input inputMode="numeric" value={oneTime} onChange={(event) => setOneTime(event.target.value)} aria-invalid={parsed.oneTimeOutflowJpy == null || (parsed.oneTimeOutflowJpy ?? 0) < 0} /></label>
    </div>
    {invalid && <p className="scenario-error" role="alert">{localize("整数の円を入力してください（一時的な支出は0以上）。")}</p>}
    {result && <>
      <table className="scenario-table">
        <thead><tr><th scope="col">{localize("月")}</th><th scope="col">{localize("月末現預金（現状）")}</th><th scope="col">{localize("月末現預金（試算）")}</th><th scope="col">{localize("差額")}</th></tr></thead>
        <tbody>{result.months.map((month) => <tr key={month.month}>
          <th scope="row">{month.month}</th><td>{yen(month.baselineClosingCashJpy)}</td>
          <td className={month.scenarioClosingCashJpy < 0 ? 'is-negative' : ''}>{yen(month.scenarioClosingCashJpy)}</td><td>{signedYen(month.deltaJpy)}</td>
        </tr>)}</tbody>
      </table>
      {result.firstNegativeMonth && <p className="scenario-warning" role="status">{localize("この条件では現預金がマイナスになる月があります。")} {result.firstNegativeMonth}</p>}
    </>}
  </section>
}
