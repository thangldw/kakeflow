import { describe, expect, it, vi } from 'vitest'

import {
  createFamilyInvitation, downloadFamilyArtifact, familyRecipientSetDigest, FamilyDeliveryHttpError, getFamilyRemoteState, listFamilyArtifacts,
  previewFamilyInvitation, registerFamilyEncryptionKey, uploadFamilyArtifact,
} from './familyDeliveryHttp'

const json = (value: unknown, status = 200) => new Response(JSON.stringify(value), { status, headers: { 'Content-Type': 'application/json' } })
const digestBytes = async (bytes: Uint8Array) => [...new Uint8Array(await crypto.subtle.digest('SHA-256', Uint8Array.from(bytes).buffer))].map((byte) => byte.toString(16).padStart(2, '0')).join('')
const membership = {
  membershipId: 'membership-1', householdId: 'family', principalId: 'principal-1', domainMemberId: 'member-taro',
  role: 'OWNER' as const, state: 'ACTIVE' as const, generation: 1, joinedAt: '2026-07-14T00:00:00Z', revokedAt: null,
  encryptionKeyId: null, encryptionPublicKey: null, encryptionKeyGeneration: 0, encryptionKeyUpdatedAt: null,
}

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

  it('registers and parses the authenticated membership encryption key', async () => {
    const key = { keyId: 'e'.repeat(64), publicKey: 'A'.repeat(43), generation: 1 }
    const keyedMembership = {
      ...membership, encryptionKeyId: key.keyId, encryptionPublicKey: key.publicKey,
      encryptionKeyGeneration: 1, encryptionKeyUpdatedAt: '2026-07-14T00:30:00Z',
    }
    const fetcher = vi.fn().mockResolvedValue(json({ membership: keyedMembership, updated: true }))

    await expect(registerFamilyEncryptionKey('https://relay.example', 'secret', 'family', key, fetcher)).resolves.toEqual(keyedMembership)
    const [url, init] = fetcher.mock.calls[0]
    expect(url).toBe('https://relay.example/v2/households/family/members/encryption-key')
    expect(init.method).toBe('PUT')
    expect(JSON.parse(init.body)).toEqual(key)
  })

  it('matches the relay canonical recipient-set digest independent of membership order', async () => {
    const first = {
      ...membership, membershipId: 'membership-a', generation: 9,
      encryptionKeyId: 'a'.repeat(64), encryptionPublicKey: 'A'.repeat(43), encryptionKeyGeneration: 2,
      encryptionKeyUpdatedAt: '2026-07-14T00:30:00Z',
    }
    const second = {
      ...membership, membershipId: 'membership-b', generation: 4,
      encryptionKeyId: 'b'.repeat(64), encryptionPublicKey: 'B'.repeat(43), encryptionKeyGeneration: 1,
      encryptionKeyUpdatedAt: '2026-07-14T00:30:00Z',
    }
    await expect(familyRecipientSetDigest([second, first])).resolves.toBe('6dc8b2553c78fae5bc8b3c47c021d800e78a0a1a38ebbe4642028db851804ec8')
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

  it('uploads a KFE1 envelope and returns the accepted inner artifact digest', async () => {
    const envelopeBytes = new Uint8Array([75, 70, 69, 49, 1, 2, 3, 4])
    const transportDigest = await digestBytes(envelopeBytes)
    const innerDigest = '1'.repeat(64)
    const recipientSetDigest = '2'.repeat(64)
    const fetcher = vi.fn().mockResolvedValue(json({ publication: {
      publicationId: 'publication-kfe1', digest: transportDigest, envelopeSchema: 'FAMILY_ENCRYPTED_ENVELOPE_V1',
      recipientSetDigest, innerDigest, createdAt: '2026-07-14T01:00:00Z',
    }, created: true }, 201))
    const artifact = {
      deliveryId: 'delivery-kfe1', artifactId: 'publication-kfe1', householdId: 'family', originDeviceId: 'device-local',
      audienceKey: 'SHARED', audienceVisibility: 'SHARED' as const, audienceMemberId: null,
      artifactSchema: 'FAMILY_AUDIENCE_PARTITION_V3' as const, envelopeSchema: 'FAMILY_ENCRYPTED_ENVELOPE_V1' as const,
      envelopeBytes: [...envelopeBytes], transportDigest, innerDigest, recipientSetDigest,
    }

    await expect(uploadFamilyArtifact('https://relay.example', 'secret', artifact, fetcher)).resolves.toEqual({
      deliveryId: 'delivery-kfe1', artifactId: 'publication-kfe1', digest: transportDigest, acceptedAt: '2026-07-14T01:00:00Z',
    })
    expect(fetcher.mock.calls[0][1].headers).toMatchObject({
      'x-kakeflow-digest': transportDigest,
      'x-kakeflow-envelope-schema': 'FAMILY_ENCRYPTED_ENVELOPE_V1',
      'x-kakeflow-recipient-set-digest': recipientSetDigest,
      'x-kakeflow-inner-digest': innerDigest,
    })
    expect([...new Uint8Array(fetcher.mock.calls[0][1].body)]).toEqual([...envelopeBytes])
  })

  it('rejects a relay acceptance whose outer envelope digest differs', async () => {
    const envelopeBytes = new Uint8Array([75, 70, 69, 49, 9])
    const transportDigest = await digestBytes(envelopeBytes)
    const fetcher = vi.fn().mockResolvedValue(json({ publication: {
      publicationId: 'publication-kfe1', digest: 'f'.repeat(64), envelopeSchema: 'FAMILY_ENCRYPTED_ENVELOPE_V1',
      recipientSetDigest: '2'.repeat(64), innerDigest: '1'.repeat(64), createdAt: '2026-07-14T01:00:00Z',
    } }, 201))
    await expect(uploadFamilyArtifact('https://relay.example', 'secret', {
      deliveryId: 'delivery-kfe1', artifactId: 'publication-kfe1', householdId: 'family', originDeviceId: 'device-local',
      audienceKey: 'SHARED', audienceVisibility: 'SHARED', audienceMemberId: null,
      artifactSchema: 'FAMILY_AUDIENCE_PARTITION_V3', envelopeSchema: 'FAMILY_ENCRYPTED_ENVELOPE_V1',
      envelopeBytes: [...envelopeBytes], transportDigest, innerDigest: '1'.repeat(64), recipientSetDigest: '2'.repeat(64),
    }, fetcher)).rejects.toEqual(expect.objectContaining<Partial<FamilyDeliveryHttpError>>({ code: 'INVALID_ARTIFACT' }))
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

  it('parses encrypted publication metadata and verifies advertised download size', async () => {
    const envelopeBytes = new Uint8Array([75, 70, 69, 49, 7, 8])
    const transportDigest = await digestBytes(envelopeBytes)
    const recipientSetDigest = '3'.repeat(64)
    const innerDigest = '4'.repeat(64)
    const listing = vi.fn().mockResolvedValue(json({ publications: [{
      sequence: 7, publicationId: 'publication-encrypted', digest: transportDigest, originDeviceId: 'device-other',
      audience: { visibility: 'SHARED', memberId: null }, artifactSchema: 'FAMILY_AUDIENCE_PARTITION_V3',
      envelopeSchema: 'FAMILY_ENCRYPTED_ENVELOPE_V1', recipientSetDigest, innerDigest,
      senderMembershipId: 'membership-2', byteSize: envelopeBytes.length, createdAt: '2026-07-14T02:00:00Z',
    }], nextCursor: '7' }))
    const page = await listFamilyArtifacts('https://relay.example', 'secret', 'family', 0, 'device-local', listing)
    expect(page.artifacts[0]).toMatchObject({ envelopeSchema: 'FAMILY_ENCRYPTED_ENVELOPE_V1', recipientSetDigest, innerDigest })

    const goodDownload = vi.fn().mockResolvedValue(new Response(envelopeBytes))
    await expect(downloadFamilyArtifact('https://relay.example', 'secret', 'family', page.artifacts[0], goodDownload)).resolves.toEqual([...envelopeBytes])
    const wrongSize = vi.fn().mockResolvedValue(new Response(envelopeBytes.slice(0, -1)))
    await expect(downloadFamilyArtifact('https://relay.example', 'secret', 'family', page.artifacts[0], wrongSize)).rejects.toEqual(
      expect.objectContaining<Partial<FamilyDeliveryHttpError>>({ code: 'INVALID_ARTIFACT' }),
    )
  })
})
