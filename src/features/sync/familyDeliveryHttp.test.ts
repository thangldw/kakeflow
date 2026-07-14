import { describe, expect, it, vi } from 'vitest'

import {
  createFamilyInvitation, FamilyDeliveryHttpError, getFamilyRemoteState, listFamilyArtifacts, previewFamilyInvitation, uploadFamilyArtifact,
} from './familyDeliveryHttp'

const json = (value: unknown, status = 200) => new Response(JSON.stringify(value), { status, headers: { 'Content-Type': 'application/json' } })
const membership = { membershipId: 'membership-1', householdId: 'family', principalId: 'principal-1', domainMemberId: 'member-taro', role: 'OWNER', state: 'ACTIVE', generation: 1, joinedAt: '2026-07-14T00:00:00Z', revokedAt: null }

describe('familyDeliveryHttp v2 contract', () => {
  it('loads server membership IDs without inventing display names', async () => {
    const fetcher = vi.fn()
      .mockResolvedValueOnce(json({ remotePrincipalId: 'principal-1', memberships: [membership] }))
      .mockResolvedValueOnce(json({ members: [membership] }))
      .mockResolvedValueOnce(json({ invites: [] }))
    const state = await getFamilyRemoteState('https://relay.example', 'secret', 'family', fetcher)
    expect(state).toEqual({ householdId: 'family', remotePrincipalId: 'principal-1', localMembership: membership, memberships: [membership], invites: [] })
    expect(fetcher.mock.calls.map((call) => call[0])).toEqual([
      'https://relay.example/v2/whoami',
      'https://relay.example/v2/households/family/members',
      'https://relay.example/v2/households/family/invites',
    ])
  })

  it('creates an invite with the server domain member and idempotency key', async () => {
    const fetcher = vi.fn().mockResolvedValue(json({ invite: { inviteId: 'invite-1', code: 'kfi_abcdefghijklmnopqrstuvwxyz', expiresAt: '2026-07-15T00:00:00Z' }, created: true }, 201))
    await expect(createFamilyInvitation('https://relay.example', 'secret', 'family', 'member-hanako', 'invite-key', fetcher)).resolves.toEqual({ inviteId: 'invite-1', inviteCode: 'kfi_abcdefghijklmnopqrstuvwxyz', expiresAt: '2026-07-15T00:00:00Z' })
    const [, init] = fetcher.mock.calls[0]
    expect(init.headers.Authorization).toBe('Bearer secret')
    expect(JSON.parse(init.body)).toEqual({ domainMemberId: 'member-hanako', idempotencyKey: 'invite-key', expiresInSeconds: 86400 })
  })

  it('previews the server-bound household and domain member before redemption', async () => {
    const fetcher = vi.fn().mockResolvedValue(json({ invite: { householdId: 'family', domainMemberId: 'member-hanako', role: 'MEMBER', expiresAt: '2026-07-15T00:00:00Z' } }))
    await expect(previewFamilyInvitation('https://relay.example', 'secret', 'kfi_abcdefghijklmnopqrstuvwxyz', fetcher)).resolves.toEqual({ householdId: 'family', domainMemberId: 'member-hanako', role: 'MEMBER', expiresAt: '2026-07-15T00:00:00Z' })
    expect(fetcher.mock.calls[0][0]).toBe('https://relay.example/v2/invites/preview')
  })

  it('publishes the exact audience-partition headers on the v2 household path', async () => {
    const digest = 'a'.repeat(64)
    const fetcher = vi.fn().mockResolvedValue(json({ publication: { publicationId: 'publication-1', digest, createdAt: '2026-07-14T01:00:00Z' }, created: true }, 201))
    const artifact = { deliveryId: 'delivery-1', artifactId: 'publication-1', digest, householdId: 'family', originDeviceId: 'device-local', audienceKey: 'PERSONAL:member-taro', audienceVisibility: 'PERSONAL' as const, audienceMemberId: 'member-taro', artifactSchema: 'FAMILY_AUDIENCE_PARTITION_V1' as const, packageBytes: [1, 2, 3] }
    await uploadFamilyArtifact('https://relay.example', 'secret', artifact, fetcher)
    const [url, init] = fetcher.mock.calls[0]
    expect(url).toBe('https://relay.example/v2/households/family/publications')
    expect(init.headers).toMatchObject({
      'x-kakeflow-publication-id': 'publication-1', 'x-kakeflow-digest': digest,
      'x-kakeflow-origin-device-id': 'device-local', 'x-kakeflow-audience-visibility': 'PERSONAL',
      'x-kakeflow-audience-member-id': 'member-taro', 'x-kakeflow-artifact-schema': 'FAMILY_AUDIENCE_PARTITION_V1',
    })
  })

  it('preserves the v2 evidence-partition schema through upload and listing', async () => {
    const digest = 'c'.repeat(64)
    const upload = vi.fn().mockResolvedValue(json({ publication: { publicationId: 'publication-v2', digest, createdAt: '2026-07-14T01:00:00Z' }, created: true }, 201))
    const artifact = { deliveryId: 'delivery-v2', artifactId: 'publication-v2', digest, householdId: 'family', originDeviceId: 'device-local', audienceKey: 'SHARED', audienceVisibility: 'SHARED' as const, audienceMemberId: null, artifactSchema: 'FAMILY_AUDIENCE_PARTITION_V2' as const, packageBytes: [1, 2, 3] }
    await uploadFamilyArtifact('https://relay.example', 'secret', artifact, upload)
    expect(upload.mock.calls[0][1].headers['x-kakeflow-artifact-schema']).toBe('FAMILY_AUDIENCE_PARTITION_V2')

    const listing = vi.fn().mockResolvedValue(json({ publications: [{ sequence: 5, publicationId: 'publication-v2', digest, householdId: 'family', originDeviceId: 'device-other', audience: { visibility: 'SHARED', memberId: null }, artifactSchema: 'FAMILY_AUDIENCE_PARTITION_V2', senderPrincipalId: 'principal-2', senderMembershipId: 'membership-2', recipientCount: 1, byteSize: 42, createdAt: '2026-07-14T02:00:00Z' }], nextCursor: '5' }))
    await expect(listFamilyArtifacts('https://relay.example', 'secret', 'family', 0, 'device-local', listing)).resolves.toEqual({ artifacts: [expect.objectContaining({ artifactSchema: 'FAMILY_AUDIENCE_PARTITION_V2' })], nextCursor: 5 })
  })

  it('preserves the v3 evidence-partition schema through upload and listing', async () => {
    const digest = 'd'.repeat(64)
    const upload = vi.fn().mockResolvedValue(json({ publication: { publicationId: 'publication-v3', digest, createdAt: '2026-07-14T01:00:00Z' }, created: true }, 201))
    const artifact = { deliveryId: 'delivery-v3', artifactId: 'publication-v3', digest, householdId: 'family', originDeviceId: 'device-local', audienceKey: 'SHARED', audienceVisibility: 'SHARED' as const, audienceMemberId: null, artifactSchema: 'FAMILY_AUDIENCE_PARTITION_V3' as const, packageBytes: [75, 70, 51] }
    await uploadFamilyArtifact('https://relay.example', 'secret', artifact, upload)
    expect(upload.mock.calls[0][1].headers['x-kakeflow-artifact-schema']).toBe('FAMILY_AUDIENCE_PARTITION_V3')

    const listing = vi.fn().mockResolvedValue(json({ publications: [{ sequence: 6, publicationId: 'publication-v3', digest, householdId: 'family', originDeviceId: 'device-other', audience: { visibility: 'SHARED', memberId: null }, artifactSchema: 'FAMILY_AUDIENCE_PARTITION_V3', senderPrincipalId: 'principal-2', senderMembershipId: 'membership-2', recipientCount: 1, byteSize: 42, createdAt: '2026-07-14T02:00:00Z' }], nextCursor: '6' }))
    await expect(listFamilyArtifacts('https://relay.example', 'secret', 'family', 0, 'device-local', listing)).resolves.toEqual({ artifacts: [expect.objectContaining({ artifactSchema: 'FAMILY_AUDIENCE_PARTITION_V3' })], nextCursor: 6 })
  })

  it('parses publications and maps the relay error shape', async () => {
    const digest = 'b'.repeat(64)
    const fetcher = vi.fn().mockResolvedValueOnce(json({ publications: [{ sequence: 4, publicationId: 'publication-4', digest, householdId: 'family', originDeviceId: 'device-other', audience: { visibility: 'SHARED', memberId: null }, artifactSchema: 'FAMILY_AUDIENCE_PARTITION_V1', senderPrincipalId: 'principal-2', senderMembershipId: 'membership-2', recipientCount: 1, byteSize: 42, createdAt: '2026-07-14T02:00:00Z' }], nextCursor: '4' }))
    await expect(listFamilyArtifacts('https://relay.example', 'secret', 'family', 0, 'device-local', fetcher)).resolves.toEqual({ artifacts: [expect.objectContaining({ sequence: 4, artifactId: 'publication-4', senderMembershipId: 'membership-2', audienceVisibility: 'SHARED' })], nextCursor: 4 })

    const denied = vi.fn().mockResolvedValue(json({ error: 'NO_ACTIVE_RECIPIENTS' }, 409))
    await expect(listFamilyArtifacts('https://relay.example', 'secret', 'family', 0, 'device-local', denied)).rejects.toEqual(expect.objectContaining<Partial<FamilyDeliveryHttpError>>({ code: 'RECIPIENT_UNAVAILABLE' }))

    const unavailable = vi.fn().mockResolvedValue(json({ error: 'INVITE_UNAVAILABLE' }, 410))
    await expect(previewFamilyInvitation('https://relay.example', 'secret', 'expired-code', unavailable)).rejects.toEqual(expect.objectContaining<Partial<FamilyDeliveryHttpError>>({ code: 'INVITE_UNAVAILABLE' }))
  })
})
