import 'fake-indexeddb/auto'
import { readFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import { unzipSync, zipSync } from 'fflate'
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

import { inspectPwaArchive } from './archive'
import { PwaLedgerClient } from './client'

const originalFetch = globalThis.fetch
const sourcePassphrase = 'source correct horse battery staple'
const destinationPassphrase = 'destination correct horse battery staple'
const evidenceBytes = new TextEncoder().encode('synthetic archive receipt bytes')

async function sourceClient(databaseName: string) {
  const client = await PwaLedgerClient.createVault(databaseName, sourcePassphrase, {
    vaultId: 'source-vault',
    evidence: { getDirectory: undefined },
  })
  await client.createHousehold({ id: 'household', name: 'Archive household' })
  await client.createAccount({ id: 'cash', householdId: 'household', name: 'Cash', kind: 'ASSET' })
  await client.createAccount({ id: 'food', householdId: 'household', name: 'Food', kind: 'EXPENSE' })
  const candidate = await client.stageReceipt({
    sourceId: 'source-1',
    candidateId: 'candidate-1',
    householdId: 'household',
    originalFilename: 'archive-synthetic.png',
    mediaType: 'image/png',
    bytes: evidenceBytes,
    occurredOn: '2026-08-24',
    payee: 'Archive Synthetic Market',
    amountJpy: 1_234,
    ocrConfidenceBps: 9_800,
    provenance: [{ field: 'amountJpy', page: 1, region: [1, 2, 3, 4] }],
  })
  const transaction = await client.approveCandidate({
    candidateId: candidate.id,
    transactionId: 'transaction-1',
    transactionType: 'EXPENSE',
    entries: [
      { id: 'debit-1', accountId: 'food', side: 'DEBIT', amountJpy: 1_234 },
      { id: 'credit-1', accountId: 'cash', side: 'CREDIT', amountJpy: 1_234 },
    ],
  })
  return { client, transaction }
}

async function destination(databaseName: string) {
  const client = await PwaLedgerClient.createVault(databaseName, destinationPassphrase, {
    vaultId: 'destination-vault',
    evidence: { getDirectory: undefined },
  })
  await client.createHousehold({ id: 'destination-household', name: 'Destination household' })
  client.close()
}

function rewriteArchive(
  archive: Uint8Array,
  mutate: (files: Record<string, Uint8Array>) => void,
) {
  const files = unzipSync(archive)
  mutate(files)
  return zipSync(files, { level: 6, mtime: new Date(1980, 0, 1) })
}

describe('encrypted PWA archive and staged restore', () => {
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

  it('exports deterministic authenticated manifest fields over encrypted records and evidence', async () => {
    const { client } = await sourceClient('archive-manifest')
    const first = await client.exportVault()
    const second = await client.exportVault()
    const [firstManifest, secondManifest] = await Promise.all([
      inspectPwaArchive(first, sourcePassphrase),
      inspectPwaArchive(second, sourcePassphrase),
    ])

    expect(firstManifest).toEqual(secondManifest)
    expect(firstManifest).toMatchObject({
      format: 'KAKEFLOW_ENCRYPTED_ARCHIVE',
      schemaVersion: 1,
      storageVersion: 2,
      vaultId: 'source-vault',
      fileCount: firstManifest.files.length,
    })
    expect(firstManifest.files.map((file) => file.path)).toEqual(
      [...firstManifest.files.map((file) => file.path)].sort(),
    )
    expect(firstManifest.files.some((file) => file.kind === 'EVIDENCE')).toBe(true)
    for (const bytes of Object.values(unzipSync(first))) {
      expect(new TextDecoder().decode(bytes)).not.toContain('Archive Synthetic Market')
      expect(new TextDecoder().decode(bytes)).not.toContain('synthetic archive receipt bytes')
    }
  })

  it('rejects a wrong passphrase and leaves the destination active vault unchanged', async () => {
    const { client } = await sourceClient('archive-wrong-pass-source')
    const archive = await client.exportVault()
    await destination('archive-wrong-pass-destination')

    await expect(PwaLedgerClient.restoreVault(
      'archive-wrong-pass-destination',
      archive,
      'wrong archive passphrase',
      { vaultId: 'restored-vault', evidence: { getDirectory: undefined } },
    )).rejects.toThrow('Vault authentication failed')

    const original = await PwaLedgerClient.unlock(
      'archive-wrong-pass-destination',
      destinationPassphrase,
      { evidence: { getDirectory: undefined } },
    )
    expect((await original.listHouseholds())[0].id).toBe('destination-household')
  })

  it('rejects a modified declared entry before switching the active vault', async () => {
    const { client } = await sourceClient('archive-modified-source')
    const archive = await client.exportVault()
    const modified = rewriteArchive(archive, (files) => {
      const entry = Object.keys(files).find((path) => path.startsWith('events/'))!
      files[entry][files[entry].length - 2] ^= 1
    })
    await destination('archive-modified-destination')

    await expect(PwaLedgerClient.restoreVault(
      'archive-modified-destination',
      modified,
      sourcePassphrase,
      { vaultId: 'restored-vault', evidence: { getDirectory: undefined } },
    )).rejects.toThrow('Archive entry hash mismatch')

    await expect(PwaLedgerClient.unlock(
      'archive-modified-destination',
      destinationPassphrase,
      { evidence: { getDirectory: undefined } },
    )).resolves.toBeInstanceOf(PwaLedgerClient)
  })

  it('rejects a missing evidence entry declared by the authenticated manifest', async () => {
    const { client } = await sourceClient('archive-missing-evidence-source')
    const archive = await client.exportVault()
    const missing = rewriteArchive(archive, (files) => {
      const entry = Object.keys(files).find((path) => path.startsWith('evidence/'))!
      delete files[entry]
    })

    await expect(PwaLedgerClient.restoreVault(
      'archive-missing-evidence-destination',
      missing,
      sourcePassphrase,
      { vaultId: 'restored-vault', evidence: { getDirectory: undefined } },
    )).rejects.toThrow('Archive declared entry is missing')
  })

  it('rejects an unsupported archive schema before attempting restore', async () => {
    const { client } = await sourceClient('archive-schema-source')
    const archive = await client.exportVault()
    const unsupported = rewriteArchive(archive, (files) => {
      const header = JSON.parse(new TextDecoder().decode(files['header.json'])) as { schemaVersion: number }
      header.schemaVersion = 2
      files['header.json'] = new TextEncoder().encode(JSON.stringify(header))
    })

    await expect(inspectPwaArchive(unsupported, sourcePassphrase)).rejects.toThrow(
      'Unsupported archive schema',
    )
  })

  it('aborts staged rows and preserves the active vault when activation is interrupted', async () => {
    const { client } = await sourceClient('archive-interrupted-source')
    const archive = await client.exportVault()
    await destination('archive-interrupted-destination')

    await expect(PwaLedgerClient.restoreVault(
      'archive-interrupted-destination',
      archive,
      sourcePassphrase,
      {
        vaultId: 'restored-vault',
        evidence: { getDirectory: undefined },
        beforeActivate: () => { throw new DOMException('quota', 'QuotaExceededError') },
      },
    )).rejects.toMatchObject({ name: 'QuotaExceededError' })

    const original = await PwaLedgerClient.unlock(
      'archive-interrupted-destination',
      destinationPassphrase,
      { evidence: { getDirectory: undefined } },
    )
    expect((await original.listHouseholds())[0].id).toBe('destination-household')
  })

  it('atomically restores a new vault ID with canonical posting hash and evidence intact', async () => {
    const { client, transaction } = await sourceClient('archive-success-source')
    const archive = await client.exportVault()
    await destination('archive-success-destination')

    const restored = await PwaLedgerClient.restoreVault(
      'archive-success-destination',
      archive,
      sourcePassphrase,
      { vaultId: 'restored-vault', evidence: { getDirectory: undefined } },
    )

    expect((await restored.listHouseholds())[0].name).toBe('Archive household')
    const restoredTransaction = (await restored.listTransactions('household'))[0]
    expect(restoredTransaction.canonicalPostingHash).toBe(transaction.canonicalPostingHash)
    expect(restoredTransaction.id).toBe('transaction-1')
    expect([...(await restored.sourceEvidence('transaction-1')).bytes]).toEqual([...evidenceBytes])
  })
})
