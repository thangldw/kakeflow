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
import type { PostingEntry } from './types'

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

  it('rejects every read and write after the local vault is locked', async () => {
    const client = await configuredClient('client-lock')
    client.lock()

    await expect(client.listHouseholds()).rejects.toThrow('Vault is locked')
    await expect(client.createHousehold({ id: 'other', name: 'Other' })).rejects.toThrow(
      'Vault is locked',
    )
  })
})
