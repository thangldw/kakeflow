import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, test } from 'node:test'
import { createRelayServer } from './server.mjs'

const roots = []
const servers = []
afterEach(async () => {
  await Promise.all(servers.splice(0).map((server) => new Promise((resolve) => server.close(resolve))))
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })))
})

async function start(root, maximum = 1024, allowedOrigins = new Set(), clock = () => new Date()) {
  const server = await createRelayServer({ dataDirectory: root, tokens: new Map([['token-a', 'principal-a'], ['token-b', 'principal-b'], ['token-c', 'principal-c']]), allowedOrigins, maxArtifactBytes: maximum, maxCaptureBytes: maximum, clock })
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve))
  servers.push(server)
  const address = server.address()
  return `http://127.0.0.1:${address.port}`
}

async function fixture({ allowedOrigins = new Set(), clock = () => new Date() } = {}) {
  const root = await mkdtemp(join(tmpdir(), 'kakeflow-relay-test-'))
  roots.push(root)
  return { root, base: await start(root, 1024, allowedOrigins, clock) }
}

const digest = (bytes) => createHash('sha256').update(bytes).digest('hex')
const auth = (token = 'token-a') => ({ authorization: `Bearer ${token}` })
function upload(base, { token = 'token-a', id = 'artifact-1', bytes = Buffer.from('package'), claimedDigest = digest(bytes), household = 'family', device = 'device-a' } = {}) {
  return fetch(`${base}/v1/artifacts`, { method: 'POST', headers: { ...auth(token), 'x-kakeflow-artifact-id': id, 'x-kakeflow-digest': claimedDigest, 'x-kakeflow-household-id': household, 'x-kakeflow-origin-device-id': device }, body: bytes })
}

function jsonHeaders(token = 'token-a') { return { ...auth(token), 'content-type': 'application/json' } }
function postJson(base, path, body, token = 'token-a') {
  return fetch(`${base}${path}`, { method: 'POST', headers: jsonHeaders(token), body: JSON.stringify(body) })
}
function putJson(base, path, body, token = 'token-a') {
  return fetch(`${base}${path}`, { method: 'PUT', headers: jsonHeaders(token), body: JSON.stringify(body) })
}
const encryptionKey = (fill) => ({ keyId: createHash('sha256').update(`key-${fill}`).digest('hex'), publicKey: Buffer.alloc(32, fill).toString('base64url'), generation: 1 })
const recipientSetDigest = (memberships) => {
  const hash = createHash('sha256')
  for (const item of [...memberships].sort((left, right) => left.membershipId.localeCompare(right.membershipId))) {
    hash.update(item.membershipId).update('\0').update(String(item.encryptionKeyGeneration)).update('\0')
      .update(item.encryptionKeyId).update('\0').update(item.encryptionPublicKey).update('\0')
  }
  return hash.digest('hex')
}
async function registerEncryptionKey(base, token, household, key = encryptionKey(token.charCodeAt(token.length - 1))) {
  const response = await putJson(base, `/v2/households/${household}/members/encryption-key`, key, token)
  assert.equal(response.status, 200)
  return (await response.json()).membership
}
async function createFamily(base, household = 'family') {
  const response = await postJson(base, '/v2/households', { householdId: household, domainMemberId: `${household}-member-owner`, idempotencyKey: `create-${household}` })
  assert.equal(response.status, 201)
  return (await response.json()).membership
}
async function inviteAndRedeem(base, { household = 'family', domainMemberId = `${household}-member-b`, ownerToken = 'token-a', memberToken = 'token-b', key = `invite-${domainMemberId}` } = {}) {
  const inviteResponse = await postJson(base, `/v2/households/${household}/invites`, { domainMemberId, idempotencyKey: key, expiresInSeconds: 3600 }, ownerToken)
  assert.equal(inviteResponse.status, 201)
  const invite = (await inviteResponse.json()).invite
  const redeemResponse = await postJson(base, '/v2/invites/redeem', { code: invite.code }, memberToken)
  assert.equal(redeemResponse.status, 201)
  return { invite, membership: (await redeemResponse.json()).membership }
}
function publish(base, { household = 'family', token = 'token-a', id = 'publication-1', bytes = Buffer.from('shared-package'), claimedDigest = digest(bytes), device = 'device-a', visibility = 'SHARED', memberId = null, schema = 'FAMILY_AUDIENCE_PARTITION_V1', envelope = null, extraHeaders = {} } = {}) {
  return fetch(`${base}/v2/households/${household}/publications`, {
    method: 'POST', headers: {
      ...auth(token), 'content-type': 'application/octet-stream',
      'x-kakeflow-publication-id': id, 'x-kakeflow-digest': claimedDigest,
      'x-kakeflow-origin-device-id': device,
      'x-kakeflow-audience-visibility': visibility,
      ...(memberId == null ? {} : { 'x-kakeflow-audience-member-id': memberId }),
      'x-kakeflow-artifact-schema': schema,
      ...(envelope == null ? {} : {
        'x-kakeflow-envelope-schema': 'FAMILY_ENCRYPTED_ENVELOPE_V1',
        'x-kakeflow-recipient-set-digest': envelope.recipientSetDigest,
        'x-kakeflow-inner-digest': envelope.innerDigest,
      }),
      ...extraHeaders,
    }, body: bytes,
  })
}

function capture(base, { household = 'family', token = 'token-a', id = 'capture-1', bytes = Buffer.from('receipt-capsule'), claimedDigest = digest(bytes), device = 'phone-a', visibility = 'SHARED', memberId = null, extraHeaders = {} } = {}) {
  return fetch(`${base}/v2/households/${household}/captures`, {
    method: 'POST', headers: {
      ...auth(token), 'content-type': 'application/octet-stream',
      'x-kakeflow-capture-id': id, 'x-kakeflow-digest': claimedDigest,
      'x-kakeflow-origin-device-id': device,
      'x-kakeflow-audience-visibility': visibility,
      ...(memberId == null ? {} : { 'x-kakeflow-audience-member-id': memberId }),
      'x-kakeflow-capsule-schema': 'MOBILE_RECEIPT_CAPTURE_V1',
      ...extraHeaders,
    }, body: bytes,
  })
}

test('authenticates whoami and rejects missing or unknown bearer tokens', async () => {
  const { base } = await fixture()
  assert.equal((await fetch(`${base}/v1/whoami`)).status, 401)
  assert.equal((await fetch(`${base}/v1/whoami`, { headers: auth('bad') })).status, 401)
  const response = await fetch(`${base}/v1/whoami`, { headers: auth() })
  assert.equal(response.status, 200)
  assert.deepEqual(await response.json(), { remotePrincipalId: 'principal-a' })
})

test('answers configured WebView CORS preflight before bearer authentication', async () => {
  const origin = 'tauri://localhost'
  const { base } = await fixture({ allowedOrigins: new Set([origin]) })
  const accepted = await fetch(`${base}/v1/artifacts`, { method: 'OPTIONS', headers: { Origin: origin } })
  assert.equal(accepted.status, 204)
  assert.equal(accepted.headers.get('access-control-allow-origin'), origin)
  assert.match(accepted.headers.get('access-control-allow-headers'), /X-KakeFlow-Digest/i)
  const rejected = await fetch(`${base}/v1/whoami`, { headers: { Origin: 'https://unconfigured.example', ...auth() } })
  assert.equal(rejected.status, 403)
})

test('isolates stored bytes and listings across derived principals', async () => {
  const { base } = await fixture()
  assert.equal((await upload(base)).status, 201)
  assert.equal((await fetch(`${base}/v1/artifacts/artifact-1`, { headers: auth('token-b') })).status, 404)
  const otherList = await fetch(`${base}/v1/artifacts?householdId=family`, { headers: auth('token-b') })
  assert.deepEqual((await otherList.json()).artifacts, [])
  const own = await fetch(`${base}/v1/artifacts/artifact-1`, { headers: auth() })
  assert.equal(await own.text(), 'package')
})

test('rejects digest tampering without publishing an artifact', async () => {
  const { base } = await fixture()
  const response = await upload(base, { claimedDigest: '0'.repeat(64) })
  assert.equal(response.status, 422)
  assert.equal((await fetch(`${base}/v1/artifacts/artifact-1`, { headers: auth() })).status, 404)
})

test('makes identical retries idempotent and conflicting IDs immutable', async () => {
  const { base } = await fixture()
  assert.equal((await upload(base)).status, 201)
  const retry = await upload(base)
  assert.equal(retry.status, 200)
  assert.equal((await retry.json()).created, false)
  assert.equal((await upload(base, { bytes: Buffer.from('different') })).status, 409)
  assert.equal(await (await fetch(`${base}/v1/artifacts/artifact-1`, { headers: auth() })).text(), 'package')
})

test('advances ordered cursors while excluding the requesting origin device', async () => {
  const { base } = await fixture()
  await upload(base, { id: 'one', device: 'device-a' })
  await upload(base, { id: 'two', device: 'device-b' })
  await upload(base, { id: 'other-household', household: 'other', device: 'device-b' })
  const first = await (await fetch(`${base}/v1/artifacts?householdId=family&after=0&excludeOriginDeviceId=device-a`, { headers: auth() })).json()
  assert.deepEqual(first.artifacts.map((item) => item.artifactId), ['two'])
  assert.equal(first.nextCursor, '2')
  const next = await (await fetch(`${base}/v1/artifacts?householdId=family&after=${first.nextCursor}&excludeOriginDeviceId=device-a`, { headers: auth() })).json()
  assert.deepEqual(next.artifacts, [])
  assert.equal(next.nextCursor, '2')
})

test('reloads the durable index and artifact bytes after restart', async () => {
  const root = await mkdtemp(join(tmpdir(), 'kakeflow-relay-restart-'))
  roots.push(root)
  let base = await start(root)
  assert.equal((await upload(base)).status, 201)
  const firstServer = servers.shift()
  await new Promise((resolve) => firstServer.close(resolve))
  base = await start(root)
  const list = await (await fetch(`${base}/v1/artifacts?householdId=family`, { headers: auth() })).json()
  assert.deepEqual(list.artifacts.map((item) => item.artifactId), ['artifact-1'])
  assert.equal(await (await fetch(`${base}/v1/artifacts/artifact-1`, { headers: auth() })).text(), 'package')
})

test('enforces the configured artifact size cap', async () => {
  const { base } = await fixture()
  const response = await upload(base, { bytes: Buffer.alloc(1025, 1) })
  assert.equal(response.status, 413)
  assert.equal((await fetch(`${base}/v1/artifacts/artifact-1`, { headers: auth() })).status, 404)
})

test('creates a family, issues an idempotent invite, and derives member identities from authentication', async () => {
  const { base } = await fixture()
  const owner = await createFamily(base)
  assert.equal(owner.principalId, 'principal-a')
  assert.equal(owner.role, 'OWNER')

  const request = { domainMemberId: 'family-member-b', idempotencyKey: 'invite-b', expiresInSeconds: 3600 }
  const first = await postJson(base, '/v2/households/family/invites', request)
  assert.equal(first.status, 201)
  const firstBody = await first.json()
  const retry = await postJson(base, '/v2/households/family/invites', request)
  assert.equal(retry.status, 200)
  assert.equal((await retry.json()).invite.code, firstBody.invite.code)
  assert.equal((await postJson(base, '/v2/households/family/invites', { ...request, idempotencyKey: 'not-owner' }, 'token-b')).status, 403)

  const redeemed = await postJson(base, '/v2/invites/redeem', { code: firstBody.invite.code }, 'token-b')
  assert.equal(redeemed.status, 201)
  const member = (await redeemed.json()).membership
  assert.equal(member.principalId, 'principal-b')
  assert.equal(member.domainMemberId, 'family-member-b')
  assert.equal(member.generation, 1)
  const redeemRetry = await postJson(base, '/v2/invites/redeem', { code: firstBody.invite.code }, 'token-b')
  assert.equal(redeemRetry.status, 200)
  assert.equal((await postJson(base, '/v2/invites/redeem', { code: firstBody.invite.code }, 'token-c')).status, 410)

  const members = await (await fetch(`${base}/v2/households/family/members`, { headers: auth('token-b') })).json()
  assert.deepEqual(members.members.map((item) => item.principalId), ['principal-a', 'principal-b'])
  const identity = await (await fetch(`${base}/v2/whoami`, { headers: auth('token-b') })).json()
  assert.equal(identity.remotePrincipalId, 'principal-b')
  assert.deepEqual(identity.memberships.map((item) => item.membershipId), [member.membershipId])
  const invites = await (await fetch(`${base}/v2/households/family/invites`, { headers: auth() })).json()
  assert.equal(invites.invites[0].code, undefined)
})

test('previews an active invite without redeeming it or returning the code', async () => {
  const { base } = await fixture()
  await createFamily(base)
  const created = await postJson(base, '/v2/households/family/invites', { domainMemberId: 'family-member-b', idempotencyKey: 'preview-b', expiresInSeconds: 3600 })
  const invite = (await created.json()).invite
  assert.equal((await fetch(`${base}/v2/invites/preview`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ code: invite.code }) })).status, 401)

  const first = await postJson(base, '/v2/invites/preview', { code: invite.code }, 'token-b')
  assert.equal(first.status, 200)
  assert.deepEqual(await first.json(), { invite: {
    householdId: 'family', domainMemberId: 'family-member-b', role: 'MEMBER', expiresAt: invite.expiresAt,
  } })
  const second = await postJson(base, '/v2/invites/preview', { code: invite.code }, 'token-b')
  assert.equal(second.status, 200)

  assert.equal((await postJson(base, '/v2/invites/redeem', { code: invite.code }, 'token-b')).status, 201)
  assert.equal((await postJson(base, '/v2/invites/preview', { code: invite.code }, 'token-b')).status, 410)
  assert.equal((await postJson(base, '/v2/invites/preview', { code: 'kfi_unknown_invitation_code_123456' }, 'token-b')).status, 404)
})

test('registers generation-safe recipient keys and stores encrypted family envelopes opaquely', async () => {
  const { base } = await fixture()
  await createFamily(base)
  const joined = await inviteAndRedeem(base)
  const ownerKey = await registerEncryptionKey(base, 'token-a', 'family', encryptionKey(11))
  const recipientKey = await registerEncryptionKey(base, 'token-b', 'family', encryptionKey(22))
  assert.equal(ownerKey.encryptionKeyGeneration, 1)
  assert.equal(recipientKey.encryptionPublicKey, encryptionKey(22).publicKey)

  const retry = await putJson(base, '/v2/households/family/members/encryption-key', encryptionKey(22), 'token-b')
  assert.equal(retry.status, 200)
  const conflict = await putJson(base, '/v2/households/family/members/encryption-key', { ...encryptionKey(23), generation: 1 }, 'token-b')
  assert.equal(conflict.status, 409)

  const ciphertext = Buffer.from('KFE1 opaque encrypted bytes')
  const innerDigest = digest(Buffer.from('KFF3 private family artifact'))
  const recipients = [recipientKey]
  const uploaded = await publish(base, { bytes: ciphertext, envelope: { recipientSetDigest: recipientSetDigest(recipients), innerDigest } })
  assert.equal(uploaded.status, 201)
  const page = await (await fetch(`${base}/v2/households/family/publications`, { headers: auth('token-b') })).json()
  assert.equal(page.publications[0].envelopeSchema, 'FAMILY_ENCRYPTED_ENVELOPE_V1')
  assert.equal(page.publications[0].innerDigest, innerDigest)
  assert.equal(page.publications[0].digest, digest(ciphertext))
  assert.equal(await (await fetch(`${base}/v2/households/family/publications/publication-1`, { headers: auth('token-b') })).text(), ciphertext.toString())

  const stale = await publish(base, { id: 'stale-envelope', bytes: ciphertext, envelope: { recipientSetDigest: '0'.repeat(64), innerDigest } })
  assert.equal(stale.status, 409)
  assert.equal((await stale.json()).error, 'RECIPIENT_SET_CHANGED')
  assert.equal(joined.membership.domainMemberId, 'family-member-b')
})

test('keeps an accepted encrypted publication idempotent after the recipient key rotates', async () => {
  const { base } = await fixture()
  await createFamily(base)
  await inviteAndRedeem(base)
  const recipientKey = await registerEncryptionKey(base, 'token-b', 'family', encryptionKey(31))
  const bytes = Buffer.from('KFE1 immutable envelope before key rotation')
  const innerDigest = digest(Buffer.from('KFF3 immutable inner artifact'))
  const envelope = { recipientSetDigest: recipientSetDigest([recipientKey]), innerDigest }

  const accepted = await publish(base, { id: 'key-rotation-retry', bytes, envelope })
  assert.equal(accepted.status, 201)
  assert.equal((await accepted.json()).created, true)

  const rotated = await registerEncryptionKey(base, 'token-b', 'family', {
    ...encryptionKey(32), generation: 2,
  })
  assert.equal(rotated.encryptionKeyGeneration, 2)
  assert.notEqual(recipientSetDigest([rotated]), envelope.recipientSetDigest)

  const retry = await publish(base, { id: 'key-rotation-retry', bytes, envelope })
  assert.equal(retry.status, 200)
  const retried = await retry.json()
  assert.equal(retried.created, false)
  assert.equal(retried.publication.digest, digest(bytes))
  assert.equal(retried.publication.recipientSetDigest, envelope.recipientSetDigest)
})

test('rejects a stale recipient set before storage and accepts a current envelope under the same publication ID', async () => {
  const { base } = await fixture()
  await createFamily(base)
  await inviteAndRedeem(base)
  const recipientKey = await registerEncryptionKey(base, 'token-b', 'family', encryptionKey(41))
  const bytes = Buffer.from('KFE1 envelope resealed for current recipients')
  const innerDigest = digest(Buffer.from('KFF3 stable inner artifact'))
  const id = 'recipient-set-recovery'

  const stale = await publish(base, {
    id, bytes,
    envelope: { recipientSetDigest: '0'.repeat(64), innerDigest },
  })
  assert.equal(stale.status, 409)
  assert.equal((await stale.json()).error, 'RECIPIENT_SET_CHANGED')
  assert.equal((await fetch(`${base}/v2/households/family/publications/${id}`, { headers: auth() })).status, 404)
  const before = await (await fetch(`${base}/v2/households/family/publications`, { headers: auth('token-b') })).json()
  assert.deepEqual(before.publications, [])

  const currentEnvelope = { recipientSetDigest: recipientSetDigest([recipientKey]), innerDigest }
  const current = await publish(base, { id, bytes, envelope: currentEnvelope })
  assert.equal(current.status, 201)
  assert.equal((await current.json()).created, true)
  const after = await (await fetch(`${base}/v2/households/family/publications`, { headers: auth('token-b') })).json()
  assert.deepEqual(after.publications.map((item) => item.publicationId), [id])
  assert.equal(after.publications[0].recipientSetDigest, currentEnvelope.recipientSetDigest)
})

test('replays the exact accepted envelope after a lost response even when household recipients later change', async () => {
  const { base } = await fixture()
  await createFamily(base)
  await inviteAndRedeem(base)
  const recipientKey = await registerEncryptionKey(base, 'token-b', 'family', encryptionKey(51))
  const bytes = Buffer.from('KFE1 response-loss retry envelope')
  const innerDigest = digest(Buffer.from('KFF3 response-loss inner artifact'))
  const envelope = { recipientSetDigest: recipientSetDigest([recipientKey]), innerDigest }

  const responseWhoseBodyIsLost = await publish(base, { id: 'response-loss-retry', bytes, envelope })
  assert.equal(responseWhoseBodyIsLost.status, 201)

  await inviteAndRedeem(base, {
    domainMemberId: 'family-member-c', memberToken: 'token-c', key: 'response-loss-add-c',
  })
  await registerEncryptionKey(base, 'token-c', 'family', encryptionKey(52))

  const retry = await publish(base, { id: 'response-loss-retry', bytes, envelope })
  assert.equal(retry.status, 200)
  const retried = await retry.json()
  assert.equal(retried.created, false)
  assert.equal(retried.publication.recipientSetDigest, envelope.recipientSetDigest)
  const originalRecipient = await (await fetch(`${base}/v2/households/family/publications`, { headers: auth('token-b') })).json()
  assert.deepEqual(originalRecipient.publications.map((item) => item.publicationId), ['response-loss-retry'])
  const laterRecipient = await (await fetch(`${base}/v2/households/family/publications`, { headers: auth('token-c') })).json()
  assert.deepEqual(laterRecipient.publications, [])
})

test('routes shared publications only to server-snapshotted active memberships', async () => {
  const { base } = await fixture()
  await createFamily(base)
  const { membership } = await inviteAndRedeem(base)
  const bytes = Buffer.from('family-shared-snapshot')
  const accepted = await publish(base, {
    bytes,
    extraHeaders: {
      'x-kakeflow-sender-principal-id': 'principal-c',
      'x-kakeflow-recipient-principal-id': 'principal-c',
    },
  })
  assert.equal(accepted.status, 201)
  const metadata = (await accepted.json()).publication
  assert.equal(metadata.senderPrincipalId, 'principal-a')
  assert.equal(metadata.senderMembershipId, 'membership-1')
  assert.equal(metadata.recipientCount, 1)
  assert.deepEqual(metadata.audience, { visibility: 'SHARED', memberId: null })

  const inbound = await (await fetch(`${base}/v2/households/family/publications?after=0`, { headers: auth('token-b') })).json()
  assert.deepEqual(inbound.publications.map((item) => item.publicationId), ['publication-1'])
  assert.equal(inbound.publications[0].senderPrincipalId, 'principal-a')
  assert.equal(await (await fetch(`${base}/v2/households/family/publications/publication-1`, { headers: auth('token-b') })).text(), bytes.toString())

  assert.equal((await fetch(`${base}/v2/households/family/publications?after=0`, { headers: auth('token-c') })).status, 404)
  assert.equal((await fetch(`${base}/v2/households/family/publications/publication-1`, { headers: auth('token-c') })).status, 404)
  assert.equal(membership.membershipId, 'membership-2')
})

test('routes PERSONAL publications only to the authenticated member tuple with no household fallback', async () => {
  const { base } = await fixture()
  await createFamily(base)
  const sameMember = await inviteAndRedeem(base, { domainMemberId: 'family-member-owner', key: 'invite-owner-second-principal' })
  await inviteAndRedeem(base, { domainMemberId: 'family-member-c', memberToken: 'token-c', key: 'invite-c' })

  const personal = await publish(base, {
    id: 'personal-1', visibility: 'PERSONAL', memberId: 'family-member-owner',
  })
  assert.equal(personal.status, 201)
  const personalMetadata = (await personal.json()).publication
  assert.deepEqual(personalMetadata.audience, { visibility: 'PERSONAL', memberId: 'family-member-owner' })
  assert.equal(personalMetadata.recipientCount, 1)

  const sameMemberList = await (await fetch(`${base}/v2/households/family/publications`, { headers: auth('token-b') })).json()
  assert.deepEqual(sameMemberList.publications.map((item) => item.publicationId), ['personal-1'])
  const otherMemberList = await (await fetch(`${base}/v2/households/family/publications`, { headers: auth('token-c') })).json()
  assert.deepEqual(otherMemberList.publications, [])
  assert.equal((await fetch(`${base}/v2/households/family/publications/personal-1`, { headers: auth('token-c') })).status, 404)

  assert.equal((await publish(base, { id: 'spoofed-personal', visibility: 'PERSONAL', memberId: 'family-member-c' })).status, 403)
  assert.equal((await fetch(`${base}/v2/households/family/members/${sameMember.membership.membershipId}`, { method: 'DELETE', headers: auth() })).status, 200)
  assert.equal((await publish(base, { id: 'personal-without-recipient', visibility: 'PERSONAL', memberId: 'family-member-owner' })).status, 409)
  const after = await (await fetch(`${base}/v2/households/family/publications`, { headers: auth('token-c') })).json()
  assert.deepEqual(after.publications, [])
})

test('revocation blocks listing and direct download, and a rejoined generation cannot read old bytes', async () => {
  const { base } = await fixture()
  await createFamily(base)
  const first = await inviteAndRedeem(base)
  assert.equal((await publish(base)).status, 201)
  const revoked = await fetch(`${base}/v2/households/family/members/${first.membership.membershipId}`, { method: 'DELETE', headers: auth() })
  assert.equal(revoked.status, 200)
  assert.equal((await fetch(`${base}/v2/households/family/publications?after=0`, { headers: auth('token-b') })).status, 404)
  assert.equal((await fetch(`${base}/v2/households/family/publications/publication-1`, { headers: auth('token-b') })).status, 404)

  const second = await inviteAndRedeem(base, { key: 'invite-b-generation-2' })
  assert.equal(second.membership.generation, 2)
  const oldList = await (await fetch(`${base}/v2/households/family/publications?after=0`, { headers: auth('token-b') })).json()
  assert.deepEqual(oldList.publications, [])
  assert.equal((await fetch(`${base}/v2/households/family/publications/publication-1`, { headers: auth('token-b') })).status, 404)

  assert.equal((await publish(base, { id: 'publication-2' })).status, 201)
  const current = await (await fetch(`${base}/v2/households/family/publications?after=0`, { headers: auth('token-b') })).json()
  assert.deepEqual(current.publications.map((item) => item.publicationId), ['publication-2'])
  assert.equal((await fetch(`${base}/v2/households/family/members/membership-1`, { method: 'DELETE', headers: auth() })).status, 409)
})

test('serializes publication acceptance with revocation and never grants revoked-generation access', async () => {
  const { base } = await fixture()
  await createFamily(base)
  const { membership } = await inviteAndRedeem(base)
  const [publication, revocation] = await Promise.all([
    publish(base, { id: 'publication-race' }),
    fetch(`${base}/v2/households/family/members/${membership.membershipId}`, { method: 'DELETE', headers: auth() }),
  ])
  assert.ok([201, 409].includes(publication.status))
  assert.equal(revocation.status, 200)
  assert.equal((await fetch(`${base}/v2/households/family/publications?after=0`, { headers: auth('token-b') })).status, 404)
  assert.equal((await fetch(`${base}/v2/households/family/publications/publication-race`, { headers: auth('token-b') })).status, 404)
})

test('publication retries are immutable while a new publication can deliver identical bytes', async () => {
  const { base } = await fixture()
  await createFamily(base)
  await inviteAndRedeem(base)
  const bytes = Buffer.from('same-current-state')
  assert.equal((await publish(base, { bytes })).status, 201)
  const retry = await publish(base, { bytes })
  assert.equal(retry.status, 200)
  assert.equal((await retry.json()).created, false)
  assert.equal((await publish(base, { bytes: Buffer.from('changed') })).status, 409)
  assert.equal((await publish(base, { id: 'publication-2', bytes })).status, 201)
  const list = await (await fetch(`${base}/v2/households/family/publications`, { headers: auth('token-b') })).json()
  assert.deepEqual(list.publications.map((item) => item.publicationId), ['publication-1', 'publication-2'])
})

test('routes and downloads FAMILY_AUDIENCE_PARTITION_V2 without reinterpreting its bytes', async () => {
  const { base } = await fixture()
  await createFamily(base)
  await inviteAndRedeem(base)
  const bytes = Buffer.from([0, 255, 17, 42, 0, 128, 99])
  const accepted = await publish(base, {
    id: 'family-v2-shared', bytes, schema: 'FAMILY_AUDIENCE_PARTITION_V2',
  })
  assert.equal(accepted.status, 201)
  const metadata = (await accepted.json()).publication
  assert.equal(metadata.artifactSchema, 'FAMILY_AUDIENCE_PARTITION_V2')
  assert.equal(metadata.digest, digest(bytes))

  const page = await (await fetch(`${base}/v2/households/family/publications`, { headers: auth('token-b') })).json()
  assert.equal(page.publications[0].artifactSchema, 'FAMILY_AUDIENCE_PARTITION_V2')
  const downloaded = await fetch(`${base}/v2/households/family/publications/family-v2-shared`, { headers: auth('token-b') })
  assert.equal(downloaded.status, 200)
  assert.equal(downloaded.headers.get('x-kakeflow-artifact-schema'), 'FAMILY_AUDIENCE_PARTITION_V2')
  assert.equal(downloaded.headers.get('x-kakeflow-digest'), digest(bytes))
  assert.deepEqual(Buffer.from(await downloaded.arrayBuffer()), bytes)
})

test('routes and downloads FAMILY_AUDIENCE_PARTITION_V3 evidence bytes without reinterpreting them', async () => {
  const { base } = await fixture()
  await createFamily(base)
  await inviteAndRedeem(base)
  const bytes = Buffer.from([75, 70, 70, 51, 0, 255, 17, 42, 0, 128, 99])
  const accepted = await publish(base, {
    id: 'family-v3-evidence', bytes, schema: 'FAMILY_AUDIENCE_PARTITION_V3',
  })
  assert.equal(accepted.status, 201)
  const metadata = (await accepted.json()).publication
  assert.equal(metadata.artifactSchema, 'FAMILY_AUDIENCE_PARTITION_V3')
  assert.equal(metadata.digest, digest(bytes))
  const retry = await publish(base, {
    id: 'family-v3-evidence', bytes, schema: 'FAMILY_AUDIENCE_PARTITION_V3',
  })
  assert.equal(retry.status, 200)
  assert.equal((await retry.json()).created, false)
  assert.equal((await publish(base, {
    id: 'family-v3-evidence', bytes, schema: 'FAMILY_AUDIENCE_PARTITION_V2',
  })).status, 409)
  assert.equal((await publish(base, {
    id: 'family-v3-evidence', bytes: Buffer.from('changed'), schema: 'FAMILY_AUDIENCE_PARTITION_V3',
  })).status, 409)

  const page = await (await fetch(`${base}/v2/households/family/publications`, { headers: auth('token-b') })).json()
  assert.equal(page.publications[0].artifactSchema, 'FAMILY_AUDIENCE_PARTITION_V3')
  const downloaded = await fetch(`${base}/v2/households/family/publications/family-v3-evidence`, { headers: auth('token-b') })
  assert.equal(downloaded.status, 200)
  assert.equal(downloaded.headers.get('x-kakeflow-artifact-schema'), 'FAMILY_AUDIENCE_PARTITION_V3')
  assert.equal(downloaded.headers.get('x-kakeflow-digest'), digest(bytes))
  assert.deepEqual(Buffer.from(await downloaded.arrayBuffer()), bytes)
})

test('keeps v2 publication identity immutable and retries byte-identically', async () => {
  const { base } = await fixture()
  await createFamily(base)
  await inviteAndRedeem(base)
  const bytes = Buffer.from('family-v2-current-state')
  assert.equal((await publish(base, {
    id: 'family-v2-idempotent', bytes, schema: 'FAMILY_AUDIENCE_PARTITION_V2',
  })).status, 201)
  const retry = await publish(base, {
    id: 'family-v2-idempotent', bytes, schema: 'FAMILY_AUDIENCE_PARTITION_V2',
  })
  assert.equal(retry.status, 200)
  assert.equal((await retry.json()).created, false)
  assert.equal((await publish(base, {
    id: 'family-v2-idempotent', bytes, schema: 'FAMILY_AUDIENCE_PARTITION_V1',
  })).status, 409)
  assert.equal((await publish(base, {
    id: 'family-v2-idempotent', bytes: Buffer.from('changed'), schema: 'FAMILY_AUDIENCE_PARTITION_V2',
  })).status, 409)
  assert.equal((await publish(base, {
    id: 'unsupported-family-schema', bytes, schema: 'FAMILY_AUDIENCE_PARTITION_V4',
  })).status, 400)
})

test('routes v2 PERSONAL bytes only to the matching membership generation and honors revocation', async () => {
  const { base } = await fixture()
  await createFamily(base)
  const first = await inviteAndRedeem(base, {
    domainMemberId: 'family-member-owner', key: 'v2-personal-peer',
  })
  await inviteAndRedeem(base, {
    domainMemberId: 'family-member-c', memberToken: 'token-c', key: 'v2-personal-other',
  })
  assert.equal((await publish(base, {
    id: 'family-v2-personal', visibility: 'PERSONAL', memberId: 'family-member-owner',
    schema: 'FAMILY_AUDIENCE_PARTITION_V2',
  })).status, 201)
  const matching = await (await fetch(`${base}/v2/households/family/publications`, { headers: auth('token-b') })).json()
  assert.deepEqual(matching.publications.map((item) => item.publicationId), ['family-v2-personal'])
  const other = await (await fetch(`${base}/v2/households/family/publications`, { headers: auth('token-c') })).json()
  assert.deepEqual(other.publications, [])
  assert.equal((await fetch(`${base}/v2/households/family/publications/family-v2-personal`, { headers: auth('token-c') })).status, 404)

  assert.equal((await fetch(`${base}/v2/households/family/members/${first.membership.membershipId}`, {
    method: 'DELETE', headers: auth(),
  })).status, 200)
  assert.equal((await fetch(`${base}/v2/households/family/publications/family-v2-personal`, { headers: auth('token-b') })).status, 404)
  const rejoined = await inviteAndRedeem(base, {
    domainMemberId: 'family-member-owner', key: 'v2-personal-peer-generation-2',
  })
  assert.equal(rejoined.membership.generation, 2)
  const after = await (await fetch(`${base}/v2/households/family/publications`, { headers: auth('token-b') })).json()
  assert.deepEqual(after.publications, [])
  assert.equal((await fetch(`${base}/v2/households/family/publications/family-v2-personal`, { headers: auth('token-b') })).status, 404)
})

test('rejects wrong audience tuples, missing recipients, digest tampering, and oversized family artifacts', async () => {
  const { base } = await fixture()
  await createFamily(base)
  assert.equal((await publish(base)).status, 409)
  await inviteAndRedeem(base)
  assert.equal((await publish(base, { extraHeaders: { 'x-kakeflow-audience-visibility': 'PERSONAL' } })).status, 400)
  assert.equal((await publish(base, { extraHeaders: { 'x-kakeflow-audience-member-id': 'family-member-b' } })).status, 400)
  assert.equal((await publish(base, { claimedDigest: '0'.repeat(64) })).status, 422)
  assert.equal((await publish(base, { bytes: Buffer.alloc(1025, 1) })).status, 413)
  const list = await (await fetch(`${base}/v2/households/family/publications`, { headers: auth('token-b') })).json()
  assert.deepEqual(list.publications, [])
})

test('routes immutable shared receipt captures through a separate cursor and byte channel', async () => {
  const { base } = await fixture()
  await createFamily(base)
  await inviteAndRedeem(base)
  const bytes = Buffer.from('mobile-receipt-capsule')
  const accepted = await capture(base, { bytes })
  assert.equal(accepted.status, 201)
  const metadata = (await accepted.json()).capture
  assert.equal(metadata.captureId, 'capture-1')
  assert.equal(metadata.senderMembershipId, 'membership-1')
  assert.equal(metadata.recipientCount, 1)
  assert.deepEqual(metadata.audience, { visibility: 'SHARED', memberId: null })
  assert.equal(metadata.capsuleSchema, 'MOBILE_RECEIPT_CAPTURE_V1')

  const page = await (await fetch(`${base}/v2/households/family/captures?after=0&excludeOriginDeviceId=desktop-b`, { headers: auth('token-b') })).json()
  assert.deepEqual(page.captures.map((item) => item.captureId), ['capture-1'])
  assert.equal(page.nextCursor, '1')
  const downloaded = await fetch(`${base}/v2/households/family/captures/capture-1`, { headers: auth('token-b') })
  assert.equal(downloaded.headers.get('x-kakeflow-capsule-schema'), 'MOBILE_RECEIPT_CAPTURE_V1')
  assert.equal(downloaded.headers.get('x-kakeflow-audience-visibility'), 'SHARED')
  assert.equal(await downloaded.text(), bytes.toString())
  const publications = await (await fetch(`${base}/v2/households/family/publications`, { headers: auth('token-b') })).json()
  assert.deepEqual(publications.publications, [])
})

test('routes PERSONAL captures only to another active principal mapped to the sender member', async () => {
  const { base } = await fixture()
  await createFamily(base)
  const sameMember = await inviteAndRedeem(base, { domainMemberId: 'family-member-owner', key: 'capture-same-member' })
  await inviteAndRedeem(base, { domainMemberId: 'family-member-c', memberToken: 'token-c', key: 'capture-other-member' })
  const personal = await capture(base, { visibility: 'PERSONAL', memberId: 'family-member-owner' })
  assert.equal(personal.status, 201)
  assert.equal((await personal.json()).capture.recipientCount, 1)
  const samePage = await (await fetch(`${base}/v2/households/family/captures`, { headers: auth('token-b') })).json()
  assert.deepEqual(samePage.captures.map((item) => item.captureId), ['capture-1'])
  const otherPage = await (await fetch(`${base}/v2/households/family/captures`, { headers: auth('token-c') })).json()
  assert.deepEqual(otherPage.captures, [])
  assert.equal((await fetch(`${base}/v2/households/family/captures/capture-1`, { headers: auth('token-c') })).status, 404)
  assert.equal((await capture(base, { id: 'spoof', visibility: 'PERSONAL', memberId: 'family-member-c' })).status, 403)
  assert.equal((await fetch(`${base}/v2/households/family/members/${sameMember.membership.membershipId}`, { method: 'DELETE', headers: auth() })).status, 200)
  assert.equal((await capture(base, { id: 'no-personal-peer', visibility: 'PERSONAL', memberId: 'family-member-owner' })).status, 409)
})

test('makes capture retries idempotent and rejects malformed, tampered, empty, or oversized capsules', async () => {
  const { base } = await fixture()
  await createFamily(base)
  await inviteAndRedeem(base)
  const bytes = Buffer.from('same-capture')
  assert.equal((await capture(base, { bytes })).status, 201)
  const retry = await capture(base, { bytes })
  assert.equal(retry.status, 200)
  assert.equal((await retry.json()).created, false)
  assert.equal((await capture(base, { bytes: Buffer.from('different') })).status, 409)
  assert.equal((await capture(base, { id: 'same-bytes-new-id', bytes })).status, 201)
  assert.equal((await capture(base, { id: 'missing-personal-member', visibility: 'PERSONAL' })).status, 400)
  assert.equal((await capture(base, { id: 'shared-with-member', memberId: 'family-member-owner' })).status, 400)
  assert.equal((await capture(base, { id: 'bad-digest', claimedDigest: '0'.repeat(64) })).status, 422)
  assert.equal((await capture(base, { id: 'empty', bytes: Buffer.alloc(0) })).status, 422)
  assert.equal((await capture(base, { id: 'oversized', bytes: Buffer.alloc(1025, 1) })).status, 413)
})

test('capture origin exclusion advances its cursor and revoked generations cannot list old captures', async () => {
  const { base } = await fixture()
  await createFamily(base)
  const first = await inviteAndRedeem(base)
  assert.equal((await capture(base, { id: 'phone-origin', device: 'phone-b' })).status, 201)
  assert.equal((await capture(base, { id: 'visible', device: 'phone-a' })).status, 201)
  const page = await (await fetch(`${base}/v2/households/family/captures?after=0&excludeOriginDeviceId=phone-b`, { headers: auth('token-b') })).json()
  assert.deepEqual(page.captures.map((item) => item.captureId), ['visible'])
  assert.equal(page.nextCursor, '2')
  assert.equal((await fetch(`${base}/v2/households/family/members/${first.membership.membershipId}`, { method: 'DELETE', headers: auth() })).status, 200)
  assert.equal((await fetch(`${base}/v2/households/family/captures?after=0`, { headers: auth('token-b') })).status, 404)
  assert.equal((await fetch(`${base}/v2/households/family/captures/visible`, { headers: auth('token-b') })).status, 404)
  const rejoined = await inviteAndRedeem(base, { key: 'capture-rejoin' })
  assert.equal(rejoined.membership.generation, 2)
  const after = await (await fetch(`${base}/v2/households/family/captures?after=0`, { headers: auth('token-b') })).json()
  assert.deepEqual(after.captures, [])
  assert.equal((await fetch(`${base}/v2/households/family/captures/visible`, { headers: auth('token-b') })).status, 404)
})

test('migrates a valid family index v1 and persists capture metadata and bytes across restart', async () => {
  const root = await mkdtemp(join(tmpdir(), 'kakeflow-capture-relay-restart-'))
  roots.push(root)
  await writeFile(join(root, 'family-index.json'), `${JSON.stringify({
    version: 1, nextSequence: 1, nextMembershipSequence: 1, nextInviteSequence: 1,
    households: [], memberships: [], invites: [], publications: [],
  })}\n`)
  let base = await start(root)
  assert.equal(JSON.parse(await readFile(join(root, 'family-index.json'), 'utf8')).version, 3)
  await createFamily(base)
  await inviteAndRedeem(base)
  assert.equal((await capture(base)).status, 201)
  const firstServer = servers.shift()
  await new Promise((resolve) => firstServer.close(resolve))
  base = await start(root)
  const page = await (await fetch(`${base}/v2/households/family/captures`, { headers: auth('token-b') })).json()
  assert.deepEqual(page.captures.map((item) => item.captureId), ['capture-1'])
  assert.equal(await (await fetch(`${base}/v2/households/family/captures/capture-1`, { headers: auth('token-b') })).text(), 'receipt-capsule')
})

test('expires and revokes invites without exposing their code through listing', async () => {
  let now = Date.parse('2026-07-14T00:00:00.000Z')
  const { base } = await fixture({ clock: () => new Date(now) })
  await createFamily(base)
  const expiring = await postJson(base, '/v2/households/family/invites', { domainMemberId: 'member-b', idempotencyKey: 'expires', expiresInSeconds: 60 })
  const expiringInvite = (await expiring.json()).invite
  now += 61_000
  assert.equal((await postJson(base, '/v2/invites/redeem', { code: expiringInvite.code }, 'token-b')).status, 410)
  assert.equal((await postJson(base, '/v2/invites/preview', { code: expiringInvite.code }, 'token-b')).status, 410)

  const active = await postJson(base, '/v2/households/family/invites', { domainMemberId: 'member-c', idempotencyKey: 'revoked', expiresInSeconds: 60 })
  const activeInvite = (await active.json()).invite
  assert.equal((await fetch(`${base}/v2/households/family/invites/${activeInvite.inviteId}`, { method: 'DELETE', headers: auth() })).status, 200)
  assert.equal((await postJson(base, '/v2/invites/redeem', { code: activeInvite.code }, 'token-c')).status, 410)
  assert.equal((await postJson(base, '/v2/invites/preview', { code: activeInvite.code }, 'token-c')).status, 410)
  const listed = await (await fetch(`${base}/v2/households/family/invites`, { headers: auth() })).json()
  assert.ok(listed.invites.every((item) => item.code === undefined))
})

test('persists family memberships, invitations, publications, and access decisions across restart', async () => {
  const root = await mkdtemp(join(tmpdir(), 'kakeflow-family-relay-restart-'))
  roots.push(root)
  let base = await start(root)
  await createFamily(base)
  await inviteAndRedeem(base)
  assert.equal((await publish(base)).status, 201)
  const firstServer = servers.shift()
  await new Promise((resolve) => firstServer.close(resolve))
  base = await start(root)

  const households = await (await fetch(`${base}/v2/households`, { headers: auth('token-b') })).json()
  assert.equal(households.households[0].membership.principalId, 'principal-b')
  const publications = await (await fetch(`${base}/v2/households/family/publications`, { headers: auth('token-b') })).json()
  assert.deepEqual(publications.publications.map((item) => item.publicationId), ['publication-1'])
  assert.equal(await (await fetch(`${base}/v2/households/family/publications/publication-1`, { headers: auth('token-b') })).text(), 'shared-package')
})

test('includes family DELETE and audience headers in configured WebView CORS', async () => {
  const origin = 'tauri://localhost'
  const { base } = await fixture({ allowedOrigins: new Set([origin]) })
  const response = await fetch(`${base}/v2/households/family/members/member`, { method: 'OPTIONS', headers: { Origin: origin } })
  assert.equal(response.status, 204)
  assert.match(response.headers.get('access-control-allow-methods'), /DELETE/)
  assert.match(response.headers.get('access-control-allow-headers'), /X-KakeFlow-Audience-Visibility/i)
  assert.match(response.headers.get('access-control-allow-headers'), /X-KakeFlow-Capture-Id/i)
  assert.match(response.headers.get('access-control-allow-headers'), /X-KakeFlow-Capsule-Schema/i)
})
