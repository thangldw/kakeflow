import 'fake-indexeddb/auto'
import { describe, expect, it, vi } from 'vitest'

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

import {
  PwaVaultDatabase,
  storagePersistenceStatus,
  type AtomicPostingWrite,
} from './database'
import { createVaultKey, unlockVaultKey } from './vaultCrypto'
import type { PasskeyConfig, PasskeyEntry } from './vaultTypes'

const encoder = new TextEncoder()
const decoder = new TextDecoder()
const passphrase = 'correct horse battery staple'

function write(
  expectedRevision = 0,
  eventId = 'event-1',
  projectionValue = { id: 'household-1', name: 'Synthetic household' },
): AtomicPostingWrite {
  return {
    expectedRevision,
    events: [{
      id: eventId,
      eventType: 'HOUSEHOLD_CREATED',
      payload: encoder.encode(JSON.stringify({ id: 'household-1', name: 'Synthetic household' })),
    }],
    projections: [{
      projectionType: 'HOUSEHOLD',
      id: 'household-1',
      payload: encoder.encode(JSON.stringify(projectionValue)),
    }],
  }
}

async function seedVersionOneDatabase(name: string) {
  const material = await createVaultKey(passphrase, 'migrated-vault')
  await new Promise<void>((resolvePromise, reject) => {
    const request = indexedDB.open(name, 1)
    request.onupgradeneeded = () => {
      request.result.createObjectStore('vaults', { keyPath: 'vaultId' })
      request.result.createObjectStore('meta', { keyPath: 'key' })
    }
    request.onerror = () => reject(request.error)
    request.onsuccess = () => {
      const transaction = request.result.transaction(['vaults', 'meta'], 'readwrite')
      transaction.objectStore('vaults').put({
        vaultId: material.metadata.vaultId,
        metadata: material.metadata,
      })
      transaction.objectStore('meta').put({ key: 'activeVaultId', value: material.metadata.vaultId })
      transaction.oncomplete = () => {
        request.result.close()
        resolvePromise()
      }
      transaction.onerror = () => reject(transaction.error)
    }
  })
}

describe('encrypted PWA database', () => {
  it('creates, locks, and reopens the active vault after a database restart', async () => {
    const name = 'restart-vault'
    const created = await PwaVaultDatabase.create(name, passphrase, 'vault-1')
    await created.appendPostingAtomically(write())
    created.lock()
    await expect(created.readEvents()).rejects.toThrow('Vault is locked')
    created.close()

    const reopened = await PwaVaultDatabase.open(name, passphrase)
    const household = await reopened.readProjection('HOUSEHOLD', 'household-1')

    expect(JSON.parse(decoder.decode(household))).toEqual({
      id: 'household-1',
      name: 'Synthetic household',
    })
    expect(reopened.vaultId).toBe('vault-1')
  })

  it('stores only encrypted event and projection payloads', async () => {
    const database = await PwaVaultDatabase.create('encrypted-raw', passphrase, 'vault-1')
    await database.appendPostingAtomically(write())

    const serialized = JSON.stringify(await database.exportEncryptedState())
    expect(serialized).not.toContain('Synthetic household')
    expect(serialized).toContain('ciphertextBase64')
  })

  it('replays authenticated events in sequence order', async () => {
    const database = await PwaVaultDatabase.create('event-replay', passphrase, 'vault-1')
    await database.appendPostingAtomically(write(0, 'event-1'))
    await database.appendPostingAtomically(write(1, 'event-2'))

    const events = await database.readEvents()
    expect(events.map((event) => event.id)).toEqual(['event-1', 'event-2'])
    expect(events.map((event) => event.sequence)).toEqual([1, 2])
    expect(events.map((event) => JSON.parse(decoder.decode(event.payload)).name)).toEqual([
      'Synthetic household',
      'Synthetic household',
    ])
  })

  it('aborts event, projection, and revision writes as one transaction', async () => {
    const database = await PwaVaultDatabase.create(
      'atomic-abort',
      passphrase,
      'vault-1',
      { beforeProjectionWrites: () => { throw new DOMException('quota', 'QuotaExceededError') } },
    )

    await expect(database.appendPostingAtomically(write())).rejects.toMatchObject({
      name: 'QuotaExceededError',
    })
    expect(await database.readEvents()).toEqual([])
    expect(await database.listProjectionIds('HOUSEHOLD')).toEqual([])
    expect(await database.revision()).toBe(0)
  })

  it('rebuilds disposable projections from authenticated events', async () => {
    const database = await PwaVaultDatabase.create('projection-rebuild', passphrase, 'vault-1')
    await database.appendPostingAtomically(write(0, 'event-1', { id: 'household-1', name: 'Stale' }))

    await database.rebuildProjections((events) => [{
      projectionType: 'HOUSEHOLD',
      id: 'household-1',
      payload: events[0].payload,
    }])

    const projection = await database.readProjection('HOUSEHOLD', 'household-1')
    expect(JSON.parse(decoder.decode(projection)).name).toBe('Synthetic household')
    expect(await database.revision()).toBe(2)
  })

  it('rejects a wrong key without mutating the active vault', async () => {
    const name = 'wrong-key'
    const created = await PwaVaultDatabase.create(name, passphrase, 'vault-1')
    await created.appendPostingAtomically(write())
    created.close()

    await expect(PwaVaultDatabase.open(name, 'totally wrong passphrase')).rejects.toThrow(
      'Vault authentication failed',
    )
    const reopened = await PwaVaultDatabase.open(name, passphrase)
    expect(await reopened.revision()).toBe(1)
  })

  it('migrates the released version-one stores before opening the vault', async () => {
    const name = 'schema-migration'
    await seedVersionOneDatabase(name)

    const database = await PwaVaultDatabase.open(name, passphrase)
    await database.appendPostingAtomically(write())

    expect(database.storageVersion).toBe(2)
    expect(await database.readEvents()).toHaveLength(1)
  })

  it('reports a denied persistent-storage request truthfully', async () => {
    const storage = {
      persisted: vi.fn(async () => false),
      persist: vi.fn(async () => false),
    }

    await expect(storagePersistenceStatus(storage)).resolves.toEqual({
      supported: true,
      persisted: false,
      requested: true,
    })
  })

  it('rejects stale projection revisions before any write', async () => {
    const database = await PwaVaultDatabase.create('revision-fence', passphrase, 'vault-1')
    await database.appendPostingAtomically(write())

    await expect(database.appendPostingAtomically(write(0, 'event-2'))).rejects.toThrow(
      'Projection revision conflict',
    )
    expect(await database.readEvents()).toHaveLength(1)
  })
})

describe('passkey storage on the vault row', () => {
  const entry = (credentialIdBase64Url: string): PasskeyEntry => ({
    credentialIdBase64Url,
    label: `Passkey ${credentialIdBase64Url}`,
    createdAt: '2026-11-15T00:00:00.000Z',
    wrapped: {
      vaultId: 'vault-1',
      recordType: 'PASSKEY_WRAP',
      recordId: `record-${credentialIdBase64Url}`,
      schemaVersion: 1,
      algorithm: 'AES-GCM',
      nonceBase64: 'AAAAAAAAAAAAAAAA',
      ciphertextBase64: 'AAAA',
    },
  })
  const config: PasskeyConfig = {
    prfSaltBase64: btoa(String.fromCharCode(...new Uint8Array(32).fill(7))),
    entries: [entry('cred-a'), entry('cred-b')],
  }

  it('treats a vault row without passkeys as valid', async () => {
    const name = 'passkeys-absent'
    const database = await PwaVaultDatabase.create(name, passphrase, 'vault-1')

    expect(await database.readPasskeys()).toBeUndefined()
    const row = await PwaVaultDatabase.readVaultRow(name)
    expect(row?.vaultId).toBe('vault-1')
    expect(row && 'passkeys' in row).toBe(false)
    database.close()
    const reopened = await PwaVaultDatabase.open(name, passphrase)
    expect(await reopened.readPasskeys()).toBeUndefined()
  })

  it('returns null when there is no active vault', async () => {
    expect(await PwaVaultDatabase.readVaultRow('passkeys-no-vault')).toBeNull()
  })

  it('writes passkeys next to the metadata and removes the field again', async () => {
    const name = 'passkeys-write'
    const database = await PwaVaultDatabase.create(name, passphrase, 'vault-1')
    const metadata = (await PwaVaultDatabase.readVaultRow(name))?.metadata

    await database.writePasskeys(config)
    expect(await database.readPasskeys()).toEqual(config)
    const row = await PwaVaultDatabase.readVaultRow(name)
    expect(row?.passkeys).toEqual(config)
    expect(row?.metadata).toEqual(metadata)

    await database.writePasskeys({ ...config, entries: [config.entries[1]] })
    expect((await database.readPasskeys())?.entries).toEqual([config.entries[1]])

    await database.writePasskeys({ ...config, entries: [] })
    const emptied = await PwaVaultDatabase.readVaultRow(name)
    expect(emptied && 'passkeys' in emptied).toBe(false)

    await database.writePasskeys(config)
    await database.writePasskeys(undefined)
    const removed = await PwaVaultDatabase.readVaultRow(name)
    expect(removed && 'passkeys' in removed).toBe(false)
    expect(removed?.metadata).toEqual(metadata)
  })

  it('refuses more than three entries', async () => {
    const database = await PwaVaultDatabase.create('passkeys-too-many', passphrase, 'vault-1')
    await expect(database.writePasskeys({
      ...config,
      entries: ['a', 'b', 'c', 'd'].map(entry),
    })).rejects.toThrow('Passkey limit reached')
    expect(await database.readPasskeys()).toBeUndefined()
  })

  it('opens the active vault with an already verified key', async () => {
    const name = 'passkeys-open-with-key'
    const created = await PwaVaultDatabase.create(name, passphrase, 'vault-1')
    await created.appendPostingAtomically(write())
    created.close()
    const metadata = (await PwaVaultDatabase.readVaultRow(name))!.metadata
    const key = await unlockVaultKey(passphrase, metadata)

    const opened = await PwaVaultDatabase.openWithKey(name, key, 'vault-1')
    expect(await opened.readEvents()).toHaveLength(1)
    opened.close()
    await expect(PwaVaultDatabase.openWithKey(name, key, 'another-vault')).rejects.toThrow()
  })

  it('rejects a wrong key for the right vault id with the authentication error', async () => {
    const name = 'passkeys-open-with-wrong-key'
    const created = await PwaVaultDatabase.create(name, passphrase, 'vault-1')
    created.close()
    const wrongKey = await crypto.subtle.importKey(
      'raw',
      new Uint8Array(32).fill(1),
      { name: 'AES-GCM', length: 256 },
      false,
      ['encrypt', 'decrypt'],
    )

    await expect(PwaVaultDatabase.openWithKey(name, wrongKey, 'vault-1'))
      .rejects.toThrow('Vault authentication failed')
    const reopened = await PwaVaultDatabase.open(name, passphrase)
    expect(await reopened.revision()).toBe(0)
  })
})
