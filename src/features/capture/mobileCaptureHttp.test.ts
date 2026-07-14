import { describe, expect, it, vi } from 'vitest'
import { downloadRemoteMobileCapture, listRemoteMobileCaptures, MobileCaptureHttpError } from './mobileCaptureHttp'

const remote = (digest: string, byteSize: number) => ({
  sequence: 1, captureId: 'capture-1', digest, householdId: 'family', originDeviceId: 'mobile-1',
  audience: { visibility: 'SHARED', memberId: null }, capsuleSchema: 'MOBILE_RECEIPT_CAPTURE_V1',
  senderPrincipalId: 'principal-a', senderMembershipId: 'membership-a', recipientCount: 1, byteSize, createdAt: '2026-07-14T12:00:00Z',
})

describe('mobile capture HTTP', () => {
  it('lists validated audience-scoped capture metadata', async () => {
    const fetcher = vi.fn().mockResolvedValue(new Response(JSON.stringify({ captures: [remote('a'.repeat(64), 123)], nextCursor: '1' }), { status: 200 }))
    const result = await listRemoteMobileCaptures('https://relay.example', 'token', 'family', 0, 'desktop-1', fetcher)
    expect(result).toEqual({ captures: [expect.objectContaining({ captureId: 'capture-1', senderMembershipId: 'membership-a', audienceVisibility: 'SHARED' })], nextCursor: 1 })
    expect(fetcher).toHaveBeenCalledWith(expect.stringContaining('excludeOriginDeviceId=desktop-1'), expect.objectContaining({ headers: expect.objectContaining({ Authorization: 'Bearer token' }) }))
  })

  it('verifies exact capsule bytes before native ingest', async () => {
    const bytes = new TextEncoder().encode('capture-capsule')
    const digest = [...new Uint8Array(await crypto.subtle.digest('SHA-256', bytes))].map((byte) => byte.toString(16).padStart(2, '0')).join('')
    const capture = (await listRemoteMobileCaptures('https://relay.example', 'token', 'family', 0, 'desktop-1', vi.fn().mockResolvedValue(new Response(JSON.stringify({ captures: [remote(digest, bytes.length)], nextCursor: '1' }), { status: 200 })))).captures[0]
    const downloaded = await downloadRemoteMobileCapture('https://relay.example', 'token', capture, vi.fn().mockResolvedValue(new Response(bytes, { status: 200 })))
    expect(downloaded).toEqual([...bytes])
  })

  it('rejects tampered bytes and maps revoked membership separately', async () => {
    const capture = { sequence: 1, captureId: 'capture-1', digest: 'a'.repeat(64), householdId: 'family', originDeviceId: 'mobile-1', senderMembershipId: 'membership-a', audienceVisibility: 'SHARED' as const, audienceMemberId: null, byteSize: 3, createdAt: '2026-07-14T12:00:00Z', capsuleSchema: 'MOBILE_RECEIPT_CAPTURE_V1' as const }
    await expect(downloadRemoteMobileCapture('https://relay.example', 'token', capture, vi.fn().mockResolvedValue(new Response(new Uint8Array([1, 2, 3]), { status: 200 })))).rejects.toMatchObject({ code: 'INVALID_CAPTURE' })
    await expect(listRemoteMobileCaptures('https://relay.example', 'token', 'family', 0, 'desktop-1', vi.fn().mockResolvedValue(new Response('', { status: 404 })))).rejects.toEqual(new MobileCaptureHttpError('MEMBERSHIP_REVOKED'))
  })
})
