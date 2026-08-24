import { beforeEach, describe, expect, it, vi } from 'vitest'

const argonMock = vi.hoisted(() => ({
  inputs: [] as Uint8Array[],
  derive: vi.fn(async (passphrase: Uint8Array, salt: Uint8Array) => {
    argonMock.inputs.push(passphrase)
    const output = new Uint8Array(32)
    for (let index = 0; index < output.length; index += 1) {
      output[index] = passphrase[index % passphrase.length] ^ salt[index % salt.length] ^ index
    }
    return output
  }),
}))

vi.mock('./argonWorker', () => ({
  deriveArgon2idInWorker: argonMock.derive,
}))

import {
  createVaultKey,
  decryptRecord,
  encryptRecord,
  unlockVaultKey,
} from './vaultCrypto'
import type { EncryptedEnvelope, VaultRecordContext } from './vaultTypes'

const context: VaultRecordContext = {
  vaultId: 'vault-1',
  recordType: 'LEDGER_EVENT',
  recordId: 'event-1',
  schemaVersion: 1,
}
const plaintext = new TextEncoder().encode('synthetic grocery receipt: 1,000 JPY')

function mutateCiphertext(envelope: EncryptedEnvelope): EncryptedEnvelope {
  const ciphertext = Uint8Array.from(atob(envelope.ciphertextBase64), (character) => character.charCodeAt(0))
  ciphertext[0] ^= 1
  return {
    ...envelope,
    ciphertextBase64: btoa(String.fromCharCode(...ciphertext)),
  }
}

describe('PWA vault crypto', () => {
  beforeEach(() => {
    argonMock.inputs.length = 0
    argonMock.derive.mockClear()
  })

  it('creates a versioned key envelope and imports a non-extractable key', async () => {
    const material = await createVaultKey('correct horse battery staple', 'vault-1')

    expect(material.metadata).toMatchObject({
      schemaVersion: 1,
      vaultId: 'vault-1',
      kdf: {
        algorithm: 'ARGON2ID',
        memoryKib: 65_536,
        iterations: 3,
        parallelism: 1,
        outputBytes: 32,
      },
    })
    expect(atob(material.metadata.kdf.saltBase64)).toHaveLength(16)
    await expect(crypto.subtle.exportKey('raw', material.key)).rejects.toThrow()
    expect([...argonMock.inputs[0]]).toEqual(Array(argonMock.inputs[0].length).fill(0))
  })

  it('round-trips bytes and unlocks the same vault with the passphrase', async () => {
    const material = await createVaultKey('correct horse battery staple', 'vault-1')
    const unlocked = await unlockVaultKey('correct horse battery staple', material.metadata)
    const envelope = await encryptRecord(unlocked, context, plaintext)

    const decrypted = await decryptRecord(unlocked, context, envelope)
    expect([...decrypted]).toEqual([...plaintext])
  })

  it('rejects a wrong passphrase without returning a key', async () => {
    const material = await createVaultKey('correct horse battery staple', 'vault-1')

    await expect(unlockVaultKey('wrong passphrase', material.metadata)).rejects.toThrow(
      'Vault authentication failed',
    )
  })

  it('rejects modified ciphertext', async () => {
    const { key } = await createVaultKey('correct horse battery staple', 'vault-1')
    const envelope = await encryptRecord(key, context, plaintext)

    await expect(decryptRecord(key, context, mutateCiphertext(envelope))).rejects.toThrow(
      'Encrypted record authentication failed',
    )
  })

  it('binds ciphertext to every AAD context field', async () => {
    const { key } = await createVaultKey('correct horse battery staple', 'vault-1')
    const envelope = await encryptRecord(key, context, plaintext)
    const alteredContext = { ...context, recordId: 'event-2' }
    const alteredEnvelope = { ...envelope, recordId: 'event-2' }

    await expect(decryptRecord(key, alteredContext, alteredEnvelope)).rejects.toThrow(
      'Encrypted record authentication failed',
    )
  })

  it('uses distinct nonces for identical plaintext', async () => {
    const { key } = await createVaultKey('correct horse battery staple', 'vault-1')
    const first = await encryptRecord(key, context, plaintext)
    const second = await encryptRecord(key, { ...context, recordId: 'event-2' }, plaintext)

    expect(first.nonceBase64).not.toBe(second.nonceBase64)
    expect(first.ciphertextBase64).not.toBe(second.ciphertextBase64)
  })

  it('rejects nonce reuse within one active key session', async () => {
    const { key } = await createVaultKey('correct horse battery staple', 'vault-1')
    const randomSpy = vi.spyOn(crypto, 'getRandomValues').mockImplementation(((array: ArrayBufferView) => {
      new Uint8Array(array.buffer, array.byteOffset, array.byteLength).fill(7)
      return array
    }) as Crypto['getRandomValues'])
    try {
      await encryptRecord(key, context, plaintext)
      await expect(
        encryptRecord(key, { ...context, recordId: 'event-2' }, plaintext),
      ).rejects.toThrow('AES-GCM nonce reuse rejected')
    } finally {
      randomSpy.mockRestore()
    }
  })

  it('never serializes the passphrase or plaintext into metadata or envelopes', async () => {
    const passphrase = 'correct horse battery staple'
    const material = await createVaultKey(passphrase, 'vault-1')
    const envelope = await encryptRecord(material.key, context, plaintext)
    const serialized = JSON.stringify({ metadata: material.metadata, envelope })

    expect(serialized).not.toContain(passphrase)
    expect(serialized).not.toContain(new TextDecoder().decode(plaintext))
    expect(serialized).not.toContain('KAKEFLOW_VAULT_KEY_CHECK')
  })
})
