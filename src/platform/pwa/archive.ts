import { unzipSync, zipSync } from 'fflate'

import {
  PwaVaultDatabase,
  type EncryptedVaultState,
  type EventRow,
  type EvidenceRow,
  type ProjectionRow,
  type RestoreFaultHooks,
} from './database'
import type { EvidenceStore } from './evidenceStore'
import { createVaultKey, decryptRecord, encryptRecord, unlockVaultKey } from './vaultCrypto'
import {
  VAULT_SCHEMA_VERSION,
  type EncryptedEnvelope,
  type VaultMetadata,
  type VaultRecordContext,
} from './vaultTypes'

export const PWA_ARCHIVE_SCHEMA_VERSION = 1 as const

const ARCHIVE_FORMAT = 'KAKEFLOW_ENCRYPTED_ARCHIVE' as const
const HEADER_PATH = 'header.json'
const MAX_ARCHIVE_BYTES = 256 * 1024 * 1024
const MAX_ENTRY_BYTES = 72 * 1024 * 1024
const MAX_UNCOMPRESSED_BYTES = 512 * 1024 * 1024
const MAX_FILES = 50_000
const ZIP_EPOCH = new Date(1980, 0, 1)
const encoder = new TextEncoder()
const decoder = new TextDecoder()

type ArchiveFileKind = 'EVENT' | 'PROJECTION' | 'EVIDENCE'

export interface PwaArchiveFile {
  readonly path: string
  readonly kind: ArchiveFileKind
  readonly byteLength: number
  readonly sha256: string
}

export interface PwaArchiveManifest {
  readonly format: typeof ARCHIVE_FORMAT
  readonly schemaVersion: typeof PWA_ARCHIVE_SCHEMA_VERSION
  readonly storageVersion: number
  readonly vaultId: string
  readonly revision: number
  readonly eventSequence: number
  readonly fileCount: number
  readonly files: readonly PwaArchiveFile[]
}

interface ArchiveHeader {
  readonly format: typeof ARCHIVE_FORMAT
  readonly schemaVersion: number
  readonly vaultMetadata: VaultMetadata
  readonly manifestId: string
  readonly manifestEnvelope: EncryptedEnvelope
}

export interface RestorePwaArchiveOptions extends RestoreFaultHooks {
  readonly vaultId?: string
}

interface OpenedArchive {
  readonly files: Record<string, Uint8Array>
  readonly manifest: PwaArchiveManifest
  readonly key: CryptoKey
}

export async function createPwaArchive(
  database: PwaVaultDatabase,
  evidenceStore: EvidenceStore,
  evidenceIds: readonly string[],
): Promise<Uint8Array> {
  const state = await database.exportEncryptedState()
  const evidenceById = new Map(state.evidence.map((row) => [row.id, row]))
  for (const id of [...new Set(evidenceIds)].sort()) {
    evidenceById.set(id, {
      vaultId: database.vaultId,
      id,
      envelope: await evidenceStore.encryptedEnvelope(id),
    })
  }

  const files: Record<string, Uint8Array> = {}
  const descriptors: PwaArchiveFile[] = []
  const rows: readonly (readonly [ArchiveFileKind, string, unknown])[] = [
    ...[...state.events]
      .sort((left, right) => left.sequence - right.sequence)
      .map((row, index) => ['EVENT', archivePath('events', index), row] as const),
    ...[...state.projections]
      .sort(compareProjectionRows)
      .map((row, index) => ['PROJECTION', archivePath('projections', index), row] as const),
    ...[...evidenceById.values()]
      .sort((left, right) => left.id.localeCompare(right.id))
      .map((row, index) => ['EVIDENCE', archivePath('evidence', index), row] as const),
  ]
  for (const [kind, path, row] of rows) {
    const bytes = encodeJson(row)
    files[path] = bytes
    descriptors.push({ path, kind, byteLength: bytes.byteLength, sha256: await sha256(bytes) })
  }
  descriptors.sort((left, right) => left.path.localeCompare(right.path))

  const manifest: PwaArchiveManifest = {
    format: ARCHIVE_FORMAT,
    schemaVersion: PWA_ARCHIVE_SCHEMA_VERSION,
    storageVersion: database.storageVersion,
    vaultId: database.vaultId,
    revision: state.revision,
    eventSequence: state.eventSequence,
    fileCount: descriptors.length,
    files: descriptors,
  }
  const manifestBytes = encodeJson(manifest)
  const manifestId = await sha256(manifestBytes)
  const header: ArchiveHeader = {
    format: ARCHIVE_FORMAT,
    schemaVersion: PWA_ARCHIVE_SCHEMA_VERSION,
    vaultMetadata: state.vault.metadata,
    manifestId,
    manifestEnvelope: await database.seal('ARCHIVE_MANIFEST', manifestId, manifestBytes),
  }
  files[HEADER_PATH] = encodeJson(header)
  return zipSync(files, { level: 6, mtime: ZIP_EPOCH })
}

export async function inspectPwaArchive(
  archive: Uint8Array,
  passphrase: string,
): Promise<PwaArchiveManifest> {
  return (await openAuthenticatedArchive(archive, passphrase)).manifest
}

export async function restorePwaArchive(
  databaseName: string,
  archive: Uint8Array,
  passphrase: string,
  options: RestorePwaArchiveOptions = {},
): Promise<PwaVaultDatabase> {
  const opened = await openAuthenticatedArchive(archive, passphrase)
  const material = await createVaultKey(passphrase, options.vaultId)
  const events: EventRow[] = []
  const projections: ProjectionRow[] = []
  const evidence: EvidenceRow[] = []

  for (const descriptor of opened.manifest.files) {
    const oldRow = parseRow(opened.files[descriptor.path], descriptor.kind)
    const context = rowContext(oldRow, descriptor.kind, opened.manifest.vaultId)
    const plaintext = await decryptRecord(opened.key, context, oldRow.envelope)
    try {
      const newContext = { ...context, vaultId: material.metadata.vaultId }
      const envelope = await encryptRecord(material.key, newContext, plaintext)
      if (descriptor.kind === 'EVENT') {
        const row = oldRow as EventRow
        events.push({ ...row, vaultId: material.metadata.vaultId, envelope })
      } else if (descriptor.kind === 'PROJECTION') {
        const row = oldRow as ProjectionRow
        projections.push({ ...row, vaultId: material.metadata.vaultId, envelope })
      } else {
        const row = oldRow as EvidenceRow
        evidence.push({ ...row, vaultId: material.metadata.vaultId, envelope })
      }
    } finally {
      plaintext.fill(0)
    }
  }

  validateEventSequence(events, opened.manifest.eventSequence)
  const state: EncryptedVaultState = {
    vault: { vaultId: material.metadata.vaultId, metadata: material.metadata },
    events,
    projections,
    evidence,
    revision: opened.manifest.revision,
    eventSequence: opened.manifest.eventSequence,
  }
  return PwaVaultDatabase.activateRestoredVault(databaseName, state, material.key, options)
}

async function openAuthenticatedArchive(
  archive: Uint8Array,
  passphrase: string,
): Promise<OpenedArchive> {
  if (archive.byteLength === 0 || archive.byteLength > MAX_ARCHIVE_BYTES) {
    throw new Error('Invalid archive size')
  }
  let files: Record<string, Uint8Array>
  let entryCount = 0
  let declaredUncompressedBytes = 0
  let preflightError: Error | undefined
  try {
    files = unzipSync(archive, {
      filter(file) {
        entryCount += 1
        declaredUncompressedBytes += file.originalSize
        if (
          entryCount > MAX_FILES + 1
          || !validArchivePath(file.name)
          || !Number.isSafeInteger(file.originalSize)
          || file.originalSize < 0
          || file.originalSize > MAX_ENTRY_BYTES
          || declaredUncompressedBytes > MAX_UNCOMPRESSED_BYTES
        ) {
          preflightError = new Error('Archive entry exceeds extraction limits')
          throw preflightError
        }
        return true
      },
    })
  } catch {
    if (preflightError) throw preflightError
    throw new Error('Invalid archive container')
  }
  const paths = Object.keys(files)
  if (paths.length === 0 || paths.length > MAX_FILES + 1) throw new Error('Invalid archive file count')
  let totalBytes = 0
  for (const [path, bytes] of Object.entries(files)) {
    if (!validArchivePath(path) || bytes.byteLength > MAX_ENTRY_BYTES) {
      throw new Error('Invalid archive entry')
    }
    totalBytes += bytes.byteLength
    if (totalBytes > MAX_UNCOMPRESSED_BYTES) throw new Error('Archive expands beyond limit')
  }

  const header = parseHeader(files[HEADER_PATH])
  const key = await unlockVaultKey(passphrase, header.vaultMetadata)
  let manifestBytes: Uint8Array
  try {
    manifestBytes = await decryptRecord(key, manifestContext(header), header.manifestEnvelope)
  } catch {
    throw new Error('Archive manifest authentication failed')
  }
  try {
    if (await sha256(manifestBytes) !== header.manifestId) {
      throw new Error('Archive manifest hash mismatch')
    }
    const manifest = parseManifest(manifestBytes, header)
    await validateArchiveFiles(files, manifest)
    return { files, manifest, key }
  } finally {
    manifestBytes.fill(0)
  }
}

function parseHeader(bytes: Uint8Array | undefined): ArchiveHeader {
  const value = parseJsonRecord(bytes, 'Archive header is missing or invalid')
  if (value.format !== ARCHIVE_FORMAT) throw new Error('Unsupported archive format')
  if (value.schemaVersion !== PWA_ARCHIVE_SCHEMA_VERSION) throw new Error('Unsupported archive schema')
  if (!isHexSha256(value.manifestId) || !isRecord(value.vaultMetadata) || !isRecord(value.manifestEnvelope)) {
    throw new Error('Invalid archive header')
  }
  return value as unknown as ArchiveHeader
}

function parseManifest(bytes: Uint8Array, header: ArchiveHeader): PwaArchiveManifest {
  const value = parseJsonRecord(bytes, 'Invalid archive manifest')
  if (
    value.format !== ARCHIVE_FORMAT
    || value.schemaVersion !== PWA_ARCHIVE_SCHEMA_VERSION
    || value.vaultId !== header.vaultMetadata.vaultId
    || !Number.isSafeInteger(value.storageVersion)
    || value.storageVersion !== 2
    || !nonNegativeInteger(value.revision)
    || !nonNegativeInteger(value.eventSequence)
    || !nonNegativeInteger(value.fileCount)
    || !Array.isArray(value.files)
    || value.fileCount !== value.files.length
    || value.files.length > MAX_FILES
  ) {
    throw new Error('Invalid archive manifest')
  }
  const descriptors = value.files.map(parseDescriptor)
  const paths = descriptors.map((descriptor) => descriptor.path)
  if (new Set(paths).size !== paths.length || paths.some((path, index) => index > 0 && path < paths[index - 1])) {
    throw new Error('Invalid archive manifest paths')
  }
  return {
    format: ARCHIVE_FORMAT,
    schemaVersion: PWA_ARCHIVE_SCHEMA_VERSION,
    storageVersion: value.storageVersion as number,
    vaultId: value.vaultId as string,
    revision: value.revision as number,
    eventSequence: value.eventSequence as number,
    fileCount: value.fileCount as number,
    files: descriptors,
  }
}

function parseDescriptor(value: unknown): PwaArchiveFile {
  if (!isRecord(value)
    || !validDataPath(value.path)
    || !['EVENT', 'PROJECTION', 'EVIDENCE'].includes(String(value.kind))
    || !nonNegativeInteger(value.byteLength)
    || value.byteLength > MAX_ENTRY_BYTES
    || !isHexSha256(value.sha256)) {
    throw new Error('Invalid archive file descriptor')
  }
  return value as unknown as PwaArchiveFile
}

async function validateArchiveFiles(
  files: Record<string, Uint8Array>,
  manifest: PwaArchiveManifest,
) {
  const expected = new Set([HEADER_PATH, ...manifest.files.map((file) => file.path)])
  for (const descriptor of manifest.files) {
    const bytes = files[descriptor.path]
    if (!bytes) throw new Error('Archive declared entry is missing')
    if (bytes.byteLength !== descriptor.byteLength || await sha256(bytes) !== descriptor.sha256) {
      throw new Error('Archive entry hash mismatch')
    }
  }
  if (Object.keys(files).some((path) => !expected.has(path))) {
    throw new Error('Archive contains undeclared entry')
  }
}

function parseRow(bytes: Uint8Array, kind: ArchiveFileKind): EventRow | ProjectionRow | EvidenceRow {
  const value = parseJsonRecord(bytes, 'Invalid encrypted archive row')
  if (typeof value.vaultId !== 'string' || typeof value.id !== 'string' || !isRecord(value.envelope)) {
    throw new Error('Invalid encrypted archive row')
  }
  if (kind === 'EVENT' && (!positiveInteger(value.sequence) || typeof value.eventType !== 'string')) {
    throw new Error('Invalid encrypted event row')
  }
  if (kind === 'PROJECTION' && typeof value.projectionType !== 'string') {
    throw new Error('Invalid encrypted projection row')
  }
  return value as unknown as EventRow | ProjectionRow | EvidenceRow
}

function rowContext(
  row: EventRow | ProjectionRow | EvidenceRow,
  kind: ArchiveFileKind,
  vaultId: string,
): VaultRecordContext {
  if (row.vaultId !== vaultId || !validIdentifier(row.id)) {
    throw new Error('Archive row belongs to another vault')
  }
  let recordType: string
  if (kind === 'EVENT') {
    const eventType = (row as EventRow).eventType
    if (!validIdentifier(eventType)) throw new Error('Invalid encrypted event row')
    recordType = `EVENT:${eventType}`
  } else if (kind === 'PROJECTION') {
    const projectionType = (row as ProjectionRow).projectionType
    if (!validIdentifier(projectionType)) throw new Error('Invalid encrypted projection row')
    recordType = `PROJECTION:${projectionType}`
  } else {
    recordType = 'EVIDENCE'
  }
  return { vaultId, recordType, recordId: row.id, schemaVersion: VAULT_SCHEMA_VERSION }
}

function validateEventSequence(events: EventRow[], expected: number) {
  events.sort((left, right) => left.sequence - right.sequence)
  if (events.length !== expected || events.some((row, index) => row.sequence !== index + 1)) {
    throw new Error('Invalid archive event sequence')
  }
}

function manifestContext(header: ArchiveHeader): VaultRecordContext {
  return {
    vaultId: header.vaultMetadata.vaultId,
    recordType: 'ARCHIVE_MANIFEST',
    recordId: header.manifestId,
    schemaVersion: VAULT_SCHEMA_VERSION,
  }
}

function compareProjectionRows(left: ProjectionRow, right: ProjectionRow) {
  return left.projectionType.localeCompare(right.projectionType) || left.id.localeCompare(right.id)
}

function archivePath(directory: string, index: number) {
  return `${directory}/${String(index + 1).padStart(12, '0')}.json`
}

function validArchivePath(path: string) {
  return path === HEADER_PATH || validDataPath(path)
}

function validDataPath(path: unknown): path is string {
  return typeof path === 'string'
    && /^(events|projections|evidence)\/\d{12}\.json$/u.test(path)
}

function validIdentifier(value: string) {
  return Boolean(value.trim()) && value.length <= 255 && ![...value].some((character) => /\p{Cc}/u.test(character))
}

function parseJsonRecord(bytes: Uint8Array | undefined, message: string): Record<string, unknown> {
  if (!bytes || bytes.byteLength === 0) throw new Error(message)
  try {
    const value: unknown = JSON.parse(decoder.decode(bytes))
    if (!isRecord(value)) throw new Error(message)
    return value
  } catch {
    throw new Error(message)
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function positiveInteger(value: unknown): value is number {
  return Number.isSafeInteger(value) && Number(value) > 0
}

function nonNegativeInteger(value: unknown): value is number {
  return Number.isSafeInteger(value) && Number(value) >= 0
}

function isHexSha256(value: unknown): value is string {
  return typeof value === 'string' && /^[a-f0-9]{64}$/u.test(value)
}

function encodeJson(value: unknown) {
  return encoder.encode(JSON.stringify(value))
}

async function sha256(bytes: Uint8Array) {
  const view = bytes.buffer instanceof ArrayBuffer
    ? new Uint8Array(bytes.buffer, bytes.byteOffset, bytes.byteLength)
    : new Uint8Array(bytes)
  const digest = new Uint8Array(await crypto.subtle.digest('SHA-256', view))
  return [...digest].map((byte) => byte.toString(16).padStart(2, '0')).join('')
}
