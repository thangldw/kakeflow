import { deriveArgon2idInWorker } from './argonWorker'
import {
  VAULT_SCHEMA_VERSION,
  type EncryptedEnvelope,
  type VaultKdfParameters,
  type VaultKeyMaterial,
  type VaultMetadata,
  type VaultRecordContext,
} from './vaultTypes'

const AES_GCM_TAG_BITS = 128
const NONCE_BYTES = 12
const SALT_BYTES = 16
const KEY_CHECK_TEXT = 'KAKEFLOW_VAULT_KEY_CHECK_V1'
const DEFAULT_KDF_PARAMETERS = {
  algorithm: 'ARGON2ID',
  memoryKib: 65_536,
  iterations: 3,
  parallelism: 1,
  outputBytes: 32,
} as const
const usedNonces = new WeakMap<CryptoKey, Set<string>>()

export async function createVaultKey(
  passphrase: string,
  vaultId: string = crypto.randomUUID(),
): Promise<VaultKeyMaterial> {
  validateIdentifier('vault ID', vaultId)
  const salt = crypto.getRandomValues(new Uint8Array(SALT_BYTES))
  const kdf: VaultKdfParameters = {
    ...DEFAULT_KDF_PARAMETERS,
    saltBase64: bytesToBase64(salt),
  }
  const key = await deriveAesKey(passphrase, kdf)
  const keyCheckContext = vaultKeyCheckContext(vaultId)
  const keyCheckBytes = new TextEncoder().encode(KEY_CHECK_TEXT)
  try {
    const keyCheck = await encryptRecord(key, keyCheckContext, keyCheckBytes)
    return {
      key,
      metadata: {
        schemaVersion: VAULT_SCHEMA_VERSION,
        vaultId,
        kdf,
        keyCheck,
      },
    }
  } finally {
    keyCheckBytes.fill(0)
  }
}

export async function unlockVaultKey(
  passphrase: string,
  metadata: VaultMetadata,
): Promise<CryptoKey> {
  try {
    validateVaultMetadata(metadata)
    const key = await deriveAesKey(passphrase, metadata.kdf)
    const decrypted = await decryptRecord(key, vaultKeyCheckContext(metadata.vaultId), metadata.keyCheck)
    const expected = new TextEncoder().encode(KEY_CHECK_TEXT)
    try {
      if (!constantTimeEqual(decrypted, expected)) throw new Error('key check mismatch')
    } finally {
      decrypted.fill(0)
      expected.fill(0)
    }
    return key
  } catch {
    throw new Error('Vault authentication failed')
  }
}

export async function encryptRecord(
  key: CryptoKey,
  context: VaultRecordContext,
  bytes: Uint8Array,
): Promise<EncryptedEnvelope> {
  validateContext(context)
  const nonce = crypto.getRandomValues(new Uint8Array(NONCE_BYTES))
  const nonceBase64 = bytesToBase64(nonce)
  const nonces = usedNonces.get(key) ?? new Set<string>()
  if (nonces.has(nonceBase64)) throw new Error('AES-GCM nonce reuse rejected')
  nonces.add(nonceBase64)
  usedNonces.set(key, nonces)

  const ciphertext = await crypto.subtle.encrypt(
    {
      name: 'AES-GCM',
      iv: webCryptoBytes(nonce),
      additionalData: webCryptoBytes(authenticatedData(context)),
      tagLength: AES_GCM_TAG_BITS,
    },
    key,
    webCryptoBytes(bytes),
  )
  return {
    ...context,
    algorithm: 'AES-GCM',
    nonceBase64,
    ciphertextBase64: bytesToBase64(new Uint8Array(ciphertext)),
  }
}

export async function decryptRecord(
  key: CryptoKey,
  context: VaultRecordContext,
  envelope: EncryptedEnvelope,
): Promise<Uint8Array> {
  try {
    validateContext(context)
    if (
      envelope.algorithm !== 'AES-GCM'
      || envelope.schemaVersion !== context.schemaVersion
      || envelope.vaultId !== context.vaultId
      || envelope.recordType !== context.recordType
      || envelope.recordId !== context.recordId
    ) {
      throw new Error('envelope context mismatch')
    }
    const nonce = base64ToBytes(envelope.nonceBase64)
    if (nonce.length !== NONCE_BYTES) throw new Error('invalid nonce')
    const plaintext = await crypto.subtle.decrypt(
      {
        name: 'AES-GCM',
        iv: webCryptoBytes(nonce),
        additionalData: webCryptoBytes(authenticatedData(context)),
        tagLength: AES_GCM_TAG_BITS,
      },
      key,
      webCryptoBytes(base64ToBytes(envelope.ciphertextBase64)),
    )
    return new Uint8Array(plaintext)
  } catch {
    throw new Error('Encrypted record authentication failed')
  }
}

async function deriveAesKey(passphrase: string, parameters: VaultKdfParameters): Promise<CryptoKey> {
  if (passphrase.length === 0 || passphrase.length > 4_096) {
    throw new Error('Invalid vault passphrase')
  }
  validateKdfParameters(parameters)
  const passphraseBytes = new TextEncoder().encode(passphrase)
  const salt = base64ToBytes(parameters.saltBase64)
  let derivedBytes: Uint8Array | undefined
  try {
    derivedBytes = await deriveArgon2idInWorker(passphraseBytes, salt, parameters)
    if (derivedBytes.length !== parameters.outputBytes) throw new Error('Invalid derived key length')
    return await crypto.subtle.importKey(
      'raw',
      webCryptoBytes(derivedBytes),
      { name: 'AES-GCM', length: 256 },
      false,
      ['encrypt', 'decrypt'],
    )
  } finally {
    passphraseBytes.fill(0)
    derivedBytes?.fill(0)
  }
}

function validateVaultMetadata(metadata: VaultMetadata) {
  if (metadata.schemaVersion !== VAULT_SCHEMA_VERSION) throw new Error('Unsupported vault schema')
  validateIdentifier('vault ID', metadata.vaultId)
  validateKdfParameters(metadata.kdf)
}

function validateKdfParameters(parameters: VaultKdfParameters) {
  if (
    parameters.algorithm !== 'ARGON2ID'
    || parameters.outputBytes !== 32
    || parameters.memoryKib < 8_192
    || parameters.memoryKib > 1_048_576
    || parameters.iterations < 1
    || parameters.iterations > 20
    || parameters.parallelism < 1
    || parameters.parallelism > 16
    || base64ToBytes(parameters.saltBase64).length !== SALT_BYTES
  ) {
    throw new Error('Invalid Argon2id parameters')
  }
}

function validateContext(context: VaultRecordContext) {
  if (context.schemaVersion !== VAULT_SCHEMA_VERSION) throw new Error('Unsupported envelope schema')
  validateIdentifier('vault ID', context.vaultId)
  validateIdentifier('record type', context.recordType)
  validateIdentifier('record ID', context.recordId)
}

function validateIdentifier(name: string, value: string) {
  if (!value.trim() || value.length > 255 || [...value].some((character) => /\p{Cc}/u.test(character))) {
    throw new Error(`Invalid ${name}`)
  }
}

function vaultKeyCheckContext(vaultId: string): VaultRecordContext {
  return {
    vaultId,
    recordType: 'VAULT_KEY_CHECK',
    recordId: 'key-check',
    schemaVersion: VAULT_SCHEMA_VERSION,
  }
}

function authenticatedData(context: VaultRecordContext): Uint8Array {
  return new TextEncoder().encode(
    `${context.vaultId}\u0000${context.recordType}\u0000${context.recordId}\u0000${context.schemaVersion}`,
  )
}

function constantTimeEqual(left: Uint8Array, right: Uint8Array): boolean {
  let difference = left.length ^ right.length
  const length = Math.max(left.length, right.length)
  for (let index = 0; index < length; index += 1) {
    difference |= (left[index] ?? 0) ^ (right[index] ?? 0)
  }
  return difference === 0
}

function bytesToBase64(bytes: Uint8Array): string {
  let binary = ''
  for (let offset = 0; offset < bytes.length; offset += 32_768) {
    binary += String.fromCharCode(...bytes.subarray(offset, offset + 32_768))
  }
  return btoa(binary)
}

function base64ToBytes(value: string): Uint8Array {
  const binary = atob(value)
  return Uint8Array.from(binary, (character) => character.charCodeAt(0))
}

function webCryptoBytes(bytes: Uint8Array): Uint8Array<ArrayBuffer> {
  if (bytes.buffer instanceof ArrayBuffer) {
    return new Uint8Array(bytes.buffer, bytes.byteOffset, bytes.byteLength)
  }
  return new Uint8Array(bytes)
}
