import { vi } from 'vitest'
import type { PasskeyAuthenticator } from '../platform/pwa/passkey'

/**
 * A deterministic PRF authenticator for tests: every `create` makes a new credential id, and the PRF output
 * depends on the credential id and the salt only, like a real authenticator's.
 */
export function fakePasskeyAuthenticator(options: { create?: () => Promise<never>; get?: () => Promise<never> } = {}) {
  let counter = 0
  const prf = async (id: Uint8Array, salt: Uint8Array) => {
    const input = new Uint8Array(id.length + salt.length)
    input.set(id)
    input.set(salt, id.length)
    return new Uint8Array(await crypto.subtle.digest('SHA-256', input))
  }
  const create = vi.fn(async (input: Parameters<PasskeyAuthenticator['create']>[0]) => {
    await options.create?.()
    counter += 1
    const id = new Uint8Array(16).fill(counter)
    return { credentialId: id, prfOutput: await prf(id, input.prfSalt) }
  })
  const get = vi.fn(async (input: Parameters<PasskeyAuthenticator['get']>[0]) => {
    await options.get?.()
    const id = new Uint8Array(input.allowCredentialIds[0])
    return { credentialId: id, prfOutput: await prf(id, input.prfSalt) }
  })
  return { create, get } satisfies PasskeyAuthenticator
}
