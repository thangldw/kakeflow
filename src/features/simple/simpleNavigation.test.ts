import { describe, expect, it } from 'vitest'
import type { PageId } from '../../types'
import { SIMPLE_TABS, tabForPage } from './simpleNavigation'

describe('simple navigation model', () => {
  it('has the five simple tabs in order with their pages and Japanese source labels', () => {
    expect(SIMPLE_TABS.map((tab) => [tab.id, tab.page, tab.label])).toEqual([
      ['today', 'overview', '今日'],
      ['transactions', 'transactions', '取引'],
      ['budget', 'budgets', '予算'],
      ['savings', 'budgets', '貯蓄'],
      ['more', 'more', 'その他'],
    ])
  })

  it('maps the budgets page to savings only when the savings view is active', () => {
    expect(tabForPage('budgets', true)).toBe('savings')
    expect(tabForPage('budgets', false)).toBe('budget')
  })

  it('maps the main pages to their tabs', () => {
    expect(tabForPage('overview', false)).toBe('today')
    expect(tabForPage('transactions', false)).toBe('transactions')
    expect(tabForPage('more', false)).toBe('more')
  })

  it('maps every page without its own tab to more', () => {
    const others: PageId[] = ['import', 'capture', 'cards', 'investments', 'reports', 'recurring', 'rules', 'family', 'audit', 'settings']
    for (const page of others) {
      expect(tabForPage(page, false)).toBe('more')
      expect(tabForPage(page, true)).toBe('more')
    }
  })
})
