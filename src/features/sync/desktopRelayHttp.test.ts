import { describe, expect, it, vi } from 'vitest'

import { DesktopRelayHttpError, downloadDesktopRelayArtifact, identifyDesktopRelay, listDesktopRelayArtifacts, uploadDesktopRelayArtifact } from './desktopRelayHttp'

const hash = 'a'.repeat(64)
const json = (value: unknown, status = 200) => new Response(JSON.stringify(value), { status, headers: { 'Content-Type': 'application/json' } })

describe('desktop relay HTTP boundary', () => {
  it('keeps the bearer token in WebView fetch and validates the remote principal', async () => {
    const fetcher = vi.fn(async () => json({ remotePrincipalId: 'principal-remote' })) as unknown as typeof fetch
    await expect(identifyDesktopRelay('https://relay.example/base/', 'ephemeral-token', fetcher)).resolves.toBe('principal-remote')
    const [url, init] = vi.mocked(fetcher).mock.calls[0]
    expect(String(url)).toBe('https://relay.example/base/v1/whoami')
    expect(new Headers(init?.headers).get('Authorization')).toBe('Bearer ephemeral-token')
  })

  it('uploads raw package bytes with immutable metadata headers', async () => {
    const fetcher = vi.fn(async () => json({ artifact: { artifactId: 'artifact-1', digest: hash, createdAt: '2026-07-13T00:00:00Z', originDeviceId: 'device-1' }, created: true })) as unknown as typeof fetch
    const delivery = { deliveryId: 'delivery-1', artifactId: 'artifact-1', digest: hash, householdId: 'family', originDeviceId: 'device-1', packageBytes: [1, 2, 3] }
    await expect(uploadDesktopRelayArtifact('https://relay.example', 'token', delivery, fetcher)).resolves.toEqual({ artifactId: 'artifact-1', digest: hash, acceptedAt: '2026-07-13T00:00:00Z' })
    const [, init] = vi.mocked(fetcher).mock.calls[0]; const headers = new Headers(init?.headers)
    expect(init?.method).toBe('POST')
    expect(headers.get('Content-Type')).toBe('application/octet-stream')
    expect(headers.get('x-kakeflow-artifact-id')).toBe('artifact-1')
    expect(headers.get('x-kakeflow-digest')).toBe(hash)
    expect(Array.from(init?.body as Uint8Array)).toEqual([1, 2, 3])
  })

  it('validates and follows the bounded incoming cursor', async () => {
    const first = { artifactId: 'one', digest: hash, createdAt: '2026-07-13T00:00:00Z', originDeviceId: 'device-a' }
    const second = { artifactId: 'two', digest: 'b'.repeat(64), createdAt: '2026-07-13T00:01:00Z', originDeviceId: 'device-b' }
    let requestCount = 0
    const fetcher = vi.fn(async () => {
      requestCount += 1
      return requestCount === 1 ? json({ artifacts: [first], nextCursor: 'next' }) : requestCount === 2 ? json({ artifacts: [second], nextCursor: 'done' }) : json({ artifacts: [], nextCursor: 'done' })
    }) as unknown as typeof fetch
    await expect(listDesktopRelayArtifacts('https://relay.example', 'token', 'family', 'device-local', fetcher)).resolves.toEqual([first, second])
    expect(String(vi.mocked(fetcher).mock.calls[0][0])).toContain('excludeOriginDeviceId=device-local')
    expect(String(vi.mocked(fetcher).mock.calls[1][0])).toContain('after=next')
  })

  it('verifies downloaded bytes against relay metadata', async () => {
    const bytes = new Uint8Array([1, 2, 3]); const digest = [...new Uint8Array(await crypto.subtle.digest('SHA-256', bytes))].map((byte) => byte.toString(16).padStart(2, '0')).join('')
    const artifact = { artifactId: 'artifact', digest, createdAt: '2026-07-13T00:00:00Z', originDeviceId: 'device' }
    const fetcher = vi.fn(async () => new Response(bytes)) as unknown as typeof fetch
    await expect(downloadDesktopRelayArtifact('https://relay.example', 'token', artifact, fetcher)).resolves.toEqual([1, 2, 3])
    await expect(downloadDesktopRelayArtifact('https://relay.example', 'token', { ...artifact, digest: hash }, fetcher)).rejects.toBeInstanceOf(DesktopRelayHttpError)
  })

  it('rejects non-http endpoints and unsuccessful responses', async () => {
    await expect(identifyDesktopRelay('file:///tmp/relay', 'token')).rejects.toMatchObject({ code: 'INVALID_ENDPOINT' })
    const fetcher = vi.fn(async () => json({}, 401)) as unknown as typeof fetch
    await expect(identifyDesktopRelay('https://relay.example', 'token', fetcher)).rejects.toMatchObject({ code: 'REJECTED' })
  })
})
