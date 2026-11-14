import { fireEvent, render, screen, within } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { navigation } from '../../navigation'
import type { PageId } from '../../types'
import { SimpleMorePage, UiModeSwitch } from './SimpleMorePage'
import { SimpleTabBar } from './SimpleTabBar'

const MAIN_TAB_PAGES: readonly PageId[] = ['overview', 'transactions', 'budgets']

describe('SimpleTabBar', () => {
  it('renders five buttons in a labelled nav and marks only the active one as the current page', () => {
    render(<SimpleTabBar active="budget" onSelect={() => undefined} />)
    const nav = screen.getByRole('navigation')
    expect(nav).toHaveAccessibleName()
    const buttons = within(nav).getAllByRole('button')
    expect(buttons.map((button) => button.textContent)).toEqual(['今日', '取引', '予算', '貯蓄', 'その他'])
    expect(buttons.filter((button) => button.getAttribute('aria-current') === 'page')).toEqual([screen.getByRole('button', { name: '予算' })])
  })

  it('calls onSelect with the tab id', () => {
    const onSelect = vi.fn()
    render(<SimpleTabBar active="today" onSelect={onSelect} />)
    fireEvent.click(screen.getByRole('button', { name: '貯蓄' }))
    expect(onSelect).toHaveBeenCalledWith('savings')
  })
})

describe('SimpleMorePage', () => {
  it('lists every Full page that is not a main tab exactly once, so nothing is lost', () => {
    const { container } = render(<SimpleMorePage mode="simple" onModeChange={() => undefined} onNavigate={() => undefined} />)
    const expected = [...navigation.map((item) => item.id).filter((id) => !MAIN_TAB_PAGES.includes(id)), 'settings'].sort()
    const listed = [...container.querySelectorAll<HTMLElement>('[data-page]')].map((element) => element.dataset.page).sort()
    expect(listed).toEqual(expected)
    for (const item of navigation.filter((entry) => !MAIN_TAB_PAGES.includes(entry.id))) {
      expect(screen.getAllByRole('button', { name: item.label })).toHaveLength(1)
    }
    expect(screen.getAllByRole('button', { name: '設定' })).toHaveLength(1)
  })

  it('groups the advanced pages under their own heading', () => {
    render(<SimpleMorePage mode="simple" onModeChange={() => undefined} onNavigate={() => undefined} />)
    const advanced = screen.getByRole('region', { name: '詳細設定' })
    expect(within(advanced).getAllByRole('button').map((button) => button.getAttribute('data-page'))).toEqual(['rules', 'investments', 'audit', 'reports'])
  })

  it('calls onNavigate with the page id', () => {
    const onNavigate = vi.fn()
    render(<SimpleMorePage mode="simple" onModeChange={() => undefined} onNavigate={onNavigate} />)
    fireEvent.click(screen.getByRole('button', { name: '分類ルール' }))
    expect(onNavigate).toHaveBeenCalledWith('rules')
    fireEvent.click(screen.getByRole('button', { name: '設定' }))
    expect(onNavigate).toHaveBeenLastCalledWith('settings')
  })

  it('switches the display mode through onModeChange', () => {
    const onModeChange = vi.fn()
    render(<SimpleMorePage mode="simple" onModeChange={onModeChange} onNavigate={() => undefined} />)
    const group = screen.getByRole('group', { name: '表示モード' })
    expect(within(group).getByRole('button', { name: 'かんたん' })).toHaveAttribute('aria-pressed', 'true')
    expect(within(group).getByRole('button', { name: '詳細' })).toHaveAttribute('aria-pressed', 'false')
    fireEvent.click(within(group).getByRole('button', { name: '詳細' }))
    expect(onModeChange).toHaveBeenCalledWith('full')
  })
})

describe('UiModeSwitch', () => {
  it('reflects the current mode and reports a change', () => {
    const onChange = vi.fn()
    render(<UiModeSwitch mode="full" onChange={onChange} />)
    expect(screen.getByRole('button', { name: '詳細' })).toHaveAttribute('aria-pressed', 'true')
    fireEvent.click(screen.getByRole('button', { name: 'かんたん' }))
    expect(onChange).toHaveBeenCalledWith('simple')
  })
})
