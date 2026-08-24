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

import { PwaVaultDatabase } from './database'
import { EvidenceStore } from './evidenceStore'

class MemoryFileHandle {
  bytes = new Uint8Array()

  constructor(private readonly failWrites = false) {}

  async createWritable() {
    return {
      write: async (value: BufferSource | Blob | string) => {
        if (this.failWrites) throw new DOMException('quota', 'QuotaExceededError')
        if (typeof value === 'string') this.bytes = new TextEncoder().encode(value)
        else if (value instanceof Blob) this.bytes = new Uint8Array(await value.arrayBuffer())
        else {
          const view = ArrayBuffer.isView(value)
            ? new Uint8Array(value.buffer, value.byteOffset, value.byteLength)
            : new Uint8Array(value)
          this.bytes = view.slice()
        }
      },
      close: async () => undefined,
      abort: async () => undefined,
    }
  }

  async getFile() {
    return {
      arrayBuffer: async () => this.bytes.slice().buffer,
    }
  }
}

class MemoryDirectoryHandle {
  readonly directories = new Map<string, MemoryDirectoryHandle>()
  readonly files = new Map<string, MemoryFileHandle>()

  constructor(private readonly failWrites = false) {}

  async getDirectoryHandle(name: string, options?: { create?: boolean }) {
    const existing = this.directories.get(name)
    if (existing) return existing
    if (!options?.create) throw new DOMException('missing', 'NotFoundError')
    const created = new MemoryDirectoryHandle(this.failWrites)
    this.directories.set(name, created)
    return created
  }

  async getFileHandle(name: string, options?: { create?: boolean }) {
    const existing = this.files.get(name)
    if (existing) return existing
    if (!options?.create) throw new DOMException('missing', 'NotFoundError')
    const created = new MemoryFileHandle(this.failWrites)
    this.files.set(name, created)
    return created
  }

  fileAt(...segments: string[]) {
    const file = segments.pop()
    const directory = segments.reduce<MemoryDirectoryHandle>(
      (current, segment) => current.directories.get(segment)!,
      this,
    )
    return directory.files.get(file!)
  }
}

const passphrase = 'correct horse battery staple'
const evidence = new TextEncoder().encode('synthetic receipt image bytes and 1,000 JPY')

describe('encrypted evidence storage', () => {
  it('round-trips ciphertext through IndexedDB when OPFS is unavailable', async () => {
    const database = await PwaVaultDatabase.create('evidence-fallback', passphrase, 'vault-1')
    const store = new EvidenceStore(database, { getDirectory: undefined })

    await expect(store.putEvidence('receipt-1', evidence)).resolves.toEqual({
      backend: 'INDEXED_DB',
    })
    const recovered = await store.getEvidence('receipt-1')
    expect([...recovered]).toEqual([...evidence])
    expect(JSON.stringify(await database.exportEncryptedState())).not.toContain(
      new TextDecoder().decode(evidence),
    )
  })

  it('writes only an encrypted envelope to the deterministic owned OPFS path', async () => {
    const database = await PwaVaultDatabase.create('evidence-opfs', passphrase, 'vault-1')
    const root = new MemoryDirectoryHandle()
    const store = new EvidenceStore(database, {
      getDirectory: async () => root as unknown as FileSystemDirectoryHandle,
    })

    await expect(store.putEvidence('receipt-1', evidence)).resolves.toEqual({ backend: 'OPFS' })
    const file = root.fileAt('kakeflow', 'vault-1', 'evidence', 'cmVjZWlwdC0x.json')
    const serialized = new TextDecoder().decode(file?.bytes)
    expect(serialized).toContain('ciphertextBase64')
    expect(serialized).not.toContain(new TextDecoder().decode(evidence))
    expect(await database.evidenceIds()).toEqual([])
    expect([...(await store.getEvidence('receipt-1'))]).toEqual([...evidence])
  })

  it('reads the encrypted IndexedDB fallback after OPFS later becomes available', async () => {
    const database = await PwaVaultDatabase.create('evidence-upgrade', passphrase, 'vault-1')
    await new EvidenceStore(database, { getDirectory: undefined }).putEvidence('receipt-1', evidence)
    const root = new MemoryDirectoryHandle()
    const upgraded = new EvidenceStore(database, {
      getDirectory: async () => root as unknown as FileSystemDirectoryHandle,
    })

    expect([...(await upgraded.getEvidence('receipt-1'))]).toEqual([...evidence])
  })

  it('propagates OPFS quota failure without persisting a partial fallback', async () => {
    const database = await PwaVaultDatabase.create('evidence-quota', passphrase, 'vault-1')
    const root = new MemoryDirectoryHandle(true)
    const store = new EvidenceStore(database, {
      getDirectory: async () => root as unknown as FileSystemDirectoryHandle,
    })

    await expect(store.putEvidence('receipt-1', evidence)).rejects.toMatchObject({
      name: 'QuotaExceededError',
    })
    expect(await database.evidenceIds()).toEqual([])
  })
})
