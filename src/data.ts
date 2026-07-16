import type { CardSettlement, Transaction } from './types'
import type { PortfolioSnapshotDetailDto } from './features/investments/portfolioPlatform'

export const spendingTrend = [
  { month: '2025-08', income: 1000, expense: 620 },
  { month: '2025-09', income: 1000, expense: 694.4 },
  { month: '2025-10', income: 1000, expense: 611.072 },
  { month: '2025-11', income: 1000, expense: 684.418 },
  { month: '2025-12', income: 3000, expense: 821.314 },
  { month: '2026-01', income: 1000, expense: 722.734 },
  { month: '2026-02', income: 1000, expense: 635.996 },
  { month: '2026-03', income: 1000, expense: 718.518 },
  { month: '2026-04', income: 1000, expense: 632.4 },
  { month: '2026-05', income: 1000, expense: 708.288 },
  { month: '2026-06', income: 3000, expense: 623.286 },
  { month: '2026-07', income: 1000, expense: 747.943 },
]

export const categoryData = [
  { name: '税金・社会保険', amount: 240000, pct: 38, color: '#a64f43' },
  { name: '食費', amount: 180000, pct: 24, color: '#c06d4f' },
  { name: '教育・子ども', amount: 92000, pct: 12, color: '#a56c22' },
  { name: '住居・光熱', amount: 88600, pct: 12, color: '#6f7d57' },
  { name: '交通', amount: 42000, pct: 6, color: '#e4aa45' },
  { name: 'その他', amount: 105343, pct: 14, color: '#7f9ba5' },
]

export const transactions: Transaction[] = [
  { id: '1', date: '7月25日', merchant: '架空テクノロジー株式会社', detail: '健太・月例給与', category: '収入', account: '三菱UFJ銀行・健太', amount: 600000, status: 'confirmed', icon: 'income' },
  { id: '2', date: '7月25日', merchant: '架空メディカル株式会社', detail: '美咲・月例給与', category: '収入', account: '三菱UFJ銀行・美咲', amount: 400000, status: 'confirmed', icon: 'income' },
  { id: '3', date: '7月23日', merchant: '成城石井', detail: '週末まとめ買い・食料品', category: '食費', account: 'PayPay残高', amount: -13876, status: 'confirmed', icon: 'food' },
  { id: '4', date: '7月20日', merchant: 'イトーヨーカドー', detail: '食料品・飲料', category: '食費', account: 'Rakuten Card', amount: -11521, status: 'confirmed', icon: 'food', accountingEffect: 'ACCRUAL_ONLY' },
  { id: '5', date: '7月17日', merchant: 'イオン', detail: '食料品・日用品', category: '食費', account: 'PayPayカード', amount: -10255, status: 'confirmed', icon: 'food', accountingEffect: 'ACCRUAL_ONLY' },
  { id: '6', date: '7月16日', merchant: 'LOHACO 教材', detail: '子どもの教材', category: '教育・子ども', account: 'PayPayカード', amount: -7200, status: 'confirmed', icon: 'subscription', accountingEffect: 'ACCRUAL_ONLY' },
  { id: '7', date: '7月12日', merchant: '東京電力', detail: '7月分電気料金', category: '住居・光熱', account: '三井住友銀行・家計', amount: -26400, status: 'confirmed', icon: 'home' },
  { id: '8', date: '7月27日', merchant: '住宅ローン返済', detail: '元金120,000円・利息30,000円', category: '資金移動', account: '三井住友銀行・家計', amount: -150000, status: 'confirmed', icon: 'home', accountingEffect: 'CASH_ONLY' },
  { id: '9', date: '7月27日', merchant: '楽天カード支払い', detail: '6月請求のSMBC口座引落', category: '資金移動', account: '三井住友銀行・家計', amount: -204987, status: 'confirmed', icon: 'subscription', accountingEffect: 'CASH_ONLY' },
  { id: '10', date: '7月27日', merchant: 'PayPayカード支払い', detail: '6月請求のSMBC口座引落', category: '資金移動', account: '三井住友銀行・家計', amount: -20170, status: 'confirmed', icon: 'subscription', accountingEffect: 'CASH_ONLY' },
]

export const cardSettlements: CardSettlement[] = [
  { name: 'Rakuten Card', mask: '•••• 8106', dueDate: '7月27日', statement: 204987, bankDebit: 204987, progress: 100, status: 'reconciled', color: '#b15b68' },
  { name: 'PayPayカード', mask: '•••• 2841', dueDate: '7月27日', statement: 20170, bankDebit: 20170, progress: 100, status: 'reconciled', color: '#336f87' },
]

export const importItems = [
  { file: 'paypay_2026.csv', source: 'PayPay QR・残高', records: 38, state: 'ready', time: '2分前' },
  { file: 'enavi202607.csv', source: 'Rakuten Card', records: 15, state: 'review', time: '18分前' },
  { file: 'paypay_card_202607.csv', source: 'PayPay Card', records: 3, state: 'matched', time: '32分前' },
  { file: 'mufg_smbc_202607.csv', source: 'MUFG・SMBC', records: 25, state: 'processed', time: '1時間前' },
]

export const previewPortfolioSnapshot: PortfolioSnapshotDetailDto = {
  id: 'demo-investment-consolidated', accountId: 'demo-investments', accountName: '投資ポートフォリオ（楽天・SBI・みずほ）',
  sourceDocumentId: 'demo-investment-sources', asOf: '2026-07-12T14:48:20+09:00',
  marketValueJpy: 20_000_000, cashValueJpy: 0, unrealizedPnlJpy: 2_850_000, realizedPnlJpy: 440_000,
  positionCount: 8, fxRateCount: 1,
  assetClasses: [
    { id: 'demo-class-stock', name: '楽天証券・株式／投資信託（60%）', marketValueJpy: 12_000_000, unrealizedPnlJpy: 2_100_000, sourceRow: 2 },
    { id: 'demo-class-metals', name: 'SBI証券・金銀（20%）', marketValueJpy: 4_000_000, unrealizedPnlJpy: 450_000, sourceRow: 3 },
    { id: 'demo-class-real-estate', name: 'みずほ証券・不動産投資（20%）', marketValueJpy: 4_000_000, unrealizedPnlJpy: 300_000, sourceRow: 4 },
  ],
  positions: [
    { id: 'demo-pos-toyota', productType: '国内株式', accountType: '楽天証券・特定', instrumentCode: '7203', instrumentName: 'トヨタ自動車', quantity: 800, averageCost: 2500, marketPrice: 3000, marketValueJpy: 2_400_000, unrealizedPnlJpy: 400_000, realizedPnlJpy: 0, currency: 'JPY', sourceRow: 10 },
    { id: 'demo-pos-mufg', productType: '国内株式', accountType: '楽天証券・NISA成長', instrumentCode: '8306', instrumentName: '三菱UFJフィナンシャル・グループ', quantity: 900, averageCost: 1600, marketPrice: 2000, marketValueJpy: 1_800_000, unrealizedPnlJpy: 360_000, realizedPnlJpy: 0, currency: 'JPY', sourceRow: 11 },
    { id: 'demo-pos-emaxis', productType: '投資信託', accountType: '楽天証券・NISAつみたて', instrumentCode: 'EMAXIS-AC', instrumentName: 'eMAXIS Slim 全世界株式', quantity: 1_000_000, averageCost: 2.65, marketPrice: 3, marketValueJpy: 3_000_000, unrealizedPnlJpy: 350_000, realizedPnlJpy: 0, currency: 'JPY', sourceRow: 12 },
    { id: 'demo-pos-voo', productType: '米国ETF', accountType: '楽天証券・特定', instrumentCode: 'VOO', instrumentName: 'Vanguard S&P 500 ETF', quantity: 50, averageCost: 330, marketPrice: 379.27, marketValueJpy: 3_000_000, unrealizedPnlJpy: 390_000, realizedPnlJpy: 180_000, currency: 'USD', sourceRow: 13 },
    { id: 'demo-pos-vt', productType: '米国ETF', accountType: '楽天証券・NISA成長', instrumentCode: 'VT', instrumentName: 'Vanguard Total World Stock ETF', quantity: 100, averageCost: 92, marketPrice: 113.78, marketValueJpy: 1_800_000, unrealizedPnlJpy: 600_000, realizedPnlJpy: 140_000, currency: 'USD', sourceRow: 14 },
    { id: 'demo-pos-gold', productType: '貴金属', accountType: 'SBI証券・積立', instrumentCode: 'GOLD-G', instrumentName: '金', quantity: 250, averageCost: 11200, marketPrice: 12800, marketValueJpy: 3_200_000, unrealizedPnlJpy: 400_000, realizedPnlJpy: 0, currency: 'JPY', sourceRow: 20 },
    { id: 'demo-pos-silver', productType: '貴金属', accountType: 'SBI証券・積立', instrumentCode: 'SILVER-G', instrumentName: '銀', quantity: 5000, averageCost: 150, marketPrice: 160, marketValueJpy: 800_000, unrealizedPnlJpy: 50_000, realizedPnlJpy: 0, currency: 'JPY', sourceRow: 21 },
    { id: 'demo-pos-reit', productType: '国内REIT', accountType: 'みずほ証券・特定', instrumentCode: '1343', instrumentName: 'NEXT FUNDS 東証REIT指数連動型上場投信', quantity: 2000, averageCost: 1850, marketPrice: 2000, marketValueJpy: 4_000_000, unrealizedPnlJpy: 300_000, realizedPnlJpy: 120_000, currency: 'JPY', sourceRow: 30 },
  ],
  fxRates: [{ id: 'demo-fx-usd-jpy', baseCurrency: 'USD', quoteCurrency: 'JPY', rate: 158.2, sourceRow: 40 }],
}
