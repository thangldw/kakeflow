export * from './types'
export * from './csv'
export * from './normalize'
export { japaneseBankAdapter } from './adapters/japaneseBank'
export { yuchoDirectAdapter } from './adapters/yuchoDirect'
export { payPayAdapter } from './adapters/paypay'
export { amazonMastercardAdapter } from './adapters/amazonMastercard'
export { rakutenEnaviAdapter } from './adapters/rakuten'
export { jcbMyJcbAdapter } from './adapters/jcbMyJcb'
export { smbcVpassAdapter } from './adapters/smbcVpass'
export { securitiesAssetSnapshotAdapter } from './adapters/securitiesAssetSnapshot'
export { sbiSecuritiesTradeHistoryAdapter } from './adapters/sbiSecuritiesTradeHistory'
export { japaneseBrokerageTransactionsAdapter } from './adapters/japaneseBrokerageTransactions'
export { moneyForwardAssetTrendAdapter } from './adapters/moneyForwardAssetTrend'
export { moneyForwardHouseholdLedgerAdapter } from './adapters/moneyForwardHouseholdLedger'
export * from './adapters/customDelimited'

import { amazonMastercardAdapter } from './adapters/amazonMastercard'
import { japaneseBankAdapter } from './adapters/japaneseBank'
import { yuchoDirectAdapter } from './adapters/yuchoDirect'
import { payPayAdapter } from './adapters/paypay'
import { rakutenEnaviAdapter } from './adapters/rakuten'
import { jcbMyJcbAdapter } from './adapters/jcbMyJcb'
import { smbcVpassAdapter } from './adapters/smbcVpass'
import { securitiesAssetSnapshotAdapter } from './adapters/securitiesAssetSnapshot'
import { sbiSecuritiesTradeHistoryAdapter } from './adapters/sbiSecuritiesTradeHistory'
import { japaneseBrokerageTransactionsAdapter } from './adapters/japaneseBrokerageTransactions'
import { moneyForwardAssetTrendAdapter } from './adapters/moneyForwardAssetTrend'
import { moneyForwardHouseholdLedgerAdapter } from './adapters/moneyForwardHouseholdLedger'
import type { ImportAdapter, ImportInput } from './types'

export const importAdapters = [
  yuchoDirectAdapter,
  japaneseBankAdapter,
  payPayAdapter,
  amazonMastercardAdapter,
  rakutenEnaviAdapter,
  jcbMyJcbAdapter,
  smbcVpassAdapter,
  securitiesAssetSnapshotAdapter,
  sbiSecuritiesTradeHistoryAdapter,
  japaneseBrokerageTransactionsAdapter,
  moneyForwardAssetTrendAdapter,
  moneyForwardHouseholdLedgerAdapter,
] as const

export function detectImportAdapter(input: ImportInput): { adapter: ImportAdapter<unknown>; score: number } | null {
  const ranked = importAdapters
    .map((adapter) => ({ adapter: adapter as ImportAdapter<unknown>, score: adapter.detect(input).score }))
    .sort((left, right) => right.score - left.score)
  return ranked[0] && ranked[0].score >= 0.5 ? ranked[0] : null
}
