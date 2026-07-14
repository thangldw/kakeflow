import type { FamilyDeliveryPreparedArtifactDto, FamilyDeliveryRemoteArtifactDto } from '../../platform'

const MAX_PACKAGE_BYTES = 64 * 1024 * 1024
const ARTIFACT_SCHEMAS = new Set<FamilyDeliveryPreparedArtifactDto['artifactSchema']>(['FAMILY_AUDIENCE_PARTITION_V1', 'FAMILY_AUDIENCE_PARTITION_V2'])

export type FamilyDeliveryHttpErrorCode =
  | 'AUTH_EXPIRED' | 'NETWORK_RETRYABLE' | 'INVITE_EXPIRED' | 'INVITE_USED' | 'INVITE_REVOKED' | 'INVITE_UNAVAILABLE'
  | 'HOUSEHOLD_MISMATCH' | 'MEMBER_ARCHIVED' | 'PRINCIPAL_ALREADY_LINKED' | 'MEMBERSHIP_REVOKED'
  | 'AUDIENCE_DENIED' | 'INVALID_ARTIFACT' | 'RECIPIENT_UNAVAILABLE' | 'OWNER_REQUIRED'
  | 'REJECTED' | 'INVALID_RESPONSE' | 'INVALID_ENDPOINT'

export class FamilyDeliveryHttpError extends Error {
  constructor(readonly code: FamilyDeliveryHttpErrorCode) { super(code) }
}

export interface FamilyRemoteMembership {
  readonly membershipId: string; readonly householdId: string; readonly principalId: string
  readonly domainMemberId: string; readonly role: 'OWNER' | 'MEMBER'; readonly state: 'ACTIVE' | 'REVOKED'
  readonly generation: number; readonly joinedAt: string; readonly revokedAt: string | null
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
  if (code === 'NO_ACTIVE_RECIPIENTS') return 'RECIPIENT_UNAVAILABLE'
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
const hash = (value: unknown): string => { const result = string(value); if (!/^[0-9a-f]{64}$/.test(result)) throw new FamilyDeliveryHttpError('INVALID_RESPONSE'); return result }

function parseMembership(value: unknown): FamilyRemoteMembership {
  const item = record(value)
  if (!['OWNER', 'MEMBER'].includes(String(item.role)) || !['ACTIVE', 'REVOKED'].includes(String(item.state))) throw new FamilyDeliveryHttpError('INVALID_RESPONSE')
  return {
    membershipId: string(item.membershipId), householdId: string(item.householdId), principalId: string(item.principalId),
    domainMemberId: string(item.domainMemberId), role: item.role as FamilyRemoteMembership['role'], state: item.state as FamilyRemoteMembership['state'],
    generation: integer(item.generation), joinedAt: timestamp(item.joinedAt), revokedAt: nullableString(item.revokedAt),
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

export async function uploadFamilyArtifact(endpoint: string, token: string, artifact: FamilyDeliveryPreparedArtifactDto, fetcher?: typeof fetch): Promise<FamilyDeliveryAcceptance> {
  const headers: Record<string, string> = {
    'Content-Type': 'application/octet-stream', 'x-kakeflow-publication-id': artifact.artifactId,
    'x-kakeflow-digest': artifact.digest, 'x-kakeflow-origin-device-id': artifact.originDeviceId,
    'x-kakeflow-audience-visibility': artifact.audienceVisibility, 'x-kakeflow-artifact-schema': artifact.artifactSchema,
  }
  if (artifact.audienceMemberId) headers['x-kakeflow-audience-member-id'] = artifact.audienceMemberId
  const response = await request(endpoint, `/v2/households/${encodeURIComponent(artifact.householdId)}/publications`, token, { method: 'POST', headers, body: new Uint8Array(artifact.packageBytes) }, fetcher)
  const publication = record(record(await response.json()).publication)
  return { deliveryId: artifact.deliveryId, artifactId: string(publication.publicationId), digest: hash(publication.digest), acceptedAt: timestamp(publication.createdAt) }
}

function parsePublication(value: unknown): FamilyDeliveryRemoteArtifactDto {
  const item = record(value); const audience = record(item.audience)
  if (!['SHARED', 'PERSONAL'].includes(String(audience.visibility)) || !ARTIFACT_SCHEMAS.has(item.artifactSchema as FamilyDeliveryPreparedArtifactDto['artifactSchema'])) throw new FamilyDeliveryHttpError('INVALID_RESPONSE')
  const memberId = nullableString(audience.memberId)
  if ((audience.visibility === 'SHARED') !== (memberId === null)) throw new FamilyDeliveryHttpError('INVALID_RESPONSE')
  return {
    sequence: integer(item.sequence), artifactId: string(item.publicationId), digest: hash(item.digest), createdAt: timestamp(item.createdAt),
    originDeviceId: string(item.originDeviceId), senderMembershipId: string(item.senderMembershipId),
    audienceVisibility: audience.visibility as FamilyDeliveryRemoteArtifactDto['audienceVisibility'], audienceMemberId: memberId,
    byteSize: integer(item.byteSize), artifactSchema: item.artifactSchema as FamilyDeliveryRemoteArtifactDto['artifactSchema'],
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
  if (bytes.length === 0 || bytes.length > MAX_PACKAGE_BYTES) throw new FamilyDeliveryHttpError('INVALID_ARTIFACT')
  const digest = [...new Uint8Array(await crypto.subtle.digest('SHA-256', bytes))].map((byte) => byte.toString(16).padStart(2, '0')).join('')
  if (digest !== artifact.digest) throw new FamilyDeliveryHttpError('INVALID_ARTIFACT')
  return [...bytes]
}
