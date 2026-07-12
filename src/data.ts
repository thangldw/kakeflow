import type { CardSettlement, Transaction } from './types'

export const spendingTrend = [
  { month: '2月', income: 610, expense: 402 },
  { month: '3月', income: 590, expense: 438 },
  { month: '4月', income: 640, expense: 421 },
  { month: '5月', income: 620, expense: 472 },
  { month: '6月', income: 680, expense: 451 },
  { month: '7月', income: 652.8, expense: 386 },
]

export const categoryData = [
  { name: '食費', amount: 82400, pct: 31, color: '#ed714d' },
  { name: '住居・光熱', amount: 67900, pct: 25, color: '#6f7d57' },
  { name: '交通', amount: 43200, pct: 16, color: '#e4aa45' },
  { name: '日用品', amount: 39100, pct: 15, color: '#7f9ba5' },
  { name: 'その他', amount: 35390, pct: 13, color: '#c7b8a0' },
]

export const transactions: Transaction[] = [
  { id: '1', date: '7月12日', merchant: '成城石井', detail: '食料品', category: '食費', account: 'PayPay', amount: -4280, status: 'confirmed', icon: 'food' },
  { id: '2', date: '7月11日', merchant: '東京電力', detail: '電気料金・6月分', category: '住居・光熱', account: 'MUFG', amount: -8640, status: 'confirmed', icon: 'home' },
  { id: '3', date: '7月10日', merchant: 'JR EAST', detail: 'モバイルSuica', category: '交通', account: 'Rakuten Card', amount: -5000, status: 'confirmed', icon: 'transport', accountingEffect: 'ACCRUAL_ONLY' },
  { id: '4', date: '7月10日', merchant: '給与振込', detail: '株式会社 Kake', category: '収入', account: 'MUFG', amount: 426800, status: 'confirmed', icon: 'income' },
  { id: '5', date: '7月9日', merchant: 'Netflix.com', detail: '月額利用料', category: '娯楽', account: 'Amazon Mastercard', amount: -1490, status: 'review', icon: 'subscription', accountingEffect: 'ACCRUAL_ONLY' },
  { id: '6', date: '7月27日', merchant: '楽天カード支払い', detail: 'カード請求の口座引落', category: '資金移動', account: 'MUFG', amount: -204987, status: 'confirmed', icon: 'subscription', accountingEffect: 'CASH_ONLY' },
]

export const cardSettlements: CardSettlement[] = [
  { name: 'Rakuten Card', mask: '•••• 8106', dueDate: '7月27日', statement: 204987, bankDebit: 204987, progress: 100, status: 'reconciled', color: '#b15b68' },
  { name: 'Amazon Mastercard', mask: '•••• 1431', dueDate: '7月26日', statement: 20170, progress: 72, status: 'pending', color: '#394b5a' },
]

export const importItems = [
  { file: 'paypay_2026.csv', source: 'PayPay', records: 38, state: 'ready', time: '2分前' },
  { file: 'enavi202607.csv', source: 'Rakuten Card', records: 15, state: 'review', time: '18分前' },
  { file: 'receipt_0712.jpg', source: 'レシート', records: 1, state: 'matched', time: '32分前' },
  { file: '0363431_202607.csv', source: 'Bank account', records: 25, state: 'processed', time: '1時間前' },
]
