import { decryptRecord, encryptRecord } from './vaultCrypto'
import { VAULT_SCHEMA_VERSION, type EncryptedEnvelope, type VaultRecordContext } from './vaultTypes'

export const PASSKEY_LIMIT = 3

const PASSKEY_WRAP_RECORD_TYPE = 'PASSKEY_WRAP'
const KEK_INFO = 'KakeFlow passkey wrap v1'
const PRF_OUTPUT_BYTES = 32
const RAW_KEY_BYTES = 32
const VAULT_AUTHENTICATION_FAILED = 'Vault authentication failed'

/** base64url (no padding) of SHA-256(credential id): always 43 characters, whatever the id length. */
export async function passkeyRecordId(credentialId: Uint8Array): Promise<string> {
  const digest = new Uint8Array(await crypto.subtle.digest('SHA-256', ownBytes(credentialId)))
  return bytesToBase64Url(digest)
}

/**
 * Wraps the 32 raw vault key bytes with a KEK derived from the PRF output. The caller owns
 * `prfOutput` and `rawKey` and zeroes them; this function zeroes only its own copies.
 */
export async function wrapVaultKey(
  prfOutput: Uint8Array,
  rawKey: Uint8Array,
  vaultId: string,
  credentialId: Uint8Array,
): Promise<EncryptedEnvelope> {
  if (rawKey.length !== RAW_KEY_BYTES) throw new Error('Invalid raw vault key length')
  const kek = await deriveKek(prfOutput, vaultId)
  const context = await wrapContext(vaultId, credentialId)
  const copy = new Uint8Array(rawKey)
  try {
    return await encryptRecord(kek, context, copy)
  } finally {
    copy.fill(0)
  }
}

/**
 * Unwraps the 32 raw vault key bytes. The caller owns the returned bytes and must zero them.
 * Every failure surfaces as `Vault authentication failed`.
 */
export async function unwrapVaultKey(
  prfOutput: Uint8Array,
  envelope: EncryptedEnvelope,
  vaultId: string,
  credentialId: Uint8Array,
): Promise<Uint8Array> {
  let raw: Uint8Array | undefined
  try {
    const kek = await deriveKek(prfOutput, vaultId)
    const context = await wrapContext(vaultId, credentialId)
    raw = await decryptRecord(kek, context, envelope)
    if (raw.length !== RAW_KEY_BYTES) throw new Error('Invalid raw vault key length')
    return raw
  } catch {
    raw?.fill(0)
    throw new Error(VAULT_AUTHENTICATION_FAILED)
  }
}

async function deriveKek(prfOutput: Uint8Array, vaultId: string): Promise<CryptoKey> {
  if (prfOutput.length !== PRF_OUTPUT_BYTES) throw new Error('Invalid PRF output length')
  const ikm = ownBytes(prfOutput)
  try {
    const baseKey = await crypto.subtle.importKey('raw', ikm, 'HKDF', false, ['deriveKey'])
    return await crypto.subtle.deriveKey(
      {
        name: 'HKDF',
        hash: 'SHA-256',
        salt: new TextEncoder().encode(vaultId),
        info: new TextEncoder().encode(KEK_INFO),
      },
      baseKey,
      { name: 'AES-GCM', length: 256 },
      false,
      ['encrypt', 'decrypt'],
    )
  } finally {
    ikm.fill(0)
  }
}

async function wrapContext(vaultId: string, credentialId: Uint8Array): Promise<VaultRecordContext> {
  return {
    vaultId,
    recordType: PASSKEY_WRAP_RECORD_TYPE,
    recordId: await passkeyRecordId(credentialId),
    schemaVersion: VAULT_SCHEMA_VERSION,
  }
}

function ownBytes(bytes: Uint8Array): Uint8Array<ArrayBuffer> {
  const copy = new Uint8Array(bytes.length)
  copy.set(bytes)
  return copy
}

function bytesToBase64Url(bytes: Uint8Array): string {
  let binary = ''
  for (const byte of bytes) binary += String.fromCharCode(byte)
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
}
