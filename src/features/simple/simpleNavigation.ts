import { Goal, Home, MoreHorizontal, PiggyBank, WalletCards, type LucideIcon } from 'lucide-react'
import type { PageId } from '../../types'

export type SimpleTab = 'today' | 'transactions' | 'budget' | 'savings' | 'more'

// The five Simple-mode entries. Budget and savings share the budgets page; the shell tracks which view is open.
export const SIMPLE_TABS: readonly { readonly id: SimpleTab; readonly page: PageId; readonly label: string }[] = [
  { id: 'today', page: 'overview', label: '今日' },
  { id: 'transactions', page: 'transactions', label: '取引' },
  { id: 'budget', page: 'budgets', label: '予算' },
  { id: 'savings', page: 'budgets', label: '貯蓄' },
  { id: 'more', page: 'more', label: 'その他' },
]

export const SIMPLE_TAB_ICONS: Readonly<Record<SimpleTab, LucideIcon>> = {
  today: Home,
  transactions: WalletCards,
  budget: Goal,
  savings: PiggyBank,
  more: MoreHorizontal,
}

/** The tab that is highlighted for a page; every page without its own tab lives under More. */
export function tabForPage(page: PageId, savingsActive: boolean): SimpleTab {
  switch (page) {
    case 'overview': return 'today'
    case 'transactions': return 'transactions'
    case 'budgets': return savingsActive ? 'savings' : 'budget'
    default: return 'more'
  }
}
