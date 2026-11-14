import { Goal, Home, MoreHorizontal, PiggyBank, WalletCards, type LucideIcon } from 'lucide-react'
import type { PageId } from '../../types'

export type SimpleTab = 'today' | 'transactions' | 'budget' | 'savings' | 'more'

// The five Simple-mode entries. Budget and savings share the budgets page; the shell tracks which view is open.
// The labels are Simple-specific catalog entries: the shared 予算 / 貯蓄 / その他 entries are lower case or mean
// "Other" in English and are also used inside longer sentences, so they cannot simply be changed. The
// Transactions tab uses its own 取引一覧 entry because the shared "Transactions" is too wide for a phone tab, and
// the Savings tab says 貯蓄 like the screens it opens (貯蓄の目標); the bare 貯蓄 entry reads "savings" in English.
export const SIMPLE_TABS: readonly { readonly id: SimpleTab; readonly page: PageId; readonly label: string }[] = [
  { id: 'today', page: 'overview', label: '今日' },
  { id: 'transactions', page: 'transactions', label: '取引一覧' },
  { id: 'budget', page: 'budgets', label: '予算管理' },
  { id: 'savings', page: 'budgets', label: '貯蓄管理' },
  { id: 'more', page: 'more', label: 'そのほか' },
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
