import { openDB, type DBSchema, type IDBPDatabase } from 'idb'

import { decryptRecord, encryptRecord, createVaultKey, unlockVaultKey } from './vaultCrypto'
import { VAULT_SCHEMA_VERSION, type EncryptedEnvelope, type VaultMetadata } from './vaultTypes'

const STORAGE_VERSION = 2

interface VaultRow {
  readonly vaultId: string
  readonly metadata: VaultMetadata
}

interface EventRow {
  readonly vaultId: string
  readonly sequence: number
  readonly id: string
  readonly eventType: string
  readonly envelope: EncryptedEnvelope
}

interface ProjectionRow {
  readonly vaultId: string
  readonly projectionType: string
  readonly id: string
  readonly envelope: EncryptedEnvelope
}

interface EvidenceRow {
  readonly vaultId: string
  readonly id: string
  readonly envelope: EncryptedEnvelope
}

interface MetaRow {
  readonly key: string
  readonly value: string | number
}

interface KakeFlowPwaSchema extends DBSchema {
  vaults: {
    key: string
    value: VaultRow
  }
  events: {
    key: [string, number]
    value: EventRow
    indexes: {
      'by-vault': string
      'by-event-id': [string, string]
    }
  }
  projections: {
    key: [string, string, string]
    value: ProjectionRow
    indexes: {
      'by-vault': string
      'by-vault-type': [string, string]
    }
  }
  evidence: {
    key: [string, string]
    value: EvidenceRow
    indexes: {
      'by-vault': string
    }
  }
  meta: {
    key: string
    value: MetaRow
  }
}

export interface PlainEventWrite {
  readonly id: string
  readonly eventType: string
  readonly payload: Uint8Array
}

export interface PlainProjectionWrite {
  readonly projectionType: string
  readonly id: string
  readonly payload: Uint8Array
}

export interface AtomicPostingWrite {
  readonly expectedRevision: number
  readonly events: readonly PlainEventWrite[]
  readonly projections: readonly PlainProjectionWrite[]
}

export interface DecryptedEvent extends PlainEventWrite {
  readonly sequence: number
}

export interface DatabaseFaultHooks {
  readonly beforeProjectionWrites?: () => void
}

export interface EncryptedVaultState {
  readonly vault: VaultRow
  readonly events: readonly EventRow[]
  readonly projections: readonly ProjectionRow[]
  readonly evidence: readonly EvidenceRow[]
  readonly revision: number
  readonly eventSequence: number
}

export class PwaVaultDatabase {
  readonly storageVersion = STORAGE_VERSION
  private key: CryptoKey | undefined

  private constructor(
    private readonly database: IDBPDatabase<KakeFlowPwaSchema>,
    readonly vaultId: string,
    key: CryptoKey,
    private readonly hooks: DatabaseFaultHooks,
  ) {
    this.key = key
  }

  static async create(
    databaseName: string,
    passphrase: string,
    vaultId?: string,
    hooks: DatabaseFaultHooks = {},
  ): Promise<PwaVaultDatabase> {
    const database = await openVaultDatabase(databaseName)
    try {
      const activeVault = await database.get('meta', 'activeVaultId')
      if (activeVault) throw new Error('An active vault already exists')
      const material = await createVaultKey(passphrase, vaultId)
      const transaction = database.transaction(['vaults', 'meta'], 'readwrite')
      await Promise.all([
        transaction.objectStore('vaults').add({
          vaultId: material.metadata.vaultId,
          metadata: material.metadata,
        }),
        transaction.objectStore('meta').put({
          key: 'activeVaultId',
          value: material.metadata.vaultId,
        }),
        transaction.objectStore('meta').put({
          key: revisionKey(material.metadata.vaultId),
          value: 0,
        }),
        transaction.objectStore('meta').put({
          key: sequenceKey(material.metadata.vaultId),
          value: 0,
        }),
      ])
      await transaction.done
      return new PwaVaultDatabase(
        database,
        material.metadata.vaultId,
        material.key,
        hooks,
      )
    } catch (error) {
      database.close()
      throw error
    }
  }

  static async open(
    databaseName: string,
    passphrase: string,
    hooks: DatabaseFaultHooks = {},
  ): Promise<PwaVaultDatabase> {
    const database = await openVaultDatabase(databaseName)
    try {
      const activeVault = await database.get('meta', 'activeVaultId')
      if (!activeVault || typeof activeVault.value !== 'string') throw new Error('Active vault not found')
      const vault = await database.get('vaults', activeVault.value)
      if (!vault) throw new Error('Active vault metadata not found')
      const key = await unlockVaultKey(passphrase, vault.metadata)
      return new PwaVaultDatabase(database, vault.vaultId, key, hooks)
    } catch (error) {
      database.close()
      throw error
    }
  }

  lock() {
    this.key = undefined
  }

  close() {
    this.lock()
    this.database.close()
  }

  async appendPostingAtomically(write: AtomicPostingWrite): Promise<{ revision: number }> {
    if (write.events.length === 0) throw new Error('Atomic posting requires at least one event')
    const activeKey = this.requireKey()
    const [events, projections] = await Promise.all([
      Promise.all(write.events.map(async (event) => ({
        event,
        envelope: await encryptRecord(activeKey, {
          vaultId: this.vaultId,
          recordType: `EVENT:${event.eventType}`,
          recordId: event.id,
          schemaVersion: VAULT_SCHEMA_VERSION,
        }, event.payload),
      }))),
      Promise.all(write.projections.map(async (projection) => ({
        projection,
        envelope: await encryptRecord(activeKey, {
          vaultId: this.vaultId,
          recordType: `PROJECTION:${projection.projectionType}`,
          recordId: projection.id,
          schemaVersion: VAULT_SCHEMA_VERSION,
        }, projection.payload),
      }))),
    ])
    this.ensureSameActiveKey(activeKey)

    const transaction = this.database.transaction(
      ['events', 'projections', 'meta'],
      'readwrite',
    )
    try {
      const metaStore = transaction.objectStore('meta')
      const revision = numericMeta(await metaStore.get(revisionKey(this.vaultId)))
      if (revision !== write.expectedRevision) throw new Error('Projection revision conflict')
      let sequence = numericMeta(await metaStore.get(sequenceKey(this.vaultId)))
      const eventStore = transaction.objectStore('events')
      for (const prepared of events) {
        sequence += 1
        await eventStore.add({
          vaultId: this.vaultId,
          sequence,
          id: prepared.event.id,
          eventType: prepared.event.eventType,
          envelope: prepared.envelope,
        })
      }
      this.hooks.beforeProjectionWrites?.()
      const projectionStore = transaction.objectStore('projections')
      for (const prepared of projections) {
        await projectionStore.put({
          vaultId: this.vaultId,
          projectionType: prepared.projection.projectionType,
          id: prepared.projection.id,
          envelope: prepared.envelope,
        })
      }
      const nextRevision = revision + 1
      await Promise.all([
        metaStore.put({ key: revisionKey(this.vaultId), value: nextRevision }),
        metaStore.put({ key: sequenceKey(this.vaultId), value: sequence }),
      ])
      await transaction.done
      return { revision: nextRevision }
    } catch (error) {
      abortTransaction(transaction)
      await transaction.done.catch(() => undefined)
      throw error
    }
  }

  async readEvents(): Promise<DecryptedEvent[]> {
    const key = this.requireKey()
    const rows = await this.database.getAllFromIndex('events', 'by-vault', this.vaultId)
    rows.sort((left, right) => left.sequence - right.sequence)
    return Promise.all(rows.map(async (row) => ({
      id: row.id,
      eventType: row.eventType,
      sequence: row.sequence,
      payload: await decryptRecord(key, {
        vaultId: this.vaultId,
        recordType: `EVENT:${row.eventType}`,
        recordId: row.id,
        schemaVersion: VAULT_SCHEMA_VERSION,
      }, row.envelope),
    })))
  }

  async readProjection(projectionType: string, id: string): Promise<Uint8Array> {
    const key = this.requireKey()
    const row = await this.database.get('projections', [this.vaultId, projectionType, id])
    if (!row) throw new Error('Projection not found')
    return decryptRecord(key, {
      vaultId: this.vaultId,
      recordType: `PROJECTION:${projectionType}`,
      recordId: id,
      schemaVersion: VAULT_SCHEMA_VERSION,
    }, row.envelope)
  }

  async listProjectionIds(projectionType: string): Promise<string[]> {
    this.requireKey()
    const rows = await this.database.getAllFromIndex(
      'projections',
      'by-vault-type',
      [this.vaultId, projectionType],
    )
    return rows.map((row) => row.id).sort()
  }

  async rebuildProjections(
    reducer: (events: readonly DecryptedEvent[]) => readonly PlainProjectionWrite[],
  ): Promise<{ revision: number }> {
    const activeKey = this.requireKey()
    const events = await this.readEvents()
    const projections = reducer(events)
    const prepared = await Promise.all(projections.map(async (projection) => ({
      projection,
      envelope: await encryptRecord(activeKey, {
        vaultId: this.vaultId,
        recordType: `PROJECTION:${projection.projectionType}`,
        recordId: projection.id,
        schemaVersion: VAULT_SCHEMA_VERSION,
      }, projection.payload),
    })))
    this.ensureSameActiveKey(activeKey)

    const transaction = this.database.transaction(['projections', 'meta'], 'readwrite')
    try {
      const projectionIndex = transaction.objectStore('projections').index('by-vault')
      let cursor = await projectionIndex.openKeyCursor(this.vaultId)
      while (cursor) {
        await transaction.objectStore('projections').delete(cursor.primaryKey)
        cursor = await cursor.continue()
      }
      for (const item of prepared) {
        await transaction.objectStore('projections').put({
          vaultId: this.vaultId,
          projectionType: item.projection.projectionType,
          id: item.projection.id,
          envelope: item.envelope,
        })
      }
      const metaStore = transaction.objectStore('meta')
      const nextRevision = numericMeta(await metaStore.get(revisionKey(this.vaultId))) + 1
      await metaStore.put({ key: revisionKey(this.vaultId), value: nextRevision })
      await transaction.done
      return { revision: nextRevision }
    } catch (error) {
      abortTransaction(transaction)
      await transaction.done.catch(() => undefined)
      throw error
    }
  }

  async revision(): Promise<number> {
    this.requireKey()
    return numericMeta(await this.database.get('meta', revisionKey(this.vaultId)))
  }

  async seal(recordType: string, recordId: string, payload: Uint8Array) {
    const key = this.requireKey()
    return encryptRecord(key, {
      vaultId: this.vaultId,
      recordType,
      recordId,
      schemaVersion: VAULT_SCHEMA_VERSION,
    }, payload)
  }

  async openEnvelope(recordType: string, recordId: string, envelope: EncryptedEnvelope) {
    const key = this.requireKey()
    return decryptRecord(key, {
      vaultId: this.vaultId,
      recordType,
      recordId,
      schemaVersion: VAULT_SCHEMA_VERSION,
    }, envelope)
  }

  async putEvidenceEnvelope(id: string, envelope: EncryptedEnvelope) {
    this.requireKey()
    await this.database.put('evidence', { vaultId: this.vaultId, id, envelope })
  }

  async getEvidenceEnvelope(id: string): Promise<EncryptedEnvelope | undefined> {
    this.requireKey()
    return (await this.database.get('evidence', [this.vaultId, id]))?.envelope
  }

  async evidenceIds(): Promise<string[]> {
    this.requireKey()
    const rows = await this.database.getAllFromIndex('evidence', 'by-vault', this.vaultId)
    return rows.map((row) => row.id).sort()
  }

  async exportEncryptedState(): Promise<EncryptedVaultState> {
    this.requireKey()
    const vault = await this.database.get('vaults', this.vaultId)
    if (!vault) throw new Error('Vault metadata not found')
    const [events, projections, evidence, revision, eventSequence] = await Promise.all([
      this.database.getAllFromIndex('events', 'by-vault', this.vaultId),
      this.database.getAllFromIndex('projections', 'by-vault', this.vaultId),
      this.database.getAllFromIndex('evidence', 'by-vault', this.vaultId),
      this.revision(),
      this.database.get('meta', sequenceKey(this.vaultId)).then(numericMeta),
    ])
    events.sort((left, right) => left.sequence - right.sequence)
    return { vault, events, projections, evidence, revision, eventSequence }
  }

  private requireKey(): CryptoKey {
    if (!this.key) throw new Error('Vault is locked')
    return this.key
  }

  private ensureSameActiveKey(key: CryptoKey) {
    if (this.key !== key) throw new Error('Vault was locked during operation')
  }
}

interface PersistenceStorage {
  readonly persisted?: () => Promise<boolean>
  readonly persist?: () => Promise<boolean>
}

export async function storagePersistenceStatus(
  storage: PersistenceStorage | undefined = globalThis.navigator?.storage,
): Promise<{ supported: boolean; persisted: boolean; requested: boolean }> {
  if (!storage?.persisted || !storage.persist) {
    return { supported: false, persisted: false, requested: false }
  }
  if (await storage.persisted()) return { supported: true, persisted: true, requested: false }
  return { supported: true, persisted: await storage.persist(), requested: true }
}

async function openVaultDatabase(name: string) {
  return openDB<KakeFlowPwaSchema>(name, STORAGE_VERSION, {
    upgrade(database, oldVersion) {
      if (oldVersion < 1) {
        database.createObjectStore('vaults', { keyPath: 'vaultId' })
        database.createObjectStore('meta', { keyPath: 'key' })
      }
      if (oldVersion < 2) {
        const events = database.createObjectStore('events', {
          keyPath: ['vaultId', 'sequence'],
        })
        events.createIndex('by-vault', 'vaultId')
        events.createIndex('by-event-id', ['vaultId', 'id'], { unique: true })
        const projections = database.createObjectStore('projections', {
          keyPath: ['vaultId', 'projectionType', 'id'],
        })
        projections.createIndex('by-vault', 'vaultId')
        projections.createIndex('by-vault-type', ['vaultId', 'projectionType'])
        const evidence = database.createObjectStore('evidence', {
          keyPath: ['vaultId', 'id'],
        })
        evidence.createIndex('by-vault', 'vaultId')
      }
    },
  })
}

function revisionKey(vaultId: string) {
  return `revision:${vaultId}`
}

function sequenceKey(vaultId: string) {
  return `sequence:${vaultId}`
}

function numericMeta(row: MetaRow | undefined): number {
  return row && typeof row.value === 'number' ? row.value : 0
}

function abortTransaction(transaction: { abort(): void }) {
  try {
    transaction.abort()
  } catch {
    // The browser may already have aborted on a storage or constraint error.
  }
}
