import { fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { useState } from 'react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { AccountDto, CreateManualTransactionInputDto, TransactionRowDto } from '../../platform/types'
import { isCalendarDate } from './quickAdd'
import { QuickAddSheet } from './QuickAddSheet'
import { readQuickAddUsage } from './uiMode'

function account(id: string, name: string, accountKind: AccountDto['accountKind'], accountSubtype: AccountDto['accountSubtype'] = 'OTHER'): AccountDto {
  return { id, name, accountKind, accountSubtype, currency: 'JPY', ownershipKind: 'HOUSEHOLD', ownerMemberId: null, ownerMemberName: null, visibility: 'SHARED' }
}

const cash = account('cash', '現金', 'ASSET', 'CASH')
const card = account('card', '楽天カード', 'LIABILITY', 'CREDIT_CARD')
const accounts: AccountDto[] = [
  account('bank', '三井住友銀行', 'ASSET', 'BANK'),
  cash,
  card,
  account('food', '食費', 'EXPENSE'),
  account('daily', '日用品', 'EXPENSE'),
  account('h1-other-expense', 'その他', 'EXPENSE'),
  account('salary', '給与', 'INCOME'),
]

// 2026-11-14 23:30 in Tokyo is still 2026-11-14 there but 14:30 UTC.
const now = () => new Date('2026-11-14T14:30:00Z')

function fakeClient(options: { fail?: boolean } = {}) {
  return {
    createManualTransaction: vi.fn(async (input: CreateManualTransactionInputDto): Promise<TransactionRowDto> => {
      if (options.fail) throw new Error('offline')
      return { id: input.id } as TransactionRowDto
    }),
  }
}

type FakeClient = ReturnType<typeof fakeClient>

// The client is kept as the fake's own type so tests can read its mock calls.
function renderSheet({ client = fakeClient(), ...overrides }: Partial<Omit<Parameters<typeof QuickAddSheet>[0], 'client'>> & { client?: FakeClient } = {}) {
  const props = {
    open: true, householdId: 'h1', accounts, onClose: vi.fn(), onSaved: vi.fn(), now, ...overrides, client,
  }
  render(<QuickAddSheet {...props} />)
  return props
}

const amountField = () => screen.getByLabelText('記録する金額') as HTMLInputElement
const saveButton = () => screen.getByRole('button', { name: '記録を保存' })
const tapKeys = (keys: string) => { for (const key of keys) fireEvent.click(screen.getByRole('button', { name: key })) }

afterEach(() => {
  localStorage.clear()
  vi.restoreAllMocks()
})

describe('QuickAddSheet', () => {
  it('renders nothing when closed', () => {
    const { container } = render(<QuickAddSheet open={false} householdId="h1" accounts={accounts} onClose={vi.fn()} onSaved={vi.fn()} client={fakeClient()} now={now} />)
    expect(container).toBeEmptyDOMElement()
  })

  it('is a modal dialog and focuses the amount field on open', () => {
    renderSheet()
    const dialog = screen.getByRole('dialog', { name: '支出を記録' })
    expect(dialog).toHaveAttribute('aria-modal', 'true')
    expect(amountField()).toHaveFocus()
  })

  it('updates the amount from the on-screen keypad', () => {
    renderSheet()
    tapKeys('1280')
    expect(amountField()).toHaveValue('1280')
    fireEvent.click(screen.getByRole('button', { name: '1文字削除' }))
    expect(amountField()).toHaveValue('128')
  })

  it('keeps Save disabled for an empty amount, 0, and when no category is chosen', () => {
    renderSheet()
    fireEvent.click(screen.getByRole('button', { name: '食費' }))
    expect(saveButton()).toBeDisabled()
    tapKeys('0')
    expect(saveButton()).toBeDisabled()
    fireEvent.change(amountField(), { target: { value: '500' } })
    expect(saveButton()).toBeEnabled()
    fireEvent.click(screen.getByRole('button', { name: '食費' }))
    expect(screen.getByRole('button', { name: '食費' })).toHaveAttribute('aria-pressed', 'false')
    expect(saveButton()).toBeDisabled()
  })

  it('accepts full-width digits and posts the half-width amount', async () => {
    const props = renderSheet()
    fireEvent.change(amountField(), { target: { value: '１２８０' } })
    fireEvent.click(screen.getByRole('button', { name: '食費' }))
    expect(saveButton()).toBeEnabled()
    fireEvent.click(saveButton())
    await waitFor(() => expect(props.client.createManualTransaction).toHaveBeenCalledTimes(1))
    expect(props.client.createManualTransaction.mock.calls[0][0].entries.map((entry) => entry.amountJpy)).toEqual([1280, 1280])
  })

  it('rejects a 16-digit amount', () => {
    renderSheet()
    fireEvent.click(screen.getByRole('button', { name: '食費' }))
    tapKeys('1234567890123456')
    expect(amountField()).toHaveAttribute('aria-invalid', 'true')
    expect(saveButton()).toBeDisabled()
  })

  it('saves the mapped journal once, from cash, dated Tokyo today, then reports and closes', async () => {
    const props = renderSheet()
    tapKeys('1280')
    fireEvent.click(screen.getByRole('button', { name: '食費' }))
    fireEvent.click(saveButton())
    await waitFor(() => expect(props.onSaved).toHaveBeenCalledTimes(1))
    expect(props.client.createManualTransaction).toHaveBeenCalledTimes(1)
    const input = props.client.createManualTransaction.mock.calls[0][0]
    expect(input).toMatchObject({
      householdId: 'h1', occurredOn: '2026-11-14', postedOn: null, transactionType: 'EXPENSE', description: null,
      attributionKind: 'HOUSEHOLD', audienceVisibility: 'SHARED',
      entries: [
        { accountId: 'food', side: 'DEBIT', amountJpy: 1280 },
        { accountId: 'cash', side: 'CREDIT', amountJpy: 1280 },
      ],
    })
    expect(props.onSaved).toHaveBeenCalledWith({ transactionId: input.id, amountJpy: 1280, categoryName: '食費' })
    expect(props.onClose).toHaveBeenCalledTimes(1)
  })

  it('swaps the chips and the account label when switching to income', () => {
    renderSheet()
    expect(screen.getByText('支払い元')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: '食費' })).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: '収入' }))
    expect(screen.getByRole('button', { name: '収入' })).toHaveAttribute('aria-pressed', 'true')
    expect(screen.getByRole('dialog', { name: '収入を記録' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: '給与' })).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: '食費' })).not.toBeInTheDocument()
    expect(screen.getByText('受取口座')).toBeInTheDocument()
    expect(screen.queryByText('支払い元')).not.toBeInTheDocument()
  })

  it('posts a card purchase when paid with a credit card', async () => {
    const props = renderSheet()
    tapKeys('3000')
    fireEvent.click(screen.getByRole('button', { name: '日用品' }))
    fireEvent.click(screen.getByRole('button', { name: /支払い元/ }))
    fireEvent.change(screen.getByRole('combobox', { name: '支払い元' }), { target: { value: 'card' } })
    fireEvent.click(saveButton())
    await waitFor(() => expect(props.client.createManualTransaction).toHaveBeenCalledTimes(1))
    expect(props.client.createManualTransaction.mock.calls[0][0]).toMatchObject({
      transactionType: 'CARD_PURCHASE',
      entries: [{ accountId: 'daily', side: 'DEBIT' }, { accountId: 'card', side: 'CREDIT' }],
    })
  })

  it('remembers the used category and paying account after a successful save', async () => {
    const props = renderSheet()
    tapKeys('800')
    fireEvent.click(screen.getByRole('button', { name: '日用品' }))
    fireEvent.click(saveButton())
    await waitFor(() => expect(props.onSaved).toHaveBeenCalled())
    expect(readQuickAddUsage('h1')).toEqual({ categoryCounts: { daily: 1 }, lastPayingAccountId: 'cash' })
  })

  it('keeps the sheet open and the amount when saving fails, and says so', async () => {
    const client = fakeClient({ fail: true })
    const props = renderSheet({ client })
    tapKeys('1280')
    fireEvent.click(screen.getByRole('button', { name: '食費' }))
    fireEvent.click(saveButton())
    expect(await screen.findByRole('alert')).toHaveTextContent('保存できませんでした。もう一度お試しください。')
    expect(screen.getByRole('dialog')).toBeInTheDocument()
    expect(amountField()).toHaveValue('1280')
    expect(props.onSaved).not.toHaveBeenCalled()
    expect(props.onClose).not.toHaveBeenCalled()
    expect(readQuickAddUsage('h1').lastPayingAccountId).toBeNull()
  })

  it('shows the error alert when no transaction id can be created (non-secure context)', async () => {
    vi.spyOn(crypto, 'randomUUID').mockImplementation(() => { throw new Error('randomUUID needs a secure context') })
    const props = renderSheet()
    tapKeys('500')
    fireEvent.click(screen.getByRole('button', { name: '食費' }))
    fireEvent.click(saveButton())
    expect(await screen.findByRole('alert')).toHaveTextContent('保存できませんでした。もう一度お試しください。')
    expect(props.client.createManualTransaction).not.toHaveBeenCalled()
    expect(saveButton()).toBeEnabled()
  })

  it('limits the note to 200 characters', () => {
    renderSheet()
    expect(screen.getByLabelText('メモ（任意）')).toHaveAttribute('maxLength', '200')
  })

  it('wraps Tab between the close button and the last field, skipping the keypad', () => {
    renderSheet()
    const close = screen.getByRole('button', { name: '記録画面を閉じる' })
    const note = screen.getByLabelText('メモ（任意）')
    // Save is disabled while the form is empty, so the note field is the last stop.
    note.focus()
    fireEvent.keyDown(note, { key: 'Tab' })
    expect(close).toHaveFocus()
    fireEvent.keyDown(close, { key: 'Tab', shiftKey: true })
    expect(note).toHaveFocus()
  })

  it('sends Tab from a focused keypad button back into the tab order, at the close button or the last field', () => {
    renderSheet()
    const close = screen.getByRole('button', { name: '記録画面を閉じる' })
    const note = screen.getByLabelText('メモ（任意）')
    // Keypad buttons are tap targets (tabindex -1), but a script or a pointer can still focus one.
    const five = screen.getByRole('button', { name: '5' })
    five.focus()
    expect(five).toHaveFocus()
    expect(fireEvent.keyDown(five, { key: 'Tab' })).toBe(false)
    expect(close).toHaveFocus()

    five.focus()
    expect(fireEvent.keyDown(five, { key: 'Tab', shiftKey: true })).toBe(false)
    expect(note).toHaveFocus()
  })

  it('leaves Tab between fields in the middle of the sheet to the browser', () => {
    renderSheet()
    amountField().focus()
    // Not prevented: the browser moves focus to the next field itself.
    expect(fireEvent.keyDown(amountField(), { key: 'Tab' })).toBe(true)
    expect(fireEvent.keyDown(amountField(), { key: 'Tab', shiftKey: true })).toBe(true)
    expect(amountField()).toHaveFocus()
  })

  it('wraps from Save to the close button once Save is enabled and is the last stop', () => {
    renderSheet()
    tapKeys('500')
    fireEvent.click(screen.getByRole('button', { name: '食費' }))
    const save = saveButton()
    expect(save).toBeEnabled()
    save.focus()
    expect(fireEvent.keyDown(save, { key: 'Tab' })).toBe(false)
    expect(screen.getByRole('button', { name: '記録画面を閉じる' })).toHaveFocus()
    fireEvent.keyDown(screen.getByRole('button', { name: '記録画面を閉じる' }), { key: 'Tab', shiftKey: true })
    expect(save).toHaveFocus()
  })

  it('shows the empty state when there is no expense category', () => {
    const onSetupAccounts = vi.fn()
    renderSheet({ accounts: accounts.filter((a) => a.accountKind !== 'EXPENSE'), onSetupAccounts })
    expect(screen.getByText('記録できる口座がありません')).toBeInTheDocument()
    expect(screen.queryByLabelText('記録する金額')).not.toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: '口座を設定する' }))
    expect(onSetupAccounts).toHaveBeenCalledTimes(1)
  })

  it('shows the empty state when there is no paying account', () => {
    renderSheet({ accounts: accounts.filter((a) => a.accountKind === 'EXPENSE'), onSetupAccounts: vi.fn() })
    expect(screen.getByText('記録できる口座がありません')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: '口座を設定する' })).toBeInTheDocument()
  })

  it('closes on Escape and returns focus to the opener', () => {
    function Harness() {
      const [open, setOpen] = useState(false)
      return <>
        <button type="button" onClick={() => setOpen(true)}>open sheet</button>
        <QuickAddSheet open={open} householdId="h1" accounts={accounts} onClose={() => setOpen(false)} onSaved={vi.fn()} client={fakeClient()} now={now} />
      </>
    }
    render(<Harness />)
    const opener = screen.getByRole('button', { name: 'open sheet' })
    opener.focus()
    fireEvent.click(opener)
    expect(amountField()).toHaveFocus()
    fireEvent.keyDown(amountField(), { key: 'Escape' })
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
    expect(opener).toHaveFocus()
  })

  it('saves on Enter when valid and not before', async () => {
    const props = renderSheet()
    fireEvent.change(amountField(), { target: { value: '450' } })
    fireEvent.keyDown(amountField(), { key: 'Enter' })
    expect(props.client.createManualTransaction).not.toHaveBeenCalled()
    fireEvent.click(screen.getByRole('button', { name: '食費' }))
    fireEvent.keyDown(amountField(), { key: 'Enter' })
    await waitFor(() => expect(props.client.createManualTransaction).toHaveBeenCalledTimes(1))
  })

  it('keeps Save disabled when the date is empty or not a real calendar date', () => {
    renderSheet()
    tapKeys('500')
    fireEvent.click(screen.getByRole('button', { name: '食費' }))
    const date = screen.getByLabelText('記録する日付')
    expect(date).toHaveValue('2026-11-14')
    expect(saveButton()).toBeEnabled()
    fireEvent.change(date, { target: { value: '' } })
    expect(saveButton()).toBeDisabled()
    fireEvent.keyDown(screen.getByLabelText('記録する金額'), { key: 'Enter' })
    expect(screen.getByRole('dialog')).toBeInTheDocument()
    fireEvent.change(date, { target: { value: '2026-11-13' } })
    expect(saveButton()).toBeEnabled()
  })

  it('treats impossible dates such as 2026-02-31 as invalid', () => {
    expect(isCalendarDate('2026-02-31')).toBe(false)
    expect(isCalendarDate('2026-13-01')).toBe(false)
    expect(isCalendarDate('')).toBe(false)
    expect(isCalendarDate('2026-2-3')).toBe(false)
    expect(isCalendarDate('2024-02-29')).toBe(true)
    // 2028 is a leap year, 2027 is not.
    expect(isCalendarDate('2028-02-29')).toBe(true)
    expect(isCalendarDate('2027-02-29')).toBe(false)
    expect(isCalendarDate('2026-11-14')).toBe(true)
  })

  it('does not save on Enter while an IME composition is being confirmed', () => {
    const props = renderSheet()
    tapKeys('700')
    fireEvent.click(screen.getByRole('button', { name: '食費' }))
    const note = screen.getByLabelText('メモ（任意）')
    fireEvent.keyDown(note, { key: 'Enter', isComposing: true })
    fireEvent.keyDown(note, { key: 'Enter', keyCode: 229 })
    expect(props.client.createManualTransaction).not.toHaveBeenCalled()
    expect(screen.getByRole('dialog')).toBeInTheDocument()
  })

  it('offers the categories beyond the chips through More…', async () => {
    const extra = ['交通費', '娯楽', '医療', '住居', '教育'].map((name, index) => account(`extra-${index}`, name, 'EXPENSE'))
    const props = renderSheet({ accounts: [...accounts, ...extra] })
    expect(screen.queryByRole('button', { name: '教育' })).not.toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'もっと見る' }))
    const select = screen.getByRole('combobox', { name: 'カテゴリー' })
    expect(within(select).getAllByRole('option').map((option) => option.textContent)).toEqual(expect.arrayContaining(['食費', '日用品', 'その他', '教育']))
    fireEvent.change(select, { target: { value: 'extra-4' } })
    expect(screen.getByRole('button', { name: 'もっと見る' })).toHaveAttribute('aria-pressed', 'true')
    tapKeys('900')
    fireEvent.click(saveButton())
    await waitFor(() => expect(props.onSaved).toHaveBeenCalledWith(expect.objectContaining({ amountJpy: 900, categoryName: '教育' })))
  })

  it('puts Save and the error in a footer outside the scrolling body, with the same enabled rules', async () => {
    const props = renderSheet({ client: fakeClient({ fail: true }) })
    const dialog = screen.getByRole('dialog')
    const footer = dialog.querySelector('.quick-add-footer')
    const body = dialog.querySelector('.quick-add-body')
    expect(footer).not.toBeNull()
    expect(body).not.toBeNull()
    // The footer is the dialog's last part and a sibling of the body, so it never scrolls with the content.
    expect(dialog.lastElementChild).toBe(footer)
    expect(footer?.parentElement).toBe(dialog)
    expect(body?.contains(footer as Node)).toBe(false)
    expect(footer).toContainElement(saveButton())
    expect(body).toContainElement(amountField())
    expect(body).toContainElement(screen.getByLabelText('メモ（任意）'))

    expect(saveButton()).toBeDisabled()
    tapKeys('450')
    expect(saveButton()).toBeDisabled()
    fireEvent.click(screen.getByRole('button', { name: '食費' }))
    expect(saveButton()).toBeEnabled()
    fireEvent.click(saveButton())
    await waitFor(() => expect(props.client.createManualTransaction).toHaveBeenCalledTimes(1))
    const alert = await screen.findByRole('alert')
    expect(footer).toContainElement(alert)
    expect(saveButton()).toBeEnabled()
  })

  it('has no footer in the empty state', () => {
    renderSheet({ accounts: accounts.filter((entry) => entry.accountKind !== 'EXPENSE') })
    expect(screen.getByRole('dialog').querySelector('.quick-add-footer')).toBeNull()
    expect(screen.queryByRole('button', { name: '記録を保存' })).not.toBeInTheDocument()
  })
})
