import { fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import type { ReactNode } from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { goalPace } from '../../domain/goalPace'
import { I18nProvider } from '../../i18n'
import type { SavingsGoalDto } from '../../platform/types'
import { GoalsPanel } from './GoalsPanel'

const yen = (value: number) => `¥${value.toLocaleString('ja-JP')}`

const goal = (overrides: Partial<SavingsGoalDto> = {}): SavingsGoalDto => ({
  id: 'trip', householdId: 'family', name: '家族旅行', targetJpy: 300_000, savedJpy: 120_000, targetDate: '2027-06-30', status: 'ACTIVE',
  createdAt: '2026-01-01T00:00:00Z', updatedAt: '2026-01-01T00:00:00Z', ...overrides,
})

const goals = [
  goal(),
  goal({ id: 'pc', name: 'パソコン', targetJpy: 200_000, savedJpy: 200_000, targetDate: '2027-01-31', status: 'COMPLETED' }),
  goal({ id: 'late', name: '車検', targetJpy: 100_000, savedJpy: 40_000, targetDate: '2026-10-31' }),
]

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

function renderPanel(props: Partial<Parameters<typeof GoalsPanel>[0]> = {}, locale: 'en' | 'vi' = 'en') {
  const onCreate = props.onCreate ?? vi.fn(async () => undefined)
  const onUpdateSaved = props.onUpdateSaved ?? vi.fn(async () => undefined)
  const view = inLocale(locale, <GoalsPanel goals={goals} {...props} onCreate={onCreate} onUpdateSaved={onUpdateSaved} />)
  return { ...view, onCreate, onUpdateSaved }
}

const goalCard = (name: string) => screen.getByRole('heading', { name }).closest('section')!
const createForm = () => screen.getByRole('form', { name: 'New goal' })

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['Date'] })
  vi.setSystemTime(new Date('2026-11-14T03:00:00Z'))
})

afterEach(() => {
  vi.useRealTimers()
  localStorage.clear()
  // The active locale is module state; render once in Japanese so later files start from the default.
  render(<I18nProvider>{null}</I18nProvider>)
})

describe('GoalsPanel list', () => {
  it('lists every goal with the shared goal pace as label and value pairs', () => {
    const { container } = renderPanel()
    expect(screen.getByRole('heading', { name: 'Savings goals' })).toBeInTheDocument()
    const trip = goalCard('家族旅行')
    const pace = goalPace(goals[0])
    expect(trip).toHaveTextContent(`${yen(120_000)} / ${yen(300_000)}`)
    expect(trip).toHaveTextContent(`Needed per month ${yen(pace.monthly)}`)
    expect(trip).toHaveTextContent(`Months left ${pace.months}`)
    expect(trip).toHaveTextContent('Target date')
    expect(goalCard('パソコン')).toHaveTextContent('Goal reached')
    expect(goalCard('車検')).toHaveTextContent('Past the target date')
    expect(goalCard('車検')).toHaveTextContent(`Still to save ${yen(60_000)}`)
    expect(lowerCaseStarts(container)).toEqual([])
  })

  it('says so when there are no goals', () => {
    renderPanel({ goals: [] })
    expect(screen.getByText('No goals yet')).toBeInTheDocument()
  })

  it('marks a cancelled goal instead of showing a pace', () => {
    renderPanel({ goals: [goal({ status: 'CANCELLED' })] })
    const card = goalCard('家族旅行')
    expect(card).toHaveTextContent('This goal was cancelled')
    expect(card).not.toHaveTextContent('Needed per month')
  })
})

describe('GoalsPanel saved amount', () => {
  it('blocks invalid text, then saves the new amount once', async () => {
    const { onUpdateSaved } = renderPanel()
    const card = goalCard('家族旅行')
    const input = within(card).getByLabelText('Saved so far')
    const update = within(card).getByRole('button', { name: 'Update saved amount' })
    fireEvent.change(input, { target: { value: 'abc' } })
    expect(update).toBeDisabled()
    fireEvent.submit(input.closest('form')!)
    expect(onUpdateSaved).not.toHaveBeenCalled()

    fireEvent.change(input, { target: { value: '150000' } })
    fireEvent.click(update)
    await waitFor(() => expect(onUpdateSaved).toHaveBeenCalledTimes(1))
    expect(onUpdateSaved).toHaveBeenCalledWith('trip', 150_000)
  })

  it('shows an alert and keeps the typed amount when the update fails', async () => {
    renderPanel({ onUpdateSaved: vi.fn(async () => { throw new Error('offline') }) })
    const card = goalCard('家族旅行')
    const input = within(card).getByLabelText('Saved so far')
    fireEvent.change(input, { target: { value: '150000' } })
    fireEvent.click(within(card).getByRole('button', { name: 'Update saved amount' }))
    expect(await within(card).findByRole('alert')).toHaveTextContent('Could not update')
    expect(input).toHaveValue('150000')
  })
})

describe('GoalsPanel new goal', () => {
  function fill(name: string, target: string, date: string) {
    const form = createForm()
    fireEvent.change(within(form).getByLabelText('Goal name'), { target: { value: name } })
    fireEvent.change(within(form).getByLabelText('Target amount'), { target: { value: target } })
    fireEvent.change(within(form).getByLabelText('Target date'), { target: { value: date } })
    return form
  }

  it('requires a name', () => {
    const { onCreate } = renderPanel()
    const form = fill('  ', '100000', '2027-12-31')
    fireEvent.click(within(form).getByRole('button', { name: 'Add goal' }))
    expect(within(form).getByRole('alert')).toHaveTextContent('Enter a goal name')
    expect(onCreate).not.toHaveBeenCalled()
  })

  it('requires a target above zero and blocks invalid amount text', () => {
    const { onCreate, container } = renderPanel()
    const form = fill('新車', '0', '2027-12-31')
    fireEvent.click(within(form).getByRole('button', { name: 'Add goal' }))
    expect(within(form).getByRole('alert')).toHaveTextContent('Enter a target amount above ¥0')
    expect(lowerCaseStarts(container)).toEqual([])
    fireEvent.change(within(form).getByLabelText('Target amount'), { target: { value: '1万' } })
    expect(within(form).getByRole('button', { name: 'Add goal' })).toBeDisabled()
    expect(onCreate).not.toHaveBeenCalled()
  })

  it('requires a real calendar date', () => {
    const { onCreate } = renderPanel()
    const form = fill('新車', '100000', '2027-02-30')
    fireEvent.click(within(form).getByRole('button', { name: 'Add goal' }))
    expect(within(form).getByRole('alert')).toHaveTextContent('Enter a valid target date')
    expect(onCreate).not.toHaveBeenCalled()
  })

  it('creates a goal with the trimmed name and clears the form', async () => {
    const { onCreate } = renderPanel()
    const form = fill(' 新車 ', '1,000,000', '2028-03-31')
    fireEvent.click(within(form).getByRole('button', { name: 'Add goal' }))
    await waitFor(() => expect(onCreate).toHaveBeenCalledTimes(1))
    expect(onCreate).toHaveBeenCalledWith({ name: '新車', targetJpy: 1_000_000, targetDate: '2028-03-31' })
    await waitFor(() => expect(within(form).getByLabelText('Goal name')).toHaveValue(''))
  })

  it('keeps the typed values and shows an alert when creating fails', async () => {
    renderPanel({ onCreate: vi.fn(async () => { throw new Error('offline') }) })
    const form = fill('新車', '100000', '2027-12-31')
    fireEvent.click(within(form).getByRole('button', { name: 'Add goal' }))
    expect(await within(form).findByRole('alert')).toHaveTextContent('Could not create the goal')
    expect(within(form).getByLabelText('Goal name')).toHaveValue('新車')
    expect(within(form).getByLabelText('Target amount')).toHaveValue('100000')
  })
})

describe('GoalsPanel in Vietnamese', () => {
  it('reads naturally', () => {
    renderPanel({}, 'vi')
    expect(screen.getByRole('heading', { name: 'Các mục tiêu tiết kiệm' })).toBeInTheDocument()
    expect(screen.getByRole('form', { name: 'Mục tiêu mới' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Thêm mục tiêu' })).toBeInTheDocument()
  })
})
