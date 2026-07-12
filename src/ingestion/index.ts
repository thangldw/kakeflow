export * from './types'
export * from './csv'
export * from './normalize'
export { japaneseBankAdapter } from './adapters/japaneseBank'
export { payPayAdapter } from './adapters/paypay'
export { amazonMastercardAdapter } from './adapters/amazonMastercard'
export { rakutenEnaviAdapter } from './adapters/rakuten'
export { securitiesAssetSnapshotAdapter } from './adapters/securitiesAssetSnapshot'
export { japaneseBrokerageTransactionsAdapter } from './adapters/japaneseBrokerageTransactions'
export { moneyForwardAssetTrendAdapter } from './adapters/moneyForwardAssetTrend'
export * from './adapters/customDelimited'

import { amazonMastercardAdapter } from './adapters/amazonMastercard'
import { japaneseBankAdapter } from './adapters/japaneseBank'
import { payPayAdapter } from './adapters/paypay'
import { rakutenEnaviAdapter } from './adapters/rakuten'
import { securitiesAssetSnapshotAdapter } from './adapters/securitiesAssetSnapshot'
import { japaneseBrokerageTransactionsAdapter } from './adapters/japaneseBrokerageTransactions'
import { moneyForwardAssetTrendAdapter } from './adapters/moneyForwardAssetTrend'
import type { ImportAdapter, ImportInput } from './types'

export const importAdapters = [
  japaneseBankAdapter,
  payPayAdapter,
  amazonMastercardAdapter,
  rakutenEnaviAdapter,
  securitiesAssetSnapshotAdapter,
  japaneseBrokerageTransactionsAdapter,
  moneyForwardAssetTrendAdapter,
] as const

export function detectImportAdapter(input: ImportInput): { adapter: ImportAdapter<unknown>; score: number } | null {
  const ranked = importAdapters
    .map((adapter) => ({ adapter: adapter as ImportAdapter<unknown>, score: adapter.detect(input).score }))
    .sort((left, right) => right.score - left.score)
  return ranked[0] && ranked[0].score >= 0.5 ? ranked[0] : null
}
