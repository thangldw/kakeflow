import type { AccountDto, TransactionRowDto } from '../../platform'

export type LocalCategorySuggestionSource = 'HISTORY' | 'KEYWORD'

export interface LocalCategorySuggestion {
  readonly categoryAccountId: string
  readonly categoryName: string
  readonly confidenceBps: number
  readonly source: LocalCategorySuggestionSource
  readonly sampleCount: number
  readonly historySharePercent: number | null
  readonly matchedKeyword: string | null
  readonly amountConsistent: boolean | null
}

interface SuggestionInput {
  readonly merchant: string | null
  readonly description: string | null
  readonly transactionType: string
  readonly amountJpy?: number | null
}

interface KeywordCategory {
  readonly categoryAliases: readonly string[]
  readonly keywords: readonly string[]
  readonly confidenceBps: number
}

const keywordCategories: readonly KeywordCategory[] = [
  { categoryAliases: ['食費', '飲食', 'food', 'ăn uống'], keywords: ['スーパー', 'コンビニ', 'レストラン', 'カフェ', 'coffee', 'starbucks', '成城石井', 'イトーヨーカドー', 'イオン', '西友', 'ライフ', '食料品', 'grocery'], confidenceBps: 8_700 },
  { categoryAliases: ['交通', '交通費', 'transport', 'đi lại'], keywords: ['suica', 'pasmo', 'jr東', 'jr西', '地下鉄', 'タクシー', '高速道路', '駐車場', 'ガソリン', '交通'], confidenceBps: 9_000 },
  { categoryAliases: ['水道・光熱費', '住居・光熱', '光熱', 'utilities', 'tiện ích'], keywords: ['電力', '電気', 'ガス', '水道', 'tepco', '東京電力', '関西電力'], confidenceBps: 9_300 },
  { categoryAliases: ['通信費', '通信', 'telecom', 'viễn thông'], keywords: ['docomo', 'softbank', 'ソフトバンク', 'au携帯', '楽天モバイル', '通信料', 'インターネット', 'ntt'], confidenceBps: 9_200 },
  { categoryAliases: ['日用品', 'daily', 'đồ dùng'], keywords: ['amazon', 'アマゾン', 'lohaco', 'ドラッグ', 'マツキヨ', 'ウエルシア', 'ホームセンター', '日用品'], confidenceBps: 8_500 },
  { categoryAliases: ['趣味・娯楽', '娯楽', 'entertainment', 'giải trí'], keywords: ['netflix', 'spotify', 'disney', '映画', 'シネマ', 'ゲーム', 'カラオケ', '娯楽'], confidenceBps: 8_900 },
  { categoryAliases: ['教養・教育', '教育費', '教育', 'education', 'giáo dục'], keywords: ['学校', '教材', '塾', 'スクール', '授業料', '学費', '教育', 'lo haco 教材'], confidenceBps: 9_000 },
  { categoryAliases: ['健康・医療', '医療', 'medical', 'y tế'], keywords: ['病院', 'クリニック', '薬局', '調剤', '歯科', '医療', 'pharmacy'], confidenceBps: 9_200 },
  { categoryAliases: ['税・社会保障', '税金・社会保険', '税金', 'tax', 'thuế'], keywords: ['税務', '税金', '都税', '県税', '市税', '年金', '社会保険', '国民健康保険'], confidenceBps: 9_500 },
  { categoryAliases: ['住居', '住宅', 'housing', 'nhà ở'], keywords: ['家賃', '賃料', '住宅ローン', '管理費', '不動産'], confidenceBps: 9_300 },
  { categoryAliases: ['保険', 'insurance', 'bảo hiểm'], keywords: ['生命保険', '損保', '保険料', '共済'], confidenceBps: 9_200 },
]

const corporateNoise = /(?:株式会社|有限会社|合同会社|（株）|\(株\)|㈱|co\.?[, ]*ltd\.?|inc\.?|corp(?:oration)?\.?)/giu
const branchNoise = /(?:本店|支店|店|店舗|オンラインストア|online store)$/giu

export function normalizeMerchant(value: string | null | undefined): string {
  return (value ?? '')
    .normalize('NFKC')
    .toLocaleLowerCase()
    .replace(corporateNoise, '')
    .replace(/(?:visa|mastercard|jcb|paypay|楽天カード|カード利用)[\s:_-]*/giu, '')
    .replace(/[0-9０-９]{4,}/gu, '')
    .replace(/[\s\p{P}\p{S}]+/gu, '')
    .replace(branchNoise, '')
    .trim()
}

function merchantSimilarity(left: string, right: string): number {
  if (!left || !right) return 0
  if (left === right) return 1
  const shortest = Math.min(left.length, right.length)
  if (shortest >= 4 && (left.includes(right) || right.includes(left))) return 0.82
  const leftPairs = new Set(Array.from({ length: Math.max(0, left.length - 1) }, (_, index) => left.slice(index, index + 2)))
  const rightPairs = new Set(Array.from({ length: Math.max(0, right.length - 1) }, (_, index) => right.slice(index, index + 2)))
  if (leftPairs.size === 0 || rightPairs.size === 0) return 0
  const overlap = [...leftPairs].filter((pair) => rightPairs.has(pair)).length
  return (2 * overlap) / (leftPairs.size + rightPairs.size)
}

function expenseAccounts(accounts: readonly AccountDto[]): readonly AccountDto[] {
  return accounts.filter((account) => account.accountKind === 'EXPENSE')
}

function historySuggestion(input: SuggestionInput, history: readonly TransactionRowDto[], accounts: readonly AccountDto[]): LocalCategorySuggestion | null {
  const merchant = normalizeMerchant(input.merchant?.trim() || input.description)
  if (!merchant) return null
  const validAccounts = new Map(expenseAccounts(accounts).map((account) => [account.id, account]))
  const scores = new Map<string, { score: number; samples: number; exact: number; amounts: number[] }>()
  history.forEach((row, index) => {
    if (!row.categoryAccountId || !validAccounts.has(row.categoryAccountId) || !['EXPENSE', 'CARD_PURCHASE', 'REFUND'].includes(row.transactionType)) return
    const similarity = merchantSimilarity(merchant, normalizeMerchant(row.payee?.trim() || row.description))
    if (similarity < 0.62) return
    const recencyWeight = index < 20 ? 1.15 : index < 60 ? 1.05 : 1
    const current = scores.get(row.categoryAccountId) ?? { score: 0, samples: 0, exact: 0, amounts: [] }
    current.score += similarity * recencyWeight
    current.samples += 1
    current.amounts.push(Math.abs(row.amountJpy))
    if (similarity === 1) current.exact += 1
    scores.set(row.categoryAccountId, current)
  })
  const ranked = [...scores.entries()].sort(([, left], [, right]) => right.score - left.score)
  const [winnerId, winner] = ranked[0] ?? []
  if (!winnerId || !winner) return null
  const totalScore = ranked.reduce((sum, [, value]) => sum + value.score, 0)
  const share = totalScore > 0 ? winner.score / totalScore : 0
  if (share < 0.55 || (winner.samples < 2 && winner.exact === 0)) return null
  const account = validAccounts.get(winnerId)!
  const sortedAmounts = [...winner.amounts].sort((left, right) => left - right)
  const medianAmount = sortedAmounts[Math.floor(sortedAmounts.length / 2)] ?? 0
  const candidateAmount = Math.abs(input.amountJpy ?? 0)
  const amountRatio = candidateAmount > 0 && medianAmount > 0 ? candidateAmount / medianAmount : 1
  const amountConsistent = amountRatio >= 0.125 && amountRatio <= 8
  const confidenceBps = Math.min(9_800, Math.round(5_300 + share * 2_700 + Math.min(winner.samples, 10) * 130 + Math.min(winner.exact, 4) * 180 - (amountConsistent ? 0 : 700)))
  return {
    categoryAccountId: account.id,
    categoryName: account.name,
    confidenceBps,
    source: 'HISTORY',
    sampleCount: winner.samples,
    historySharePercent: Math.round(share * 100),
    matchedKeyword: null,
    amountConsistent,
  }
}

function keywordSuggestion(input: SuggestionInput, accounts: readonly AccountDto[]): LocalCategorySuggestion | null {
  const haystack = `${input.merchant ?? ''} ${input.description ?? ''}`.normalize('NFKC').toLocaleLowerCase()
  if (!haystack.trim()) return null
  const categories = expenseAccounts(accounts)
  const matches = keywordCategories.flatMap((mapping) => {
    const keywords = mapping.keywords.filter((candidate) => haystack.includes(candidate.toLocaleLowerCase()))
    const account = categories.find((candidate) => {
      const name = candidate.name.normalize('NFKC').toLocaleLowerCase()
      return mapping.categoryAliases.some((alias) => name.includes(alias.toLocaleLowerCase()) || alias.toLocaleLowerCase().includes(name))
    })
    if (!account) return []
    return keywords.map((keyword) => ({ mapping, keyword, account }))
  }).sort((left, right) => right.mapping.confidenceBps - left.mapping.confidenceBps || right.keyword.length - left.keyword.length)
  const winner = matches[0]
  if (!winner) return null
  return {
    categoryAccountId: winner.account.id,
    categoryName: winner.account.name,
    confidenceBps: winner.mapping.confidenceBps,
    source: 'KEYWORD',
    sampleCount: 0,
    historySharePercent: null,
    matchedKeyword: winner.keyword,
    amountConsistent: null,
  }
}

export function suggestLocalCategory(input: SuggestionInput, history: readonly TransactionRowDto[], accounts: readonly AccountDto[]): LocalCategorySuggestion | null {
  if (!['EXPENSE', 'CARD_PURCHASE', 'REFUND'].includes(input.transactionType)) return null
  return historySuggestion(input, history, accounts) ?? keywordSuggestion(input, accounts)
}

export const HIGH_CONFIDENCE_CATEGORY_BPS = 9_200
