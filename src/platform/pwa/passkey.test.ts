import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import {
  PasskeyCancelledError,
  PasskeyUnsupportedError,
  base64UrlToBytes,
  browserPasskeyAuthenticator,
  bytesToBase64Url,
  passkeyAvailable,
} from './passkey'

function sequence(length: number, start = 0): Uint8Array {
  return Uint8Array.from({ length }, (_, index) => (start + index) % 256)
}

const salt = sequence(32, 50)
const challenge = sequence(32, 7)
const credentialBytes = sequence(20, 90)

interface FakeCredentialOptions {
  prfFirst?: ArrayBuffer | null
  prfEnabledOnly?: boolean
}

function fakeCredential(options: FakeCredentialOptions = {}) {
  const prf = options.prfFirst
    ? { enabled: true, results: { first: options.prfFirst } }
    : options.prfEnabledOnly
      ? { enabled: true }
      : undefined
  return {
    rawId: credentialBytes.slice().buffer,
    getClientExtensionResults: () => (prf ? { prf } : {}),
  }
}

function stubCredentials(credential: unknown) {
  const create = vi.fn().mockResolvedValue(credential)
  const get = vi.fn().mockResolvedValue(credential)
  vi.stubGlobal('navigator', { credentials: { create, get } })
  return { create, get }
}

function stubLocation(hostname: string) {
  vi.stubGlobal('location', { hostname })
}

function notAllowed() {
  return new DOMException('The operation either timed out or was not allowed.', 'NotAllowedError')
}

describe('browser passkey authenticator', () => {
  beforeEach(() => {
    stubLocation('kakeflow.example')
  })

  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('creates a resident, user-verified credential with the PRF salt and returns the PRF output', async () => {
    const prfBytes = sequence(32, 200)
    const { create } = stubCredentials(fakeCredential({ prfFirst: prfBytes.slice().buffer }))
    const userId = sequence(16, 3)
    const excluded = [sequence(12, 1), sequence(24, 2)]

    const result = await browserPasskeyAuthenticator().create({
      rpId: 'kakeflow.example',
      userId,
      challenge,
      excludeCredentialIds: excluded,
      prfSalt: salt,
    })

    expect(create).toHaveBeenCalledTimes(1)
    const publicKey = create.mock.calls[0][0].publicKey
    expect(publicKey.rp.id).toBe('kakeflow.example')
    expect(publicKey.authenticatorSelection.userVerification).toBe('required')
    expect(publicKey.authenticatorSelection.residentKey).toBe('preferred')
    expect(new Uint8Array(publicKey.user.id)).toHaveLength(16)
    expect([...new Uint8Array(publicKey.user.id)]).toEqual([...userId])
    expect([...new Uint8Array(publicKey.challenge)]).toEqual([...challenge])
    expect(publicKey.excludeCredentials).toHaveLength(2)
    expect(publicKey.excludeCredentials.map((entry: { type: string }) => entry.type)).toEqual([
      'public-key',
      'public-key',
    ])
    expect(
      publicKey.excludeCredentials.map((entry: { id: ArrayBuffer }) => [...new Uint8Array(entry.id)]),
    ).toEqual(excluded.map((id) => [...id]))
    expect([...new Uint8Array(publicKey.extensions.prf.eval.first)]).toEqual([...salt])

    expect([...result.credentialId]).toEqual([...credentialBytes])
    expect(result.prfOutput).not.toBeNull()
    expect([...(result.prfOutput as Uint8Array)]).toEqual([...prfBytes])
  })

  it('returns a PRF output that is a fresh copy, not a view on the browser buffer', async () => {
    const buffer = sequence(32, 1).slice().buffer
    stubCredentials(fakeCredential({ prfFirst: buffer }))

    const result = await browserPasskeyAuthenticator().create({
      rpId: 'kakeflow.example',
      userId: sequence(16),
      challenge,
      excludeCredentialIds: [],
      prfSalt: salt,
    })

    expect(result.prfOutput?.buffer).not.toBe(buffer)
    new Uint8Array(buffer).fill(0)
    expect(result.prfOutput?.[0]).toBe(1)
  })

  it('returns a null PRF output when only prf.enabled comes back or no PRF result exists', async () => {
    const input = {
      rpId: 'kakeflow.example',
      userId: sequence(16),
      challenge,
      excludeCredentialIds: [],
      prfSalt: salt,
    }

    stubCredentials(fakeCredential({ prfEnabledOnly: true }))
    expect((await browserPasskeyAuthenticator().create(input)).prfOutput).toBeNull()

    stubCredentials(fakeCredential())
    expect((await browserPasskeyAuthenticator().create(input)).prfOutput).toBeNull()
  })

  it('maps NotAllowedError to PasskeyCancelledError on create', async () => {
    const { create } = stubCredentials(null)
    create.mockRejectedValue(notAllowed())

    await expect(
      browserPasskeyAuthenticator().create({
        rpId: 'kakeflow.example',
        userId: sequence(16),
        challenge,
        excludeCredentialIds: [],
        prfSalt: salt,
      }),
    ).rejects.toBeInstanceOf(PasskeyCancelledError)
  })

  it('rethrows other WebAuthn errors unchanged', async () => {
    const { create } = stubCredentials(null)
    const failure = new DOMException('Already registered', 'InvalidStateError')
    create.mockRejectedValue(failure)

    await expect(
      browserPasskeyAuthenticator().create({
        rpId: 'kakeflow.example',
        userId: sequence(16),
        challenge,
        excludeCredentialIds: [],
        prfSalt: salt,
      }),
    ).rejects.toBe(failure)
  })

  it('gets with every allowed credential id, user verification required and the PRF salt', async () => {
    const prfBytes = sequence(32, 9)
    const { get } = stubCredentials(fakeCredential({ prfFirst: prfBytes.slice().buffer }))
    const allowed = [sequence(16, 1), sequence(20, 2), sequence(24, 3)]

    const result = await browserPasskeyAuthenticator().get({
      rpId: 'kakeflow.example',
      challenge,
      allowCredentialIds: allowed,
      prfSalt: salt,
    })

    expect(get).toHaveBeenCalledTimes(1)
    const publicKey = get.mock.calls[0][0].publicKey
    expect(publicKey.rpId).toBe('kakeflow.example')
    expect(publicKey.userVerification).toBe('required')
    expect(
      publicKey.allowCredentials.map((entry: { id: ArrayBuffer }) => [...new Uint8Array(entry.id)]),
    ).toEqual(allowed.map((id) => [...id]))
    expect([...new Uint8Array(publicKey.extensions.prf.eval.first)]).toEqual([...salt])
    expect([...(result.prfOutput as Uint8Array)]).toEqual([...prfBytes])
    expect([...result.credentialId]).toEqual([...credentialBytes])
  })

  it('maps NotAllowedError to PasskeyCancelledError on get', async () => {
    const { get } = stubCredentials(null)
    get.mockRejectedValue(notAllowed())

    await expect(
      browserPasskeyAuthenticator().get({
        rpId: 'kakeflow.example',
        challenge,
        allowCredentialIds: [sequence(16)],
        prfSalt: salt,
      }),
    ).rejects.toBeInstanceOf(PasskeyCancelledError)
  })

  it('reports unsupported when the browser returns no credential or has no credentials API', async () => {
    stubCredentials(null)
    await expect(
      browserPasskeyAuthenticator().get({
        rpId: 'kakeflow.example',
        challenge,
        allowCredentialIds: [sequence(16)],
        prfSalt: salt,
      }),
    ).rejects.toBeInstanceOf(PasskeyUnsupportedError)

    vi.stubGlobal('navigator', {})
    await expect(
      browserPasskeyAuthenticator().create({
        rpId: 'kakeflow.example',
        userId: sequence(16),
        challenge,
        excludeCredentialIds: [],
        prfSalt: salt,
      }),
    ).rejects.toBeInstanceOf(PasskeyUnsupportedError)
  })
})

describe('passkeyAvailable', () => {
  beforeEach(() => {
    stubLocation('kakeflow.example')
  })

  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('is false when PublicKeyCredential is undefined', async () => {
    vi.stubGlobal('PublicKeyCredential', undefined)
    expect(await passkeyAvailable()).toBe(false)
  })

  it('is false for IPv4 and IPv6 hostnames', async () => {
    vi.stubGlobal('PublicKeyCredential', class {})
    for (const hostname of ['192.168.1.20', '127.0.0.1', '[::1]', '[2001:db8::1]', '::1']) {
      stubLocation(hostname)
      expect(await passkeyAvailable(), hostname).toBe(false)
    }
  })

  it('is true for localhost and ordinary hostnames', async () => {
    vi.stubGlobal('PublicKeyCredential', class {})
    for (const hostname of ['localhost', 'kakeflow.example', '1.example.com']) {
      stubLocation(hostname)
      expect(await passkeyAvailable(), hostname).toBe(true)
    }
  })

  it('is false when getClientCapabilities reports extension:prf false', async () => {
    vi.stubGlobal(
      'PublicKeyCredential',
      class {
        static getClientCapabilities = vi.fn().mockResolvedValue({ 'extension:prf': false })
      },
    )
    expect(await passkeyAvailable()).toBe(false)
  })

  it('is true when getClientCapabilities reports prf true, omits it, or fails', async () => {
    vi.stubGlobal(
      'PublicKeyCredential',
      class {
        static getClientCapabilities = vi.fn().mockResolvedValue({ 'extension:prf': true })
      },
    )
    expect(await passkeyAvailable()).toBe(true)

    vi.stubGlobal(
      'PublicKeyCredential',
      class {
        static getClientCapabilities = vi.fn().mockResolvedValue({})
      },
    )
    expect(await passkeyAvailable()).toBe(true)

    vi.stubGlobal(
      'PublicKeyCredential',
      class {
        static getClientCapabilities = vi.fn().mockRejectedValue(new Error('unavailable'))
      },
    )
    expect(await passkeyAvailable()).toBe(true)
  })
})

describe('base64url helpers', () => {
  it('round-trips 1023 bytes without padding or unsafe characters', () => {
    const bytes = sequence(1023, 5)
    const encoded = bytesToBase64Url(bytes)

    expect(encoded).toMatch(/^[A-Za-z0-9_-]+$/)
    expect([...base64UrlToBytes(encoded)]).toEqual([...bytes])
  })

  it('round-trips empty and short inputs and uses the url alphabet', () => {
    expect(bytesToBase64Url(new Uint8Array(0))).toBe('')
    expect(base64UrlToBytes('')).toHaveLength(0)
    expect(bytesToBase64Url(Uint8Array.from([251, 255, 190]))).toBe('-_--')
    expect([...base64UrlToBytes('-_--')]).toEqual([251, 255, 190])
    expect([...base64UrlToBytes(bytesToBase64Url(Uint8Array.from([1])))]).toEqual([1])
  })
})
