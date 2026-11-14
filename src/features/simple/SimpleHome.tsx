import { useEffect, useId, useState } from 'react'
import { goalPace } from '../../domain/goalPace'
import { localize, useI18n } from '../../i18n'
import { formatMonthLabel } from '../../monthLabel'
import type { SavingsGoalDto } from '../../platform/types'
import { YenInput } from '../../ui/YenInput'
import { loadSimpleHome, type HomeClient, type SimpleHomeData } from './homeLoader'
import { daysLeftInMonth, tokyoDate, type RemainingToSpend } from './homeMath'

const yen = (value: number) => `¥${value.toLocaleString('ja-JP')}`
// A signed amount without a hyphen glued to the yen mark.
const signedYen = (value: number) => value < 0 ? `− ${yen(-value)}` : yen(value)
const percent = (ratio: number) => `${Math.round(Math.min(1, Math.max(0, ratio)) * 100)}%`

interface SimpleHomeProps {
  readonly householdId: string | null
  readonly householdName: string
  readonly month: string
  readonly revision: number
  readonly onSetLimit: () => void
  readonly onOpenBudgets: () => void
  readonly onOpenSavings: () => void
  /** Switches the shown month back to the current Tokyo month; offered when another month is shown. */
  readonly onGoToCurrentMonth?: () => void
  /** The ledger client: the desktop app passes its platform client, the PWA its own adapter. */
  readonly client: HomeClient
}

type LoadState =
  | { readonly kind: 'loading' }
  | { readonly kind: 'error' }
  | { readonly kind: 'ready'; readonly key: string; readonly data: SimpleHomeData }

/**
 * Simple-mode Home: how much is left to spend this month, the nearest savings
 * goal and at most one category that needs attention. Always reads the whole
 * household on the accrual basis.
 */
export function SimpleHome({ householdId, householdName, month, revision, onSetLimit, onOpenBudgets, onOpenSavings, onGoToCurrentMonth, client }: SimpleHomeProps) {
  const [state, setState] = useState<LoadState>({ kind: 'loading' })
  const [reloadKey, setReloadKey] = useState(0)
  const key = `${householdId ?? ''}|${month}`

  useEffect(() => {
    if (!householdId) return
    let active = true
    // Keep figures of the same household and month on screen while refreshing; anything else shows the skeleton.
    setState((current) => current.kind === 'ready' && current.key === key ? current : { kind: 'loading' })
    Promise.resolve()
      .then(() => loadSimpleHome(client, householdId, month))
      .then((data) => { if (active) setState({ kind: 'ready', key, data }) })
      .catch(() => { if (active) setState({ kind: 'error' }) })
    return () => { active = false }
  }, [client, householdId, month, key, revision, reloadKey])

  if (!householdId) return null
  const reload = () => setReloadKey((value) => value + 1)

  if (state.kind === 'error') {
    return <div className="simple-home">
      <p className="simple-home-household">{householdName}</p>
      <div className="simple-card simple-home-error" role="alert">
        <p>{localize("読み込めませんでした")}</p>
        <button type="button" className="secondary-btn" onClick={reload}>{localize("再読み込み")}</button>
      </div>
    </div>
  }

  if (state.kind === 'loading' || state.key !== key) {
    return <div className="simple-home" role="status" aria-busy="true" aria-label={localize("ホームを準備中")}>
      <p className="simple-home-household">{householdName}</p>
      <div className="skeleton simple-skeleton-hero" />
      <div className="skeleton simple-skeleton-card" />
    </div>
  }

  const { remaining, goal } = state.data
  return <div className="simple-home">
    <p className="simple-home-household">{householdName}</p>
    <RemainingCard remaining={remaining} month={month} onSetLimit={onSetLimit} onGoToCurrentMonth={onGoToCurrentMonth} />
    {remaining.mostOver && <NeedsAttention name={remaining.mostOver.name} overJpy={remaining.mostOver.overJpy} onOpenBudgets={onOpenBudgets} />}
    {goal
      ? <GoalCard key={`${goal.id}:${goal.savedJpy}`} goal={goal} client={client} onSaved={reload} />
      : <NoGoalCard onOpenSavings={onOpenSavings} />}
  </div>
}

function RemainingCard({ remaining, month, onSetLimit, onGoToCurrentMonth }: { readonly remaining: RemainingToSpend; readonly month: string; readonly onSetLimit: () => void; readonly onGoToCurrentMonth?: () => void }) {
  const id = useId()
  const { localeCode } = useI18n()
  // The month comes from the saved month selection, so it can be an earlier (or later) month than today's.
  // It is written the way the top bar writes it ("September 2026"), never as the raw "2026-09".
  const otherMonth = month !== tokyoDate().slice(0, 7)
  const monthLine = otherMonth && <p className="simple-hero-month">{formatMonthLabel(month, localeCode)}</p>
  const backToThisMonth = otherMonth && onGoToCurrentMonth
    && <button type="button" className="secondary-btn simple-hero-action" onClick={onGoToCurrentMonth}>{localize("今月に戻る")}</button>

  if (remaining.basis === 'INCOME_MINUS_EXPENSE') {
    return <section className="simple-card simple-hero" aria-labelledby={`${id}-title`}>
      <h2 id={`${id}-title`} className="simple-hero-label">{localize("収入 − 支出（予算は未設定）")}</h2>
      {monthLine}
      <p className="simple-hero-value">{signedYen(remaining.remainingJpy)}</p>
      <button type="button" className="primary-btn simple-hero-action" onClick={onSetLimit}>{localize("月の上限を決める")}</button>
      {backToThisMonth}
    </section>
  }

  // Exactly zero left is not over budget (ruling R8).
  const over = remaining.remainingJpy < 0
  const showPerDay = remaining.remainingJpy > 0 && remaining.perDayJpy !== null
  const barLabel = `${localize("使った金額")} ${yen(remaining.spentJpy)} / ${localize("予算の合計")} ${yen(remaining.totalBudgetJpy)}`
  return <section className={`simple-card simple-hero${over ? ' simple-hero-over' : ''}`} aria-labelledby={`${id}-title`}>
    <h2 id={`${id}-title`} className="simple-hero-label">{over ? localize("予算を超えています") : otherMonth ? localize("残り金額") : localize("今月あと使える金額")}</h2>
    {monthLine}
    <p className="simple-hero-value">{over ? yen(remaining.overByJpy) : yen(remaining.remainingJpy)}</p>
    <div className="simple-bar" role="img" aria-label={barLabel}>
      <span style={{ width: percent(remaining.usedRatio) }} />
    </div>
    <dl className="simple-figures">
      <div><dt>{localize("使った金額")}</dt><dd>{yen(remaining.spentJpy)}</dd></div>
      <div><dt>{localize("予算の合計")}</dt><dd>{yen(remaining.totalBudgetJpy)}</dd></div>
      {showPerDay && <>
        <div><dt>{localize("1日あたりの目安")}</dt><dd>{yen(remaining.perDayJpy ?? 0)}</dd></div>
        <div><dt>{localize("残り日数")}</dt><dd>{daysLeftInMonth(tokyoDate())}</dd></div>
      </>}
    </dl>
    {remaining.unbudgetedSpentJpy > 0 && <p className="simple-note"><span>{localize("予算のないカテゴリーの支出")}</span> <strong>{yen(remaining.unbudgetedSpentJpy)}</strong></p>}
    {remaining.budgetMonth !== null && remaining.budgetMonth !== month && <p className="simple-note"><span>{localize("以前の月の予算を使っています")}</span> <strong>{formatMonthLabel(remaining.budgetMonth, localeCode)}</strong></p>}
    {backToThisMonth}
  </section>
}

function NeedsAttention({ name, overJpy, onOpenBudgets }: { readonly name: string; readonly overJpy: number; readonly onOpenBudgets: () => void }) {
  const id = useId()
  return <section className="simple-card simple-attention" aria-labelledby={`${id}-title`}>
    <div>
      <h2 id={`${id}-title`} className="simple-card-label">{localize("予算を超えたカテゴリー")}</h2>
      <p className="simple-attention-detail"><strong>{name}</strong> <span className="simple-over-amount">+{yen(overJpy)}</span></p>
    </div>
    <button type="button" className="secondary-btn" onClick={onOpenBudgets}>{localize("見る")}</button>
  </section>
}

function GoalCard({ goal, client, onSaved }: { readonly goal: SavingsGoalDto; readonly client: HomeClient; readonly onSaved: () => void }) {
  const id = useId()
  const [draft, setDraft] = useState(goal.savedJpy)
  // YenInput keeps invalid text to itself, so the last valid draft must not be saved while the field is flagged.
  const [draftValid, setDraftValid] = useState(true)
  const [busy, setBusy] = useState(false)
  const [failed, setFailed] = useState(false)
  const pace = goalPace(goal)
  const ratio = goal.targetJpy > 0 ? goal.savedJpy / goal.targetJpy : 1
  const amounts = `${yen(goal.savedJpy)} / ${yen(goal.targetJpy)}`

  const save = async () => {
    if (!draftValid) return
    setBusy(true); setFailed(false)
    try {
      await client.updateSavingsGoal({
        id: goal.id, householdId: goal.householdId, name: goal.name, targetJpy: goal.targetJpy,
        savedJpy: draft, targetDate: goal.targetDate, status: goal.status,
      })
      onSaved()
    } catch { setFailed(true) } finally { setBusy(false) }
  }

  return <section className="simple-card simple-goal" aria-labelledby={`${id}-title`}>
    <p className="simple-card-label">{localize("貯蓄の目標")}</p>
    <h2 id={`${id}-title`} className="simple-goal-name">{goal.name}</h2>
    <p className="simple-goal-amounts">{amounts}</p>
    <div className="simple-bar simple-bar-goal" role="img" aria-label={`${localize("貯蓄の目標")} ${goal.name} ${amounts}`}>
      <span style={{ width: percent(ratio) }} />
    </div>
    {/* Each figure is a label and a value, so no translated word is glued to a number. */}
    <p className="simple-goal-pace">{pace.remaining === 0
      ? <b>{localize("目標を達成しました")}</b>
      : pace.overdue
        ? <><span>{localize("目標日を過ぎています")}</span><span>{localize("あと必要な金額")} <b>{yen(pace.remaining)}</b></span></>
        : <><span>{localize("必要な月額")} <b>{yen(pace.monthly)}</b></span><span>{localize("残りの月数")} <b>{pace.months}</b></span></>}</p>
    <form className="simple-goal-update" onSubmit={(event) => { event.preventDefault(); void save() }}>
      <label>{localize("貯蓄済みの金額")}<YenInput value={draft} onChange={setDraft} onValidityChange={setDraftValid} /></label>
      <button type="submit" className="secondary-btn" disabled={busy || !draftValid}>{localize("貯蓄済みを更新")}</button>
    </form>
    {failed && <p className="simple-error-text" role="alert">{localize("更新できませんでした")}</p>}
  </section>
}

function NoGoalCard({ onOpenSavings }: { readonly onOpenSavings: () => void }) {
  const id = useId()
  return <section className="simple-card simple-goal" aria-labelledby={`${id}-title`}>
    <h2 id={`${id}-title`} className="simple-card-label">{localize("貯蓄の目標")}</h2>
    <button type="button" className="primary-btn" onClick={onOpenSavings}>{localize("目標を作る")}</button>
  </section>
}
