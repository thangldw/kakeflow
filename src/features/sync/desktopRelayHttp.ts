import type { DesktopRelayPreparedDeliveryDto, DesktopRelayRemoteArtifactDto } from '../../platform'

const REQUEST_TIMEOUT_MS = 10_000
const MAX_PACKAGE_BYTES = 64 * 1024 * 1024

export class DesktopRelayHttpError extends Error {
  constructor(readonly code: 'INVALID_ENDPOINT' | 'NETWORK' | 'REJECTED' | 'INVALID_RESPONSE') { super(code) }
}

function baseUrl(endpoint: string): URL {
  try {
    const value = new URL(endpoint)
    if (!['http:', 'https:'].includes(value.protocol) || value.username || value.password) throw new Error()
    value.pathname = value.pathname.replace(/\/$/, '')
    value.search = ''; value.hash = ''
    return value
  } catch { throw new DesktopRelayHttpError('INVALID_ENDPOINT') }
}

async function relayFetch(endpoint: string, path: string, bearerToken: string, init: RequestInit = {}, fetcher: typeof fetch = fetch): Promise<Response> {
  const url = baseUrl(endpoint); const queryAt = path.indexOf('?')
  url.pathname = `${url.pathname}${queryAt < 0 ? path : path.slice(0, queryAt)}`
  url.search = queryAt < 0 ? '' : path.slice(queryAt)
  const controller = new AbortController(); const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS)
  try {
    const response = await fetcher(url, { ...init, signal: controller.signal, headers: { Accept: 'application/json', Authorization: `Bearer ${bearerToken}`, ...init.headers } })
    if (!response.ok) throw new DesktopRelayHttpError('REJECTED')
    return response
  } catch (error) {
    if (error instanceof DesktopRelayHttpError) throw error
    throw new DesktopRelayHttpError('NETWORK')
  } finally { clearTimeout(timer) }
}

function object(value: unknown): Record<string, unknown> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) throw new DesktopRelayHttpError('INVALID_RESPONSE')
  return value as Record<string, unknown>
}

function text(value: unknown): string {
  if (typeof value !== 'string' || value.length === 0) throw new DesktopRelayHttpError('INVALID_RESPONSE')
  return value
}

function digest(value: unknown): string {
  const result = text(value)
  if (!/^[0-9a-f]{64}$/.test(result)) throw new DesktopRelayHttpError('INVALID_RESPONSE')
  return result
}

function timestamp(value: unknown): string {
  const result = text(value)
  if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{3})?Z$/.test(result) || Number.isNaN(Date.parse(result))) throw new DesktopRelayHttpError('INVALID_RESPONSE')
  return result
}

export async function identifyDesktopRelay(endpoint: string, bearerToken: string, fetcher?: typeof fetch): Promise<string> {
  const response = await relayFetch(endpoint, '/v1/whoami', bearerToken, {}, fetcher)
  return text(object(await response.json()).remotePrincipalId)
}

export interface DesktopRelayAcceptance { readonly artifactId: string; readonly digest: string; readonly acceptedAt: string }

export async function uploadDesktopRelayArtifact(endpoint: string, bearerToken: string, delivery: DesktopRelayPreparedDeliveryDto, fetcher?: typeof fetch): Promise<DesktopRelayAcceptance> {
  const response = await relayFetch(endpoint, '/v1/artifacts', bearerToken, {
    method: 'POST', headers: {
      'Content-Type': 'application/octet-stream', 'x-kakeflow-artifact-id': delivery.artifactId,
      'x-kakeflow-digest': delivery.digest, 'x-kakeflow-household-id': delivery.householdId,
      'x-kakeflow-origin-device-id': delivery.originDeviceId,
    }, body: new Uint8Array(delivery.packageBytes),
  }, fetcher)
  const value = object(await response.json()); const artifact = parseRemoteArtifact(value.artifact)
  if (typeof value.created !== 'boolean') throw new DesktopRelayHttpError('INVALID_RESPONSE')
  return { artifactId: artifact.artifactId, digest: artifact.digest, acceptedAt: artifact.createdAt }
}

export async function listDesktopRelayArtifacts(endpoint: string, bearerToken: string, householdId: string, excludeOriginDeviceId: string, fetcher?: typeof fetch): Promise<readonly DesktopRelayRemoteArtifactDto[]> {
  const seen = new Set<string>()
  const result: DesktopRelayRemoteArtifactDto[] = []; let cursor: string | null = null
  for (let page = 0; page < 20; page += 1) {
    const query = `householdId=${encodeURIComponent(householdId)}&excludeOriginDeviceId=${encodeURIComponent(excludeOriginDeviceId)}${cursor ? `&after=${encodeURIComponent(cursor)}` : ''}`
    const response = await relayFetch(endpoint, `/v1/artifacts?${query}`, bearerToken, {}, fetcher)
    const value = object(await response.json())
    if (!Array.isArray(value.artifacts) || typeof value.nextCursor !== 'string') throw new DesktopRelayHttpError('INVALID_RESPONSE')
    if (value.artifacts.length === 0) return result
    for (const item of value.artifacts) {
      const artifact = parseRemoteArtifact(item)
      if (seen.has(artifact.artifactId) || result.length >= 1000) throw new DesktopRelayHttpError('INVALID_RESPONSE')
      seen.add(artifact.artifactId); result.push(artifact)
    }
    const next = text(value.nextCursor)
    if (next === cursor) throw new DesktopRelayHttpError('INVALID_RESPONSE')
    cursor = next
  }
  throw new DesktopRelayHttpError('INVALID_RESPONSE')
}

function parseRemoteArtifact(value: unknown): DesktopRelayRemoteArtifactDto {
  const record = object(value)
  return { artifactId: text(record.artifactId), digest: digest(record.digest), createdAt: timestamp(record.createdAt), originDeviceId: text(record.originDeviceId) }
}

export async function downloadDesktopRelayArtifact(endpoint: string, bearerToken: string, artifact: DesktopRelayRemoteArtifactDto, fetcher?: typeof fetch): Promise<readonly number[]> {
  const response = await relayFetch(endpoint, `/v1/artifacts/${encodeURIComponent(artifact.artifactId)}`, bearerToken, { headers: { Accept: 'application/octet-stream' } }, fetcher)
  const bytes = new Uint8Array(await response.arrayBuffer())
  if (bytes.length === 0 || bytes.length > MAX_PACKAGE_BYTES) throw new DesktopRelayHttpError('INVALID_RESPONSE')
  const calculated = [...new Uint8Array(await crypto.subtle.digest('SHA-256', bytes))].map((byte) => byte.toString(16).padStart(2, '0')).join('')
  if (calculated !== artifact.digest) throw new DesktopRelayHttpError('INVALID_RESPONSE')
  return [...bytes]
}
