import { useId, useState, type FormEvent } from 'react'
import { goalPace } from '../../domain/goalPace'
import { localize } from '../../i18n'
import type { SavingsGoalDto } from '../../platform/types'
import { YenInput } from '../../ui/YenInput'
import { isCalendarDate } from './quickAdd'

const yen = (value: number) => `¥${value.toLocaleString('ja-JP')}`
const percent = (ratio: number) => `${Math.round(Math.min(1, Math.max(0, ratio)) * 100)}%`

export interface NewGoalInput {
  readonly name: string
  readonly targetJpy: number
  /** Calendar date `YYYY-MM-DD`. */
  readonly targetDate: string
}

interface GoalsPanelProps {
  readonly goals: readonly SavingsGoalDto[]
  readonly onCreate: (input: NewGoalInput) => Promise<void>
  readonly onUpdateSaved: (goalId: string, savedJpy: number) => Promise<void>
}

/** Simple-mode savings goals: every goal with its pace and saved amount, and a form for a new goal. Props only. */
export function GoalsPanel({ goals, onCreate, onUpdateSaved }: GoalsPanelProps) {
  const id = useId()
  return <div className="simple-goals-panel">
    <section className="simple-goals-list" aria-labelledby={`${id}-title`}>
      <h2 id={`${id}-title`} className="simple-panel-title">{localize("貯蓄の目標の一覧")}</h2>
      {goals.length === 0
        ? <p className="simple-note">{localize("まだ目標がありません")}</p>
        : goals.map((goal) => <GoalItem key={`${goal.id}:${goal.savedJpy}`} goal={goal} onUpdateSaved={onUpdateSaved} />)}
    </section>
    <NewGoalForm onCreate={onCreate} />
  </div>
}

function GoalPaceLine({ goal }: { readonly goal: SavingsGoalDto }) {
  if (goal.status === 'CANCELLED') return <p className="simple-goal-pace"><span>{localize("この目標は取りやめました")}</span></p>
  const pace = goalPace(goal)
  // Each figure is a label and a value, so no translated word is glued to a number.
  return <p className="simple-goal-pace">{pace.remaining === 0
    ? <b>{localize("目標を達成しました")}</b>
    : pace.overdue
      ? <><span>{localize("目標日を過ぎています")}</span><span>{localize("あと必要な金額")} <b>{yen(pace.remaining)}</b></span></>
      : <><span>{localize("必要な月額")} <b>{yen(pace.monthly)}</b></span><span>{localize("残りの月数")} <b>{pace.months}</b></span></>}</p>
}

function GoalItem({ goal, onUpdateSaved }: { readonly goal: SavingsGoalDto; readonly onUpdateSaved: GoalsPanelProps['onUpdateSaved'] }) {
  const id = useId()
  const [draft, setDraft] = useState(goal.savedJpy)
  // YenInput keeps invalid text to itself, so the last valid draft must not be saved while the field is flagged.
  const [draftValid, setDraftValid] = useState(true)
  const [busy, setBusy] = useState(false)
  const [failed, setFailed] = useState(false)
  const ratio = goal.targetJpy > 0 ? goal.savedJpy / goal.targetJpy : 1
  const amounts = `${yen(goal.savedJpy)} / ${yen(goal.targetJpy)}`

  const save = async (event: FormEvent) => {
    event.preventDefault()
    if (busy || !draftValid) return
    setBusy(true); setFailed(false)
    try { await onUpdateSaved(goal.id, draft) } catch { setFailed(true) } finally { setBusy(false) }
  }

  return <section className="simple-card simple-goal" aria-labelledby={`${id}-title`}>
    <h3 id={`${id}-title`} className="simple-goal-name">{goal.name}</h3>
    <p className="simple-goal-amounts">{amounts}</p>
    <div className="simple-bar simple-bar-goal" role="img" aria-label={`${localize("貯蓄の目標")} ${goal.name} ${amounts}`}>
      <span style={{ width: percent(ratio) }} />
    </div>
    <p className="simple-note"><span>{localize("目標の日付")}</span> <strong>{goal.targetDate}</strong></p>
    <GoalPaceLine goal={goal} />
    <form className="simple-goal-update" onSubmit={(event) => { void save(event) }}>
      <label>{localize("貯蓄済みの金額")}<YenInput value={draft} onChange={(value) => { setDraft(value); setFailed(false) }} onValidityChange={setDraftValid} /></label>
      <button type="submit" className="secondary-btn" disabled={busy || !draftValid}>{localize("貯蓄済みを更新")}</button>
    </form>
    {failed && <p className="simple-error-text" role="alert">{localize("更新できませんでした")}</p>}
  </section>
}

type NewGoalError = 'name' | 'target' | 'date' | 'failed'

function NewGoalForm({ onCreate }: { readonly onCreate: GoalsPanelProps['onCreate'] }) {
  const id = useId()
  const [name, setName] = useState('')
  const [targetJpy, setTargetJpy] = useState(0)
  const [targetValid, setTargetValid] = useState(true)
  const [targetDate, setTargetDate] = useState('')
  // Bumped after a successful create so the yen field starts empty again.
  const [formKey, setFormKey] = useState(0)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<NewGoalError | null>(null)

  const create = async (event: FormEvent) => {
    event.preventDefault()
    if (busy || !targetValid) return
    const trimmed = name.trim()
    if (!trimmed) { setError('name'); return }
    if (targetJpy <= 0) { setError('target'); return }
    if (!isCalendarDate(targetDate)) { setError('date'); return }
    setBusy(true); setError(null)
    try {
      await onCreate({ name: trimmed, targetJpy, targetDate })
      setName(''); setTargetJpy(0); setTargetDate(''); setFormKey((value) => value + 1)
    } catch { setError('failed') } finally { setBusy(false) }
  }

  const message = error === 'name' ? localize("目標の名前を入力してください")
    : error === 'target' ? localize("目標金額を1円以上にしてください")
      : error === 'date' ? localize("目標の日付を正しく入力してください")
        : error === 'failed' ? localize("目標を作れませんでした")
          : null

  return <form className="simple-card simple-add-form" aria-labelledby={`${id}-title`} noValidate onSubmit={(event) => { void create(event) }}>
    <h2 id={`${id}-title`} className="simple-panel-title">{localize("新しい目標を作る")}</h2>
    <label className="simple-field">
      <span>{localize("目標の名前")}</span>
      <input type="text" autoComplete="off" value={name} aria-invalid={error === 'name'} onChange={(event) => { setName(event.target.value); setError(null) }} />
    </label>
    <label className="simple-field">
      <span>{localize("目標金額")}</span>
      <YenInput key={formKey} value={targetJpy} onChange={(value) => { setTargetJpy(value); setError(null) }} onValidityChange={setTargetValid} />
    </label>
    <label className="simple-field">
      <span>{localize("目標の日付")}</span>
      <input type="date" value={targetDate} aria-invalid={error === 'date'} onChange={(event) => { setTargetDate(event.target.value); setError(null) }} />
    </label>
    <button type="submit" className="primary-btn" disabled={busy || !targetValid}>{localize("目標を追加する")}</button>
    {message && <p className="simple-error-text" role="alert">{message}</p>}
  </form>
}
