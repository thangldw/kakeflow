import { describe, expect, it } from 'vitest'

import { PASSKEY_LIMIT, passkeyRecordId, unwrapVaultKey, wrapVaultKey } from './passkeyWrap'
import type { EncryptedEnvelope } from './vaultTypes'

function filled(length: number, value: number): Uint8Array {
  return new Uint8Array(length).fill(value)
}

function sequence(length: number, start = 0): Uint8Array {
  return Uint8Array.from({ length }, (_, index) => (start + index) % 256)
}

const prfOutput = filled(32, 11)
const rawKey = sequence(32, 100)
const credentialId = sequence(16, 1)

describe('PWA passkey wrap', () => {
  it('allows at most three passkeys per vault', () => {
    expect(PASSKEY_LIMIT).toBe(3)
  })

  it('wraps and unwraps the 32 raw vault key bytes', async () => {
    const envelope = await wrapVaultKey(prfOutput, rawKey, 'vault-1', credentialId)
    const unwrapped = await unwrapVaultKey(prfOutput, envelope, 'vault-1', credentialId)

    expect(unwrapped).toHaveLength(32)
    expect([...unwrapped]).toEqual([...rawKey])
  })

  it('labels the wrapper as a PASSKEY_WRAP record bound to the vault and credential', async () => {
    const envelope = await wrapVaultKey(prfOutput, rawKey, 'vault-1', credentialId)

    expect(envelope).toMatchObject({
      algorithm: 'AES-GCM',
      vaultId: 'vault-1',
      recordType: 'PASSKEY_WRAP',
      recordId: await passkeyRecordId(credentialId),
      schemaVersion: 1,
    })
    expect(JSON.stringify(envelope)).not.toContain(btoa(String.fromCharCode(...rawKey)))
  })

  it('does not retain or zero the caller-owned inputs', async () => {
    const prf = filled(32, 11)
    const raw = sequence(32, 100)
    await wrapVaultKey(prf, raw, 'vault-1', credentialId)

    expect([...prf]).toEqual([...prfOutput])
    expect([...raw]).toEqual([...rawKey])
  })

  it('rejects a different PRF output', async () => {
    const envelope = await wrapVaultKey(prfOutput, rawKey, 'vault-1', credentialId)

    await expect(unwrapVaultKey(filled(32, 12), envelope, 'vault-1', credentialId)).rejects.toThrow(
      'Vault authentication failed',
    )
  })

  it('rejects unwrapping for another vault', async () => {
    const envelope = await wrapVaultKey(prfOutput, rawKey, 'vault-1', credentialId)
    const moved: EncryptedEnvelope = { ...envelope, vaultId: 'vault-2' }

    await expect(unwrapVaultKey(prfOutput, envelope, 'vault-2', credentialId)).rejects.toThrow(
      'Vault authentication failed',
    )
    await expect(unwrapVaultKey(prfOutput, moved, 'vault-2', credentialId)).rejects.toThrow(
      'Vault authentication failed',
    )
  })

  it('rejects unwrapping with a different credential id', async () => {
    const envelope = await wrapVaultKey(prfOutput, rawKey, 'vault-1', credentialId)
    const otherCredential = sequence(16, 2)
    const moved: EncryptedEnvelope = { ...envelope, recordId: await passkeyRecordId(otherCredential) }

    await expect(unwrapVaultKey(prfOutput, envelope, 'vault-1', otherCredential)).rejects.toThrow(
      'Vault authentication failed',
    )
    await expect(unwrapVaultKey(prfOutput, moved, 'vault-1', otherCredential)).rejects.toThrow(
      'Vault authentication failed',
    )
  })

  it('wraps for a 1023-byte credential id with a 43-character record id', async () => {
    const longCredential = sequence(1023, 7)
    const recordId = await passkeyRecordId(longCredential)
    const envelope = await wrapVaultKey(prfOutput, rawKey, 'vault-1', longCredential)

    expect(recordId).toHaveLength(43)
    expect(recordId).toMatch(/^[A-Za-z0-9_-]{43}$/)
    expect(envelope.recordId).toBe(recordId)
    expect([...(await unwrapVaultKey(prfOutput, envelope, 'vault-1', longCredential))]).toEqual([...rawKey])
  })

  it('rejects a raw key that is not 32 bytes', async () => {
    await expect(wrapVaultKey(prfOutput, sequence(16), 'vault-1', credentialId)).rejects.toThrow()
  })
})
