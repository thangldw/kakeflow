import { useEffect, useId, useMemo, useRef, useState, type KeyboardEvent as ReactKeyboardEvent } from 'react'
import { X } from 'lucide-react'
import { localize } from '../../i18n'
import type { AccountDto, PlatformClient } from '../../platform/types'
import { parseYenText } from '../../ui/yen'
import { tokyoDate } from './homeMath'
import { buildQuickAddInput, isCalendarDate, quickAddChoices, type QuickAddKind } from './quickAdd'
import { readQuickAddUsage, recordQuickAddUse } from './uiMode'

type QuickAddClient = Pick<PlatformClient, 'createManualTransaction'>

interface QuickAddSheetProps {
  readonly open: boolean
  readonly householdId: string | null
  readonly accounts: readonly AccountDto[]
  readonly onClose: () => void
  readonly onSaved: (result: { transactionId: string; amountJpy: number; categoryName: string }) => void
  /** Opens account settings from the empty state. */
  readonly onSetupAccounts?: () => void
  /** The ledger client: the desktop app passes its platform client, the PWA its own adapter. */
  readonly client: QuickAddClient
  readonly now?: () => Date
}

const KEYPAD_DIGITS = ['1', '2', '3', '4', '5', '6', '7', '8', '9', '00', '0'] as const
const FOCUSABLE = 'button:not([disabled]),input:not([disabled]),select:not([disabled]),textarea:not([disabled]),a[href],[tabindex]:not([tabindex="-1"])'

/**
 * Simple-mode quick add: amount, category, save. A bottom sheet on narrow
 * screens and a centered dialog on wide ones. Posts one balanced journal
 * through createManualTransaction.
 */
export function QuickAddSheet(props: QuickAddSheetProps) {
  if (!props.open || !props.householdId) return null
  // Mounted only while open, so every opening starts from a fresh form.
  return <QuickAddSheetBody {...props} householdId={props.householdId} />
}

function QuickAddSheetBody({ householdId, accounts, onClose, onSaved, onSetupAccounts, client, now }: QuickAddSheetProps & { readonly householdId: string }) {
  const titleId = useId()
  const payingLabelId = useId()
  const amountId = useId()
  const dialogRef = useRef<HTMLElement>(null)
  const amountRef = useRef<HTMLInputElement>(null)
  const headingRef = useRef<HTMLHeadingElement>(null)

  const [kind, setKind] = useState<QuickAddKind>('EXPENSE')
  const [amountText, setAmountText] = useState('')
  const [categoryId, setCategoryId] = useState<string | null>(null)
  const [moreOpen, setMoreOpen] = useState(false)
  const [occurredOn, setOccurredOn] = useState(() => tokyoDate(now?.()))
  const [note, setNote] = useState('')
  const [payingOpen, setPayingOpen] = useState(false)
  const [busy, setBusy] = useState(false)
  const [failed, setFailed] = useState(false)

  // Read once per opening; the result may be a shared frozen object and is never mutated.
  const [usage] = useState(() => readQuickAddUsage(householdId))
  const choices = useMemo(() => quickAddChoices(accounts, kind, usage), [accounts, kind, usage])
  const [payingChoice, setPayingChoice] = useState<string | null>(null)
  // An explicit choice wins while it is still offered for the current kind; otherwise the remembered default.
  const payingAccountId = payingChoice !== null && choices.payingAccounts.some((account) => account.id === payingChoice)
    ? payingChoice
    : choices.defaultPayingAccountId
  const payingAccount = choices.payingAccounts.find((account) => account.id === payingAccountId) ?? null
  const category = choices.allCategories.find((account) => account.id === categoryId) ?? null
  const empty = choices.allCategories.length === 0 || choices.payingAccounts.length === 0

  const amount = parseYenText(amountText)
  const amountValid = amount !== null && amount > 0
  const canSave = amountValid && category !== null && payingAccount !== null && isCalendarDate(occurredOn) && !busy

  // Focus the amount on open and give focus back to whatever opened the sheet.
  useEffect(() => {
    const opener = document.activeElement instanceof HTMLElement ? document.activeElement : null
    if (amountRef.current) amountRef.current.focus()
    else headingRef.current?.focus()
    return () => { if (opener?.isConnected) opener.focus() }
  }, [])

  // On touch screens the on-screen keypad replaces the system keyboard.
  const coarsePointer = useMemo(() => typeof globalThis.matchMedia === 'function' && globalThis.matchMedia('(pointer: coarse)').matches, [])

  const switchKind = (next: QuickAddKind) => {
    if (next === kind) return
    setKind(next)
    setCategoryId(null)
    setMoreOpen(false)
    setFailed(false)
  }

  const pressKey = (key: string) => {
    setFailed(false)
    setAmountText((current) => {
      const base = current === '0' ? '' : current
      const next = base + key
      return next === '00' ? '0' : next
    })
  }

  const save = async () => {
    if (!canSave || amount === null || !category || !payingAccount) return
    let transactionId: string
    setBusy(true)
    setFailed(false)
    try {
      // randomUUID throws outside a secure context; that must show the error, not reject unhandled.
      transactionId = crypto.randomUUID()
      const input = buildQuickAddInput({
        id: transactionId, householdId, kind, amountJpy: amount, categoryId: category.id,
        payingAccountId: payingAccount.id, occurredOn, note, accounts,
      })
      await client.createManualTransaction(input)
    } catch {
      setBusy(false)
      setFailed(true)
      return
    }
    recordQuickAddUse(householdId, category.id, payingAccount.id)
    onSaved({ transactionId, amountJpy: amount, categoryName: category.name })
    setAmountText('')
    setBusy(false)
    onClose()
  }

  const handleKeyDown = (event: ReactKeyboardEvent<HTMLElement>) => {
    if (event.key === 'Escape') { if (!busy) { event.preventDefault(); onClose() }; return }
    if (event.key === 'Enter') {
      // Enter that confirms an IME conversion (Japanese input) must not save.
      if (event.nativeEvent.isComposing || event.keyCode === 229) return
      // Enter in a text or date field saves; buttons and selects keep their own Enter behavior.
      if (event.target instanceof HTMLInputElement) { event.preventDefault(); void save() }
      return
    }
    if (event.key !== 'Tab') return
    // The keypad buttons are buttons with tabindex -1: reachable by tap, never by Tab.
    const focusable = [...(dialogRef.current?.querySelectorAll<HTMLElement>(FOCUSABLE) ?? [])].filter((element) => element.getAttribute('tabindex') !== '-1')
    if (focusable.length === 0) { event.preventDefault(); headingRef.current?.focus(); return }
    const activeIndex = focusable.indexOf(document.activeElement as HTMLElement)
    if (event.shiftKey && activeIndex <= 0) { event.preventDefault(); focusable[focusable.length - 1].focus() }
    else if (!event.shiftKey && (activeIndex === -1 || activeIndex === focusable.length - 1)) { event.preventDefault(); focusable[0].focus() }
  }

  const payingLabel = kind === 'EXPENSE' ? localize("支払い元") : localize("受取口座")
  const chipIds = new Set(choices.chips.map((chip) => chip.id))

  return <div className="quick-add-backdrop" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget && !busy) onClose() }}>
    <section ref={dialogRef} className="quick-add-sheet" role="dialog" aria-modal="true" aria-labelledby={titleId} onKeyDown={handleKeyDown}>
      <div className="quick-add-head">
        <h2 ref={headingRef} id={titleId} tabIndex={-1}>{kind === 'EXPENSE' ? localize("支出を記録") : localize("収入を記録")}</h2>
        <button type="button" className="icon-btn quick-add-close" aria-label={localize("記録画面を閉じる")} disabled={busy} onClick={onClose}><X size={20} /></button>
      </div>

      <div className="quick-add-kind" role="group" aria-label={localize("記録の種類")}>
        <button type="button" aria-pressed={kind === 'EXPENSE'} onClick={() => switchKind('EXPENSE')}>{localize("支出")}</button>
        <button type="button" aria-pressed={kind === 'INCOME'} onClick={() => switchKind('INCOME')}>{localize("収入")}</button>
      </div>

      {empty
        ? <div className="quick-add-empty">
          <p>{localize("記録できる口座がありません")}</p>
          {onSetupAccounts && <button type="button" className="primary-btn" onClick={onSetupAccounts}>{localize("口座を設定する")}</button>}
        </div>
        : <>
          <div className="quick-add-amount">
            <label htmlFor={amountId}>{localize("記録する金額")}</label>
            <span className="quick-add-amount-field">
              <span aria-hidden="true">¥</span>
              <input
                ref={amountRef} id={amountId} type="text" inputMode={coarsePointer ? 'none' : 'numeric'} autoComplete="off"
                value={amountText} aria-invalid={amount === null}
                onChange={(event) => { setAmountText(event.target.value); setFailed(false) }}
              />
            </span>
          </div>

          <div className="quick-add-keypad">
            {KEYPAD_DIGITS.map((key) => <button key={key} type="button" tabIndex={-1} onMouseDown={(event) => event.preventDefault()} onClick={() => pressKey(key)}>{key}</button>)}
            <button type="button" tabIndex={-1} aria-label={localize("1文字削除")} onMouseDown={(event) => event.preventDefault()} onClick={() => { setFailed(false); setAmountText((current) => current.slice(0, -1)) }}>⌫</button>
          </div>

          <fieldset className="quick-add-categories">
            <legend>{localize("カテゴリー")}</legend>
            <div className="quick-add-chips">
              {choices.chips.map((chip) => <button key={chip.id} type="button" className="quick-add-chip" aria-pressed={chip.id === categoryId}
                onClick={() => setCategoryId((current) => current === chip.id ? null : chip.id)}>{chip.name}</button>)}
              {choices.allCategories.length > choices.chips.length && <button type="button" className="quick-add-chip quick-add-more" aria-expanded={moreOpen}
                aria-pressed={categoryId !== null && !chipIds.has(categoryId)} onClick={() => setMoreOpen((value) => !value)}>{localize("もっと見る")}</button>}
            </div>
            {moreOpen && <select aria-label={localize("カテゴリー")} value={categoryId ?? ''} onChange={(event) => setCategoryId(event.target.value || null)}>
              <option value="" disabled>{localize("カテゴリー")}</option>
              {choices.allCategories.map((option) => <option key={option.id} value={option.id}>{option.name}</option>)}
            </select>}
          </fieldset>

          <div className="quick-add-details">
            {payingOpen || payingAccount === null
              ? <div className="quick-add-paying">
                <span id={payingLabelId}>{payingLabel}</span>
                <select aria-labelledby={payingLabelId} value={payingAccountId ?? ''} onChange={(event) => setPayingChoice(event.target.value || null)}>
                  {payingAccount === null && <option value="" disabled>{localize("口座を選択")}</option>}
                  {choices.payingAccounts.map((option) => <option key={option.id} value={option.id}>{option.name}</option>)}
                </select>
              </div>
              : <button type="button" className="quick-add-paying quick-add-paying-row" aria-expanded={false} onClick={() => setPayingOpen(true)}>
                <span>{payingLabel}</span>
                <strong>{payingAccount.name}</strong>
              </button>}
            <label className="quick-add-field">
              <span>{localize("記録する日付")}</span>
              <input type="date" value={occurredOn} onChange={(event) => setOccurredOn(event.target.value)} />
            </label>
            <label className="quick-add-field">
              <span>{localize("メモ（任意）")}</span>
              <input type="text" value={note} onChange={(event) => setNote(event.target.value)} />
            </label>
          </div>

          {failed && <p className="quick-add-error" role="alert">{localize("保存できませんでした。もう一度お試しください。")}</p>}

          <button type="button" className="primary-btn quick-add-save" disabled={!canSave} onClick={() => void save()}>
            {busy ? localize("保存中…") : localize("記録を保存")}
          </button>
        </>}
    </section>
  </div>
}
