import { createHash, randomBytes } from 'node:crypto'
import { createReadStream, createWriteStream } from 'node:fs'
import { access, mkdir, open, readFile, rename, rm, unlink, writeFile } from 'node:fs/promises'
import { createServer } from 'node:http'
import { join } from 'node:path'
import { pipeline } from 'node:stream/promises'

export const MAX_ARTIFACT_BYTES = 64 * 1024 * 1024
export const MAX_CAPTURE_BYTES = 32 * 1024 * 1024
const ID = /^[A-Za-z0-9_.:-]{1,200}$/
const DIGEST = /^[0-9a-f]{64}$/
const INDEX_VERSION = 1
const FAMILY_INDEX_VERSION = 3
const PAGE_SIZE = 100
const MAX_JSON_BYTES = 64 * 1024
const FAMILY_AUDIENCES = new Set(['SHARED', 'PERSONAL'])
const FAMILY_ARTIFACT_SCHEMAS = new Set([
  'FAMILY_AUDIENCE_PARTITION_V1',
  'FAMILY_AUDIENCE_PARTITION_V2',
  'FAMILY_AUDIENCE_PARTITION_V3',
])
const FAMILY_ENVELOPE_SCHEMA = 'FAMILY_ENCRYPTED_ENVELOPE_V1'
const ENCRYPTION_KEY_ID = /^[0-9a-f]{64}$/
const ENCRYPTION_PUBLIC_KEY = /^[A-Za-z0-9_-]{43}$/
const CAPTURE_CAPSULE_SCHEMA = 'MOBILE_RECEIPT_CAPTURE_V1'

function json(response, status, body) {
  const bytes = Buffer.from(JSON.stringify(body))
  response.writeHead(status, { 'content-type': 'application/json; charset=utf-8', 'content-length': bytes.length, 'cache-control': 'no-store' })
  response.end(bytes)
}

function failure(response, status, code) {
  json(response, status, { error: code })
}

function atomicName(path) {
  return `${path}.tmp-${process.pid}-${Date.now()}-${Math.random().toString(16).slice(2)}`
}

async function atomicJson(path, value) {
  const temporary = atomicName(path)
  const handle = await open(temporary, 'wx', 0o600)
  try {
    await handle.writeFile(`${JSON.stringify(value)}\n`)
    await handle.sync()
  } finally {
    await handle.close()
  }
  await rename(temporary, path)
}

function artifactStorageName(principalId, artifactId) {
  return createHash('sha256').update(principalId).update('\0').update(artifactId).digest('hex')
}

function bearer(request, tokenMap) {
  const match = /^Bearer ([^\s]+)$/.exec(request.headers.authorization ?? '')
  return match ? tokenMap.get(match[1]) ?? null : null
}

function validMetadata(value) {
  return value && Number.isSafeInteger(value.sequence) && value.sequence > 0
    && [value.artifactId, value.householdId, value.originDeviceId, value.remotePrincipalId].every((item) => typeof item === 'string' && ID.test(item))
    && typeof value.digest === 'string' && DIGEST.test(value.digest)
    && Number.isSafeInteger(value.byteSize) && value.byteSize >= 0
    && typeof value.createdAt === 'string'
}

async function readIndex(path) {
  try {
    const parsed = JSON.parse(await readFile(path, 'utf8'))
    if (parsed.version !== INDEX_VERSION || !Array.isArray(parsed.artifacts) || !parsed.artifacts.every(validMetadata)) throw new Error('relay index is invalid')
    const sequences = new Set(parsed.artifacts.map((item) => item.sequence))
    if (sequences.size !== parsed.artifacts.length) throw new Error('relay index contains duplicate sequences')
    return parsed
  } catch (error) {
    if (error?.code === 'ENOENT') return { version: INDEX_VERSION, nextSequence: 1, artifacts: [] }
    throw error
  }
}

function validFamilyIndex(value) {
  if (!value || value.version !== FAMILY_INDEX_VERSION
    || !Number.isSafeInteger(value.nextSequence) || value.nextSequence < 1
    || !Number.isSafeInteger(value.nextMembershipSequence) || value.nextMembershipSequence < 1
    || !Number.isSafeInteger(value.nextInviteSequence) || value.nextInviteSequence < 1
    || !Number.isSafeInteger(value.nextCaptureSequence) || value.nextCaptureSequence < 1
    || !Array.isArray(value.households) || !Array.isArray(value.memberships)
    || !Array.isArray(value.invites) || !Array.isArray(value.publications)
    || !Array.isArray(value.captures)) return false
  const ids = (items, key) => new Set(items.map((item) => item?.[key])).size === items.length
  if (!ids(value.households, 'householdId') || !ids(value.memberships, 'membershipId')
    || !ids(value.invites, 'inviteId')) return false
  const householdIds = new Set(value.households.map((item) => item.householdId))
  const membershipIds = new Set(value.memberships.map((item) => item.membershipId))
  if (!value.households.every((item) => item && ID.test(item.householdId)
    && ID.test(item.createdByPrincipalId) && ID.test(item.creationIdempotencyKey)
    && typeof item.createdAt === 'string')) return false
  if (!value.memberships.every((item) => item && /^membership-[1-9]\d*$/.test(item.membershipId)
    && householdIds.has(item.householdId) && ID.test(item.principalId)
    && ID.test(item.domainMemberId) && ['OWNER', 'MEMBER'].includes(item.role)
    && ['ACTIVE', 'REVOKED'].includes(item.state)
    && Number.isSafeInteger(item.generation) && item.generation > 0
    && (item.encryptionKeyId === null || ENCRYPTION_KEY_ID.test(item.encryptionKeyId))
    && (item.encryptionPublicKey === null || ENCRYPTION_PUBLIC_KEY.test(item.encryptionPublicKey))
    && ((item.encryptionKeyId === null) === (item.encryptionPublicKey === null))
    && Number.isSafeInteger(item.encryptionKeyGeneration) && item.encryptionKeyGeneration >= 0
    && ((item.encryptionKeyId === null && item.encryptionKeyGeneration === 0 && item.encryptionKeyUpdatedAt === null)
      || (item.encryptionKeyId !== null && item.encryptionKeyGeneration > 0 && typeof item.encryptionKeyUpdatedAt === 'string'))
    && typeof item.joinedAt === 'string'
    && (item.revokedAt === null || typeof item.revokedAt === 'string'))) return false
  const membershipById = new Map(value.memberships.map((item) => [item.membershipId, item]))
  if (!value.invites.every((item) => item && /^invite-[1-9]\d*$/.test(item.inviteId)
    && householdIds.has(item.householdId) && membershipIds.has(item.createdByMembershipId)
    && ID.test(item.domainMemberId) && ID.test(item.idempotencyKey)
    && typeof item.code === 'string' && item.code.length >= 24
    && item.role === 'MEMBER' && ['ACTIVE', 'REVOKED', 'REDEEMED'].includes(item.state)
    && typeof item.createdAt === 'string' && typeof item.expiresAt === 'string'
    && membershipById.get(item.createdByMembershipId)?.householdId === item.householdId
    && (item.redeemedByMembershipId === null
      || (membershipById.get(item.redeemedByMembershipId)?.householdId === item.householdId
        && membershipById.get(item.redeemedByMembershipId)?.domainMemberId === item.domainMemberId)))) return false
  const activePrincipalKeys = value.memberships.filter((item) => item.state === 'ACTIVE').map((item) => `${item.householdId}\0${item.principalId}`)
  const generationKeys = value.memberships.map((item) => `${item.householdId}\0${item.principalId}\0${item.generation}`)
  if (new Set(activePrincipalKeys).size !== activePrincipalKeys.length
    || new Set(generationKeys).size !== generationKeys.length
    || value.households.some((household) => !value.memberships.some((item) => item.householdId === household.householdId && item.role === 'OWNER' && item.state === 'ACTIVE'))) return false
  const sequences = new Set()
  const publicationKeys = new Set()
  if (!value.publications.every((item) => {
    const key = `${item?.householdId}\0${item?.publicationId}`
    if (!item || sequences.has(item.sequence) || publicationKeys.has(key)) return false
    sequences.add(item.sequence); publicationKeys.add(key)
    return Number.isSafeInteger(item.sequence) && item.sequence > 0
      && householdIds.has(item.householdId) && ID.test(item.publicationId)
      && DIGEST.test(item.digest) && ID.test(item.originDeviceId)
      && FAMILY_AUDIENCES.has(item.audienceVisibility)
      && ((item.audienceVisibility === 'SHARED' && item.audienceMemberId === null)
        || (item.audienceVisibility === 'PERSONAL' && ID.test(item.audienceMemberId)))
      && FAMILY_ARTIFACT_SCHEMAS.has(item.artifactSchema)
      && (item.envelopeSchema === null || item.envelopeSchema === FAMILY_ENVELOPE_SCHEMA)
      && (item.recipientSetDigest === null || DIGEST.test(item.recipientSetDigest))
      && (item.innerDigest === null || DIGEST.test(item.innerDigest))
      && ((item.envelopeSchema === null) === (item.recipientSetDigest === null))
      && ((item.envelopeSchema === null) === (item.innerDigest === null))
      && membershipById.get(item.senderMembershipId)?.householdId === item.householdId
      && membershipById.get(item.senderMembershipId)?.principalId === item.senderPrincipalId
      && ID.test(item.senderPrincipalId)
      && Array.isArray(item.recipientMembershipIds) && item.recipientMembershipIds.length > 0
      && new Set(item.recipientMembershipIds).size === item.recipientMembershipIds.length
      && item.recipientMembershipIds.every((id) => membershipById.get(id)?.householdId === item.householdId && id !== item.senderMembershipId)
      && Number.isSafeInteger(item.byteSize) && item.byteSize > 0
      && typeof item.createdAt === 'string'
  })) return false
  const captureSequences = new Set()
  const captureKeys = new Set()
  if (!value.captures.every((item) => {
    const key = `${item?.householdId}\0${item?.captureId}`
    if (!item || captureSequences.has(item.sequence) || captureKeys.has(key)) return false
    captureSequences.add(item.sequence); captureKeys.add(key)
    return Number.isSafeInteger(item.sequence) && item.sequence > 0
      && householdIds.has(item.householdId) && ID.test(item.captureId)
      && DIGEST.test(item.digest) && ID.test(item.originDeviceId)
      && FAMILY_AUDIENCES.has(item.audienceVisibility)
      && ((item.audienceVisibility === 'SHARED' && item.audienceMemberId === null)
        || (item.audienceVisibility === 'PERSONAL' && ID.test(item.audienceMemberId)))
      && item.capsuleSchema === CAPTURE_CAPSULE_SCHEMA
      && membershipById.get(item.senderMembershipId)?.householdId === item.householdId
      && membershipById.get(item.senderMembershipId)?.principalId === item.senderPrincipalId
      && (item.audienceVisibility !== 'PERSONAL'
        || membershipById.get(item.senderMembershipId)?.domainMemberId === item.audienceMemberId)
      && ID.test(item.senderPrincipalId)
      && Array.isArray(item.recipientMembershipIds) && item.recipientMembershipIds.length > 0
      && new Set(item.recipientMembershipIds).size === item.recipientMembershipIds.length
      && item.recipientMembershipIds.every((id) => membershipById.get(id)?.householdId === item.householdId
        && id !== item.senderMembershipId
        && (item.audienceVisibility !== 'PERSONAL' || membershipById.get(id)?.domainMemberId === item.audienceMemberId))
      && Number.isSafeInteger(item.byteSize) && item.byteSize > 0
      && typeof item.createdAt === 'string'
  })) return false
  const membershipNumbers = value.memberships.map((item) => Number(item.membershipId.slice('membership-'.length)))
  const inviteNumbers = value.invites.map((item) => Number(item.inviteId.slice('invite-'.length)))
  const publicationSequences = value.publications.map((item) => item.sequence)
  const captureSequenceNumbers = value.captures.map((item) => item.sequence)
  return value.nextMembershipSequence > Math.max(0, ...membershipNumbers)
    && value.nextInviteSequence > Math.max(0, ...inviteNumbers)
    && value.nextSequence > Math.max(0, ...publicationSequences)
    && value.nextCaptureSequence > Math.max(0, ...captureSequenceNumbers)
}

async function readFamilyIndex(path) {
  try {
    let parsed = JSON.parse(await readFile(path, 'utf8'))
    if (parsed?.version === 1) {
      parsed = { ...parsed, version: 2, nextCaptureSequence: 1, captures: [] }
    }
    if (parsed?.version === 2) {
      parsed = {
        ...parsed,
        version: FAMILY_INDEX_VERSION,
        memberships: parsed.memberships.map((item) => ({
          ...item, encryptionKeyId: null, encryptionPublicKey: null,
          encryptionKeyGeneration: 0, encryptionKeyUpdatedAt: null,
        })),
        publications: parsed.publications.map((item) => ({
          ...item, envelopeSchema: null, recipientSetDigest: null,
        })),
      }
      if (!validFamilyIndex(parsed)) throw new Error('family relay index is invalid')
      await atomicJson(path, parsed)
    }
    if (!validFamilyIndex(parsed)) throw new Error('family relay index is invalid')
    return parsed
  } catch (error) {
    if (error?.code === 'ENOENT') return {
      version: FAMILY_INDEX_VERSION, nextSequence: 1, nextMembershipSequence: 1,
      nextInviteSequence: 1, nextCaptureSequence: 1,
      households: [], memberships: [], invites: [], publications: [], captures: [],
    }
    throw error
  }
}

async function receiveJson(request) {
  const chunks = []
  let size = 0
  for await (const chunk of request) {
    size += chunk.length
    if (size > MAX_JSON_BYTES) throw new Error('too large')
    chunks.push(chunk)
  }
  const value = JSON.parse(Buffer.concat(chunks).toString('utf8'))
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('invalid json')
  return value
}

function activeMembership(state, householdId, principalId) {
  return state.memberships.find((item) => item.householdId === householdId
    && item.principalId === principalId && item.state === 'ACTIVE') ?? null
}

function encryptionFields() {
  return { encryptionKeyId: null, encryptionPublicKey: null, encryptionKeyGeneration: 0, encryptionKeyUpdatedAt: null }
}

function publicationRecipients(state, householdId, sender, audienceVisibility, audienceMemberId) {
  return state.memberships.filter((item) => item.householdId === householdId
    && item.state === 'ACTIVE' && item.membershipId !== sender.membershipId
    && (audienceVisibility === 'SHARED' || item.domainMemberId === audienceMemberId))
}

function recipientSetDigest(recipients) {
  const hash = createHash('sha256')
  for (const item of [...recipients].sort((left, right) => left.membershipId.localeCompare(right.membershipId))) {
    hash.update(item.membershipId).update('\0')
      .update(String(item.encryptionKeyGeneration)).update('\0')
      .update(item.encryptionKeyId ?? '').update('\0')
      .update(item.encryptionPublicKey ?? '').update('\0')
  }
  return hash.digest('hex')
}

function membershipPublic(item) {
  return {
    membershipId: item.membershipId, householdId: item.householdId,
    principalId: item.principalId, domainMemberId: item.domainMemberId,
    role: item.role, state: item.state, generation: item.generation,
    encryptionKeyId: item.encryptionKeyId,
    encryptionPublicKey: item.encryptionPublicKey,
    encryptionKeyGeneration: item.encryptionKeyGeneration,
    encryptionKeyUpdatedAt: item.encryptionKeyUpdatedAt,
    joinedAt: item.joinedAt, revokedAt: item.revokedAt,
  }
}

function invitePublic(item, includeCode = false) {
  const result = {
    inviteId: item.inviteId, householdId: item.householdId,
    domainMemberId: item.domainMemberId, role: item.role, state: item.state,
    createdAt: item.createdAt, expiresAt: item.expiresAt,
    redeemedByMembershipId: item.redeemedByMembershipId,
  }
  if (includeCode) result.code = item.code
  return result
}

function publicationPublic(item) {
  return {
    sequence: item.sequence, publicationId: item.publicationId,
    digest: item.digest, householdId: item.householdId,
    originDeviceId: item.originDeviceId,
    audience: { visibility: item.audienceVisibility, memberId: item.audienceMemberId },
    artifactSchema: item.artifactSchema,
    envelopeSchema: item.envelopeSchema,
    recipientSetDigest: item.recipientSetDigest,
    innerDigest: item.innerDigest,
    senderPrincipalId: item.senderPrincipalId,
    senderMembershipId: item.senderMembershipId,
    recipientCount: item.recipientMembershipIds.length,
    byteSize: item.byteSize, createdAt: item.createdAt,
  }
}

function capturePublic(item) {
  return {
    sequence: item.sequence, captureId: item.captureId,
    digest: item.digest, householdId: item.householdId,
    originDeviceId: item.originDeviceId,
    audience: { visibility: item.audienceVisibility, memberId: item.audienceMemberId },
    capsuleSchema: item.capsuleSchema,
    senderPrincipalId: item.senderPrincipalId,
    senderMembershipId: item.senderMembershipId,
    recipientCount: item.recipientMembershipIds.length,
    byteSize: item.byteSize, createdAt: item.createdAt,
  }
}

function familyPublicationStorageName(householdId, publicationId) {
  return createHash('sha256').update(householdId).update('\0').update(publicationId).digest('hex')
}

function familyCaptureStorageName(householdId, captureId) {
  return createHash('sha256').update(householdId).update('\0').update(captureId).digest('hex')
}

function routeArtifactId(pathname) {
  const prefix = '/v1/artifacts/'
  if (!pathname.startsWith(prefix)) return null
  try { return decodeURIComponent(pathname.slice(prefix.length)) } catch { return null }
}

function routeSegments(pathname) {
  try { return pathname.split('/').filter(Boolean).map(decodeURIComponent) } catch { return null }
}

async function receiveArtifact(request, temporary, maximum) {
  const hash = createHash('sha256')
  let size = 0
  let tooLarge = false
  const output = createWriteStream(temporary, { flags: 'wx', mode: 0o600 })
  request.on('data', (chunk) => {
    size += chunk.length
    if (size > maximum) tooLarge = true
    if (!tooLarge) hash.update(chunk)
  })
  await pipeline(request, output)
  if (tooLarge) return { tooLarge: true, size, digest: null }
  const handle = await open(temporary, 'r')
  try { await handle.sync() } finally { await handle.close() }
  return { tooLarge: false, size, digest: hash.digest('hex') }
}

export async function createRelayServer({ dataDirectory, tokens, allowedOrigins = new Set(), maxArtifactBytes = MAX_ARTIFACT_BYTES, maxCaptureBytes = MAX_CAPTURE_BYTES, clock = () => new Date() } = {}) {
  if (!dataDirectory || !(tokens instanceof Map) || tokens.size === 0 || !(allowedOrigins instanceof Set)
    || !Number.isSafeInteger(maxArtifactBytes) || maxArtifactBytes < 1
    || !Number.isSafeInteger(maxCaptureBytes) || maxCaptureBytes < 1) throw new Error('relay configuration is invalid')
  if (typeof clock !== 'function') throw new Error('relay configuration is invalid')
  for (const [token, principal] of tokens) {
    if (!token || typeof principal !== 'string' || !ID.test(principal)) throw new Error('relay token mapping is invalid')
  }
  await mkdir(dataDirectory, { recursive: true, mode: 0o700 })
  const artifactDirectory = join(dataDirectory, 'artifacts')
  const temporaryDirectory = join(dataDirectory, 'tmp')
  const indexPath = join(dataDirectory, 'index.json')
  const familyIndexPath = join(dataDirectory, 'family-index.json')
  const familyArtifactDirectory = join(dataDirectory, 'family-artifacts')
  const familyCaptureDirectory = join(dataDirectory, 'family-captures')
  await mkdir(artifactDirectory, { recursive: true, mode: 0o700 })
  await mkdir(familyArtifactDirectory, { recursive: true, mode: 0o700 })
  await mkdir(familyCaptureDirectory, { recursive: true, mode: 0o700 })
  await mkdir(temporaryDirectory, { recursive: true, mode: 0o700 })
  let index = await readIndex(indexPath)
  let familyIndex = await readFamilyIndex(familyIndexPath)
  let mutationQueue = Promise.resolve()
  const mutate = (operation) => {
    const result = mutationQueue.then(operation, operation)
    mutationQueue = result.catch(() => {})
    return result
  }

  const server = createServer(async (request, response) => {
    try {
      const origin = request.headers.origin
      if (origin != null) {
        if (!allowedOrigins.has(origin)) return failure(response, 403, 'ORIGIN_NOT_ALLOWED')
        response.setHeader('access-control-allow-origin', origin)
        response.setHeader('vary', 'Origin')
      }
      if (request.method === 'OPTIONS') {
        response.writeHead(204, {
          'access-control-allow-methods': 'GET, POST, PUT, DELETE, OPTIONS',
          'access-control-allow-headers': 'Authorization, Content-Type, X-KakeFlow-Artifact-Id, X-KakeFlow-Digest, X-KakeFlow-Inner-Digest, X-KakeFlow-Household-Id, X-KakeFlow-Origin-Device-Id, X-KakeFlow-Publication-Id, X-KakeFlow-Audience-Visibility, X-KakeFlow-Audience-Member-Id, X-KakeFlow-Artifact-Schema, X-KakeFlow-Envelope-Schema, X-KakeFlow-Recipient-Set-Digest, X-KakeFlow-Capture-Id, X-KakeFlow-Capsule-Schema',
          'access-control-max-age': '600',
        })
        return response.end()
      }
      const principalId = bearer(request, tokens)
      if (!principalId) return failure(response, 401, 'AUTHENTICATION_REQUIRED')
      const url = new URL(request.url ?? '/', 'http://relay.invalid')

      if (request.method === 'GET' && url.pathname === '/v1/whoami') {
        return json(response, 200, { remotePrincipalId: principalId })
      }
      if (request.method === 'GET' && url.pathname === '/v2/whoami') {
        return json(response, 200, {
          remotePrincipalId: principalId,
          memberships: familyIndex.memberships
            .filter((item) => item.principalId === principalId && item.state === 'ACTIVE')
            .map(membershipPublic),
        })
      }

      const parts = routeSegments(url.pathname)
      if (!parts) return failure(response, 400, 'INVALID_PATH')

      if (request.method === 'POST' && url.pathname === '/v2/households') {
        let body
        try { body = await receiveJson(request) } catch { return failure(response, 400, 'INVALID_JSON') }
        const { householdId, domainMemberId, idempotencyKey } = body
        if (![householdId, domainMemberId, idempotencyKey].every((item) => typeof item === 'string' && ID.test(item))) {
          return failure(response, 400, 'INVALID_HOUSEHOLD_REQUEST')
        }
        const result = await mutate(async () => {
          const existing = familyIndex.households.find((item) => item.householdId === householdId)
          if (existing) {
            const membership = activeMembership(familyIndex, householdId, principalId)
            if (existing.createdByPrincipalId === principalId
              && existing.creationIdempotencyKey === idempotencyKey
              && membership?.role === 'OWNER' && membership.domainMemberId === domainMemberId) {
              return { status: 200, body: { household: existing, membership: membershipPublic(membership), created: false } }
            }
            return { status: 409, body: { error: 'HOUSEHOLD_CONFLICT' } }
          }
          const createdAt = clock().toISOString()
          const household = { householdId, createdByPrincipalId: principalId, creationIdempotencyKey: idempotencyKey, createdAt }
          const membership = {
            membershipId: `membership-${familyIndex.nextMembershipSequence}`,
            householdId, principalId, domainMemberId, role: 'OWNER', state: 'ACTIVE',
            generation: 1, joinedAt: createdAt, revokedAt: null,
            ...encryptionFields(),
          }
          const next = {
            ...familyIndex, nextMembershipSequence: familyIndex.nextMembershipSequence + 1,
            households: [...familyIndex.households, household],
            memberships: [...familyIndex.memberships, membership],
          }
          await atomicJson(familyIndexPath, next); familyIndex = next
          return { status: 201, body: { household, membership: membershipPublic(membership), created: true } }
        })
        return json(response, result.status, result.body)
      }

      if (request.method === 'GET' && url.pathname === '/v2/households') {
        const memberships = familyIndex.memberships.filter((item) => item.principalId === principalId && item.state === 'ACTIVE')
        return json(response, 200, { households: memberships.map((membership) => ({
          household: familyIndex.households.find((item) => item.householdId === membership.householdId),
          membership: membershipPublic(membership),
        })) })
      }

      if (parts.length === 4 && parts[0] === 'v2' && parts[1] === 'households' && parts[3] === 'members' && request.method === 'GET') {
        const householdId = parts[2]
        if (!ID.test(householdId)) return failure(response, 400, 'INVALID_HOUSEHOLD_ID')
        const caller = activeMembership(familyIndex, householdId, principalId)
        if (!caller) return failure(response, 404, 'HOUSEHOLD_NOT_FOUND')
        const members = familyIndex.memberships.filter((item) => item.householdId === householdId).map(membershipPublic)
        return json(response, 200, { members })
      }

      if (parts.length === 5 && parts[0] === 'v2' && parts[1] === 'households' && parts[3] === 'members' && parts[4] === 'encryption-key' && request.method === 'PUT') {
        const householdId = parts[2]
        let body
        try { body = await receiveJson(request) } catch { return failure(response, 400, 'INVALID_JSON') }
        const { keyId, publicKey, generation } = body
        if (!ID.test(householdId) || !ENCRYPTION_KEY_ID.test(keyId) || !ENCRYPTION_PUBLIC_KEY.test(publicKey)
          || !Number.isSafeInteger(generation) || generation < 1) {
          return failure(response, 400, 'INVALID_ENCRYPTION_KEY')
        }
        const result = await mutate(async () => {
          const current = activeMembership(familyIndex, householdId, principalId)
          if (!current) return { status: 404, body: { error: 'HOUSEHOLD_NOT_FOUND' } }
          if (generation < current.encryptionKeyGeneration) return { status: 409, body: { error: 'ENCRYPTION_KEY_ROLLBACK' } }
          if (generation === current.encryptionKeyGeneration) {
            if (current.encryptionKeyId !== keyId || current.encryptionPublicKey !== publicKey) {
              return { status: 409, body: { error: 'ENCRYPTION_KEY_CONFLICT' } }
            }
            return { status: 200, body: { membership: membershipPublic(current), updated: false } }
          }
          const updated = {
            ...current, encryptionKeyId: keyId, encryptionPublicKey: publicKey,
            encryptionKeyGeneration: generation, encryptionKeyUpdatedAt: clock().toISOString(),
          }
          const memberships = familyIndex.memberships.map((item) => item.membershipId === current.membershipId ? updated : item)
          const next = { ...familyIndex, memberships }
          await atomicJson(familyIndexPath, next); familyIndex = next
          return { status: 200, body: { membership: membershipPublic(updated), updated: true } }
        })
        return json(response, result.status, result.body)
      }

      if (parts.length === 4 && parts[0] === 'v2' && parts[1] === 'households' && parts[3] === 'invites' && request.method === 'POST') {
        const householdId = parts[2]
        let body
        try { body = await receiveJson(request) } catch { return failure(response, 400, 'INVALID_JSON') }
        const { domainMemberId, idempotencyKey, expiresInSeconds = 86400 } = body
        if (!ID.test(householdId) || ![domainMemberId, idempotencyKey].every((item) => typeof item === 'string' && ID.test(item))
          || !Number.isSafeInteger(expiresInSeconds) || expiresInSeconds < 60 || expiresInSeconds > 604800) {
          return failure(response, 400, 'INVALID_INVITE_REQUEST')
        }
        const result = await mutate(async () => {
          const caller = activeMembership(familyIndex, householdId, principalId)
          if (!caller || caller.role !== 'OWNER') return { status: 403, body: { error: 'OWNER_REQUIRED' } }
          const retry = familyIndex.invites.find((item) => item.householdId === householdId && item.idempotencyKey === idempotencyKey)
          if (retry) {
            if (retry.createdByMembershipId !== caller.membershipId || retry.domainMemberId !== domainMemberId) {
              return { status: 409, body: { error: 'INVITE_CONFLICT' } }
            }
            return { status: 200, body: { invite: invitePublic(retry, true), created: false } }
          }
          if (familyIndex.invites.some((item) => item.householdId === householdId && item.domainMemberId === domainMemberId && item.state === 'ACTIVE' && Date.parse(item.expiresAt) > clock().getTime())) {
            return { status: 409, body: { error: 'DOMAIN_MEMBER_INVITE_ALREADY_ACTIVE' } }
          }
          const createdAtDate = clock()
          const invite = {
            inviteId: `invite-${familyIndex.nextInviteSequence}`, householdId,
            domainMemberId, role: 'MEMBER', state: 'ACTIVE',
            code: `kfi_${randomBytes(24).toString('base64url')}`,
            idempotencyKey, createdByMembershipId: caller.membershipId,
            createdAt: createdAtDate.toISOString(),
            expiresAt: new Date(createdAtDate.getTime() + expiresInSeconds * 1000).toISOString(),
            redeemedByMembershipId: null,
          }
          const next = { ...familyIndex, nextInviteSequence: familyIndex.nextInviteSequence + 1, invites: [...familyIndex.invites, invite] }
          await atomicJson(familyIndexPath, next); familyIndex = next
          return { status: 201, body: { invite: invitePublic(invite, true), created: true } }
        })
        return json(response, result.status, result.body)
      }

      if (parts.length === 4 && parts[0] === 'v2' && parts[1] === 'households' && parts[3] === 'invites' && request.method === 'GET') {
        const householdId = parts[2]
        const caller = activeMembership(familyIndex, householdId, principalId)
        if (!caller || caller.role !== 'OWNER') return failure(response, 403, 'OWNER_REQUIRED')
        return json(response, 200, { invites: familyIndex.invites.filter((item) => item.householdId === householdId).map((item) => invitePublic(item, false)) })
      }

      if (parts.length === 5 && parts[0] === 'v2' && parts[1] === 'households' && parts[3] === 'invites' && request.method === 'DELETE') {
        const householdId = parts[2]; const inviteId = parts[4]
        if (!ID.test(householdId) || !ID.test(inviteId)) return failure(response, 400, 'INVALID_INVITE_ID')
        const result = await mutate(async () => {
          const caller = activeMembership(familyIndex, householdId, principalId)
          if (!caller || caller.role !== 'OWNER') return { status: 403, body: { error: 'OWNER_REQUIRED' } }
          const position = familyIndex.invites.findIndex((item) => item.householdId === householdId && item.inviteId === inviteId)
          if (position < 0) return { status: 404, body: { error: 'INVITE_NOT_FOUND' } }
          const current = familyIndex.invites[position]
          if (current.state === 'REDEEMED') return { status: 409, body: { error: 'INVITE_ALREADY_REDEEMED' } }
          const invite = { ...current, state: 'REVOKED' }
          const invites = [...familyIndex.invites]; invites[position] = invite
          const next = { ...familyIndex, invites }
          await atomicJson(familyIndexPath, next); familyIndex = next
          return { status: 200, body: { invite: invitePublic(invite, false) } }
        })
        return json(response, result.status, result.body)
      }

      if (request.method === 'POST' && url.pathname === '/v2/invites/redeem') {
        let body
        try { body = await receiveJson(request) } catch { return failure(response, 400, 'INVALID_JSON') }
        if (typeof body.code !== 'string' || body.code.length < 24 || body.code.length > 128) return failure(response, 400, 'INVALID_INVITE_CODE')
        const result = await mutate(async () => {
          const position = familyIndex.invites.findIndex((item) => item.code === body.code)
          if (position < 0) return { status: 404, body: { error: 'INVITE_NOT_FOUND' } }
          const invite = familyIndex.invites[position]
          if (invite.state === 'REDEEMED') {
            const prior = familyIndex.memberships.find((item) => item.membershipId === invite.redeemedByMembershipId)
            if (prior?.principalId === principalId) return { status: 200, body: { membership: membershipPublic(prior), redeemed: false } }
            return { status: 410, body: { error: 'INVITE_USED' } }
          }
          if (invite.state !== 'ACTIVE') return { status: 410, body: { error: 'INVITE_REVOKED' } }
          if (Date.parse(invite.expiresAt) <= clock().getTime()) return { status: 410, body: { error: 'INVITE_EXPIRED' } }
          if (activeMembership(familyIndex, invite.householdId, principalId)) {
            return { status: 409, body: { error: 'MEMBERSHIP_CONFLICT' } }
          }
          const generation = Math.max(0, ...familyIndex.memberships.filter((item) => item.householdId === invite.householdId && item.principalId === principalId).map((item) => item.generation)) + 1
          const membership = {
            membershipId: `membership-${familyIndex.nextMembershipSequence}`,
            householdId: invite.householdId, principalId,
            domainMemberId: invite.domainMemberId, role: invite.role, state: 'ACTIVE',
            generation, joinedAt: clock().toISOString(), revokedAt: null,
            ...encryptionFields(),
          }
          const invites = [...familyIndex.invites]
          invites[position] = { ...invite, state: 'REDEEMED', redeemedByMembershipId: membership.membershipId }
          const next = {
            ...familyIndex, nextMembershipSequence: familyIndex.nextMembershipSequence + 1,
            memberships: [...familyIndex.memberships, membership], invites,
          }
          await atomicJson(familyIndexPath, next); familyIndex = next
          return { status: 201, body: { membership: membershipPublic(membership), redeemed: true } }
        })
        return json(response, result.status, result.body)
      }

      if (request.method === 'POST' && url.pathname === '/v2/invites/preview') {
        let body
        try { body = await receiveJson(request) } catch { return failure(response, 400, 'INVALID_JSON') }
        if (typeof body.code !== 'string' || body.code.length < 24 || body.code.length > 128) return failure(response, 400, 'INVALID_INVITE_CODE')
        const invite = familyIndex.invites.find((item) => item.code === body.code)
        if (!invite) return failure(response, 404, 'INVITE_NOT_FOUND')
        if (invite.state !== 'ACTIVE' || Date.parse(invite.expiresAt) <= clock().getTime()) return failure(response, 410, 'INVITE_UNAVAILABLE')
        return json(response, 200, {
          invite: {
            householdId: invite.householdId,
            domainMemberId: invite.domainMemberId,
            role: invite.role,
            expiresAt: invite.expiresAt,
          },
        })
      }

      if (parts.length === 5 && parts[0] === 'v2' && parts[1] === 'households' && parts[3] === 'members' && request.method === 'DELETE') {
        const householdId = parts[2]; const membershipId = parts[4]
        if (!ID.test(householdId) || !ID.test(membershipId)) return failure(response, 400, 'INVALID_MEMBERSHIP_ID')
        const result = await mutate(async () => {
          const caller = activeMembership(familyIndex, householdId, principalId)
          if (!caller || caller.role !== 'OWNER') return { status: 403, body: { error: 'OWNER_REQUIRED' } }
          const position = familyIndex.memberships.findIndex((item) => item.householdId === householdId && item.membershipId === membershipId)
          if (position < 0) return { status: 404, body: { error: 'MEMBERSHIP_NOT_FOUND' } }
          const target = familyIndex.memberships[position]
          if (target.state !== 'ACTIVE') return { status: 200, body: { membership: membershipPublic(target), revoked: false } }
          if (target.membershipId === caller.membershipId) return { status: 409, body: { error: 'OWNER_CANNOT_REVOKE_SELF' } }
          if (target.role === 'OWNER' && familyIndex.memberships.filter((item) => item.householdId === householdId && item.role === 'OWNER' && item.state === 'ACTIVE').length <= 1) {
            return { status: 409, body: { error: 'LAST_OWNER_REQUIRED' } }
          }
          const membership = { ...target, state: 'REVOKED', revokedAt: clock().toISOString() }
          const memberships = [...familyIndex.memberships]; memberships[position] = membership
          const next = { ...familyIndex, memberships }
          await atomicJson(familyIndexPath, next); familyIndex = next
          return { status: 200, body: { membership: membershipPublic(membership), revoked: true } }
        })
        return json(response, result.status, result.body)
      }

      if (parts.length === 4 && parts[0] === 'v2' && parts[1] === 'households' && parts[3] === 'publications' && request.method === 'POST') {
        const householdId = parts[2]
        const publicationId = request.headers['x-kakeflow-publication-id']
        const expectedDigest = request.headers['x-kakeflow-digest']
        const originDeviceId = request.headers['x-kakeflow-origin-device-id']
        const audienceVisibility = request.headers['x-kakeflow-audience-visibility']
        const audienceMemberId = request.headers['x-kakeflow-audience-member-id']
        const artifactSchema = request.headers['x-kakeflow-artifact-schema']
        const envelopeSchema = request.headers['x-kakeflow-envelope-schema'] ?? null
        const suppliedRecipientSetDigest = request.headers['x-kakeflow-recipient-set-digest'] ?? null
        const innerDigest = request.headers['x-kakeflow-inner-digest'] ?? null
        if (!ID.test(householdId) || ![publicationId, originDeviceId].every((item) => typeof item === 'string' && ID.test(item))
          || typeof expectedDigest !== 'string' || !DIGEST.test(expectedDigest)
          || !FAMILY_AUDIENCES.has(audienceVisibility)
          || (audienceVisibility === 'SHARED' && audienceMemberId != null)
          || (audienceVisibility === 'PERSONAL' && (typeof audienceMemberId !== 'string' || !ID.test(audienceMemberId)))
          || !FAMILY_ARTIFACT_SCHEMAS.has(artifactSchema)
          || (envelopeSchema !== null && envelopeSchema !== FAMILY_ENVELOPE_SCHEMA)
          || ((envelopeSchema === null) !== (suppliedRecipientSetDigest === null))
          || ((envelopeSchema === null) !== (innerDigest === null))
          || (suppliedRecipientSetDigest !== null && !DIGEST.test(suppliedRecipientSetDigest))
          || (innerDigest !== null && !DIGEST.test(innerDigest))) {
          request.resume(); return failure(response, 400, 'INVALID_PUBLICATION_HEADERS')
        }
        const declaredLength = Number(request.headers['content-length'])
        if (Number.isFinite(declaredLength) && declaredLength > maxArtifactBytes) {
          request.resume(); return failure(response, 413, 'ARTIFACT_TOO_LARGE')
        }
        const temporary = join(temporaryDirectory, `family-${Date.now()}-${Math.random().toString(16).slice(2)}`)
        let received
        try { received = await receiveArtifact(request, temporary, maxArtifactBytes) } catch {
          await rm(temporary, { force: true }); return failure(response, 400, 'ARTIFACT_READ_FAILED')
        }
        if (received.tooLarge) { await rm(temporary, { force: true }); return failure(response, 413, 'ARTIFACT_TOO_LARGE') }
        if (received.size === 0 || received.digest !== expectedDigest) {
          await rm(temporary, { force: true }); return failure(response, 422, received.size === 0 ? 'EMPTY_ARTIFACT' : 'DIGEST_MISMATCH')
        }
        const result = await mutate(async () => {
          const sender = activeMembership(familyIndex, householdId, principalId)
          if (!sender) { await rm(temporary, { force: true }); return { status: 403, body: { error: 'ACTIVE_MEMBERSHIP_REQUIRED' } } }
          const existing = familyIndex.publications.find((item) => item.householdId === householdId && item.publicationId === publicationId)
          if (existing) {
            await rm(temporary, { force: true })
            if (existing.digest !== expectedDigest || existing.senderMembershipId !== sender.membershipId
              || existing.originDeviceId !== originDeviceId || existing.artifactSchema !== artifactSchema
              || existing.audienceVisibility !== audienceVisibility || existing.audienceMemberId !== (audienceMemberId ?? null)
              || existing.envelopeSchema !== envelopeSchema || existing.recipientSetDigest !== suppliedRecipientSetDigest
              || existing.innerDigest !== innerDigest) {
              return { status: 409, body: { error: 'PUBLICATION_CONFLICT' } }
            }
            const stored = join(familyArtifactDirectory, familyPublicationStorageName(householdId, publicationId))
            try { await access(stored) } catch { return { status: 500, body: { error: 'ARTIFACT_STORAGE_MISSING' } } }
            return { status: 200, body: { publication: publicationPublic(existing), created: false } }
          }
          if (audienceVisibility === 'PERSONAL' && audienceMemberId !== sender.domainMemberId) {
            await rm(temporary, { force: true }); return { status: 403, body: { error: 'PERSONAL_AUDIENCE_MISMATCH' } }
          }
          const recipients = publicationRecipients(familyIndex, householdId, sender, audienceVisibility, audienceMemberId ?? null)
          if (recipients.length === 0) { await rm(temporary, { force: true }); return { status: 409, body: { error: 'NO_ACTIVE_RECIPIENTS' } } }
          if (envelopeSchema !== null) {
            if (recipients.some((item) => item.encryptionKeyId === null)) {
              await rm(temporary, { force: true }); return { status: 409, body: { error: 'RECIPIENT_KEY_UNAVAILABLE' } }
            }
            if (recipientSetDigest(recipients) !== suppliedRecipientSetDigest) {
              await rm(temporary, { force: true }); return { status: 409, body: { error: 'RECIPIENT_SET_CHANGED' } }
            }
          }
          const stored = join(familyArtifactDirectory, familyPublicationStorageName(householdId, publicationId))
          await rm(stored, { force: true }); await rename(temporary, stored)
          const publication = {
            sequence: familyIndex.nextSequence, publicationId, digest: expectedDigest,
            householdId, originDeviceId, audienceVisibility,
            audienceMemberId: audienceMemberId ?? null, artifactSchema,
            envelopeSchema, recipientSetDigest: suppliedRecipientSetDigest, innerDigest,
            senderPrincipalId: principalId, senderMembershipId: sender.membershipId,
            recipientMembershipIds: recipients.map((item) => item.membershipId),
            byteSize: received.size, createdAt: clock().toISOString(),
          }
          const next = { ...familyIndex, nextSequence: familyIndex.nextSequence + 1, publications: [...familyIndex.publications, publication] }
          await atomicJson(familyIndexPath, next); familyIndex = next
          return { status: 201, body: { publication: publicationPublic(publication), created: true } }
        })
        return json(response, result.status, result.body)
      }

      if (parts.length === 4 && parts[0] === 'v2' && parts[1] === 'households' && parts[3] === 'publications' && request.method === 'GET') {
        const householdId = parts[2]
        const after = Number(url.searchParams.get('after') ?? '0')
        const excluded = url.searchParams.get('excludeOriginDeviceId')
        if (!ID.test(householdId) || !Number.isSafeInteger(after) || after < 0 || (excluded != null && !ID.test(excluded))) return failure(response, 400, 'INVALID_QUERY')
        const membership = activeMembership(familyIndex, householdId, principalId)
        if (!membership) return failure(response, 404, 'HOUSEHOLD_NOT_FOUND')
        const matching = familyIndex.publications.filter((item) => item.householdId === householdId && item.sequence > after)
        const publications = matching.filter((item) => item.recipientMembershipIds.includes(membership.membershipId) && item.originDeviceId !== excluded).slice(0, PAGE_SIZE)
        const pageBoundary = publications.length === PAGE_SIZE ? publications.at(-1).sequence : matching.at(-1)?.sequence ?? after
        return json(response, 200, { publications: publications.map(publicationPublic), nextCursor: String(pageBoundary) })
      }

      if (parts.length === 5 && parts[0] === 'v2' && parts[1] === 'households' && parts[3] === 'publications' && request.method === 'GET') {
        const householdId = parts[2]; const publicationId = parts[4]
        if (!ID.test(householdId) || !ID.test(publicationId)) return failure(response, 400, 'INVALID_PUBLICATION_ID')
        const membership = activeMembership(familyIndex, householdId, principalId)
        if (!membership) return failure(response, 404, 'PUBLICATION_NOT_FOUND')
        const publication = familyIndex.publications.find((item) => item.householdId === householdId && item.publicationId === publicationId)
        if (!publication || (publication.senderMembershipId !== membership.membershipId && !publication.recipientMembershipIds.includes(membership.membershipId))) {
          return failure(response, 404, 'PUBLICATION_NOT_FOUND')
        }
        const path = join(familyArtifactDirectory, familyPublicationStorageName(householdId, publicationId))
        response.writeHead(200, {
          'content-type': 'application/octet-stream', 'content-length': publication.byteSize,
          'x-kakeflow-publication-id': publication.publicationId,
          'x-kakeflow-digest': publication.digest,
          'x-kakeflow-household-id': publication.householdId,
          'x-kakeflow-audience-visibility': publication.audienceVisibility,
          'x-kakeflow-artifact-schema': publication.artifactSchema,
          ...(publication.envelopeSchema === null ? {} : {
            'x-kakeflow-envelope-schema': publication.envelopeSchema,
            'x-kakeflow-recipient-set-digest': publication.recipientSetDigest,
            'x-kakeflow-inner-digest': publication.innerDigest,
          }),
          'cache-control': 'no-store',
        })
        return pipeline(createReadStream(path), response).catch(() => response.destroy())
      }

      if (parts.length === 4 && parts[0] === 'v2' && parts[1] === 'households' && parts[3] === 'captures' && request.method === 'POST') {
        const householdId = parts[2]
        const captureId = request.headers['x-kakeflow-capture-id']
        const expectedDigest = request.headers['x-kakeflow-digest']
        const originDeviceId = request.headers['x-kakeflow-origin-device-id']
        const audienceVisibility = request.headers['x-kakeflow-audience-visibility']
        const audienceMemberId = request.headers['x-kakeflow-audience-member-id']
        const capsuleSchema = request.headers['x-kakeflow-capsule-schema']
        if (!ID.test(householdId) || ![captureId, originDeviceId].every((item) => typeof item === 'string' && ID.test(item))
          || typeof expectedDigest !== 'string' || !DIGEST.test(expectedDigest)
          || !FAMILY_AUDIENCES.has(audienceVisibility)
          || (audienceVisibility === 'SHARED' && audienceMemberId != null)
          || (audienceVisibility === 'PERSONAL' && (typeof audienceMemberId !== 'string' || !ID.test(audienceMemberId)))
          || capsuleSchema !== CAPTURE_CAPSULE_SCHEMA) {
          request.resume(); return failure(response, 400, 'INVALID_CAPTURE_HEADERS')
        }
        const declaredLength = Number(request.headers['content-length'])
        if (Number.isFinite(declaredLength) && declaredLength > maxCaptureBytes) {
          request.resume(); return failure(response, 413, 'CAPTURE_TOO_LARGE')
        }
        const temporary = join(temporaryDirectory, `capture-${Date.now()}-${Math.random().toString(16).slice(2)}`)
        let received
        try { received = await receiveArtifact(request, temporary, maxCaptureBytes) } catch {
          await rm(temporary, { force: true }); return failure(response, 400, 'CAPTURE_READ_FAILED')
        }
        if (received.tooLarge) { await rm(temporary, { force: true }); return failure(response, 413, 'CAPTURE_TOO_LARGE') }
        if (received.size === 0 || received.digest !== expectedDigest) {
          await rm(temporary, { force: true }); return failure(response, 422, received.size === 0 ? 'EMPTY_CAPTURE' : 'CAPTURE_DIGEST_MISMATCH')
        }
        const result = await mutate(async () => {
          const sender = activeMembership(familyIndex, householdId, principalId)
          if (!sender) { await rm(temporary, { force: true }); return { status: 403, body: { error: 'ACTIVE_MEMBERSHIP_REQUIRED' } } }
          const existing = familyIndex.captures.find((item) => item.householdId === householdId && item.captureId === captureId)
          if (existing) {
            await rm(temporary, { force: true })
            if (existing.digest !== expectedDigest || existing.senderMembershipId !== sender.membershipId
              || existing.originDeviceId !== originDeviceId || existing.capsuleSchema !== capsuleSchema
              || existing.audienceVisibility !== audienceVisibility || existing.audienceMemberId !== (audienceMemberId ?? null)) {
              return { status: 409, body: { error: 'CAPTURE_CONFLICT' } }
            }
            const stored = join(familyCaptureDirectory, familyCaptureStorageName(householdId, captureId))
            try { await access(stored) } catch { return { status: 500, body: { error: 'CAPTURE_STORAGE_MISSING' } } }
            return { status: 200, body: { capture: capturePublic(existing), created: false } }
          }
          if (audienceVisibility === 'PERSONAL' && audienceMemberId !== sender.domainMemberId) {
            await rm(temporary, { force: true }); return { status: 403, body: { error: 'PERSONAL_AUDIENCE_MISMATCH' } }
          }
          const recipients = familyIndex.memberships.filter((item) => item.householdId === householdId
            && item.state === 'ACTIVE' && item.membershipId !== sender.membershipId
            && (audienceVisibility === 'SHARED' || item.domainMemberId === sender.domainMemberId))
          if (recipients.length === 0) { await rm(temporary, { force: true }); return { status: 409, body: { error: 'NO_ACTIVE_CAPTURE_RECIPIENTS' } } }
          const stored = join(familyCaptureDirectory, familyCaptureStorageName(householdId, captureId))
          await rm(stored, { force: true }); await rename(temporary, stored)
          const capture = {
            sequence: familyIndex.nextCaptureSequence, captureId, digest: expectedDigest,
            householdId, originDeviceId, audienceVisibility,
            audienceMemberId: audienceMemberId ?? null, capsuleSchema,
            senderPrincipalId: principalId, senderMembershipId: sender.membershipId,
            recipientMembershipIds: recipients.map((item) => item.membershipId),
            byteSize: received.size, createdAt: clock().toISOString(),
          }
          const next = { ...familyIndex, nextCaptureSequence: familyIndex.nextCaptureSequence + 1, captures: [...familyIndex.captures, capture] }
          await atomicJson(familyIndexPath, next); familyIndex = next
          return { status: 201, body: { capture: capturePublic(capture), created: true } }
        })
        return json(response, result.status, result.body)
      }

      if (parts.length === 4 && parts[0] === 'v2' && parts[1] === 'households' && parts[3] === 'captures' && request.method === 'GET') {
        const householdId = parts[2]
        const after = Number(url.searchParams.get('after') ?? '0')
        const excluded = url.searchParams.get('excludeOriginDeviceId')
        if (!ID.test(householdId) || !Number.isSafeInteger(after) || after < 0 || (excluded != null && !ID.test(excluded))) return failure(response, 400, 'INVALID_QUERY')
        const membership = activeMembership(familyIndex, householdId, principalId)
        if (!membership) return failure(response, 404, 'HOUSEHOLD_NOT_FOUND')
        const matching = familyIndex.captures.filter((item) => item.householdId === householdId && item.sequence > after)
        const captures = matching.filter((item) => item.recipientMembershipIds.includes(membership.membershipId) && item.originDeviceId !== excluded).slice(0, PAGE_SIZE)
        const pageBoundary = captures.length === PAGE_SIZE ? captures.at(-1).sequence : matching.at(-1)?.sequence ?? after
        return json(response, 200, { captures: captures.map(capturePublic), nextCursor: String(pageBoundary) })
      }

      if (parts.length === 5 && parts[0] === 'v2' && parts[1] === 'households' && parts[3] === 'captures' && request.method === 'GET') {
        const householdId = parts[2]; const captureId = parts[4]
        if (!ID.test(householdId) || !ID.test(captureId)) return failure(response, 400, 'INVALID_CAPTURE_ID')
        const membership = activeMembership(familyIndex, householdId, principalId)
        if (!membership) return failure(response, 404, 'CAPTURE_NOT_FOUND')
        const capture = familyIndex.captures.find((item) => item.householdId === householdId && item.captureId === captureId)
        if (!capture || (capture.senderMembershipId !== membership.membershipId && !capture.recipientMembershipIds.includes(membership.membershipId))) {
          return failure(response, 404, 'CAPTURE_NOT_FOUND')
        }
        const path = join(familyCaptureDirectory, familyCaptureStorageName(householdId, captureId))
        const headers = {
          'content-type': 'application/octet-stream', 'content-length': capture.byteSize,
          'x-kakeflow-capture-id': capture.captureId,
          'x-kakeflow-digest': capture.digest,
          'x-kakeflow-household-id': capture.householdId,
          'x-kakeflow-audience-visibility': capture.audienceVisibility,
          'x-kakeflow-capsule-schema': capture.capsuleSchema,
          'cache-control': 'no-store',
        }
        if (capture.audienceMemberId !== null) headers['x-kakeflow-audience-member-id'] = capture.audienceMemberId
        response.writeHead(200, headers)
        return pipeline(createReadStream(path), response).catch(() => response.destroy())
      }

      if (request.method === 'POST' && url.pathname === '/v1/artifacts') {
        const artifactId = request.headers['x-kakeflow-artifact-id']
        const expectedDigest = request.headers['x-kakeflow-digest']
        const householdId = request.headers['x-kakeflow-household-id']
        const originDeviceId = request.headers['x-kakeflow-origin-device-id']
        if (![artifactId, householdId, originDeviceId].every((item) => typeof item === 'string' && ID.test(item)) || typeof expectedDigest !== 'string' || !DIGEST.test(expectedDigest)) {
          request.resume()
          return failure(response, 400, 'INVALID_ARTIFACT_HEADERS')
        }
        const declaredLength = Number(request.headers['content-length'])
        if (Number.isFinite(declaredLength) && declaredLength > maxArtifactBytes) {
          request.resume()
          return failure(response, 413, 'ARTIFACT_TOO_LARGE')
        }
        const temporary = join(temporaryDirectory, `${Date.now()}-${Math.random().toString(16).slice(2)}`)
        let received
        try { received = await receiveArtifact(request, temporary, maxArtifactBytes) } catch {
          await rm(temporary, { force: true })
          return failure(response, 400, 'ARTIFACT_READ_FAILED')
        }
        if (received.tooLarge) {
          await rm(temporary, { force: true })
          return failure(response, 413, 'ARTIFACT_TOO_LARGE')
        }
        if (received.digest !== expectedDigest) {
          await rm(temporary, { force: true })
          return failure(response, 422, 'DIGEST_MISMATCH')
        }
        const result = await mutate(async () => {
          const existing = index.artifacts.find((item) => item.remotePrincipalId === principalId && item.artifactId === artifactId)
          if (existing) {
            await rm(temporary, { force: true })
            if (existing.digest !== expectedDigest) return { status: 409, body: { error: 'ARTIFACT_CONFLICT' } }
            const storedPath = join(artifactDirectory, artifactStorageName(principalId, artifactId))
            try { await access(storedPath) } catch { return { status: 500, body: { error: 'ARTIFACT_STORAGE_MISSING' } } }
            return { status: 200, body: { artifact: existing, created: false } }
          }
          const storedPath = join(artifactDirectory, artifactStorageName(principalId, artifactId))
          await rm(storedPath, { force: true })
          await rename(temporary, storedPath)
          const metadata = {
            sequence: index.nextSequence, artifactId, digest: expectedDigest, householdId,
            originDeviceId, remotePrincipalId: principalId, byteSize: received.size,
            createdAt: new Date().toISOString(),
          }
          const next = { version: INDEX_VERSION, nextSequence: index.nextSequence + 1, artifacts: [...index.artifacts, metadata] }
          await atomicJson(indexPath, next)
          index = next
          return { status: 201, body: { artifact: metadata, created: true } }
        })
        return json(response, result.status, result.body)
      }

      if (request.method === 'GET' && url.pathname === '/v1/artifacts') {
        const householdId = url.searchParams.get('householdId') ?? ''
        const afterText = url.searchParams.get('after') ?? '0'
        const after = Number(afterText)
        const excluded = url.searchParams.get('excludeOriginDeviceId')
        if (!ID.test(householdId) || !Number.isSafeInteger(after) || after < 0 || (excluded != null && !ID.test(excluded))) return failure(response, 400, 'INVALID_QUERY')
        const matching = index.artifacts.filter((item) => item.remotePrincipalId === principalId && item.householdId === householdId && item.sequence > after)
        const artifacts = matching.filter((item) => item.originDeviceId !== excluded).slice(0, PAGE_SIZE)
        const pageBoundary = artifacts.at(-1)?.sequence ?? matching.at(-1)?.sequence ?? after
        return json(response, 200, { artifacts, nextCursor: String(pageBoundary) })
      }

      const artifactId = routeArtifactId(url.pathname)
      if (request.method === 'GET' && artifactId && ID.test(artifactId)) {
        const metadata = index.artifacts.find((item) => item.remotePrincipalId === principalId && item.artifactId === artifactId)
        if (!metadata) return failure(response, 404, 'ARTIFACT_NOT_FOUND')
        const path = join(artifactDirectory, artifactStorageName(principalId, artifactId))
        response.writeHead(200, {
          'content-type': 'application/octet-stream', 'content-length': metadata.byteSize,
          'x-kakeflow-artifact-id': metadata.artifactId, 'x-kakeflow-digest': metadata.digest,
          'x-kakeflow-household-id': metadata.householdId, 'cache-control': 'no-store',
        })
        return pipeline(createReadStream(path), response).catch(() => response.destroy())
      }

      failure(response, 404, 'NOT_FOUND')
    } catch {
      if (!response.headersSent) failure(response, 500, 'RELAY_INTERNAL_ERROR')
      else response.destroy()
    }
  })

  return server
}
