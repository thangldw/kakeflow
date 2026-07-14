const MAX_CAPSULE_BYTES = 32 * 1024 * 1024

export type MobileCaptureHttpErrorCode = 'AUTH_EXPIRED' | 'MEMBERSHIP_REVOKED' | 'AUDIENCE_DENIED' | 'INVALID_CAPTURE' | 'NETWORK_RETRYABLE' | 'INVALID_ENDPOINT' | 'INVALID_RESPONSE'

export class MobileCaptureHttpError extends Error {
  constructor(readonly code: MobileCaptureHttpErrorCode) { super(code) }
}

export interface RemoteMobileCaptureDto {
  readonly sequence: number; readonly captureId: string; readonly digest: string; readonly householdId: string
  readonly originDeviceId: string; readonly senderMembershipId: string
  readonly audienceVisibility: 'SHARED' | 'PERSONAL'; readonly audienceMemberId: string | null
  readonly byteSize: number; readonly createdAt: string; readonly capsuleSchema: 'MOBILE_RECEIPT_CAPTURE_V1'
}
export interface RemoteMobileCapturePageDto { readonly captures: readonly RemoteMobileCaptureDto[]; readonly nextCursor: number }

function endpointUrl(endpoint: string, path: string): string {
  try {
    const url = new URL(endpoint)
    if (url.protocol !== 'https:' && !(url.protocol === 'http:' && ['127.0.0.1', 'localhost', '[::1]'].includes(url.hostname))) throw new Error()
    return new URL(path, `${url.toString().replace(/\/$/, '')}/`).toString()
  } catch { throw new MobileCaptureHttpError('INVALID_ENDPOINT') }
}

async function request(endpoint: string, path: string, token: string, init: RequestInit = {}, fetcher: typeof fetch = fetch): Promise<Response> {
  try {
    const response = await fetcher(endpointUrl(endpoint, path), { ...init, headers: { Authorization: `Bearer ${token}`, ...init.headers }, signal: init.signal ?? AbortSignal.timeout(15_000) })
    if (response.ok) return response
    if (response.status === 401) throw new MobileCaptureHttpError('AUTH_EXPIRED')
    if (response.status === 404) throw new MobileCaptureHttpError(path.includes('/captures/') ? 'AUDIENCE_DENIED' : 'MEMBERSHIP_REVOKED')
    throw new MobileCaptureHttpError(response.status >= 500 ? 'NETWORK_RETRYABLE' : 'INVALID_CAPTURE')
  } catch (error) {
    if (error instanceof MobileCaptureHttpError) throw error
    throw new MobileCaptureHttpError('NETWORK_RETRYABLE')
  }
}

const record = (value: unknown): Record<string, unknown> => {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) throw new MobileCaptureHttpError('INVALID_RESPONSE')
  return value as Record<string, unknown>
}
const string = (value: unknown): string => { if (typeof value !== 'string' || !value) throw new MobileCaptureHttpError('INVALID_RESPONSE'); return value }
const hash = (value: unknown): string => { const result = string(value); if (!/^[0-9a-f]{64}$/.test(result)) throw new MobileCaptureHttpError('INVALID_RESPONSE'); return result }
const integer = (value: unknown): number => { if (!Number.isSafeInteger(value) || Number(value) < 0) throw new MobileCaptureHttpError('INVALID_RESPONSE'); return Number(value) }

function parseRemoteCapture(value: unknown): RemoteMobileCaptureDto {
  const item = record(value); const audience = record(item.audience)
  if (!['SHARED', 'PERSONAL'].includes(String(audience.visibility)) || item.capsuleSchema !== 'MOBILE_RECEIPT_CAPTURE_V1') throw new MobileCaptureHttpError('INVALID_RESPONSE')
  const audienceMemberId = audience.memberId === null ? null : string(audience.memberId)
  if ((audience.visibility === 'SHARED') !== (audienceMemberId === null)) throw new MobileCaptureHttpError('INVALID_RESPONSE')
  const byteSize = integer(item.byteSize)
  if (byteSize < 1 || byteSize > MAX_CAPSULE_BYTES) throw new MobileCaptureHttpError('INVALID_RESPONSE')
  const createdAt = string(item.createdAt)
  if (Number.isNaN(Date.parse(createdAt))) throw new MobileCaptureHttpError('INVALID_RESPONSE')
  return {
    sequence: integer(item.sequence), captureId: string(item.captureId), digest: hash(item.digest), householdId: string(item.householdId),
    originDeviceId: string(item.originDeviceId), senderMembershipId: string(item.senderMembershipId),
    audienceVisibility: audience.visibility as RemoteMobileCaptureDto['audienceVisibility'], audienceMemberId,
    byteSize, createdAt, capsuleSchema: 'MOBILE_RECEIPT_CAPTURE_V1',
  }
}

export async function listRemoteMobileCaptures(endpoint: string, token: string, householdId: string, after: number, excludeOriginDeviceId: string, fetcher?: typeof fetch): Promise<RemoteMobileCapturePageDto> {
  if (!Number.isSafeInteger(after) || after < 0) throw new MobileCaptureHttpError('INVALID_RESPONSE')
  const result: RemoteMobileCaptureDto[] = []; const ids = new Set<string>(); let cursor = after
  for (let page = 0; page < 20; page += 1) {
    const response = await request(endpoint, `/v2/households/${encodeURIComponent(householdId)}/captures?after=${cursor}&excludeOriginDeviceId=${encodeURIComponent(excludeOriginDeviceId)}`, token, {}, fetcher)
    const body = record(await response.json())
    if (!Array.isArray(body.captures) || typeof body.nextCursor !== 'string') throw new MobileCaptureHttpError('INVALID_RESPONSE')
    const captures = body.captures.map(parseRemoteCapture)
    for (const capture of captures) {
      if (capture.householdId !== householdId || ids.has(capture.captureId) || capture.sequence <= cursor) throw new MobileCaptureHttpError('INVALID_RESPONSE')
      ids.add(capture.captureId); result.push(capture)
    }
    const next = Number(body.nextCursor)
    if (!Number.isSafeInteger(next) || next < cursor || result.length > 1_000) throw new MobileCaptureHttpError('INVALID_RESPONSE')
    if (captures.length < 100 || next === cursor) return { captures: result, nextCursor: next }
    cursor = next
  }
  throw new MobileCaptureHttpError('INVALID_RESPONSE')
}

export async function downloadRemoteMobileCapture(endpoint: string, token: string, capture: RemoteMobileCaptureDto, fetcher?: typeof fetch): Promise<readonly number[]> {
  const response = await request(endpoint, `/v2/households/${encodeURIComponent(capture.householdId)}/captures/${encodeURIComponent(capture.captureId)}`, token, { headers: { Accept: 'application/octet-stream' } }, fetcher)
  const bytes = new Uint8Array(await response.arrayBuffer())
  if (bytes.length < 1 || bytes.length > MAX_CAPSULE_BYTES || bytes.length !== capture.byteSize) throw new MobileCaptureHttpError('INVALID_CAPTURE')
  const digest = [...new Uint8Array(await crypto.subtle.digest('SHA-256', bytes))].map((byte) => byte.toString(16).padStart(2, '0')).join('')
  if (digest !== capture.digest) throw new MobileCaptureHttpError('INVALID_CAPTURE')
  return [...bytes]
}
