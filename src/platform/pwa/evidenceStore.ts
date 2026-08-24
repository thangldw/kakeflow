import { PwaVaultDatabase } from './database'
import type { EncryptedEnvelope } from './vaultTypes'

const MAX_ENVELOPE_BYTES = 64 * 1024 * 1024

export interface EvidenceStoreOptions {
  readonly getDirectory?: (() => Promise<FileSystemDirectoryHandle>) | undefined
}

export class EvidenceStore {
  private readonly getDirectory: (() => Promise<FileSystemDirectoryHandle>) | undefined

  constructor(
    private readonly database: PwaVaultDatabase,
    options: EvidenceStoreOptions = {},
  ) {
    this.getDirectory = Object.hasOwn(options, 'getDirectory')
      ? options.getDirectory
      : defaultDirectoryProvider()
  }

  async putEvidence(id: string, bytes: Uint8Array): Promise<{ backend: 'OPFS' | 'INDEXED_DB' }> {
    const envelope = await this.database.seal('EVIDENCE', id, bytes)
    if (this.getDirectory) {
      try {
        const root = await this.getDirectory()
        await writeOpfsEnvelope(root, this.database.vaultId, id, envelope)
        return { backend: 'OPFS' }
      } catch (error) {
        if (!isUnavailableOpfs(error)) throw error
      }
    }
    await this.database.putEvidenceEnvelope(id, envelope)
    return { backend: 'INDEXED_DB' }
  }

  async getEvidence(id: string): Promise<Uint8Array> {
    const envelope = await this.encryptedEnvelope(id)
    return this.database.openEnvelope('EVIDENCE', id, envelope)
  }

  async encryptedEnvelope(id: string): Promise<EncryptedEnvelope> {
    let envelope: EncryptedEnvelope | undefined
    if (this.getDirectory) {
      try {
        const root = await this.getDirectory()
        envelope = await readOpfsEnvelope(root, this.database.vaultId, id)
      } catch (error) {
        if (!isUnavailableOpfs(error) && !isNotFound(error)) throw error
      }
    }
    envelope ??= await this.database.getEvidenceEnvelope(id)
    if (!envelope) throw new Error('Evidence not found')
    return envelope
  }
}

function defaultDirectoryProvider(): (() => Promise<FileSystemDirectoryHandle>) | undefined {
  const storage = globalThis.navigator?.storage as StorageManager & {
    getDirectory?: () => Promise<FileSystemDirectoryHandle>
  }
  return storage?.getDirectory ? storage.getDirectory.bind(storage) : undefined
}

async function writeOpfsEnvelope(
  root: FileSystemDirectoryHandle,
  vaultId: string,
  evidenceId: string,
  envelope: EncryptedEnvelope,
) {
  const evidenceDirectory = await evidenceDirectoryHandle(root, vaultId, true)
  const file = await evidenceDirectory.getFileHandle(evidenceFileName(evidenceId), { create: true })
  const writable = await file.createWritable()
  try {
    await writable.write(JSON.stringify(envelope))
    await writable.close()
  } catch (error) {
    await writable.abort().catch(() => undefined)
    throw error
  }
}

async function readOpfsEnvelope(
  root: FileSystemDirectoryHandle,
  vaultId: string,
  evidenceId: string,
): Promise<EncryptedEnvelope> {
  const evidenceDirectory = await evidenceDirectoryHandle(root, vaultId, false)
  const file = await evidenceDirectory.getFileHandle(evidenceFileName(evidenceId))
  const bytes = new Uint8Array(await (await file.getFile()).arrayBuffer())
  if (bytes.length === 0 || bytes.length > MAX_ENVELOPE_BYTES) {
    throw new Error('Invalid encrypted evidence envelope size')
  }
  try {
    return JSON.parse(new TextDecoder().decode(bytes)) as EncryptedEnvelope
  } catch {
    throw new Error('Invalid encrypted evidence envelope')
  }
}

async function evidenceDirectoryHandle(
  root: FileSystemDirectoryHandle,
  vaultId: string,
  create: boolean,
) {
  const application = await root.getDirectoryHandle('kakeflow', { create })
  const vault = await application.getDirectoryHandle(safeVaultSegment(vaultId), { create })
  return vault.getDirectoryHandle('evidence', { create })
}

function safeVaultSegment(vaultId: string) {
  if (!/^[A-Za-z0-9._-]{1,255}$/.test(vaultId)) throw new Error('Invalid OPFS vault path')
  return vaultId
}

function evidenceFileName(evidenceId: string) {
  if (!evidenceId || evidenceId.length > 255) throw new Error('Invalid evidence ID')
  const bytes = new TextEncoder().encode(evidenceId)
  let binary = ''
  for (const byte of bytes) binary += String.fromCharCode(byte)
  const segment = btoa(binary).replaceAll('+', '-').replaceAll('/', '_').replace(/=+$/u, '')
  return `${segment}.json`
}

function isUnavailableOpfs(error: unknown) {
  return error instanceof DOMException
    && ['InvalidStateError', 'NotAllowedError', 'NotSupportedError', 'SecurityError'].includes(error.name)
}

function isNotFound(error: unknown) {
  return error instanceof DOMException && error.name === 'NotFoundError'
}
