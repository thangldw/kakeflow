export const VAULT_SCHEMA_VERSION = 1 as const

export interface VaultKdfParameters {
  readonly algorithm: 'ARGON2ID'
  readonly saltBase64: string
  readonly memoryKib: number
  readonly iterations: number
  readonly parallelism: number
  readonly outputBytes: 32
}

export interface VaultRecordContext {
  readonly vaultId: string
  readonly recordType: string
  readonly recordId: string
  readonly schemaVersion: typeof VAULT_SCHEMA_VERSION
}

export interface EncryptedEnvelope extends VaultRecordContext {
  readonly algorithm: 'AES-GCM'
  readonly nonceBase64: string
  readonly ciphertextBase64: string
}

export interface VaultMetadata {
  readonly schemaVersion: typeof VAULT_SCHEMA_VERSION
  readonly vaultId: string
  readonly kdf: VaultKdfParameters
  readonly keyCheck: EncryptedEnvelope
}

export interface VaultKeyMaterial {
  readonly metadata: VaultMetadata
  readonly key: CryptoKey
}
