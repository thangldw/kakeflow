import { localize, useI18n } from '../../i18n'
import { upcomingMilestones } from './annualMilestones'

/** The next few yearly deadlines (確定申告, 予定納税, ふるさと納税 ...) with days remaining. */
export function AnnualMilestonesPanel({ today, limit = 4 }: { readonly today: string; readonly limit?: number }) {
  const { locale } = useI18n()
  const items = upcomingMilestones(today, limit)
  const daysLeft = (days: number) => locale === 'vi' ? `Còn ${days} ngày` : locale === 'en' ? `In ${days} days` : `あと${days}日`
  return <section className="panel annual-milestones" aria-label={localize("今後の税金・申告の節目")}>
    <div className="panel-head"><div><h2>{localize("今後の税金・申告の節目")}</h2><p>{localize("国の定めのない日付は目安です。自治体・勤務先でご確認ください。")}</p></div></div>
    <ul>
      {items.map((item) => <li key={`${item.id}-${item.date}`}>
        <span>{item.date}</span>
        <span>{localize(item.label)}{item.approximate && <small> {localize("（目安）")}</small>}</span>
        <strong>{item.daysUntil === 0 ? localize("今日") : daysLeft(item.daysUntil)}</strong>
      </li>)}
    </ul>
  </section>
}
