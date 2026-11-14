import 'fake-indexeddb/auto'
import { readFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'

const argonMock = vi.hoisted(() => ({
  derive: vi.fn(async (passphrase: Uint8Array, salt: Uint8Array) => {
    const output = new Uint8Array(32)
    for (let index = 0; index < output.length; index += 1) {
      output[index] = passphrase[index % passphrase.length] ^ salt[index % salt.length] ^ index
    }
    return output
  }),
}))

vi.mock('./argonWorker', () => ({ deriveArgon2idInWorker: argonMock.derive }))

import { PwaLedgerClient } from './client'
import type { PostingEntry, TransactionType } from './types'

const passphrase = 'correct horse battery staple'
const originalFetch = globalThis.fetch
const receiptBytes = new TextEncoder().encode('synthetic receipt image bytes')
const balancedEntries: PostingEntry[] = [
  { id: 'entry-debit', accountId: 'expense', side: 'DEBIT', amountJpy: 1_000 },
  { id: 'entry-credit', accountId: 'cash', side: 'CREDIT', amountJpy: 1_000 },
]

async function configuredClient(name: string) {
  const client = await PwaLedgerClient.createVault(name, passphrase, {
    vaultId: 'vault-1',
    evidence: { getDirectory: undefined },
  })
  await client.createHousehold({ id: 'household-1', name: 'Synthetic household' })
  await client.createAccount({
    id: 'cash',
    householdId: 'household-1',
    name: 'Cash',
    kind: 'ASSET',
  })
  await client.createAccount({
    id: 'expense',
    householdId: 'household-1',
    name: 'Groceries',
    kind: 'EXPENSE',
  })
  return client
}

async function stageReceipt(client: PwaLedgerClient) {
  return client.stageReceipt({
    sourceId: 'source-1',
    candidateId: 'candidate-1',
    householdId: 'household-1',
    originalFilename: 'synthetic-receipt.png',
    mediaType: 'image/png',
    bytes: receiptBytes,
    occurredOn: '2026-08-24',
    payee: 'Synthetic Market',
    amountJpy: 1_000,
    ocrConfidenceBps: 9_800,
    provenance: [{ field: 'amountJpy', page: 1, region: [10, 20, 30, 40] }],
  })
}

async function simpleClient(name: string, now?: () => Date) {
  const client = await PwaLedgerClient.createVault(name, passphrase, {
    vaultId: 'vault-1',
    evidence: { getDirectory: undefined },
    now,
  })
  await client.createHousehold({ id: 'household-1', name: 'Synthetic household' })
  const accounts = [
    ['cash', 'Cash', 'ASSET'],
    ['bank', 'Bank', 'ASSET'],
    ['card', 'Card', 'LIABILITY'],
    ['salary', 'Salary', 'INCOME'],
    ['interest', 'Interest', 'INCOME'],
    ['groceries', 'Groceries', 'EXPENSE'],
    ['utilities', 'Utilities', 'EXPENSE'],
    ['fees', 'Bank fees', 'EXPENSE'],
    ['transport', 'Transport', 'EXPENSE'],
  ] as const
  for (const [id, accountName, kind] of accounts) {
    await client.createAccount({ id, householdId: 'household-1', name: accountName, kind })
  }
  return client
}

async function post(
  client: PwaLedgerClient,
  id: string,
  occurredOn: string,
  transactionType: TransactionType,
  amountJpy: number,
  debitAccountId: string,
  creditAccountId: string,
) {
  return client.createManualTransaction({
    id,
    householdId: 'household-1',
    occurredOn,
    transactionType,
    payee: `Payee ${id}`,
    amountJpy,
    entries: [
      { id: `${id}-debit`, accountId: debitAccountId, side: 'DEBIT', amountJpy },
      { id: `${id}-credit`, accountId: creditAccountId, side: 'CREDIT', amountJpy },
    ],
  })
}

function steppingClock() {
  let tick = 0
  return () => new Date(Date.UTC(2026, 10, 14, 0, 0, tick++))
}

describe('authoritative PWA ledger client', () => {
  beforeAll(() => {
    vi.stubGlobal('fetch', async (input: RequestInfo | URL) => {
      if (String(input).endsWith('kakeflow_core_bg.wasm')) {
        const bytes = await readFile(resolve('src/platform/pwa/core-wasm/kakeflow_core_bg.wasm'))
        return new Response(bytes, { headers: { 'Content-Type': 'application/wasm' } })
      }
      return originalFetch(input)
    })
  })

  afterAll(() => {
    vi.unstubAllGlobals()
  })

  it('persists household and account setup without synthetic defaults', async () => {
    const client = await configuredClient('client-setup')

    await expect(client.listHouseholds()).resolves.toEqual([{
      id: 'household-1',
      name: 'Synthetic household',
      baseCurrency: 'JPY',
    }])
    await expect(client.listAccounts('household-1')).resolves.toHaveLength(2)
  })

  it('posts a balanced manual transaction through the shared WASM core', async () => {
    const client = await configuredClient('client-manual')

    const transaction = await client.createManualTransaction({
      id: 'manual-transaction-1',
      householdId: 'household-1',
      occurredOn: '2026-08-24',
      transactionType: 'EXPENSE',
      payee: 'Manual Market',
      amountJpy: 1_000,
      entries: balancedEntries,
    })

    expect(transaction.canonicalPostingHash).toMatch(/^[a-f0-9]{64}$/u)
    await expect(client.listTransactions('household-1')).resolves.toHaveLength(1)
  })

  it('stages encrypted receipt evidence without posting before approval', async () => {
    const client = await configuredClient('client-stage')
    const candidate = await stageReceipt(client)

    expect(candidate.status).toBe('CANDIDATE')
    expect(candidate.explicitlyApproved).toBe(false)
    await expect(client.listTransactions('household-1')).resolves.toEqual([])
    const evidence = await client.sourceEvidenceForCandidate(candidate.id)
    expect([...evidence.bytes]).toEqual([...receiptBytes])
  })

  it('rejects an unbalanced approval with no partial candidate or ledger state', async () => {
    const client = await configuredClient('client-unbalanced')
    await stageReceipt(client)
    const revisionBefore = await client.revision()

    await expect(client.approveCandidate({
      candidateId: 'candidate-1',
      transactionId: 'transaction-1',
      transactionType: 'EXPENSE',
      entries: balancedEntries.map((entry) => (
        entry.side === 'CREDIT' ? { ...entry, amountJpy: 999 } : entry
      )),
    })).rejects.toThrow('UNBALANCED_JOURNAL')

    expect((await client.listCandidates('household-1'))[0]).toMatchObject({
      status: 'CANDIDATE',
      explicitlyApproved: false,
    })
    expect(await client.listTransactions('household-1')).toEqual([])
    expect(await client.revision()).toBe(revisionBefore)
  })

  it('atomically approves, posts, updates dashboard, and retains provenance', async () => {
    const client = await configuredClient('client-approval')
    await stageReceipt(client)

    const transaction = await client.approveCandidate({
      candidateId: 'candidate-1',
      transactionId: 'transaction-1',
      transactionType: 'EXPENSE',
      entries: balancedEntries,
    })

    expect(transaction.canonicalPostingHash).toBe(
      'c190a870d36257f86f3e473bdfb77f085d5c21a171332025ff04460392ee484f',
    )
    expect((await client.listCandidates('household-1'))[0]).toMatchObject({
      status: 'POSTED',
      explicitlyApproved: true,
      transactionId: 'transaction-1',
    })
    await expect(client.dashboard('household-1')).resolves.toMatchObject({
      expenseJpy: 1_000,
      incomeJpy: 0,
      transactionCount: 1,
    })
    const detail = await client.transactionDetail('transaction-1')
    expect(detail.entries).toEqual(balancedEntries)
    expect(detail.provenance).toMatchObject({ sourceId: 'source-1', manual: false })
    expect((await client.sourceEvidence('transaction-1')).bytes).toEqual(
      expect.any(Uint8Array),
    )
  })

  it('deduplicates the same immutable source hash without another event', async () => {
    const client = await configuredClient('client-duplicate-source')
    const first = await stageReceipt(client)
    const revision = await client.revision()
    const repeated = await stageReceipt(client)

    expect(repeated.id).toBe(first.id)
    expect(await client.listCandidates('household-1')).toHaveLength(1)
    expect(await client.revision()).toBe(revision)
  })

  it('projects exactly one account-independent manual source with the current pending receipt count', async () => {
    const client = await PwaLedgerClient.createVault('client-manual-source', passphrase, {
      vaultId: 'vault-1',
      evidence: { getDirectory: undefined },
    })
    await client.createHousehold({ id: 'household-1', name: 'Synthetic household' })

    await expect(client.listConnectorSummaries('household-1')).resolves.toEqual([{
      schemaVersion: 1,
      connectorKind: 'MANUAL_IMPORT',
      connectionKey: 'manual-import',
      displayLabel: 'Manual import',
      availability: 'AVAILABLE',
      lifecycle: 'CONNECTED',
      health: 'MANUAL',
      capabilities: ['IMPORT_FILE'],
      lastAttemptAt: null,
      lastSuccessAt: null,
      freshnessDeadlineAt: null,
      nextDueAt: null,
      pendingReviewCount: 0,
      consecutiveFailures: 0,
      lastErrorCode: null,
      bindingSummary: null,
      configurationDestination: 'IMPORT_INBOX',
    }])

    await stageReceipt(client)
    await expect(client.listConnectorSummaries('household-1')).resolves.toEqual([
      expect.objectContaining({
        connectorKind: 'MANUAL_IMPORT',
        capabilities: ['IMPORT_FILE'],
        pendingReviewCount: 1,
      }),
    ])
  })

  it('rejects every read and write after the local vault is locked', async () => {
    const client = await configuredClient('client-lock')
    client.lock()

    await expect(client.listHouseholds()).rejects.toThrow('Vault is locked')
    await expect(client.createHousehold({ id: 'other', name: 'Other' })).rejects.toThrow(
      'Vault is locked',
    )
  })
  describe('account subtypes', () => {
    it('stores no subtype by default, accepts a valid one and rejects an invalid one', async () => {
      const client = await configuredClient('client-subtype')

      expect((await client.listAccounts('household-1')).find((account) => account.id === 'cash'))
        .not.toHaveProperty('subtype')
      await expect(client.createAccount({
        id: 'wallet',
        householdId: 'household-1',
        name: 'Wallet',
        kind: 'ASSET',
        subtype: 'WALLET',
      })).resolves.toMatchObject({ subtype: 'WALLET' })
      expect((await client.listAccounts('household-1')).find((account) => account.id === 'wallet'))
        .toMatchObject({ subtype: 'WALLET' })
      await expect(client.createAccount({
        id: 'odd',
        householdId: 'household-1',
        name: 'Odd',
        kind: 'ASSET',
        subtype: 'SAFE' as never,
      })).rejects.toThrow('Invalid account subtype')
    })
  })

  describe('monthly dashboard', () => {
    it('applies the accrual rules and buckets by the occurredOn month', async () => {
      const client = await simpleClient('client-monthly')
      await post(client, 't-expense', '2026-11-01', 'EXPENSE', 1_000, 'groceries', 'cash')
      await post(client, 't-card', '2026-11-15', 'CARD_PURCHASE', 3_000, 'utilities', 'card')
      await post(client, 't-fee', '2026-11-20', 'FEE', 200, 'fees', 'bank')
      await post(client, 't-refund', '2026-11-21', 'REFUND', 400, 'cash', 'groceries')
      await post(client, 't-income', '2026-11-25', 'INCOME', 250_000, 'bank', 'salary')
      await post(client, 't-interest', '2026-11-26', 'INTEREST', 5, 'bank', 'interest')
      await post(client, 't-transfer', '2026-11-27', 'TRANSFER', 10_000, 'cash', 'bank')
      await post(client, 't-payment', '2026-11-28', 'CARD_PAYMENT', 3_000, 'card', 'bank')
      await post(client, 't-october', '2026-10-31', 'EXPENSE', 700, 'groceries', 'cash')

      await expect(client.monthlyDashboard('household-1', '2026-11')).resolves.toEqual({
        householdId: 'household-1',
        month: '2026-11',
        incomeJpy: 250_005,
        expenseJpy: 3_800,
        expenseCategories: [
          { accountId: 'utilities', name: 'Utilities', amountJpy: 3_000 },
          { accountId: 'groceries', name: 'Groceries', amountJpy: 600 },
          { accountId: 'fees', name: 'Bank fees', amountJpy: 200 },
        ],
      })
      await expect(client.monthlyDashboard('household-1', '2026-10')).resolves.toEqual({
        householdId: 'household-1',
        month: '2026-10',
        incomeJpy: 0,
        expenseJpy: 700,
        expenseCategories: [{ accountId: 'groceries', name: 'Groceries', amountJpy: 700 }],
      })
    })

    it('omits categories whose month net is zero', async () => {
      const client = await simpleClient('client-monthly-zero')
      await post(client, 't-spend', '2026-12-01', 'EXPENSE', 50, 'groceries', 'cash')
      await post(client, 't-back', '2026-12-02', 'REFUND', 50, 'cash', 'groceries')

      await expect(client.monthlyDashboard('household-1', '2026-12')).resolves.toMatchObject({
        expenseJpy: 0,
        expenseCategories: [],
      })
    })

    it('counts an expense without expense-account entries in the total but in no category', async () => {
      const client = await simpleClient('client-monthly-ill-formed')
      await post(client, 't-odd', '2027-01-10', 'EXPENSE', 900, 'bank', 'cash')

      await expect(client.monthlyDashboard('household-1', '2027-01')).resolves.toMatchObject({
        expenseJpy: 900,
        expenseCategories: [],
      })
    })

    it('clamps a category at zero when a refund exceeds that month spending', async () => {
      const client = await simpleClient('client-monthly-clamp')
      await post(client, 't-january', '2027-01-10', 'EXPENSE', 300, 'groceries', 'cash')
      await post(client, 't-late-refund', '2027-02-03', 'REFUND', 300, 'cash', 'groceries')

      await expect(client.monthlyDashboard('household-1', '2027-02')).resolves.toMatchObject({
        expenseJpy: -300,
        expenseCategories: [],
      })
    })

    it('rejects an invalid month or an unknown household', async () => {
      const client = await simpleClient('client-monthly-invalid')

      await expect(client.monthlyDashboard('household-1', '2026-13')).rejects.toThrow('Invalid month')
      await expect(client.monthlyDashboard('household-1', '26-11')).rejects.toThrow('Invalid month')
      await expect(client.monthlyDashboard('nobody', '2026-11')).rejects.toThrow('Unknown household')
    })
  })

  describe('budgets', () => {
    it('lists a budgeted category with its month actual and remaining amount', async () => {
      const client = await simpleClient('client-budget')
      await post(client, 't-1', '2026-11-03', 'EXPENSE', 1_200, 'groceries', 'cash')
      await post(client, 't-2', '2026-10-31', 'EXPENSE', 700, 'groceries', 'cash')

      await expect(client.upsertBudget({
        householdId: 'household-1',
        month: '2026-11',
        categoryAccountId: 'groceries',
        budgetJpy: 5_000,
      })).resolves.toEqual({
        householdId: 'household-1',
        month: '2026-11',
        categoryAccountId: 'groceries',
        budgetJpy: 5_000,
      })
      await expect(client.listBudgets('household-1', '2026-11')).resolves.toEqual([{
        householdId: 'household-1',
        month: '2026-11',
        categoryAccountId: 'groceries',
        budgetJpy: 5_000,
        categoryName: 'Groceries',
        actualJpy: 1_200,
        remainingJpy: 3_800,
      }])
      await expect(client.listBudgets('household-1', '2026-10')).resolves.toEqual([])
    })

    it('overwrites on a second upsert, accepts zero and orders rows by category name', async () => {
      const client = await simpleClient('client-budget-overwrite')
      await post(client, 't-1', '2026-11-03', 'EXPENSE', 1_200, 'groceries', 'cash')
      const budget = { householdId: 'household-1', month: '2026-11' }
      await client.upsertBudget({ ...budget, categoryAccountId: 'utilities', budgetJpy: 0 })
      await client.upsertBudget({ ...budget, categoryAccountId: 'groceries', budgetJpy: 5_000 })
      await client.upsertBudget({ ...budget, categoryAccountId: 'groceries', budgetJpy: 1_000 })

      await expect(client.listBudgets('household-1', '2026-11')).resolves.toEqual([
        {
          ...budget,
          categoryAccountId: 'groceries',
          budgetJpy: 1_000,
          categoryName: 'Groceries',
          actualJpy: 1_200,
          remainingJpy: -200,
        },
        {
          ...budget,
          categoryAccountId: 'utilities',
          budgetJpy: 0,
          categoryName: 'Utilities',
          actualJpy: 0,
          remainingJpy: 0,
        },
      ])
    })

    it('rejects invalid amounts, months, categories and households without writing', async () => {
      const client = await simpleClient('client-budget-invalid')
      await client.createHousehold({ id: 'household-2', name: 'Other household' })
      await client.createAccount({
        id: 'other-food',
        householdId: 'household-2',
        name: 'Other food',
        kind: 'EXPENSE',
      })
      const valid = {
        householdId: 'household-1',
        month: '2026-11',
        categoryAccountId: 'groceries',
        budgetJpy: 1_000,
      }
      const revision = await client.revision()

      for (const budgetJpy of [-1, 1.5, 2 ** 53, Number.NaN]) {
        await expect(client.upsertBudget({ ...valid, budgetJpy })).rejects.toThrow('Invalid JPY amount')
      }
      for (const month of ['2026-13', '26-11', '2026-00', '2026-1']) {
        await expect(client.upsertBudget({ ...valid, month })).rejects.toThrow('Invalid month')
      }
      await expect(client.upsertBudget({ ...valid, categoryAccountId: 'missing' }))
        .rejects.toThrow('Unknown category account')
      await expect(client.upsertBudget({ ...valid, categoryAccountId: 'other-food' }))
        .rejects.toThrow('Unknown category account')
      await expect(client.upsertBudget({ ...valid, categoryAccountId: 'cash' }))
        .rejects.toThrow('Category account must be an EXPENSE account')
      await expect(client.upsertBudget({ ...valid, householdId: 'nobody' }))
        .rejects.toThrow('Unknown household')
      await expect(client.upsertBudget({ ...valid, categoryAccountId: 'a~b' }))
        .rejects.toThrow('Invalid category account ID')
      await expect(client.upsertBudget({ ...valid, householdId: 'a~b' }))
        .rejects.toThrow('Invalid household ID')
      expect(await client.revision()).toBe(revision)
      await expect(client.listBudgets('household-1', '2026-11')).resolves.toEqual([])
    })
  })

  describe('savings goals', () => {
    const goal = {
      id: 'goal-1',
      householdId: 'household-1',
      name: ' Summer trip ',
      targetJpy: 100_000,
      savedJpy: 0,
      targetDate: '2027-03-31',
    }

    it('creates and lists a goal that starts ACTIVE with clock timestamps', async () => {
      const client = await simpleClient('client-goal-create', steppingClock())

      const created = await client.createSavingsGoal(goal)

      expect(created).toEqual({
        ...goal,
        name: 'Summer trip',
        status: 'ACTIVE',
        createdAt: '2026-11-14T00:00:00.000Z',
        updatedAt: '2026-11-14T00:00:00.000Z',
      })
      await expect(client.listSavingsGoals('household-1')).resolves.toEqual([created])
      await expect(client.listSavingsGoals('household-2')).resolves.toEqual([])
    })

    it('updates only the given fields and updatedAt, completing a reached goal', async () => {
      const client = await simpleClient('client-goal-update', steppingClock())
      const created = await client.createSavingsGoal(goal)

      const saved = await client.updateSavingsGoal({ ...goal, savedJpy: 20_000 })
      expect(saved).toEqual({
        ...created,
        savedJpy: 20_000,
        updatedAt: '2026-11-14T00:00:01.000Z',
      })

      await expect(client.updateSavingsGoal({ ...goal, savedJpy: 100_000 }))
        .resolves.toMatchObject({ status: 'COMPLETED', savedJpy: 100_000 })
      await expect(client.updateSavingsGoal({ ...goal, savedJpy: 50_000 }))
        .resolves.toMatchObject({ status: 'COMPLETED', savedJpy: 50_000 })
      await expect(client.updateSavingsGoal({ ...goal, savedJpy: 100_000, status: 'CANCELLED' }))
        .resolves.toMatchObject({ status: 'CANCELLED' })
      await expect(client.updateSavingsGoal({ ...goal, status: 'ACTIVE' }))
        .resolves.toMatchObject({ status: 'ACTIVE', createdAt: created.createdAt })
      expect(await client.listSavingsGoals('household-1')).toHaveLength(1)
    })

    it('rejects invalid goals, duplicates and unknown ids without writing', async () => {
      const client = await simpleClient('client-goal-invalid', steppingClock())
      await client.createSavingsGoal(goal)
      const revision = await client.revision()

      await expect(client.createSavingsGoal({ ...goal, id: 'goal-2', targetJpy: 0, savedJpy: 10 }))
        .rejects.toThrow('Invalid JPY amount')
      await expect(client.createSavingsGoal({ ...goal, id: 'goal-2', savedJpy: -1 }))
        .rejects.toThrow('Invalid JPY amount')
      for (const targetDate of ['2027-02-30', '2027-13-01', '27-03-31', '']) {
        await expect(client.createSavingsGoal({ ...goal, id: 'goal-2', targetDate }))
          .rejects.toThrow('Invalid date')
      }
      await expect(client.createSavingsGoal({ ...goal, id: 'goal-2', name: '   ' }))
        .rejects.toThrow('Invalid goal name')
      await expect(client.createSavingsGoal({ ...goal, id: 'goal-2', householdId: 'nobody' }))
        .rejects.toThrow('Unknown household')
      await expect(client.createSavingsGoal(goal)).rejects.toThrow('Savings goal already exists')
      await expect(client.updateSavingsGoal({ ...goal, id: 'missing' }))
        .rejects.toThrow('Savings goal not found')
      await expect(client.updateSavingsGoal({ ...goal, name: '' })).rejects.toThrow('Invalid goal name')
      await expect(client.updateSavingsGoal({ ...goal, targetDate: '2027-04-31' }))
        .rejects.toThrow('Invalid date')
      await expect(client.updateSavingsGoal({ ...goal, targetJpy: 0, savedJpy: 5 }))
        .rejects.toThrow('Invalid JPY amount')
      await expect(client.updateSavingsGoal({ ...goal, status: 'PAUSED' as never }))
        .rejects.toThrow('Invalid goal status')
      expect(await client.revision()).toBe(revision)
    })
  })
})
