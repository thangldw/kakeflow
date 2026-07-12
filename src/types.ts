import type { LucideIcon } from 'lucide-react'

export type PageId = 'overview' | 'transactions' | 'import' | 'cards' | 'budgets'

export interface NavigationItem {
  id: PageId
  label: string
  icon: LucideIcon
  badge?: number
}

export interface Transaction {
  id: string
  date: string
  merchant: string
  detail: string
  category: string
  account: string
  amount: number
  status: 'confirmed' | 'review'
  icon: 'food' | 'home' | 'transport' | 'income' | 'subscription'
  accountingEffect?: 'ACCRUAL_AND_CASH' | 'ACCRUAL_ONLY' | 'CASH_ONLY'
}

export interface CardSettlement {
  name: string
  mask: string
  dueDate: string
  statement: number
  bankDebit?: number
  progress: number
  status: 'reconciled' | 'pending' | 'possible'
  color: string
}
