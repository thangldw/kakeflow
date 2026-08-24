import { readFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'

import { deriveArgon2idInWorker } from './argonWorker'
import type { VaultKdfParameters } from './vaultTypes'

const originalFetch = globalThis.fetch
const parameters: VaultKdfParameters = {
  algorithm: 'ARGON2ID',
  saltBase64: '',
  memoryKib: 64,
  iterations: 2,
  parallelism: 1,
  outputBytes: 32,
}

describe('Argon2id WASM worker boundary', () => {
  beforeAll(() => {
    vi.stubGlobal('fetch', async (input: RequestInfo | URL) => {
      if (String(input).endsWith('kakeflow_core_bg.wasm')) {
        const bytes = await readFile(resolve('src/platform/pwa/core-wasm/kakeflow_core_bg.wasm'))
        return new Response(bytes, { headers: { 'Content-Type': 'application/wasm' } })
      }
      return originalFetch(input)
    })
  })

  afterAll(() => {
    vi.unstubAllGlobals()
  })

  it('derives the same 32-byte key as a deterministic WASM operation', async () => {
    const passphrase = new TextEncoder().encode('correct horse battery staple')
    const salt = new TextEncoder().encode('0123456789abcdef')

    const first = await deriveArgon2idInWorker(passphrase, salt, parameters)
    const repeated = await deriveArgon2idInWorker(passphrase, salt, parameters)

    expect(first).toHaveLength(32)
    expect([...first]).toEqual([...repeated])
  })
})
