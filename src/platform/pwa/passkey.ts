/**
 * The only module that talks to WebAuthn. Everything else uses the `PasskeyAuthenticator`
 * interface so tests can inject a fake. PRF bytes are copied into fresh arrays, never logged.
 */

export interface PasskeyResult {
  credentialId: Uint8Array
  /** The PRF `first` result, or null when the authenticator or browser returned none. */
  prfOutput: Uint8Array | null
}

export interface PasskeyAuthenticator {
  create(input: {
    rpId: string
    userId: Uint8Array
    challenge: Uint8Array
    excludeCredentialIds: readonly Uint8Array[]
    prfSalt: Uint8Array
  }): Promise<PasskeyResult>
  get(input: {
    rpId: string
    challenge: Uint8Array
    allowCredentialIds: readonly Uint8Array[]
    prfSalt: Uint8Array
  }): Promise<PasskeyResult>
}

/** The user dismissed, denied or timed out the passkey prompt. */
export class PasskeyCancelledError extends Error {
  constructor(message = 'Passkey request was cancelled') {
    super(message)
    this.name = 'PasskeyCancelledError'
  }
}

/** This browser or device cannot run the passkey ceremony. */
export class PasskeyUnsupportedError extends Error {
  constructor(message = 'Passkeys are not supported here') {
    super(message)
    this.name = 'PasskeyUnsupportedError'
  }
}

const RP_NAME = 'KakeFlow'
const USER_NAME = 'KakeFlow vault'
const ES256 = -7
const RS256 = -257

export function browserPasskeyAuthenticator(): PasskeyAuthenticator {
  return {
    async create(input) {
      const credential = await runCeremony(() =>
        credentialsApi().create({
          publicKey: {
            rp: { id: input.rpId, name: RP_NAME },
            user: { id: ownBuffer(input.userId), name: USER_NAME, displayName: USER_NAME },
            challenge: ownBuffer(input.challenge),
            pubKeyCredParams: [
              { type: 'public-key', alg: ES256 },
              { type: 'public-key', alg: RS256 },
            ],
            authenticatorSelection: { userVerification: 'required', residentKey: 'preferred' },
            excludeCredentials: input.excludeCredentialIds.map(descriptor),
            extensions: prfExtension(input.prfSalt),
          },
        }),
      )
      return toResult(credential)
    },
    async get(input) {
      const credential = await runCeremony(() =>
        credentialsApi().get({
          publicKey: {
            rpId: input.rpId,
            challenge: ownBuffer(input.challenge),
            userVerification: 'required',
            allowCredentials: input.allowCredentialIds.map(descriptor),
            extensions: prfExtension(input.prfSalt),
          },
        }),
      )
      return toResult(credential)
    },
  }
}

/**
 * Whether to offer the quick unlock at all. False without WebAuthn, on IP-address hosts (no valid
 * rp.id) and when the browser says it has no PRF extension; otherwise true, and enrolment fails
 * gracefully if PRF turns out to be missing.
 */
export async function passkeyAvailable(): Promise<boolean> {
  if (typeof PublicKeyCredential === 'undefined' || !PublicKeyCredential) return false
  if (isIpAddress(location.hostname)) return false
  const getClientCapabilities = (
    PublicKeyCredential as unknown as {
      getClientCapabilities?: () => Promise<Record<string, boolean | undefined>>
    }
  ).getClientCapabilities
  if (typeof getClientCapabilities === 'function') {
    try {
      const capabilities = await getClientCapabilities.call(PublicKeyCredential)
      if (capabilities?.['extension:prf'] === false) return false
    } catch {
      // Capability detection is only a hint; enrolment still fails gracefully.
    }
  }
  return true
}

export function bytesToBase64Url(bytes: Uint8Array): string {
  let binary = ''
  const chunk = 0x8000
  for (let offset = 0; offset < bytes.length; offset += chunk) {
    binary += String.fromCharCode(...bytes.subarray(offset, offset + chunk))
  }
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
}

export function base64UrlToBytes(value: string): Uint8Array {
  const base64 = value.replace(/-/g, '+').replace(/_/g, '/')
  const padded = base64 + '='.repeat((4 - (base64.length % 4)) % 4)
  const binary = atob(padded)
  const bytes = new Uint8Array(binary.length)
  for (let index = 0; index < binary.length; index += 1) bytes[index] = binary.charCodeAt(index)
  return bytes
}

function isIpAddress(hostname: string): boolean {
  if (/^\d{1,3}(\.\d{1,3}){3}$/.test(hostname)) return true
  // location.hostname brackets IPv6 literals; a colon never appears in a DNS name.
  return hostname.startsWith('[') || hostname.includes(':')
}

function credentialsApi(): CredentialsContainer {
  const credentials = typeof navigator === 'undefined' ? undefined : navigator.credentials
  if (!credentials) throw new PasskeyUnsupportedError()
  return credentials
}

async function runCeremony(call: () => Promise<Credential | null>): Promise<Credential> {
  let credential: Credential | null
  try {
    credential = await call()
  } catch (error) {
    if (isNamedError(error, 'NotAllowedError')) throw new PasskeyCancelledError()
    throw error
  }
  if (!credential) throw new PasskeyUnsupportedError()
  return credential
}

function isNamedError(error: unknown, name: string): boolean {
  return typeof error === 'object' && error !== null && (error as { name?: unknown }).name === name
}

function descriptor(id: Uint8Array): PublicKeyCredentialDescriptor {
  return { type: 'public-key', id: ownBuffer(id) }
}

function prfExtension(salt: Uint8Array): AuthenticationExtensionsClientInputs {
  return { prf: { eval: { first: ownBuffer(salt) } } } as AuthenticationExtensionsClientInputs
}

function toResult(credential: Credential): PasskeyResult {
  const publicKeyCredential = credential as PublicKeyCredential
  const extensions = publicKeyCredential.getClientExtensionResults() as {
    prf?: { results?: { first?: ArrayBuffer | ArrayBufferView } }
  }
  const first = extensions.prf?.results?.first
  return {
    credentialId: new Uint8Array(copyBytes(publicKeyCredential.rawId)),
    prfOutput: first ? new Uint8Array(copyBytes(first)) : null,
  }
}

/** A fresh ArrayBuffer holding exactly the given bytes, so callers keep ownership of their own. */
function ownBuffer(bytes: Uint8Array): ArrayBuffer {
  return copyBytes(bytes)
}

function copyBytes(source: ArrayBuffer | ArrayBufferView): ArrayBuffer {
  const view = ArrayBuffer.isView(source)
    ? new Uint8Array(source.buffer, source.byteOffset, source.byteLength)
    : new Uint8Array(source)
  const copy = new ArrayBuffer(view.byteLength)
  new Uint8Array(copy).set(view)
  return copy
}
