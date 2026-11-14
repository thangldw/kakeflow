import { useId, useState, type FormEvent } from 'react'
import { localize, useI18n } from '../../i18n'
import { formatMonthLabel } from '../../monthLabel'
import { YenInput } from '../../ui/YenInput'

interface BudgetEditorProps {
  /** Calendar month `YYYY-MM` the budgets belong to. */
  readonly month: string
  readonly categories: readonly { readonly id: string; readonly name: string }[]
  readonly budgets: readonly { readonly categoryAccountId: string; readonly budgetJpy: number }[]
  readonly onSave: (categoryAccountId: string, budgetJpy: number) => Promise<void>
  /** When given, a form to add a spending category is shown. */
  readonly onAddCategory?: (name: string) => Promise<void>
}

/** Long enough for any real category name, and far inside the vault's 512-unit name limit. */
const NAME_MAX_LENGTH = 120

/** Simple-mode budget editor: one yen field per spending category for one month. Props only. */
export function BudgetEditor({ month, categories, budgets, onSave, onAddCategory }: BudgetEditorProps) {
  const id = useId()
  const { localeCode } = useI18n()
  const budgetOf = (categoryId: string) => budgets.find((budget) => budget.categoryAccountId === categoryId)?.budgetJpy ?? 0

  return <section className="simple-card simple-budget-editor" aria-labelledby={`${id}-title`}>
    <h2 id={`${id}-title`} className="simple-panel-title">{localize("カテゴリーごとの月予算")}</h2>
    <p className="simple-hero-month">{formatMonthLabel(month, localeCode)}</p>
    {categories.length === 0
      ? <p className="simple-note">{localize("支出カテゴリーがまだありません")}</p>
      : <ul className="simple-budget-rows">
        {categories.map((category) => {
          const budgetJpy = budgetOf(category.id)
          // A new budget from the parent remounts the row so its field and baseline follow it.
          return <li key={`${category.id}:${budgetJpy}`}>
            <BudgetRow category={category} budgetJpy={budgetJpy} onSave={onSave} />
          </li>
        })}
      </ul>}
    {onAddCategory && <AddCategoryForm onAddCategory={onAddCategory} />}
  </section>
}

function BudgetRow({ category, budgetJpy, onSave }: { readonly category: { readonly id: string; readonly name: string }; readonly budgetJpy: number; readonly onSave: BudgetEditorProps['onSave'] }) {
  const nameId = useId()
  const [saved, setSaved] = useState(budgetJpy)
  const [draft, setDraft] = useState(budgetJpy)
  // YenInput keeps invalid text to itself, so the last valid draft must not be saved while the field is flagged.
  const [draftValid, setDraftValid] = useState(true)
  const [busy, setBusy] = useState(false)
  const [status, setStatus] = useState<'idle' | 'saved' | 'failed'>('idle')

  const save = async (event: FormEvent) => {
    event.preventDefault()
    if (busy || !draftValid || draft === saved) return
    const value = draft
    setBusy(true); setStatus('idle')
    try {
      await onSave(category.id, value)
      setSaved(value)
      setStatus('saved')
    } catch { setStatus('failed') } finally { setBusy(false) }
  }

  return <form className="simple-budget-row" aria-labelledby={nameId} onSubmit={(event) => { void save(event) }}>
    <label className="simple-field">
      <span id={nameId} className="simple-budget-name">{category.name}</span>
      <YenInput value={draft} onChange={(value) => { setDraft(value); setStatus('idle') }} onValidityChange={(valid) => { setDraftValid(valid); setStatus('idle') }} />
    </label>
    <button type="submit" className="secondary-btn" aria-describedby={nameId} disabled={busy || !draftValid || draft === saved}>{localize("予算を保存する")}</button>
    {status === 'saved' && <p className="simple-note simple-budget-status" role="status">{localize("予算を保存しました")}</p>}
    {status === 'failed' && <p className="simple-error-text" role="alert">{localize("予算を保存できませんでした")}</p>}
  </form>
}

function AddCategoryForm({ onAddCategory }: { readonly onAddCategory: (name: string) => Promise<void> }) {
  const id = useId()
  const [name, setName] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<'empty' | 'failed' | null>(null)

  const add = async (event: FormEvent) => {
    event.preventDefault()
    if (busy) return
    const trimmed = name.trim()
    if (!trimmed) { setError('empty'); return }
    setBusy(true); setError(null)
    try {
      await onAddCategory(trimmed)
      setName('')
    } catch { setError('failed') } finally { setBusy(false) }
  }

  return <form className="simple-add-form" aria-labelledby={`${id}-title`} noValidate onSubmit={(event) => { void add(event) }}>
    <h3 id={`${id}-title`} className="simple-card-label">{localize("カテゴリーの追加")}</h3>
    <label className="simple-field">
      <span>{localize("新しいカテゴリーの名前")}</span>
      <input type="text" autoComplete="off" maxLength={NAME_MAX_LENGTH} value={name} aria-invalid={error === 'empty'} onChange={(event) => { setName(event.target.value); setError(null) }} />
    </label>
    <button type="submit" className="secondary-btn" disabled={busy}>{localize("このカテゴリーを追加")}</button>
    {error && <p className="simple-error-text" role="alert">{error === 'empty' ? localize("カテゴリー名を入力してください") : localize("カテゴリーを追加できませんでした")}</p>}
  </form>
}
