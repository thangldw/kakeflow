import { CalendarDays, Camera, Clock3, CreditCard, Goal, Home, Import, ShieldCheck, Sparkles, TrendingUp, Users, WalletCards } from 'lucide-react'
import type { NavigationItem, PageId } from './types'

// Full-mode pages in sidebar order. Labels are Japanese source strings passed through the i18n helpers.
export const navigation: readonly NavigationItem[] = [
  { id: 'overview', label: 'ホーム', icon: Home },
  { id: 'transactions', label: '取引', icon: WalletCards },
  { id: 'import', label: 'インポート', icon: Import },
  { id: 'capture', label: '撮影 Inbox', icon: Camera },
  { id: 'cards', label: 'カード照合', icon: CreditCard },
  { id: 'investments', label: '資産・投資', icon: TrendingUp },
  { id: 'reports', label: 'カレンダー・レポート', icon: CalendarDays },
  { id: 'budgets', label: '予算・目標', icon: Goal },
  { id: 'recurring', label: '定期取引・固定費', icon: Clock3 },
  { id: 'rules', label: '分類ルール', icon: Sparkles },
  { id: 'family', label: '家族スペース', icon: Users },
  { id: 'audit', label: '監査・証跡', icon: ShieldCheck },
]

export const navigationSections: readonly { label: string; pages: readonly PageId[] }[] = [
  { label: 'メイン', pages: ['overview', 'transactions'] },
  { label: '取り込み', pages: ['import', 'capture'] },
  { label: '照合・資産', pages: ['cards', 'investments'] },
  { label: '計画・分析', pages: ['reports', 'budgets', 'recurring', 'rules'] },
  { label: '世帯', pages: ['family', 'audit'] },
]
