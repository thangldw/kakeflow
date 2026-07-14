import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { mkdtemp, rm } from 'node:fs/promises'
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

async function start(root, maximum = 1024, allowedOrigins = new Set()) {
  const server = await createRelayServer({ dataDirectory: root, tokens: new Map([['token-a', 'principal-a'], ['token-b', 'principal-b']]), allowedOrigins, maxArtifactBytes: maximum })
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve))
  servers.push(server)
  const address = server.address()
  return `http://127.0.0.1:${address.port}`
}

async function fixture({ allowedOrigins = new Set() } = {}) {
  const root = await mkdtemp(join(tmpdir(), 'kakeflow-relay-test-'))
  roots.push(root)
  return { root, base: await start(root, 1024, allowedOrigins) }
}

const digest = (bytes) => createHash('sha256').update(bytes).digest('hex')
const auth = (token = 'token-a') => ({ authorization: `Bearer ${token}` })
function upload(base, { token = 'token-a', id = 'artifact-1', bytes = Buffer.from('package'), claimedDigest = digest(bytes), household = 'family', device = 'device-a' } = {}) {
  return fetch(`${base}/v1/artifacts`, { method: 'POST', headers: { ...auth(token), 'x-kakeflow-artifact-id': id, 'x-kakeflow-digest': claimedDigest, 'x-kakeflow-household-id': household, 'x-kakeflow-origin-device-id': device }, body: bytes })
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
