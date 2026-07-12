export const fixedCostReviewFixture = {
  asOf: '2026-07-13', historyFrom: '2026-01-01', historyThrough: '2026-06-30',
  monthlyPoints: [9000, 10000, 11000, 12000, 13000, 14000].map((totalJpy, index) => ({ month: `2026-${String(index + 1).padStart(2, '0')}`, totalJpy, recurringPayeeCount: 1, transactionCount: 1 })),
  segments: [{ segment: 'MOBILE', monthlyPoints: [9000, 10000, 11000, 12000, 13000, 14000].map((totalJpy, index) => ({ month: `2026-${String(index + 1).padStart(2, '0')}`, totalJpy, recurringPayeeCount: 1, transactionCount: 1 })), recentThreeAverageJpy: 13000, previousThreeAverageJpy: 10000, changeJpy: 3000, changeRateBps: 3000, annualizedJpy: 156000, recurringPayeeCount: 1, transactionCount: 6, latestPaymentOn: '2026-06-20', topPayees: [{ normalizedPayee: 'mobile', displayPayee: 'Mobile Co', expenseCategoryNames: ['通信費'], cadence: 'MONTHLY', typicalAmountJpy: 13000, latestAmountJpy: 14000, latestPaymentOn: '2026-06-20', occurrenceCount: 6, confidenceBps: 9600, reasons: ['毎月の支払い'] }], reasons: ['直近3か月平均が増加'] }],
  totals: { recentThreeAverageJpy: 13000, previousThreeAverageJpy: 10000, changeJpy: 3000, changeRateBps: 3000, annualizedJpy: 156000, recurringPayeeCount: 1, transactionCount: 6 },
  coverage: { completeMonthCount: 6, observedMonthCount: 12, confirmedTransactionCount: 100, recurringTransactionCount: 6, unclassifiedRecurringPayeeCount: 0 },
  limitations: ['確定済みの取引だけを対象にしています。'],
}
