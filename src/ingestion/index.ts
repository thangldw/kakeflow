export * from './types'
export * from './csv'
export * from './normalize'
export { japaneseBankAdapter } from './adapters/japaneseBank'
export { resonaWebMeisaiPlusAdapter } from './adapters/resonaWebMeisaiPlus'
export { personalJapaneseBankAdapter } from './adapters/personalJapaneseBank'
export { mufgBizstationAllDetailsAdapter } from './adapters/mufgBizstationAllDetails'
export { mufgBizstationDepositWithdrawalAdapter } from './adapters/mufgBizstationDepositWithdrawal'
export { yuchoDirectAdapter } from './adapters/yuchoDirect'
export { payPayAdapter } from './adapters/paypay'
export { payPayHistoryV2Adapter } from './adapters/paypayHistoryV2'
export { amazonMastercardAdapter } from './adapters/amazonMastercard'
export { rakutenEnaviAdapter } from './adapters/rakuten'
export { jcbMyJcbAdapter } from './adapters/jcbMyJcb'
export { smbcVpassAdapter } from './adapters/smbcVpass'
export { aeonCardAdapter } from './adapters/aeonCard'
export { payPayCardAdapter } from './adapters/paypayCard'
export { securitiesAssetSnapshotAdapter } from './adapters/securitiesAssetSnapshot'
export { sbiSecuritiesTradeHistoryAdapter } from './adapters/sbiSecuritiesTradeHistory'
export { rakutenSecuritiesDomesticTradeHistoryAdapter } from './adapters/rakutenSecuritiesDomesticTradeHistory'
export { monexUsStockTradeHistoryAdapter } from './adapters/monexUsStockTradeHistory'
export { japaneseBrokerageTransactionsAdapter } from './adapters/japaneseBrokerageTransactions'
export { moneyForwardAssetTrendAdapter } from './adapters/moneyForwardAssetTrend'
export { moneyForwardHouseholdLedgerAdapter } from './adapters/moneyForwardHouseholdLedger'
export * from './adapters/customDelimited'

import { amazonMastercardAdapter } from './adapters/amazonMastercard'
import { japaneseBankAdapter } from './adapters/japaneseBank'
import { resonaWebMeisaiPlusAdapter } from './adapters/resonaWebMeisaiPlus'
import { personalJapaneseBankAdapter } from './adapters/personalJapaneseBank'
import { mufgBizstationAllDetailsAdapter } from './adapters/mufgBizstationAllDetails'
import { mufgBizstationDepositWithdrawalAdapter } from './adapters/mufgBizstationDepositWithdrawal'
import { yuchoDirectAdapter } from './adapters/yuchoDirect'
import { payPayAdapter } from './adapters/paypay'
import { payPayHistoryV2Adapter } from './adapters/paypayHistoryV2'
import { rakutenEnaviAdapter } from './adapters/rakuten'
import { jcbMyJcbAdapter } from './adapters/jcbMyJcb'
import { smbcVpassAdapter } from './adapters/smbcVpass'
import { aeonCardAdapter } from './adapters/aeonCard'
import { payPayCardAdapter } from './adapters/paypayCard'
import { securitiesAssetSnapshotAdapter } from './adapters/securitiesAssetSnapshot'
import { sbiSecuritiesTradeHistoryAdapter } from './adapters/sbiSecuritiesTradeHistory'
import { rakutenSecuritiesDomesticTradeHistoryAdapter } from './adapters/rakutenSecuritiesDomesticTradeHistory'
import { monexUsStockTradeHistoryAdapter } from './adapters/monexUsStockTradeHistory'
import { japaneseBrokerageTransactionsAdapter } from './adapters/japaneseBrokerageTransactions'
import { moneyForwardAssetTrendAdapter } from './adapters/moneyForwardAssetTrend'
import { moneyForwardHouseholdLedgerAdapter } from './adapters/moneyForwardHouseholdLedger'
import type { ImportAdapter, ImportInput } from './types'

export const importAdapters = [
  resonaWebMeisaiPlusAdapter,
  mufgBizstationDepositWithdrawalAdapter,
  mufgBizstationAllDetailsAdapter,
  yuchoDirectAdapter,
  personalJapaneseBankAdapter,
  japaneseBankAdapter,
  payPayHistoryV2Adapter,
  payPayAdapter,
  amazonMastercardAdapter,
  rakutenEnaviAdapter,
  jcbMyJcbAdapter,
  smbcVpassAdapter,
  aeonCardAdapter,
  payPayCardAdapter,
  securitiesAssetSnapshotAdapter,
  sbiSecuritiesTradeHistoryAdapter,
  rakutenSecuritiesDomesticTradeHistoryAdapter,
  monexUsStockTradeHistoryAdapter,
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
