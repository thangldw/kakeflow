import type { HomeClient } from '../features/simple/homeLoader'
import type { PwaLedgerClient } from '../platform/pwa/client'
import type { Account, SavingsGoal } from '../platform/pwa/types'
import type {
  AccountDto,
  CreateManualTransactionInputDto,
  DashboardMonthlyTotalsDto,
  DashboardRequestDto,
  MonthlyCategoryBudgetDto,
  SavingsGoalDto,
  TransactionRowDto,
  UpdateSavingsGoalInputDto,
} from '../platform/types'

/** What the Simple Home and the quick-add sheet need, served from the PWA vault. */
export type SimpleAdapter = HomeClient & {
  createManualTransaction(input: CreateManualTransactionInputDto): Promise<TransactionRowDto>
  listAccountDtos(): Promise<readonly AccountDto[]>
}

function accountDto(account: Account): AccountDto {
  const accountSubtype: AccountDto['accountSubtype'] =
    account.kind === 'ASSET' ? account.subtype ?? 'CASH'
      : account.kind === 'LIABILITY' ? account.subtype ?? 'CREDIT_CARD'
        : 'OTHER'
  // The PWA vault has no members: every account belongs to the household and is shared.
  return {
    id: account.id, name: account.name, accountKind: account.kind, accountSubtype, currency: 'JPY',
    ownershipKind: 'HOUSEHOLD', ownerMemberId: null, ownerMemberName: null, visibility: 'SHARED',
  }
}

function goalDto(goal: SavingsGoal): SavingsGoalDto {
  return {
    id: goal.id, householdId: goal.householdId, name: goal.name, targetJpy: goal.targetJpy, savedJpy: goal.savedJpy,
    targetDate: goal.targetDate, status: goal.status, createdAt: goal.createdAt, updatedAt: goal.updatedAt,
  }
}

/** The vault rejects a payee longer than this many UTF-16 code units. */
const PAYEE_MAX_UNITS = 512

/**
 * Safety net for the vault's payee limit (the quick-add note field is already capped well below it).
 * Cuts at 512 units and drops a high surrogate left alone at the end, so no character is split in half.
 */
function limitPayee(payee: string): string {
  if (payee.length <= PAYEE_MAX_UNITS) return payee
  const cut = payee.slice(0, PAYEE_MAX_UNITS)
  const last = cut.charCodeAt(cut.length - 1)
  return last >= 0xd800 && last <= 0xdbff ? cut.slice(0, -1) : cut
}

/** The single entry on `side`, or null when there are none or several. */
function soleEntry(input: CreateManualTransactionInputDto, side: 'DEBIT' | 'CREDIT') {
  const entries = input.entries.filter((entry) => entry.side === side)
  return entries.length === 1 ? entries[0] : null
}

export function createSimpleAdapter(client: PwaLedgerClient, householdId: string): SimpleAdapter {
  return {
    async listAccountDtos() {
      return (await client.listAccounts(householdId)).map(accountDto)
    },

    async listBudgets(requestHouseholdId, month): Promise<readonly MonthlyCategoryBudgetDto[]> {
      return (await client.listBudgets(requestHouseholdId, month)).map((row) => ({
        householdId: row.householdId, month: row.month, categoryAccountId: row.categoryAccountId, categoryName: row.categoryName,
        budgetJpy: row.budgetJpy, actualJpy: row.actualJpy, remainingJpy: row.remainingJpy,
      }))
    },

    // The PWA has no account groups, members or cash basis: the request's filters are ignored and the
    // figures are always the whole household on the accrual basis. Fields the Simple Home never reads
    // are zero or empty.
    async queryDashboard(request: DashboardRequestDto): Promise<DashboardMonthlyTotalsDto> {
      const month = await client.monthlyDashboard(request.householdId, request.month)
      return {
        month: request.month,
        accountingBasis: 'ACCRUAL',
        incomeJpy: month.incomeJpy,
        // A month whose refunds exceed its spending has a negative expense total. Passed on as is it would
        // raise "left to spend" above the budget total, so the Simple Home gets 0 instead.
        expenseJpy: Math.max(0, month.expenseJpy),
        savingsJpy: 0,
        postedTransactionCount: 0,
        netWorthAsOf: '',
        assetsJpy: 0,
        liabilitiesJpy: 0,
        netWorthJpy: 0,
        accrualTrend: [],
        cashFlowTrend: [],
        expenseCategories: month.expenseCategories.map((category) => ({ accountId: category.accountId, name: category.name, amountJpy: category.amountJpy })),
      }
    },

    async listSavingsGoals(requestHouseholdId) {
      return (await client.listSavingsGoals(requestHouseholdId)).map(goalDto)
    },

    async updateSavingsGoal(input: UpdateSavingsGoalInputDto) {
      const stored = (await client.listSavingsGoals(input.householdId)).find((goal) => goal.id === input.id)
      if (!stored) throw new Error('Savings goal not found')
      // The caller's status is not passed on (the vault has no PAUSED). A cancelled goal stays CANCELLED,
      // even at or above its target. Otherwise a goal below its target is ACTIVE, so lowering the saved
      // amount reopens a completed goal; at or above the target no status is sent and the vault marks the
      // goal COMPLETED.
      const status = stored.status === 'CANCELLED' ? 'CANCELLED' as const
        : input.savedJpy < input.targetJpy ? 'ACTIVE' as const
          : undefined
      return goalDto(await client.updateSavingsGoal({
        id: input.id, householdId: input.householdId, name: input.name, targetJpy: input.targetJpy,
        savedJpy: input.savedJpy, targetDate: input.targetDate, ...(status ? { status } : {}),
      }))
    },

    async createManualTransaction(input: CreateManualTransactionInputDto): Promise<TransactionRowDto> {
      const accounts = await client.listAccounts(householdId)
      const nameOf = (accountId: string | undefined) => accounts.find((account) => account.id === accountId)?.name ?? null
      const category = input.entries
        .map((entry) => accounts.find((account) => account.id === entry.accountId))
        .find((account) => account?.kind === 'EXPENSE' || account?.kind === 'INCOME')
      // The vault requires a payee. Quick add sends its note as the description; without a note the
      // category name stands in.
      const payee = limitPayee(input.payee?.trim() || input.description?.trim() || category?.name || '')
      const amountJpy = input.entries.filter((entry) => entry.side === 'DEBIT').reduce((total, entry) => total + entry.amountJpy, 0)
      const transaction = await client.createManualTransaction({
        id: input.id,
        householdId,
        occurredOn: input.occurredOn,
        transactionType: input.transactionType,
        payee,
        amountJpy,
        entries: input.entries.map((entry) => ({ id: entry.id, accountId: entry.accountId, side: entry.side, amountJpy: entry.amountJpy })),
      })
      const debit = soleEntry(input, 'DEBIT')
      const credit = soleEntry(input, 'CREDIT')
      return {
        id: transaction.id,
        occurredOn: transaction.occurredOn,
        postedOn: null,
        transactionType: transaction.transactionType,
        payee: transaction.payee,
        description: input.description,
        amountJpy: transaction.amountJpy,
        status: 'POSTED',
        calculationTarget: true,
        debitAccountId: debit?.accountId ?? null,
        debitAccountName: nameOf(debit?.accountId),
        creditAccountId: credit?.accountId ?? null,
        creditAccountName: nameOf(credit?.accountId),
        categoryAccountId: category?.id ?? null,
        categoryName: category?.name ?? null,
        attributionKind: 'HOUSEHOLD',
        attributedMemberId: null,
        attributedMemberName: null,
        audienceVisibility: 'SHARED',
        audienceMemberId: null,
        audienceMemberName: null,
        labels: [],
        tags: [],
      }
    },
  }
}
