import { fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import type { ReactNode } from 'react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { I18nProvider } from '../../i18n'
import { BudgetEditor } from './BudgetEditor'

// User data stays Japanese so it can never look like an untranslated English word.
const categories = [{ id: 'food', name: '食費' }, { id: 'daily', name: '日用品' }]
const budgets = [{ categoryAccountId: 'food', budgetJpy: 50_000 }]

function inLocale(locale: 'en' | 'vi', node: ReactNode) {
  localStorage.setItem('kakeflow.locale', locale)
  return render(<I18nProvider>{node}</I18nProvider>)
}

/** Visible text and accessible names that start with a lower-case ASCII letter. */
function lowerCaseStarts(root: HTMLElement): string[] {
  const found: string[] = []
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT)
  for (let node = walker.nextNode(); node; node = walker.nextNode()) {
    const value = node.textContent?.trim() ?? ''
    if (/^[a-z]/.test(value)) found.push(value)
  }
  for (const element of root.querySelectorAll('[aria-label]')) {
    const value = element.getAttribute('aria-label')?.trim() ?? ''
    if (/^[a-z]/.test(value)) found.push(`aria-label: ${value}`)
  }
  return found
}

function renderEditor(props: Partial<Parameters<typeof BudgetEditor>[0]> = {}, locale: 'en' | 'vi' = 'en') {
  const onSave = props.onSave ?? vi.fn(async () => undefined)
  const view = inLocale(locale, <BudgetEditor month="2026-11" categories={categories} budgets={budgets} onSave={onSave} {...props} />)
  return { ...view, onSave }
}

const row = (name: string) => screen.getByRole('form', { name })

afterEach(() => {
  localStorage.clear()
  // The active locale is module state; render once in Japanese so later files start from the default.
  render(<I18nProvider>{null}</I18nProvider>)
})

describe('BudgetEditor', () => {
  it('renders one row per category with a yen field holding its budget', () => {
    const { container } = renderEditor()
    expect(screen.getByRole('heading', { name: 'Monthly budget by category' })).toBeInTheDocument()
    expect(screen.getByText('November 2026')).toBeInTheDocument()
    expect(within(row('食費')).getByLabelText('食費')).toHaveValue('50,000')
    expect(within(row('日用品')).getByLabelText('日用品')).toHaveValue('0')
    expect(lowerCaseStarts(container)).toEqual([])
  })

  it('keeps Save disabled while the amount is unchanged or invalid and saves once', async () => {
    const { onSave } = renderEditor()
    const form = row('食費')
    const save = within(form).getByRole('button', { name: 'Save budget' })
    const input = within(form).getByLabelText('食費')
    expect(save).toBeDisabled()

    fireEvent.change(input, { target: { value: '12a' } })
    expect(input).toHaveAttribute('aria-invalid', 'true')
    expect(save).toBeDisabled()

    fireEvent.change(input, { target: { value: '50000' } })
    expect(save).toBeDisabled()

    fireEvent.change(input, { target: { value: '60000' } })
    expect(save).toBeEnabled()
    fireEvent.click(save)
    expect(save).toBeDisabled()
    await waitFor(() => expect(within(form).getByRole('status')).toHaveTextContent('Budget saved'))
    expect(onSave).toHaveBeenCalledTimes(1)
    expect(onSave).toHaveBeenCalledWith('food', 60_000)
    // The saved amount is the new baseline.
    expect(save).toBeDisabled()
  })

  it('shows an alert and keeps the typed amount when saving fails', async () => {
    renderEditor({ onSave: vi.fn(async () => { throw new Error('offline') }) })
    const form = row('日用品')
    const input = within(form).getByLabelText('日用品')
    fireEvent.change(input, { target: { value: '20000' } })
    fireEvent.click(within(form).getByRole('button', { name: 'Save budget' }))
    expect(await within(form).findByRole('alert')).toHaveTextContent('Could not save the budget')
    expect(input).toHaveValue('20000')
    expect(within(form).getByRole('button', { name: 'Save budget' })).toBeEnabled()
  })

  it('says so when there are no categories', () => {
    renderEditor({ categories: [], budgets: [] })
    expect(screen.getByText('No spending categories yet')).toBeInTheDocument()
  })

  it('offers Add a category only when onAddCategory is given', () => {
    renderEditor()
    expect(screen.queryByRole('heading', { name: 'Add a category' })).not.toBeInTheDocument()
  })

  it('rejects an empty category name and adds a named one', async () => {
    const onAddCategory = vi.fn(async () => undefined)
    const { container } = renderEditor({ onAddCategory })
    const form = screen.getByRole('form', { name: 'Add a category' })
    const name = within(form).getByLabelText('Category name')
    fireEvent.change(name, { target: { value: '   ' } })
    fireEvent.click(within(form).getByRole('button', { name: 'Add category' }))
    expect(within(form).getByRole('alert')).toHaveTextContent('Enter a category name')
    expect(onAddCategory).not.toHaveBeenCalled()
    expect(lowerCaseStarts(container)).toEqual([])

    fireEvent.change(name, { target: { value: ' 趣味 ' } })
    fireEvent.click(within(form).getByRole('button', { name: 'Add category' }))
    await waitFor(() => expect(onAddCategory).toHaveBeenCalledWith('趣味'))
    await waitFor(() => expect(name).toHaveValue(''))
    expect(within(form).queryByRole('alert')).not.toBeInTheDocument()
  })

  it('keeps the typed name and shows an alert when adding fails', async () => {
    renderEditor({ onAddCategory: vi.fn(async () => { throw new Error('offline') }) })
    const form = screen.getByRole('form', { name: 'Add a category' })
    const name = within(form).getByLabelText('Category name')
    fireEvent.change(name, { target: { value: '趣味' } })
    fireEvent.click(within(form).getByRole('button', { name: 'Add category' }))
    expect(await within(form).findByRole('alert')).toHaveTextContent('Could not add the category')
    expect(name).toHaveValue('趣味')
  })

  it('reads naturally in Vietnamese', () => {
    renderEditor({ onAddCategory: vi.fn(async () => undefined) }, 'vi')
    expect(screen.getByRole('heading', { name: 'Ngân sách tháng theo danh mục' })).toBeInTheDocument()
    expect(within(row('食費')).getByRole('button', { name: 'Lưu ngân sách' })).toBeInTheDocument()
    expect(screen.getByRole('form', { name: 'Thêm danh mục' })).toBeInTheDocument()
    expect(screen.getByLabelText('Tên danh mục')).toBeInTheDocument()
  })
})
