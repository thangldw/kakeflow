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
import { PwaVaultDatabase } from './database'
import {
  PasskeyCancelledError,
  PasskeyUnsupportedError,
  bytesToBase64Url,
  type PasskeyAuthenticator,
} from './passkey'
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

    it('returns no rows for a month without budgets without reading any transaction or account', async () => {
      const client = await simpleClient('client-budget-empty-month')
      await post(client, 't-1', '2026-11-03', 'EXPENSE', 1_200, 'groceries', 'cash')
      await client.upsertBudget({ householdId: 'household-1', month: '2026-11', categoryAccountId: 'groceries', budgetJpy: 5_000 })
      const listIds = vi.spyOn(PwaVaultDatabase.prototype, 'listProjectionIds')
      const read = vi.spyOn(PwaVaultDatabase.prototype, 'readProjection')
      try {
        await expect(client.listBudgets('household-1', '2026-10')).resolves.toEqual([])
        const types = [...listIds.mock.calls, ...read.mock.calls].map(([projectionType]) => projectionType)
        expect(types).not.toContain('TRANSACTION')
        expect(types).not.toContain('ACCOUNT')
      } finally {
        listIds.mockRestore()
        read.mockRestore()
      }
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

    it('copies a month in one write, keeps rows the target already has and is idempotent', async () => {
      const client = await simpleClient('client-budget-copy')
      await post(client, 't-1', '2026-11-03', 'EXPENSE', 1_200, 'groceries', 'cash')
      const october = { householdId: 'household-1', month: '2026-10' }
      await client.upsertBudget({ ...october, categoryAccountId: 'groceries', budgetJpy: 5_000 })
      await client.upsertBudget({ ...october, categoryAccountId: 'utilities', budgetJpy: 0 })
      await client.upsertBudget({ ...october, categoryAccountId: 'transport', budgetJpy: 3_000 })
      await client.upsertBudget({ householdId: 'household-1', month: '2026-11', categoryAccountId: 'transport', budgetJpy: 9_000 })
      // A stored row for a category that is not an expense account is never copied.
      const stray = { ...october, categoryAccountId: 'cash', budgetJpy: 7_000 }
      await (Reflect.get(client, 'database') as PwaVaultDatabase).appendPostingAtomically({
        expectedRevision: await client.revision(),
        events: [{ id: 'stray-budget', eventType: 'BUDGET_SET', payload: new TextEncoder().encode(JSON.stringify(stray)) }],
        projections: [{ projectionType: 'BUDGET', id: 'household-1~2026-10~cash', payload: new TextEncoder().encode(JSON.stringify(stray)) }],
      })
      const append = vi.spyOn(PwaVaultDatabase.prototype, 'appendPostingAtomically')
      try {
        const copied = await client.copyBudgets({ householdId: 'household-1', fromMonth: '2026-10', toMonth: '2026-11' })
        expect(append).toHaveBeenCalledTimes(1)
        expect(append.mock.calls[0][0].events).toHaveLength(2)
        expect(append.mock.calls[0][0].projections).toHaveLength(2)
        expect(copied).toEqual(await client.listBudgets('household-1', '2026-11'))
        expect(copied.map((row) => [row.categoryAccountId, row.budgetJpy, row.actualJpy])).toEqual([
          ['groceries', 5_000, 1_200],
          ['transport', 9_000, 0],
          ['utilities', 0, 0],
        ])

        const revision = await client.revision()
        await expect(client.copyBudgets({ householdId: 'household-1', fromMonth: '2026-10', toMonth: '2026-11' }))
          .resolves.toEqual(copied)
        await expect(client.copyBudgets({ householdId: 'household-1', fromMonth: '2026-01', toMonth: '2026-02' }))
          .resolves.toEqual([])
        expect(append).toHaveBeenCalledTimes(1)
        expect(await client.revision()).toBe(revision)
      } finally {
        append.mockRestore()
      }
    })

    it('does not overwrite a row another write adds to the target month while it copies', async () => {
      const client = await simpleClient('client-budget-copy-race')
      await client.upsertBudget({ householdId: 'household-1', month: '2026-10', categoryAccountId: 'groceries', budgetJpy: 5_000 })
      await client.upsertBudget({ householdId: 'household-1', month: '2026-10', categoryAccountId: 'utilities', budgetJpy: 2_000 })
      const listAccounts = client.listAccounts.bind(client)
      // The competing write lands after the copy has looked at the target month but before it writes.
      vi.spyOn(client, 'listAccounts').mockImplementationOnce(async (householdId) => {
        await client.upsertBudget({ householdId: 'household-1', month: '2026-11', categoryAccountId: 'groceries', budgetJpy: 9_000 })
        return listAccounts(householdId)
      })
      await expect(client.copyBudgets({ householdId: 'household-1', fromMonth: '2026-10', toMonth: '2026-11' }))
        .rejects.toThrow('Projection revision conflict')
      await expect(client.listBudgets('household-1', '2026-11')).resolves.toEqual([
        expect.objectContaining({ categoryAccountId: 'groceries', budgetJpy: 9_000 }),
      ])
      // The next attempt copies only what is still missing and keeps the other writer's value.
      const copied = await client.copyBudgets({ householdId: 'household-1', fromMonth: '2026-10', toMonth: '2026-11' })
      expect(copied.map((row) => [row.categoryAccountId, row.budgetJpy])).toEqual([
        ['groceries', 9_000],
        ['utilities', 2_000],
      ])
    })

    it('rejects invalid copies and writes nothing when the single write fails', async () => {
      const client = await simpleClient('client-budget-copy-invalid')
      await client.upsertBudget({ householdId: 'household-1', month: '2026-10', categoryAccountId: 'groceries', budgetJpy: 5_000 })
      await client.upsertBudget({ householdId: 'household-1', month: '2026-10', categoryAccountId: 'utilities', budgetJpy: 2_000 })
      const valid = { householdId: 'household-1', fromMonth: '2026-10', toMonth: '2026-11' }
      const revision = await client.revision()

      await expect(client.copyBudgets({ ...valid, toMonth: '2026-10' })).rejects.toThrow('Choose two different months')
      for (const month of ['2026-13', '26-11', '2026-00', '2026-1']) {
        await expect(client.copyBudgets({ ...valid, fromMonth: month })).rejects.toThrow('Invalid month')
        await expect(client.copyBudgets({ ...valid, toMonth: month })).rejects.toThrow('Invalid month')
      }
      await expect(client.copyBudgets({ ...valid, householdId: 'nobody' })).rejects.toThrow('Unknown household')
      await expect(client.copyBudgets({ ...valid, householdId: 'a~b' })).rejects.toThrow('Invalid household ID')

      const append = vi.spyOn(PwaVaultDatabase.prototype, 'appendPostingAtomically')
        .mockRejectedValueOnce(new DOMException('quota', 'QuotaExceededError'))
      try {
        await expect(client.copyBudgets(valid)).rejects.toMatchObject({ name: 'QuotaExceededError' })
      } finally {
        append.mockRestore()
      }
      expect(await client.revision()).toBe(revision)
      await expect(client.listBudgets('household-1', '2026-11')).resolves.toEqual([])
      await expect(client.copyBudgets(valid)).resolves.toHaveLength(2)
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

interface FakeAuthenticatorOptions {
  /** Secret that makes the PRF output differ between authenticators. */
  seed?: string
  createPrf?: 'ok' | 'none' | 'empty' | 'short'
  getPrf?: 'ok' | 'none' | 'empty' | 'short'
  idLength?: number
  /** Always return this credential id from `create`. */
  fixedId?: Uint8Array
  /** Awaited inside `create` before it answers, to hold a ceremony open. */
  createGate?: () => Promise<void>
  createError?: Error
  /** Chooses which allowed credential answers `get`; defaults to the first one. */
  pick?: (ids: readonly Uint8Array[]) => Uint8Array
}

/** A deterministic PRF authenticator: output = SHA-256(seed, credential id, salt). */
function fakeAuthenticator(options: FakeAuthenticatorOptions = {}) {
  let counter = 0
  const handedOut: Uint8Array[] = []
  /** Copies of the ceremony inputs, taken before the client zeroes its own arrays. */
  const seen: { userId?: Uint8Array; challenge: Uint8Array; prfSalt: Uint8Array }[] = []
  async function prf(mode: FakeAuthenticatorOptions['createPrf'], id: Uint8Array, salt: Uint8Array) {
    if (mode === 'none') return null
    if (mode === 'empty') return new Uint8Array(0)
    const seed = new TextEncoder().encode(options.seed ?? 'device-1')
    const input = new Uint8Array(seed.length + id.length + salt.length)
    input.set(seed)
    input.set(id, seed.length)
    input.set(salt, seed.length + id.length)
    const output = new Uint8Array(await crypto.subtle.digest('SHA-256', input))
    const result = mode === 'short' ? output.slice(0, 16) : output
    handedOut.push(result)
    return result
  }
  const create = vi.fn(async (input: Parameters<PasskeyAuthenticator['create']>[0]) => {
    seen.push({ userId: input.userId.slice(), challenge: input.challenge.slice(), prfSalt: input.prfSalt.slice() })
    if (options.createError) throw options.createError
    await options.createGate?.()
    counter += 1
    const id = options.fixedId ? options.fixedId.slice() : new Uint8Array(options.idLength ?? 16).fill(counter)
    if (!options.fixedId) id[id.length - 1] = counter * 7
    return { credentialId: id, prfOutput: await prf(options.createPrf ?? 'ok', id, input.prfSalt) }
  })
  const get = vi.fn(async (input: Parameters<PasskeyAuthenticator['get']>[0]) => {
    seen.push({ challenge: input.challenge.slice(), prfSalt: input.prfSalt.slice() })
    const id = new Uint8Array(options.pick ? options.pick(input.allowCredentialIds) : input.allowCredentialIds[0])
    return { credentialId: id, prfOutput: await prf(options.getPrf ?? 'ok', id, input.prfSalt) }
  })
  return { create, get, options, handedOut, seen } satisfies PasskeyAuthenticator & Record<string, unknown>
}

async function passkeyVault(name: string, now?: () => Date) {
  const client = await PwaLedgerClient.createVault(name, passphrase, {
    vaultId: `vault-${name}`,
    evidence: { getDirectory: undefined },
    now,
  })
  await client.createHousehold({ id: 'household-1', name: 'Passkey household' })
  return client
}

async function enable(client: PwaLedgerClient, authenticator: PasskeyAuthenticator, label?: string) {
  await client.verifyPassphrase(passphrase)
  await client.enablePasskey(passphrase, authenticator, label)
}

describe('passkeys', () => {
  const evidence = { getDirectory: undefined }

  it('enrols a passkey and unlocks the same data with it', async () => {
    const client = await passkeyVault('passkey-roundtrip')
    const authenticator = fakeAuthenticator()
    await enable(client, authenticator, 'This phone')
    client.close()

    expect(await PwaLedgerClient.readPasskeyCount('passkey-roundtrip')).toBe(1)
    const unlocked = await PwaLedgerClient.unlockWithPasskey('passkey-roundtrip', authenticator, { evidence })
    expect((await unlocked.listHouseholds())[0].name).toBe('Passkey household')
    const summaries = await unlocked.listPasskeys()
    expect(summaries).toHaveLength(1)
    expect(summaries[0].label).toBe('This phone')
    expect(Object.keys(summaries[0]).sort()).toEqual(['createdAt', 'credentialIdBase64Url', 'label'])
  })

  it('passes the hostname as rp id and fresh random user ids and challenges', async () => {
    const client = await passkeyVault('passkey-ceremony-input')
    const authenticator = fakeAuthenticator({ createPrf: 'none' })
    await enable(client, authenticator)
    await enable(client, authenticator)

    expect(authenticator.create.mock.calls.map(([input]) => input.rpId)).toEqual([location.hostname, location.hostname])
    expect(authenticator.get.mock.calls.map(([input]) => input.rpId)).toEqual([location.hostname, location.hostname])
    // seen: create 1, get 1, create 2, get 2.
    const [first, firstGet, second] = authenticator.seen
    expect(first.userId).toHaveLength(16)
    expect(first.challenge).toHaveLength(32)
    expect(first.prfSalt).toHaveLength(32)
    expect(firstGet.challenge).toHaveLength(32)
    expect([...first.userId!]).not.toEqual([...second.userId!])
    expect([...first.challenge]).not.toEqual([...second.challenge])
    expect([...first.challenge]).not.toEqual([...firstGet.challenge])
    expect([...first.prfSalt]).toEqual([...second.prfSalt])
    // The client zeroes the arrays it handed to the authenticator once the ceremony is over.
    const handed = authenticator.create.mock.calls[0][0]
    for (const bytes of [handed.userId, handed.challenge, handed.prfSalt]) {
      expect(bytes.every((byte) => byte === 0)).toBe(true)
    }
  })

  it('verifyPassphrase rejects a wrong passphrase', async () => {
    const client = await passkeyVault('passkey-verify-wrong')
    await expect(client.verifyPassphrase('wrong passphrase value')).rejects.toThrow('Vault authentication failed')
    await expect(client.verifyPassphrase(passphrase)).resolves.toBeUndefined()
  })

  it('never calls the authenticator without a verified matching passphrase', async () => {
    const client = await passkeyVault('passkey-unverified')
    const authenticator = fakeAuthenticator()

    await expect(client.enablePasskey(passphrase, authenticator)).rejects.toThrow('Passphrase not verified')
    await client.verifyPassphrase(passphrase)
    await expect(client.enablePasskey('a different passphrase', authenticator))
      .rejects.toThrow('Passphrase not verified')
    // A failed enablePasskey clears the marker, so the right passphrase now needs verifying again.
    await expect(client.enablePasskey(passphrase, authenticator)).rejects.toThrow('Passphrase not verified')

    expect(authenticator.create).not.toHaveBeenCalled()
    expect(authenticator.get).not.toHaveBeenCalled()
    expect(await client.listPasskeys()).toEqual([])
  })

  it('expires the verified passphrase after five minutes and after a successful enrolment', async () => {
    let time = Date.UTC(2026, 10, 15, 9, 0, 0)
    const client = await passkeyVault('passkey-marker-expiry', () => new Date(time))
    const authenticator = fakeAuthenticator()

    await client.verifyPassphrase(passphrase)
    time += 5 * 60 * 1000 + 1
    await expect(client.enablePasskey(passphrase, authenticator)).rejects.toThrow('Passphrase not verified')

    await client.verifyPassphrase(passphrase)
    time += 5 * 60 * 1000 - 1
    await client.enablePasskey(passphrase, authenticator)
    await expect(client.enablePasskey(passphrase, authenticator)).rejects.toThrow('Passphrase not verified')
    expect(authenticator.create).toHaveBeenCalledTimes(1)
  })

  it('stops with PasskeyUnsupportedError and stores nothing when no PRF output arrives', async () => {
    const client = await passkeyVault('passkey-no-prf')
    const authenticator = fakeAuthenticator({ createPrf: 'none', getPrf: 'none' })

    await client.verifyPassphrase(passphrase)
    await expect(client.enablePasskey(passphrase, authenticator)).rejects.toBeInstanceOf(PasskeyUnsupportedError)
    expect(authenticator.get).toHaveBeenCalledTimes(1)
    expect(await client.listPasskeys()).toEqual([])
    expect(await PwaLedgerClient.readPasskeyCount('passkey-no-prf')).toBe(0)
  })

  it.each(['empty', 'short'] as const)('treats a %s PRF output as no PRF', async (mode) => {
    const name = `passkey-prf-${mode}`
    const client = await passkeyVault(name)
    const authenticator = fakeAuthenticator({ createPrf: mode, getPrf: mode })

    await client.verifyPassphrase(passphrase)
    await expect(client.enablePasskey(passphrase, authenticator)).rejects.toBeInstanceOf(PasskeyUnsupportedError)
    expect(authenticator.get).toHaveBeenCalledTimes(1)
    expect(await PwaLedgerClient.readPasskeyCount(name)).toBe(0)
  })

  it('enrols through the second tap when PRF only comes back from get', async () => {
    const client = await passkeyVault('passkey-second-tap')
    const authenticator = fakeAuthenticator({ createPrf: 'none' })
    await enable(client, authenticator)

    const created = await authenticator.create.mock.results[0].value
    expect(authenticator.get).toHaveBeenCalledTimes(1)
    expect(authenticator.get.mock.calls[0][0].allowCredentialIds.map((id) => [...id]))
      .toEqual([[...created.credentialId]])
    client.close()
    const unlocked = await PwaLedgerClient.unlockWithPasskey('passkey-second-tap', authenticator, { evidence })
    expect((await unlocked.listHouseholds())).toHaveLength(1)
  })

  it('stores nothing when the ceremony is cancelled', async () => {
    const client = await passkeyVault('passkey-cancelled')
    const authenticator = fakeAuthenticator({ createError: new PasskeyCancelledError() })

    await client.verifyPassphrase(passphrase)
    await expect(client.enablePasskey(passphrase, authenticator)).rejects.toBeInstanceOf(PasskeyCancelledError)
    expect(await client.listPasskeys()).toEqual([])
  })

  it('zeroes the PRF output it was handed', async () => {
    const client = await passkeyVault('passkey-zeroing')
    const authenticator = fakeAuthenticator()
    await enable(client, authenticator)
    client.close()
    await PwaLedgerClient.unlockWithPasskey('passkey-zeroing', authenticator, { evidence })

    expect(authenticator.handedOut).toHaveLength(2)
    for (const output of authenticator.handedOut) expect(output.every((byte) => byte === 0)).toBe(true)
  })

  it('enrols and unlocks with a 1023-byte credential id', async () => {
    const client = await passkeyVault('passkey-long-id')
    const authenticator = fakeAuthenticator({ idLength: 1023 })
    await enable(client, authenticator)
    client.close()

    const unlocked = await PwaLedgerClient.unlockWithPasskey('passkey-long-id', authenticator, { evidence })
    expect((await unlocked.listPasskeys())[0].credentialIdBase64Url.length).toBe(1364)
  })

  it('allows at most three passkeys and excludes the stored ids at creation', async () => {
    const client = await passkeyVault('passkey-limit')
    const authenticator = fakeAuthenticator()
    await enable(client, authenticator)
    await enable(client, authenticator)
    await enable(client, authenticator)

    const stored = (await client.listPasskeys()).map((entry) => entry.credentialIdBase64Url)
    expect(new Set(stored).size).toBe(3)
    const excluded = authenticator.create.mock.calls.map(([input]) =>
      input.excludeCredentialIds.map((id) => bytesToBase64Url(id)))
    expect(excluded).toEqual([[], stored.slice(0, 1), stored.slice(0, 2)])
    const salts = authenticator.seen.map((input) => bytesToBase64Url(input.prfSalt))
    expect(new Set(salts).size).toBe(1)

    await client.verifyPassphrase(passphrase)
    await expect(client.enablePasskey(passphrase, authenticator)).rejects.toThrow('Passkey limit reached')
    expect(authenticator.create).toHaveBeenCalledTimes(3)
    expect(await PwaLedgerClient.readPasskeyCount('passkey-limit')).toBe(3)
  })

  it('removes one passkey and still unlocks with the other', async () => {
    const client = await passkeyVault('passkey-remove')
    const authenticator = fakeAuthenticator()
    await enable(client, authenticator, 'first')
    await enable(client, authenticator, 'second')
    const [first, second] = await client.listPasskeys()

    await client.removePasskey(first.credentialIdBase64Url)
    expect(await client.listPasskeys()).toEqual([second])
    await expect(client.removePasskey(first.credentialIdBase64Url)).rejects.toThrow('Passkey not found')
    client.close()

    authenticator.options.pick = (ids) => ids[0]
    const unlocked = await PwaLedgerClient.unlockWithPasskey('passkey-remove', authenticator, { evidence })
    expect(authenticator.get.mock.calls.at(-1)?.[0].allowCredentialIds.map((id) => bytesToBase64Url(id)))
      .toEqual([second.credentialIdBase64Url])
    await unlocked.removePasskey(second.credentialIdBase64Url)
    expect(await PwaLedgerClient.readPasskeyCount('passkey-remove')).toBe(0)
    unlocked.close()
    await expect(PwaLedgerClient.unlockWithPasskey('passkey-remove', authenticator, { evidence }))
      .rejects.toThrow('Vault authentication failed')
  })

  it('keeps passphrase unlock working in every state', async () => {
    const name = 'passkey-passphrase-still-works'
    const authenticator = fakeAuthenticator()
    const reopen = async () => {
      const reopened = await PwaLedgerClient.unlock(name, passphrase, { evidence })
      expect((await reopened.listHouseholds())[0].name).toBe('Passkey household')
      return reopened
    }
    const client = await passkeyVault(name)
    client.close()
    let current = await reopen()
    for (let index = 0; index < 3; index += 1) {
      await enable(current, authenticator)
      current.close()
      current = await reopen()
    }
    for (const entry of await current.listPasskeys()) {
      await current.removePasskey(entry.credentialIdBase64Url)
      current.close()
      current = await reopen()
    }
    await expect(PwaLedgerClient.unlock(name, 'wrong passphrase value', { evidence }))
      .rejects.toThrow('Vault authentication failed')
  })

  it('fails with the same error for every unlock failure except a cancel', async () => {
    const name = 'passkey-unlock-failures'
    const client = await passkeyVault(name)
    const authenticator = fakeAuthenticator()
    await enable(client, authenticator)
    client.close()
    const failed = 'Vault authentication failed'

    await expect(PwaLedgerClient.unlockWithPasskey('passkey-never-created', authenticator, { evidence }))
      .rejects.toThrow(failed)
    await expect(PwaLedgerClient.unlockWithPasskey(name, fakeAuthenticator({ seed: 'other device' }), { evidence }))
      .rejects.toThrow(failed)
    for (const getPrf of ['none', 'empty', 'short'] as const) {
      await expect(PwaLedgerClient.unlockWithPasskey(name, fakeAuthenticator({ getPrf }), { evidence }))
        .rejects.toThrow(failed)
    }
    await expect(PwaLedgerClient.unlockWithPasskey(name, fakeAuthenticator({
      pick: () => new Uint8Array([9, 9, 9]),
    }), { evidence })).rejects.toThrow(failed)
    const cancelling: PasskeyAuthenticator = {
      create: authenticator.create,
      get: async () => { throw new PasskeyCancelledError() },
    }
    await expect(PwaLedgerClient.unlockWithPasskey(name, cancelling, { evidence }))
      .rejects.toBeInstanceOf(PasskeyCancelledError)
    const unlocked = await PwaLedgerClient.unlockWithPasskey(name, authenticator, { evidence })
    expect(await unlocked.listHouseholds()).toHaveLength(1)
  })

  it('rejects a wrapper moved to another vault row or another credential', async () => {
    const authenticator = fakeAuthenticator()
    const source = await passkeyVault('passkey-move-source')
    await enable(source, authenticator)
    await enable(source, authenticator)
    const sourceConfig = (await PwaVaultDatabase.readVaultRow('passkey-move-source'))?.passkeys
    expect(sourceConfig?.entries).toHaveLength(2)
    source.close()

    const target = await passkeyVault('passkey-move-target')
    target.close()
    const targetDatabase = await PwaVaultDatabase.open('passkey-move-target', passphrase)
    await targetDatabase.writePasskeys(sourceConfig)
    targetDatabase.close()
    await expect(PwaLedgerClient.unlockWithPasskey('passkey-move-target', authenticator, { evidence }))
      .rejects.toThrow('Vault authentication failed')

    const [first, second] = sourceConfig!.entries
    const swapped = {
      ...sourceConfig!,
      entries: [{ ...first, wrapped: second.wrapped }, { ...second, wrapped: first.wrapped }],
    }
    const sourceDatabase = await PwaVaultDatabase.open('passkey-move-source', passphrase)
    await sourceDatabase.writePasskeys(swapped)
    sourceDatabase.close()
    await expect(PwaLedgerClient.unlockWithPasskey('passkey-move-source', authenticator, { evidence }))
      .rejects.toThrow('Vault authentication failed')
  })

  it('rejects a credential that is already enrolled and stores nothing', async () => {
    const client = await passkeyVault('passkey-duplicate')
    const fixedId = new Uint8Array(24).fill(42)
    const authenticator = fakeAuthenticator({ fixedId })
    await enable(client, authenticator)
    const before = await client.listPasskeys()

    await client.verifyPassphrase(passphrase)
    await expect(client.enablePasskey(passphrase, authenticator)).rejects.toThrow('Passkey already enabled')
    expect(await client.listPasskeys()).toEqual(before)
    expect(await PwaLedgerClient.readPasskeyCount('passkey-duplicate')).toBe(1)
  })

  it('spends the verified passphrase on the first of two concurrent enrolments', async () => {
    const client = await passkeyVault('passkey-double-submit')
    const authenticator = fakeAuthenticator()
    await client.verifyPassphrase(passphrase)

    const results = await Promise.allSettled([
      client.enablePasskey(passphrase, authenticator),
      client.enablePasskey(passphrase, authenticator),
    ])
    expect(results.map((result) => result.status).sort()).toEqual(['fulfilled', 'rejected'])
    const rejected = results.find((result) => result.status === 'rejected') as PromiseRejectedResult
    expect(rejected.reason).toEqual(new Error('Passphrase not verified'))
    expect(authenticator.create).toHaveBeenCalledTimes(1)
    expect(await client.listPasskeys()).toHaveLength(1)
  })

  it('does not bring back a passkey removed while an enrolment was in flight', async () => {
    const client = await passkeyVault('passkey-enable-remove-race')
    const authenticator = fakeAuthenticator()
    await enable(client, authenticator, 'first')
    await enable(client, authenticator, 'second')
    const [first, second] = await client.listPasskeys()

    let release!: () => void
    const gate = new Promise<void>((resolveGate) => { release = resolveGate })
    let entered!: () => void
    const inCreate = new Promise<void>((resolveEntered) => { entered = resolveEntered })
    authenticator.options.createGate = async () => {
      entered()
      await gate
    }
    await client.verifyPassphrase(passphrase)
    const enrolment = client.enablePasskey(passphrase, authenticator, 'third')
    await inCreate
    const removal = client.removePasskey(first.credentialIdBase64Url)
    release()
    await Promise.all([enrolment, removal])

    const labels = (await client.listPasskeys()).map((entry) => entry.label)
    expect(labels).toEqual(['second', 'third'])
    expect((await client.listPasskeys())[0]).toEqual(second)
  })

  it('reads a passkey count of zero for a vault without passkeys', async () => {
    const client = await passkeyVault('passkey-count-zero')
    client.close()
    expect(await PwaLedgerClient.readPasskeyCount('passkey-count-zero')).toBe(0)
  })
})
