import type { FamilyDeliveryPreparedArtifactDto, FamilyDeliveryRemoteArtifactDto } from '../../platform'

const MAX_PACKAGE_BYTES = 64 * 1024 * 1024
const ARTIFACT_SCHEMAS = new Set<FamilyDeliveryPreparedArtifactDto['artifactSchema']>(['FAMILY_AUDIENCE_PARTITION_V1', 'FAMILY_AUDIENCE_PARTITION_V2', 'FAMILY_AUDIENCE_PARTITION_V3'])
const ENVELOPE_SCHEMA = 'FAMILY_ENCRYPTED_ENVELOPE_V1' as const
const HASH = /^[0-9a-f]{64}$/
const ENCRYPTION_PUBLIC_KEY = /^[A-Za-z0-9_-]{43}$/

export type FamilyDeliveryHttpErrorCode =
  | 'AUTH_EXPIRED' | 'NETWORK_RETRYABLE' | 'INVITE_EXPIRED' | 'INVITE_USED' | 'INVITE_REVOKED' | 'INVITE_UNAVAILABLE'
  | 'HOUSEHOLD_MISMATCH' | 'MEMBER_ARCHIVED' | 'PRINCIPAL_ALREADY_LINKED' | 'MEMBERSHIP_REVOKED'
  | 'AUDIENCE_DENIED' | 'INVALID_ARTIFACT' | 'RECIPIENT_UNAVAILABLE' | 'RECIPIENT_SET_CHANGED' | 'OWNER_REQUIRED'
  | 'REJECTED' | 'INVALID_RESPONSE' | 'INVALID_ENDPOINT'

export class FamilyDeliveryHttpError extends Error {
  constructor(readonly code: FamilyDeliveryHttpErrorCode) { super(code) }
}

export interface FamilyRemoteMembership {
  readonly membershipId: string; readonly householdId: string; readonly principalId: string
  readonly domainMemberId: string; readonly role: 'OWNER' | 'MEMBER'; readonly state: 'ACTIVE' | 'REVOKED'
  readonly generation: number; readonly joinedAt: string; readonly revokedAt: string | null
  readonly encryptionKeyId: string | null; readonly encryptionPublicKey: string | null
  readonly encryptionKeyGeneration: number; readonly encryptionKeyUpdatedAt: string | null
}
export interface FamilyEncryptionKeyRegistration {
  readonly keyId: string; readonly publicKey: string; readonly generation: number
}
export interface FamilyEncryptedArtifactUpload {
  readonly deliveryId: string; readonly artifactId: string; readonly householdId: string
  readonly originDeviceId: string; readonly audienceKey: string
  readonly audienceVisibility: FamilyDeliveryPreparedArtifactDto['audienceVisibility']; readonly audienceMemberId: string | null
  readonly artifactSchema: FamilyDeliveryPreparedArtifactDto['artifactSchema']
  readonly envelopeSchema: typeof ENVELOPE_SCHEMA; readonly envelopeBytes: readonly number[]
  readonly transportDigest: string; readonly innerDigest: string; readonly recipientSetDigest: string
}
export interface FamilyRemoteInvite {
  readonly inviteId: string; readonly householdId: string; readonly domainMemberId: string
  readonly state: 'ACTIVE' | 'REVOKED' | 'REDEEMED'; readonly expiresAt: string
}
export interface FamilyRemoteState {
  readonly householdId: string; readonly remotePrincipalId: string
  readonly localMembership: FamilyRemoteMembership | null
  readonly memberships: readonly FamilyRemoteMembership[]; readonly invites: readonly FamilyRemoteInvite[]
}
export interface FamilyInvitationResult { readonly inviteId: string; readonly inviteCode: string; readonly expiresAt: string }
export interface FamilyInvitationPreview { readonly householdId: string; readonly domainMemberId: string; readonly role: 'MEMBER'; readonly expiresAt: string }
export interface FamilyDeliveryAcceptance { readonly deliveryId: string; readonly artifactId: string; readonly digest: string; readonly acceptedAt: string }
export interface FamilyArtifactPage { readonly artifacts: readonly FamilyDeliveryRemoteArtifactDto[]; readonly nextCursor: number }

function endpointUrl(endpoint: string, path: string): string {
  try {
    const url = new URL(endpoint)
    if (url.protocol !== 'https:' && !(url.protocol === 'http:' && ['127.0.0.1', 'localhost', '[::1]'].includes(url.hostname))) throw new Error()
    return new URL(path, `${url.toString().replace(/\/$/, '')}/`).toString()
  } catch { throw new FamilyDeliveryHttpError('INVALID_ENDPOINT') }
}

function mapServerError(code: string, status: number): FamilyDeliveryHttpErrorCode {
  if (status === 401 || code === 'AUTHENTICATION_REQUIRED') return 'AUTH_EXPIRED'
  if (['INVITE_EXPIRED', 'INVITE_USED', 'INVITE_REVOKED', 'INVITE_UNAVAILABLE'].includes(code)) return code as FamilyDeliveryHttpErrorCode
  if (['MEMBERSHIP_CONFLICT', 'DOMAIN_MEMBER_INVITE_ALREADY_ACTIVE'].includes(code)) return 'PRINCIPAL_ALREADY_LINKED'
  if (['ACTIVE_MEMBERSHIP_REQUIRED', 'HOUSEHOLD_NOT_FOUND', 'MEMBERSHIP_NOT_FOUND'].includes(code)) return 'MEMBERSHIP_REVOKED'
  if (['PERSONAL_AUDIENCE_MISMATCH', 'PUBLICATION_NOT_FOUND'].includes(code)) return 'AUDIENCE_DENIED'
  if (status === 409 && code === 'RECIPIENT_SET_CHANGED') return 'RECIPIENT_SET_CHANGED'
  if (['NO_ACTIVE_RECIPIENTS', 'RECIPIENT_KEY_UNAVAILABLE'].includes(code)) return 'RECIPIENT_UNAVAILABLE'
  if (code === 'OWNER_REQUIRED') return 'OWNER_REQUIRED'
  if (['DIGEST_MISMATCH', 'EMPTY_ARTIFACT', 'INVALID_PUBLICATION_HEADERS', 'ARTIFACT_TOO_LARGE'].includes(code)) return 'INVALID_ARTIFACT'
  return 'REJECTED'
}

async function request(endpoint: string, path: string, token: string, init: RequestInit = {}, fetcher: typeof fetch = fetch): Promise<Response> {
  try {
    const response = await fetcher(endpointUrl(endpoint, path), {
      ...init, headers: { Authorization: `Bearer ${token}`, ...init.headers },
      signal: init.signal ?? AbortSignal.timeout(15_000),
    })
    if (!response.ok) {
      const value = await response.clone().json().catch(() => null) as { error?: unknown } | null
      throw new FamilyDeliveryHttpError(mapServerError(typeof value?.error === 'string' ? value.error : '', response.status))
    }
    return response
  } catch (error) {
    if (error instanceof FamilyDeliveryHttpError) throw error
    throw new FamilyDeliveryHttpError('NETWORK_RETRYABLE')
  }
}

const record = (value: unknown): Record<string, unknown> => {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) throw new FamilyDeliveryHttpError('INVALID_RESPONSE')
  return value as Record<string, unknown>
}
const string = (value: unknown): string => { if (typeof value !== 'string' || !value) throw new FamilyDeliveryHttpError('INVALID_RESPONSE'); return value }
const nullableString = (value: unknown): string | null => value === null ? null : string(value)
const integer = (value: unknown): number => { if (!Number.isSafeInteger(value) || Number(value) < 0) throw new FamilyDeliveryHttpError('INVALID_RESPONSE'); return Number(value) }
const timestamp = (value: unknown): string => { const result = string(value); if (Number.isNaN(Date.parse(result))) throw new FamilyDeliveryHttpError('INVALID_RESPONSE'); return result }
const hash = (value: unknown): string => { const result = string(value); if (!HASH.test(result)) throw new FamilyDeliveryHttpError('INVALID_RESPONSE'); return result }
const nullableHash = (value: unknown): string | null => value === null || value === undefined ? null : hash(value)
const nullableTimestamp = (value: unknown): string | null => value === null || value === undefined ? null : timestamp(value)

async function digestBytes(bytes: Uint8Array): Promise<string> {
  return [...new Uint8Array(await crypto.subtle.digest('SHA-256', Uint8Array.from(bytes).buffer))].map((byte) => byte.toString(16).padStart(2, '0')).join('')
}

export async function familyRecipientSetDigest(memberships: readonly FamilyRemoteMembership[]): Promise<string> {
  const canonical = [...memberships].sort((left, right) => left.membershipId.localeCompare(right.membershipId)).map((item) => {
    if (!item.membershipId || item.encryptionKeyId === null || item.encryptionPublicKey === null
      || !HASH.test(item.encryptionKeyId) || !ENCRYPTION_PUBLIC_KEY.test(item.encryptionPublicKey)
      || !Number.isSafeInteger(item.encryptionKeyGeneration) || item.encryptionKeyGeneration < 1) {
      throw new FamilyDeliveryHttpError('RECIPIENT_UNAVAILABLE')
    }
    return `${item.membershipId}\0${item.encryptionKeyGeneration}\0${item.encryptionKeyId}\0${item.encryptionPublicKey}\0`
  }).join('')
  return digestBytes(new TextEncoder().encode(canonical))
}

function parseMembership(value: unknown): FamilyRemoteMembership {
  const item = record(value)
  if (!['OWNER', 'MEMBER'].includes(String(item.role)) || !['ACTIVE', 'REVOKED'].includes(String(item.state))) throw new FamilyDeliveryHttpError('INVALID_RESPONSE')
  const encryptionKeyId = nullableHash(item.encryptionKeyId)
  const encryptionPublicKey = item.encryptionPublicKey === null || item.encryptionPublicKey === undefined ? null : string(item.encryptionPublicKey)
  const encryptionKeyGeneration = integer(item.encryptionKeyGeneration ?? 0)
  const encryptionKeyUpdatedAt = nullableTimestamp(item.encryptionKeyUpdatedAt)
  const hasEncryptionKey = encryptionKeyId !== null
  if (hasEncryptionKey !== (encryptionPublicKey !== null) || hasEncryptionKey !== (encryptionKeyUpdatedAt !== null)
    || (hasEncryptionKey ? encryptionKeyGeneration < 1 || !ENCRYPTION_PUBLIC_KEY.test(encryptionPublicKey!) : encryptionKeyGeneration !== 0)) {
    throw new FamilyDeliveryHttpError('INVALID_RESPONSE')
  }
  return {
    membershipId: string(item.membershipId), householdId: string(item.householdId), principalId: string(item.principalId),
    domainMemberId: string(item.domainMemberId), role: item.role as FamilyRemoteMembership['role'], state: item.state as FamilyRemoteMembership['state'],
    generation: integer(item.generation), joinedAt: timestamp(item.joinedAt), revokedAt: nullableString(item.revokedAt),
    encryptionKeyId, encryptionPublicKey, encryptionKeyGeneration, encryptionKeyUpdatedAt,
  }
}
function parseInvite(value: unknown): FamilyRemoteInvite {
  const item = record(value)
  if (!['ACTIVE', 'REVOKED', 'REDEEMED'].includes(String(item.state))) throw new FamilyDeliveryHttpError('INVALID_RESPONSE')
  return { inviteId: string(item.inviteId), householdId: string(item.householdId), domainMemberId: string(item.domainMemberId), state: item.state as FamilyRemoteInvite['state'], expiresAt: timestamp(item.expiresAt) }
}

async function whoami(endpoint: string, token: string, fetcher?: typeof fetch): Promise<{ remotePrincipalId: string; memberships: readonly FamilyRemoteMembership[] }> {
  const response = await request(endpoint, '/v2/whoami', token, {}, fetcher); const value = record(await response.json())
  if (!Array.isArray(value.memberships)) throw new FamilyDeliveryHttpError('INVALID_RESPONSE')
  return { remotePrincipalId: string(value.remotePrincipalId), memberships: value.memberships.map(parseMembership) }
}

export async function createFamilyHousehold(endpoint: string, token: string, householdId: string, domainMemberId: string, idempotencyKey: string, fetcher?: typeof fetch): Promise<void> {
  await request(endpoint, '/v2/households', token, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ householdId, domainMemberId, idempotencyKey }) }, fetcher)
}

export async function getFamilyRemoteState(endpoint: string, token: string, householdId: string, fetcher?: typeof fetch): Promise<FamilyRemoteState> {
  const identity = await whoami(endpoint, token, fetcher)
  const localMembership = identity.memberships.find((item) => item.householdId === householdId && item.state === 'ACTIVE') ?? null
  if (!localMembership) return { householdId, remotePrincipalId: identity.remotePrincipalId, localMembership: null, memberships: [], invites: [] }
  const membersResponse = await request(endpoint, `/v2/households/${encodeURIComponent(householdId)}/members`, token, {}, fetcher)
  const membersValue = record(await membersResponse.json())
  if (!Array.isArray(membersValue.members)) throw new FamilyDeliveryHttpError('INVALID_RESPONSE')
  let invites: readonly FamilyRemoteInvite[] = []
  if (localMembership.role === 'OWNER') {
    const inviteResponse = await request(endpoint, `/v2/households/${encodeURIComponent(householdId)}/invites`, token, {}, fetcher)
    const inviteValue = record(await inviteResponse.json())
    if (!Array.isArray(inviteValue.invites)) throw new FamilyDeliveryHttpError('INVALID_RESPONSE')
    invites = inviteValue.invites.map(parseInvite)
  }
  return { householdId, remotePrincipalId: identity.remotePrincipalId, localMembership, memberships: membersValue.members.map(parseMembership), invites }
}

export async function createFamilyInvitation(endpoint: string, token: string, householdId: string, domainMemberId: string, idempotencyKey: string, fetcher?: typeof fetch): Promise<FamilyInvitationResult> {
  const response = await request(endpoint, `/v2/households/${encodeURIComponent(householdId)}/invites`, token, {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ domainMemberId, idempotencyKey, expiresInSeconds: 86400 }),
  }, fetcher)
  const value = record(await response.json()); const invite = record(value.invite)
  return { inviteId: string(invite.inviteId), inviteCode: string(invite.code), expiresAt: timestamp(invite.expiresAt) }
}

export async function cancelFamilyInvitation(endpoint: string, token: string, householdId: string, inviteId: string, fetcher?: typeof fetch): Promise<void> {
  await request(endpoint, `/v2/households/${encodeURIComponent(householdId)}/invites/${encodeURIComponent(inviteId)}`, token, { method: 'DELETE' }, fetcher)
}

export async function redeemFamilyInvitation(endpoint: string, token: string, inviteCode: string, fetcher?: typeof fetch): Promise<FamilyRemoteMembership> {
  const response = await request(endpoint, '/v2/invites/redeem', token, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ code: inviteCode }) }, fetcher)
  return parseMembership(record(await response.json()).membership)
}

export async function previewFamilyInvitation(endpoint: string, token: string, inviteCode: string, fetcher?: typeof fetch): Promise<FamilyInvitationPreview> {
  const response = await request(endpoint, '/v2/invites/preview', token, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ code: inviteCode }) }, fetcher)
  const invite = record(record(await response.json()).invite)
  if (invite.role !== 'MEMBER') throw new FamilyDeliveryHttpError('INVALID_RESPONSE')
  return { householdId: string(invite.householdId), domainMemberId: string(invite.domainMemberId), role: 'MEMBER', expiresAt: timestamp(invite.expiresAt) }
}

export async function revokeFamilyMembership(endpoint: string, token: string, householdId: string, membershipId: string, fetcher?: typeof fetch): Promise<void> {
  await request(endpoint, `/v2/households/${encodeURIComponent(householdId)}/members/${encodeURIComponent(membershipId)}`, token, { method: 'DELETE' }, fetcher)
}

export async function registerFamilyEncryptionKey(endpoint: string, token: string, householdId: string, key: FamilyEncryptionKeyRegistration, fetcher?: typeof fetch): Promise<FamilyRemoteMembership> {
  if (!HASH.test(key.keyId) || !ENCRYPTION_PUBLIC_KEY.test(key.publicKey) || !Number.isSafeInteger(key.generation) || key.generation < 1) {
    throw new FamilyDeliveryHttpError('INVALID_ARTIFACT')
  }
  const response = await request(endpoint, `/v2/households/${encodeURIComponent(householdId)}/members/encryption-key`, token, {
    method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(key),
  }, fetcher)
  return parseMembership(record(await response.json()).membership)
}

export async function uploadFamilyArtifact(endpoint: string, token: string, artifact: FamilyDeliveryPreparedArtifactDto | FamilyEncryptedArtifactUpload, fetcher?: typeof fetch): Promise<FamilyDeliveryAcceptance> {
  const encrypted = 'envelopeBytes' in artifact
  const packageBytes = new Uint8Array(encrypted ? artifact.envelopeBytes : artifact.packageBytes)
  const transportDigest = encrypted ? artifact.transportDigest : artifact.digest
  if (packageBytes.length === 0 || packageBytes.length > MAX_PACKAGE_BYTES || !HASH.test(transportDigest)
    || (encrypted && (!HASH.test(artifact.innerDigest) || !HASH.test(artifact.recipientSetDigest) || await digestBytes(packageBytes) !== transportDigest))) {
    throw new FamilyDeliveryHttpError('INVALID_ARTIFACT')
  }
  const headers: Record<string, string> = {
    'Content-Type': 'application/octet-stream', 'x-kakeflow-publication-id': artifact.artifactId,
    'x-kakeflow-digest': transportDigest, 'x-kakeflow-origin-device-id': artifact.originDeviceId,
    'x-kakeflow-audience-visibility': artifact.audienceVisibility, 'x-kakeflow-artifact-schema': artifact.artifactSchema,
  }
  if (artifact.audienceMemberId) headers['x-kakeflow-audience-member-id'] = artifact.audienceMemberId
  if (encrypted) {
    headers['x-kakeflow-envelope-schema'] = artifact.envelopeSchema
    headers['x-kakeflow-recipient-set-digest'] = artifact.recipientSetDigest
    headers['x-kakeflow-inner-digest'] = artifact.innerDigest
  }
  const response = await request(endpoint, `/v2/households/${encodeURIComponent(artifact.householdId)}/publications`, token, { method: 'POST', headers, body: packageBytes }, fetcher)
  const publication = record(record(await response.json()).publication)
  const artifactId = string(publication.publicationId)
  const relayTransportDigest = hash(publication.digest)
  if (artifactId !== artifact.artifactId || relayTransportDigest !== transportDigest) throw new FamilyDeliveryHttpError('INVALID_ARTIFACT')
  if (encrypted) {
    if (publication.envelopeSchema !== artifact.envelopeSchema || hash(publication.recipientSetDigest) !== artifact.recipientSetDigest
      || hash(publication.innerDigest) !== artifact.innerDigest) throw new FamilyDeliveryHttpError('INVALID_ARTIFACT')
  }
  return { deliveryId: artifact.deliveryId, artifactId, digest: relayTransportDigest, acceptedAt: timestamp(publication.createdAt) }
}

function parsePublication(value: unknown): FamilyDeliveryRemoteArtifactDto {
  const item = record(value); const audience = record(item.audience)
  if (!['SHARED', 'PERSONAL'].includes(String(audience.visibility)) || !ARTIFACT_SCHEMAS.has(item.artifactSchema as FamilyDeliveryPreparedArtifactDto['artifactSchema'])) throw new FamilyDeliveryHttpError('INVALID_RESPONSE')
  const memberId = nullableString(audience.memberId)
  if ((audience.visibility === 'SHARED') !== (memberId === null)) throw new FamilyDeliveryHttpError('INVALID_RESPONSE')
  const envelopeSchema = item.envelopeSchema === null || item.envelopeSchema === undefined ? null : string(item.envelopeSchema)
  const recipientSetDigest = nullableHash(item.recipientSetDigest)
  const innerDigest = nullableHash(item.innerDigest)
  if ((envelopeSchema !== null && envelopeSchema !== ENVELOPE_SCHEMA)
    || (envelopeSchema === null) !== (recipientSetDigest === null)
    || (envelopeSchema === null) !== (innerDigest === null)) throw new FamilyDeliveryHttpError('INVALID_RESPONSE')
  return {
    sequence: integer(item.sequence), artifactId: string(item.publicationId), digest: hash(item.digest), createdAt: timestamp(item.createdAt),
    originDeviceId: string(item.originDeviceId), senderMembershipId: string(item.senderMembershipId),
    audienceVisibility: audience.visibility as FamilyDeliveryRemoteArtifactDto['audienceVisibility'], audienceMemberId: memberId,
    byteSize: integer(item.byteSize), artifactSchema: item.artifactSchema as FamilyDeliveryRemoteArtifactDto['artifactSchema'],
    envelopeSchema: envelopeSchema as FamilyDeliveryRemoteArtifactDto['envelopeSchema'], transportDigest: envelopeSchema === null ? null : hash(item.digest), recipientSetDigest, innerDigest,
  }
}

export async function listFamilyArtifacts(endpoint: string, token: string, householdId: string, after: number, excludeOriginDeviceId: string, fetcher?: typeof fetch): Promise<FamilyArtifactPage> {
  const result: FamilyDeliveryRemoteArtifactDto[] = []; let cursor = after
  for (let page = 0; page < 20; page += 1) {
    const response = await request(endpoint, `/v2/households/${encodeURIComponent(householdId)}/publications?after=${cursor}&excludeOriginDeviceId=${encodeURIComponent(excludeOriginDeviceId)}`, token, {}, fetcher)
    const value = record(await response.json())
    if (!Array.isArray(value.publications) || typeof value.nextCursor !== 'string') throw new FamilyDeliveryHttpError('INVALID_RESPONSE')
    const publications = value.publications.map(parsePublication); result.push(...publications)
    const next = Number(value.nextCursor)
    if (!Number.isSafeInteger(next) || next < cursor || result.length > 1_000) throw new FamilyDeliveryHttpError('INVALID_RESPONSE')
    if (publications.length < 100 || next === cursor) return { artifacts: result, nextCursor: next }
    cursor = next
  }
  throw new FamilyDeliveryHttpError('INVALID_RESPONSE')
}

export async function downloadFamilyArtifact(endpoint: string, token: string, householdId: string, artifact: FamilyDeliveryRemoteArtifactDto, fetcher?: typeof fetch): Promise<readonly number[]> {
  const response = await request(endpoint, `/v2/households/${encodeURIComponent(householdId)}/publications/${encodeURIComponent(artifact.artifactId)}`, token, { headers: { Accept: 'application/octet-stream' } }, fetcher)
  const bytes = new Uint8Array(await response.arrayBuffer())
  if (bytes.length === 0 || bytes.length > MAX_PACKAGE_BYTES || bytes.length !== artifact.byteSize) throw new FamilyDeliveryHttpError('INVALID_ARTIFACT')
  const digest = await digestBytes(bytes)
  if (digest !== artifact.digest) throw new FamilyDeliveryHttpError('INVALID_ARTIFACT')
  return [...bytes]
}
