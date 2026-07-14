import { createHash } from 'node:crypto'
import { createReadStream, createWriteStream } from 'node:fs'
import { access, mkdir, open, readFile, rename, rm, unlink, writeFile } from 'node:fs/promises'
import { createServer } from 'node:http'
import { join } from 'node:path'
import { pipeline } from 'node:stream/promises'

export const MAX_ARTIFACT_BYTES = 64 * 1024 * 1024
const ID = /^[A-Za-z0-9_.:-]{1,200}$/
const DIGEST = /^[0-9a-f]{64}$/
const INDEX_VERSION = 1
const PAGE_SIZE = 100

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

function routeArtifactId(pathname) {
  const prefix = '/v1/artifacts/'
  if (!pathname.startsWith(prefix)) return null
  try { return decodeURIComponent(pathname.slice(prefix.length)) } catch { return null }
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

export async function createRelayServer({ dataDirectory, tokens, allowedOrigins = new Set(), maxArtifactBytes = MAX_ARTIFACT_BYTES } = {}) {
  if (!dataDirectory || !(tokens instanceof Map) || tokens.size === 0 || !(allowedOrigins instanceof Set) || !Number.isSafeInteger(maxArtifactBytes) || maxArtifactBytes < 1) throw new Error('relay configuration is invalid')
  for (const [token, principal] of tokens) {
    if (!token || typeof principal !== 'string' || !ID.test(principal)) throw new Error('relay token mapping is invalid')
  }
  await mkdir(dataDirectory, { recursive: true, mode: 0o700 })
  const artifactDirectory = join(dataDirectory, 'artifacts')
  const temporaryDirectory = join(dataDirectory, 'tmp')
  const indexPath = join(dataDirectory, 'index.json')
  await mkdir(artifactDirectory, { recursive: true, mode: 0o700 })
  await mkdir(temporaryDirectory, { recursive: true, mode: 0o700 })
  let index = await readIndex(indexPath)
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
          'access-control-allow-methods': 'GET, POST, OPTIONS',
          'access-control-allow-headers': 'Authorization, Content-Type, X-KakeFlow-Artifact-Id, X-KakeFlow-Digest, X-KakeFlow-Household-Id, X-KakeFlow-Origin-Device-Id',
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
