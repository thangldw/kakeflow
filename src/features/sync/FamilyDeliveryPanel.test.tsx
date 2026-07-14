import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const family = vi.hoisted(() => ({
  status: vi.fn(), save: vi.fn(), disconnect: vi.fn(), registerRemote: vi.fn(), prepare: vi.fn(), envelopePrepare: vi.fn(), cachedEnvelope: vi.fn(), identity: vi.fn(), accept: vi.fn(), fail: vi.fn(), recipientChanged: vi.fn(), registerInbound: vi.fn(), stage: vi.fn(), encryptedStage: vi.fn(), backgroundStatus: vi.fn(), backgroundEnable: vi.fn(), backgroundDisable: vi.fn(), backgroundNow: vi.fn(),
  remote: vi.fn(), registerKey: vi.fn(), recipientDigest: vi.fn(), createHousehold: vi.fn(), previewInvite: vi.fn(), createInvite: vi.fn(), cancelInvite: vi.fn(), redeem: vi.fn(), revoke: vi.fn(), upload: vi.fn(), list: vi.fn(), download: vi.fn(),
}))
vi.mock('../../platform', () => ({ platformClient: {
  runtime: 'tauri', getFamilyDeliveryStatus: (...args: unknown[]) => family.status(...args),
  saveFamilyDeliveryConnection: (...args: unknown[]) => family.save(...args), disconnectFamilyDelivery: (...args: unknown[]) => family.disconnect(...args),
  registerFamilyDeliveryRemoteState: (...args: unknown[]) => family.registerRemote(...args), prepareFamilyDelivery: (...args: unknown[]) => family.prepare(...args),
  prepareEncryptedFamilyEnvelope: (...args: unknown[]) => family.envelopePrepare(...args), getFamilyEnvelopeIdentity: (...args: unknown[]) => family.identity(...args),
  getCachedFamilyDeliveryEnvelope: (...args: unknown[]) => family.cachedEnvelope(...args),
  acceptFamilyDelivery: (...args: unknown[]) => family.accept(...args), failFamilyDelivery: (...args: unknown[]) => family.fail(...args),
  resetFamilyDeliveryRecipientSetChanged: (...args: unknown[]) => family.recipientChanged(...args),
  registerFamilyDeliveryInbound: (...args: unknown[]) => family.registerInbound(...args), stageFamilyDeliveryInbound: (...args: unknown[]) => family.stage(...args),
  stageEncryptedFamilyDeliveryInbound: (...args: unknown[]) => family.encryptedStage(...args),
  getFamilyDeliveryBackgroundStatus: (...args: unknown[]) => family.backgroundStatus(...args),
  enableFamilyDeliveryBackground: (...args: unknown[]) => family.backgroundEnable(...args),
  disableFamilyDeliveryBackground: (...args: unknown[]) => family.backgroundDisable(...args),
  runFamilyDeliveryBackgroundNow: (...args: unknown[]) => family.backgroundNow(...args),
} }))
vi.mock('./familyDeliveryHttp', () => ({
  FamilyDeliveryHttpError: class FamilyDeliveryHttpError extends Error { constructor(readonly code: string) { super(code) } },
  getFamilyRemoteState: (...args: unknown[]) => family.remote(...args), createFamilyHousehold: (...args: unknown[]) => family.createHousehold(...args),
  registerFamilyEncryptionKey: (...args: unknown[]) => family.registerKey(...args), familyRecipientSetDigest: (...args: unknown[]) => family.recipientDigest(...args),
  previewFamilyInvitation: (...args: unknown[]) => family.previewInvite(...args),
  createFamilyInvitation: (...args: unknown[]) => family.createInvite(...args), cancelFamilyInvitation: (...args: unknown[]) => family.cancelInvite(...args),
  redeemFamilyInvitation: (...args: unknown[]) => family.redeem(...args), revokeFamilyMembership: (...args: unknown[]) => family.revoke(...args),
  uploadFamilyArtifact: (...args: unknown[]) => family.upload(...args), listFamilyArtifacts: (...args: unknown[]) => family.list(...args),
  downloadFamilyArtifact: (...args: unknown[]) => family.download(...args),
}))

import { FamilyDeliveryPanel } from './FamilyDeliveryPanel'
import { FamilyDeliveryHttpError } from './familyDeliveryHttp'
import type { FamilyDeliveryStatusDto, HouseholdMemberDto } from '../../platform/types'

const members: readonly HouseholdMemberDto[] = [
  { id: 'member-taro', householdId: 'family', displayName: '太郎', relationshipLabel: '父', sortOrder: 0, status: 'ACTIVE', createdAt: '2026-07-14T00:00:00Z', updatedAt: '2026-07-14T00:00:00Z' },
  { id: 'member-hanako', householdId: 'family', displayName: '花子', relationshipLabel: '母', sortOrder: 1, status: 'ACTIVE', createdAt: '2026-07-14T00:00:00Z', updatedAt: '2026-07-14T00:00:00Z' },
]
const keyId = 'e'.repeat(64)
const membership = { membershipId: 'membership-owner', householdId: 'family', principalId: 'principal-owner', domainMemberId: 'member-taro', role: 'OWNER' as const, state: 'ACTIVE' as const, generation: 1, joinedAt: '2026-07-14T00:00:00Z', revokedAt: null, encryptionKeyId: keyId, encryptionPublicKey: 'public-owner', encryptionKeyGeneration: 1 }
const recipientMembership = { ...membership, membershipId: 'membership-hanako', principalId: 'principal-hanako', domainMemberId: 'member-hanako', role: 'MEMBER' as const, encryptionPublicKey: 'public-hanako' }
const remote = { householdId: 'family', remotePrincipalId: 'principal-owner', localMembership: membership, memberships: [membership, recipientMembership], invites: [] }
const base: FamilyDeliveryStatusDto = {
  householdId: 'family', connectionState: 'NOT_CONFIGURED', endpoint: null, remotePrincipalId: null,
  localDeviceId: 'device-local', inboundCursor: 0, localMemberId: null, localMemberName: null,
  memberships: [], outbound: [], withheldChangeCount: 0, inbound: [],
}
const connected: FamilyDeliveryStatusDto = {
  ...base, connectionState: 'CONNECTED', endpoint: 'https://relay.example', remotePrincipalId: 'principal-owner', localMemberId: 'member-taro', localMemberName: '太郎',
  memberships: [
    { memberId: 'member-taro', memberName: '太郎', state: 'ACTIVE', remoteMembershipIds: ['membership-owner'], inviteId: null, inviteExpiresAt: null, deviceCount: 1, lastDeliveryAt: null },
    { memberId: 'member-hanako', memberName: '花子', state: 'UNLINKED', remoteMembershipIds: [], inviteId: null, inviteExpiresAt: null, deviceCount: 0, lastDeliveryAt: null },
  ],
  outbound: [
    { audienceKey: 'SHARED', audienceVisibility: 'SHARED', audienceMemberId: null, audienceMemberName: null, recipientNames: ['花子'], pendingChangeCount: 4, state: 'READY', withheldReason: null, domainCounts: { LEDGER: 2, PLANNING: 0, CONFIG: 0, CARD: 2, INVESTMENT: 1 }, withheldDomainCounts: { LEDGER: 0, PLANNING: 0, CONFIG: 0, CARD: 2, INVESTMENT: 2 }, evidenceFileCount: 2, evidenceRecordCount: 3, withheldCountsByReason: { MISSING_CARD_EVIDENCE: 1, MISSING_INVESTMENT_EVIDENCE: 1, EVIDENCE_AUDIENCE_MISMATCH: 1, EVIDENCE_SIZE_LIMIT: 1 }, coverageState: 'PARTIAL' },
    { audienceKey: 'PERSONAL:member-hanako', audienceVisibility: 'PERSONAL', audienceMemberId: 'member-hanako', audienceMemberName: '花子', recipientNames: [], pendingChangeCount: 2, state: 'BLOCKED_NO_RECIPIENT', withheldReason: '配信先未設定', domainCounts: { LEDGER: 1, PLANNING: 0, CONFIG: 0, CARD: 0, INVESTMENT: 1 }, withheldDomainCounts: { LEDGER: 1, PLANNING: 0, CONFIG: 0, CARD: 0, INVESTMENT: 1 }, evidenceFileCount: 1, evidenceRecordCount: 2, withheldCountsByReason: { MISSING_INVESTMENT_EVIDENCE: 1, UNASSIGNED_SCOPE: 1 }, coverageState: 'PARTIAL' },
  ],
  withheldChangeCount: 6,
}
const connectedWithTwoReady: FamilyDeliveryStatusDto = {
  ...connected,
  outbound: connected.outbound.map((item) => item.audienceKey === 'PERSONAL:member-hanako'
    ? { ...item, recipientNames: ['花子'], state: 'READY' as const, withheldReason: null }
    : item),
}
const preparedShared = { deliveryId: 'delivery-1', artifactId: 'publication-1', digest: 'a'.repeat(64), householdId: 'family', originDeviceId: 'device-local', audienceKey: 'SHARED', audienceVisibility: 'SHARED' as const, audienceMemberId: null, artifactSchema: 'FAMILY_AUDIENCE_PARTITION_V1' as const, packageBytes: [1] }
const preparedPersonal = { deliveryId: 'delivery-2', artifactId: 'publication-2', digest: 'b'.repeat(64), householdId: 'family', originDeviceId: 'device-local', audienceKey: 'PERSONAL:member-hanako', audienceVisibility: 'PERSONAL' as const, audienceMemberId: 'member-hanako', artifactSchema: 'FAMILY_AUDIENCE_PARTITION_V1' as const, packageBytes: [2] }
const disabledSchedule = {
  householdId: 'family', enabled: false, intervalMinutes: 30, nextDueAt: null, running: false, leaseExpiresAt: null,
  lastAttemptAt: null, lastSuccessAt: null, lastResult: 'DISABLED' as const, lastDiscoveredCount: 0,
  consecutiveFailures: 0, suspendedUntil: null, suspensionReason: null, lastErrorCode: null, updatedAt: '2026-07-14T00:00:00Z',
}
const enabledSchedule = {
  ...disabledSchedule, enabled: true, nextDueAt: '2026-07-14T01:30:00Z', lastAttemptAt: '2026-07-14T01:00:00Z',
  lastSuccessAt: '2026-07-14T01:00:00Z', lastResult: 'NO_CHANGES' as const, updatedAt: '2026-07-14T01:00:00Z',
}

describe('FamilyDeliveryPanel', () => {
  beforeEach(() => {
    for (const mock of Object.values(family)) mock.mockReset()
    family.status.mockResolvedValue(base); family.remote.mockResolvedValue(remote); family.save.mockResolvedValue(connected)
    family.identity.mockResolvedValue({ keyId, publicKey: 'public-owner', generation: 1 }); family.registerKey.mockResolvedValue(undefined); family.recipientDigest.mockResolvedValue('d'.repeat(64))
    family.disconnect.mockResolvedValue(base); family.registerRemote.mockResolvedValue(connected)
    family.backgroundStatus.mockResolvedValue(disabledSchedule); family.backgroundEnable.mockResolvedValue(enabledSchedule)
    family.backgroundDisable.mockResolvedValue(disabledSchedule); family.backgroundNow.mockResolvedValue({ ...enabledSchedule, lastResult: 'DISCOVERED', lastDiscoveredCount: 2 })
    family.prepare.mockResolvedValue([{ deliveryId: 'delivery-1', artifactId: 'publication-1', digest: 'a'.repeat(64), householdId: 'family', originDeviceId: 'device-local', audienceKey: 'SHARED', audienceVisibility: 'SHARED', audienceMemberId: null, artifactSchema: 'FAMILY_AUDIENCE_PARTITION_V1', packageBytes: [1] }])
    family.cachedEnvelope.mockResolvedValue(null)
    family.envelopePrepare.mockResolvedValue({ envelopeBytes: [9, 8], envelopeSha256: 'c'.repeat(64), envelopeByteSize: 2, recipientCount: 1, recipientSetDigest: 'd'.repeat(64), cacheDisposition: 'NEWLY_SEALED' })
    family.upload.mockResolvedValue({ deliveryId: 'delivery-1', artifactId: 'publication-1', digest: 'c'.repeat(64), acceptedAt: '2026-07-14T01:00:00Z' })
    family.accept.mockResolvedValue({ ...connected, outbound: connected.outbound.map((item) => item.audienceKey === 'SHARED' ? { ...item, pendingChangeCount: 0, state: 'RELAY_ACCEPTED' as const } : item) })
    family.fail.mockResolvedValue(connected); family.recipientChanged.mockResolvedValue(connected)
    family.list.mockResolvedValue({ artifacts: [], nextCursor: 0 }); family.registerInbound.mockResolvedValue(connected)
  })

  it('connects with a server-derived principal and never sends the token through IPC', async () => {
    render(<FamilyDeliveryPanel householdId="family" members={members} />)
    await screen.findByText('未接続')
    fireEvent.change(screen.getByLabelText('配信サービスURL'), { target: { value: 'https://relay.example' } })
    fireEvent.change(screen.getByLabelText('接続トークン（この画面のみ）'), { target: { value: 'session-secret' } })
    fireEvent.click(screen.getByRole('button', { name: '配信サービスに接続' }))
    await waitFor(() => expect(family.remote).toHaveBeenCalledWith('https://relay.example', 'session-secret', 'family'))
    expect(family.save).toHaveBeenCalledWith(expect.objectContaining({ householdId: 'family', remotePrincipalId: 'principal-owner', localMemberId: 'member-taro' }))
    expect(JSON.stringify(family.save.mock.calls)).not.toContain('session-secret')
    expect(await screen.findByText(/データはまだ送信されていません/)).toBeInTheDocument()
  })

  it('previews derived recipients, withholds unlinked personal data and sends only selected audience keys', async () => {
    family.status.mockResolvedValue(connected)
    render(<FamilyDeliveryPanel householdId="family" members={members} />)
    expect(await screen.findByText('世帯共有 → 花子')).toBeInTheDocument()
    expect(screen.getByText('個人・花子 → 配信先未設定')).toBeInTheDocument()
    expect(screen.getByText((_text, element) => element?.tagName === 'SMALL' && element.textContent === '4件 · 原本 2ファイル / 証跡 3件')).toBeInTheDocument()
    const withheldPanels = screen.getAllByText((_text, element) => element?.classList.contains('family-withheld-detail') === true)
    expect(screen.getAllByLabelText('この配信で送る内容')[0]).toHaveTextContent('カード 2')
    expect(screen.getAllByLabelText('この配信で送る内容')[0]).toHaveTextContent('投資 1')
    expect(withheldPanels[0]).toHaveTextContent('カードの原本・証跡が不足')
    expect(withheldPanels[0]).toHaveTextContent('投資の原本・証跡が不足')
    expect(withheldPanels[0]).toHaveTextContent('原本をこの配信範囲へ安全に分けられない')
    expect(withheldPanels[0]).toHaveTextContent('配信サイズが上限を超える')
    expect(withheldPanels[0]).toHaveTextContent('カード 2件 · 投資 2件')
    expect(withheldPanels[0]).not.toHaveTextContent('世帯全体')
    expect(screen.getAllByText('一部保留')).toHaveLength(2)
    expect(screen.getByText(/家族へ送らず、この端末に保留/)).toBeInTheDocument()
    const checkboxes = screen.getAllByRole('checkbox')
    expect(checkboxes[0]).toBeChecked(); expect(checkboxes[1]).toBeDisabled()
    fireEvent.change(screen.getByLabelText('接続トークン（この画面のみ）'), { target: { value: 'session-secret' } })
    fireEvent.click(screen.getByRole('button', { name: '選択した範囲を送信' }))
    await waitFor(() => expect(family.prepare).toHaveBeenCalledWith({ householdId: 'family', audienceKeys: ['SHARED'] }))
    expect(family.upload).toHaveBeenCalledWith('https://relay.example', 'session-secret', expect.objectContaining({ audienceVisibility: 'SHARED' }))
    expect(await screen.findByText(/受信・反映完了ではありません/)).toBeInTheDocument()
  })

  it('coalesces immediate duplicate send gestures into one upload attempt per delivery', async () => {
    family.status.mockResolvedValue(connected)
    let releaseUpload!: () => void
    family.upload.mockImplementation(() => new Promise((resolve) => {
      releaseUpload = () => resolve({ deliveryId: 'delivery-1', artifactId: 'publication-1', digest: 'c'.repeat(64), acceptedAt: '2026-07-14T01:00:00Z' })
    }))
    render(<FamilyDeliveryPanel householdId="family" members={members} />)
    await screen.findByText('世帯共有 → 花子')
    fireEvent.change(screen.getByLabelText('接続トークン（この画面のみ）'), { target: { value: 'session-secret' } })
    const sendButton = screen.getByRole('button', { name: '選択した範囲を送信' })
    fireEvent.click(sendButton)
    fireEvent.click(sendButton)
    await waitFor(() => expect(family.upload).toHaveBeenCalledTimes(1))
    expect(family.prepare).toHaveBeenCalledTimes(1)
    releaseUpload()
    await screen.findByText(/受信・反映完了ではありません/)
  })

  it('replays a validated cached envelope before evaluating the current recipient set', async () => {
    const localOnly = { ...remote, memberships: [membership] }
    family.status.mockResolvedValue(connected)
    family.remote.mockResolvedValue(localOnly)
    family.cachedEnvelope.mockResolvedValue({
      envelopeBytes: [7, 7], envelopeSha256: 'f'.repeat(64), envelopeByteSize: 2, recipientCount: 1,
      recipientSetDigest: '9'.repeat(64), cacheDisposition: 'STALE_CACHE_REUSED',
    })
    family.upload.mockResolvedValue({ deliveryId: 'delivery-1', artifactId: 'publication-1', digest: 'f'.repeat(64), acceptedAt: '2026-07-14T01:00:00Z' })

    render(<FamilyDeliveryPanel householdId="family" members={members} />)
    await screen.findByText('世帯共有 → 花子')
    fireEvent.change(screen.getByLabelText('接続トークン（この画面のみ）'), { target: { value: 'session-secret' } })
    fireEvent.click(screen.getByRole('button', { name: '選択した範囲を送信' }))

    await waitFor(() => expect(family.cachedEnvelope).toHaveBeenCalledWith({
      deliveryId: 'delivery-1', metadata: expect.objectContaining({ householdId: 'family', publicationId: 'publication-1' }),
    }))
    expect(family.envelopePrepare).not.toHaveBeenCalled()
    expect(family.recipientDigest).not.toHaveBeenCalled()
    expect(family.upload).toHaveBeenCalledWith('https://relay.example', 'session-secret', expect.objectContaining({
      transportDigest: 'f'.repeat(64), recipientSetDigest: '9'.repeat(64), envelopeBytes: [7, 7],
    }))
    expect(await screen.findByText(/受信・反映完了ではありません/)).toBeInTheDocument()
  })

  it('accepts successful uploads and resets only the delivery rejected for an exact recipient-set change', async () => {
    family.status.mockResolvedValue(connectedWithTwoReady)
    family.registerRemote.mockResolvedValue(connectedWithTwoReady)
    family.prepare.mockResolvedValue([preparedShared, preparedPersonal])
    family.accept.mockResolvedValue(connectedWithTwoReady)
    family.recipientChanged.mockResolvedValue(connectedWithTwoReady)
    family.envelopePrepare.mockImplementation(async (input: { deliveryId: string }) => ({
      envelopeBytes: input.deliveryId === 'delivery-1' ? [1, 1] : [2, 2],
      envelopeSha256: (input.deliveryId === 'delivery-1' ? 'c' : 'd').repeat(64), envelopeByteSize: 2, recipientCount: 1,
      recipientSetDigest: 'd'.repeat(64), cacheDisposition: 'NEWLY_SEALED',
    }))
    let personalAttempts = 0
    family.upload.mockImplementation(async (_endpoint: string, _token: string, artifact: { deliveryId: string; artifactId: string; transportDigest: string }) => {
      if (artifact.deliveryId === 'delivery-2' && personalAttempts++ === 0) throw new FamilyDeliveryHttpError('RECIPIENT_SET_CHANGED')
      return { deliveryId: artifact.deliveryId, artifactId: artifact.artifactId, digest: artifact.transportDigest, acceptedAt: '2026-07-14T01:00:00Z' }
    })

    render(<FamilyDeliveryPanel householdId="family" members={members} />)
    await screen.findByText('世帯共有 → 花子')
    fireEvent.change(screen.getByLabelText('接続トークン（この画面のみ）'), { target: { value: 'session-secret' } })
    fireEvent.click(screen.getByRole('button', { name: '選択した範囲を送信' }))

    await waitFor(() => expect(family.recipientChanged).toHaveBeenCalledWith('family', [{
      deliveryId: 'delivery-2', transportSha256: 'd'.repeat(64), recipientSetDigest: 'd'.repeat(64),
    }]))
    expect(family.accept).toHaveBeenCalledWith({ householdId: 'family', receipts: [expect.objectContaining({ deliveryId: 'delivery-1' })] })
    expect(family.accept.mock.invocationCallOrder[0]).toBeLessThan(family.recipientChanged.mock.invocationCallOrder[0])
    expect(family.fail).not.toHaveBeenCalled()
    expect(await screen.findByText(/現在の配信先に封印し直します/)).toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: '選択した範囲を送信' }))
    await waitFor(() => expect(family.accept).toHaveBeenLastCalledWith({ householdId: 'family', receipts: [
      expect.objectContaining({ deliveryId: 'delivery-1' }), expect.objectContaining({ deliveryId: 'delivery-2' }),
    ] }))
    expect(family.envelopePrepare.mock.calls.filter(([input]) => input.deliveryId === 'delivery-2')).toHaveLength(2)
  })

  it('accepts a partial success but retains cached envelope metadata for ambiguous retryable failures', async () => {
    family.status.mockResolvedValue(connectedWithTwoReady)
    family.registerRemote.mockResolvedValue(connectedWithTwoReady)
    family.prepare.mockResolvedValue([preparedShared, preparedPersonal])
    family.accept.mockResolvedValue(connectedWithTwoReady)
    family.fail.mockResolvedValue(connectedWithTwoReady)
    family.envelopePrepare.mockImplementation(async (input: { deliveryId: string }) => ({
      envelopeBytes: [1, 2], envelopeSha256: (input.deliveryId === 'delivery-1' ? 'c' : 'd').repeat(64), envelopeByteSize: 2, recipientCount: 1,
      recipientSetDigest: 'd'.repeat(64), cacheDisposition: 'NEWLY_SEALED',
    }))
    family.upload.mockImplementation(async (_endpoint: string, _token: string, artifact: { deliveryId: string; artifactId: string; transportDigest: string }) => {
      if (artifact.deliveryId === 'delivery-2') throw new FamilyDeliveryHttpError('NETWORK_RETRYABLE')
      return { deliveryId: artifact.deliveryId, artifactId: artifact.artifactId, digest: artifact.transportDigest, acceptedAt: '2026-07-14T01:00:00Z' }
    })

    render(<FamilyDeliveryPanel householdId="family" members={members} />)
    await screen.findByText('世帯共有 → 花子')
    fireEvent.change(screen.getByLabelText('接続トークン（この画面のみ）'), { target: { value: 'session-secret' } })
    fireEvent.click(screen.getByRole('button', { name: '選択した範囲を送信' }))

    await waitFor(() => expect(family.fail).toHaveBeenCalledWith('family', ['delivery-2']))
    expect(family.accept).toHaveBeenCalledWith({ householdId: 'family', receipts: [expect.objectContaining({ deliveryId: 'delivery-1' })] })
    expect(family.recipientChanged).not.toHaveBeenCalled()
    expect(await screen.findByText(/配信サービスに接続できません/)).toBeInTheDocument()
  })

  it('retries an exact reset and drains a pending reset before resealing after a native reset failure', async () => {
    family.status.mockResolvedValue(connectedWithTwoReady)
    family.registerRemote.mockResolvedValue(connectedWithTwoReady)
    family.prepare.mockResolvedValue([preparedShared, preparedPersonal])
    family.accept.mockResolvedValue(connectedWithTwoReady)
    family.recipientChanged.mockRejectedValueOnce(new Error('ipc unavailable'))
      .mockRejectedValueOnce(new Error('ipc unavailable')).mockResolvedValue(connectedWithTwoReady)
    family.envelopePrepare.mockImplementation(async (input: { deliveryId: string }) => ({
      envelopeBytes: [1, 2], envelopeSha256: (input.deliveryId === 'delivery-1' ? 'c' : 'd').repeat(64), envelopeByteSize: 2, recipientCount: 1,
      recipientSetDigest: 'd'.repeat(64), cacheDisposition: 'NEWLY_SEALED',
    }))
    let personalAttempts = 0
    family.upload.mockImplementation(async (_endpoint: string, _token: string, artifact: { deliveryId: string; artifactId: string; transportDigest: string }) => {
      if (artifact.deliveryId === 'delivery-2' && personalAttempts++ === 0) throw new FamilyDeliveryHttpError('RECIPIENT_SET_CHANGED')
      return { deliveryId: artifact.deliveryId, artifactId: artifact.artifactId, digest: artifact.transportDigest, acceptedAt: '2026-07-14T01:00:00Z' }
    })

    render(<FamilyDeliveryPanel householdId="family" members={members} />)
    await screen.findByText('世帯共有 → 花子')
    fireEvent.change(screen.getByLabelText('接続トークン（この画面のみ）'), { target: { value: 'session-secret' } })
    fireEvent.click(screen.getByRole('button', { name: '選択した範囲を送信' }))
    await waitFor(() => expect(family.recipientChanged).toHaveBeenCalledTimes(2))
    expect(family.accept).toHaveBeenCalledWith({ householdId: 'family', receipts: [expect.objectContaining({ deliveryId: 'delivery-1' })] })
    expect(await screen.findByText(/操作を完了できませんでした/)).toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: '選択した範囲を送信' }))
    await waitFor(() => expect(family.recipientChanged).toHaveBeenCalledTimes(3))
    await waitFor(() => expect(family.accept).toHaveBeenCalledWith({ householdId: 'family', receipts: [
      expect.objectContaining({ deliveryId: 'delivery-1' }), expect.objectContaining({ deliveryId: 'delivery-2' }),
    ] }))
    expect(family.envelopePrepare.mock.calls.filter(([input]) => input.deliveryId === 'delivery-2')).toHaveLength(2)
  })

  it('uses an accessible confirmation before creating a member-bound invitation', async () => {
    family.status.mockResolvedValue(connected)
    family.createInvite.mockResolvedValue({ inviteId: 'invite-1', inviteCode: 'kfi_long-invite-code-for-hanako', expiresAt: '2026-07-15T00:00:00Z' })
    family.remote.mockResolvedValue({ ...remote, invites: [{ inviteId: 'invite-1', householdId: 'family', domainMemberId: 'member-hanako', state: 'ACTIVE', expiresAt: '2026-07-15T00:00:00Z' }] })
    render(<FamilyDeliveryPanel householdId="family" members={members} />)
    await screen.findByRole('button', { name: '招待を作成' })
    fireEvent.change(screen.getByLabelText('接続トークン（この画面のみ）'), { target: { value: 'session-secret' } })
    fireEvent.click(screen.getByRole('button', { name: '招待を作成' }))
    const dialog = screen.getByRole('dialog', { name: '花子さんを家族スペースに招待' })
    expect(dialog).toHaveTextContent('他のメンバーの個人データは配信されません')
    fireEvent.click(screen.getByRole('button', { name: '招待コードを発行' }))
    await waitFor(() => expect(family.createInvite).toHaveBeenCalledWith('https://relay.example', 'session-secret', 'family', 'member-hanako', expect.stringMatching(/^invite:/)))
    expect(await screen.findByText('kfi_long-invite-code-for-hanako')).toBeInTheDocument()
  })

  it('stages an audience-approved publication without applying it', async () => {
    const artifact = { sequence: 2, artifactId: 'publication-in', digest: 'b'.repeat(64), createdAt: '2026-07-14T02:00:00Z', originDeviceId: 'device-other', senderMembershipId: 'membership-hanako', audienceVisibility: 'SHARED' as const, audienceMemberId: null, byteSize: 321, artifactSchema: 'FAMILY_AUDIENCE_PARTITION_V1' as const }
    const available = { ...connected, inbound: [{ artifactId: artifact.artifactId, senderMemberName: '花子', audienceVisibility: 'SHARED' as const, audienceMemberName: null, itemCount: 3, createdAt: artifact.createdAt, state: 'AVAILABLE' as const, receivedBeforeRevocation: false }] }
    family.status.mockResolvedValue(available); family.list.mockResolvedValue({ artifacts: [artifact], nextCursor: 2 }); family.download.mockResolvedValue([1, 2, 3]); family.stage.mockResolvedValue({ ...available, inbound: [{ ...available.inbound[0], state: 'WAITING_FOR_REVIEW' as const }] })
    const onReviewStaged = vi.fn(); render(<FamilyDeliveryPanel householdId="family" members={members} onReviewStaged={onReviewStaged} />)
    await screen.findByText('花子さんから・世帯共有')
    fireEvent.change(screen.getByLabelText('接続トークン（この画面のみ）'), { target: { value: 'session-secret' } })
    fireEvent.click(screen.getByRole('button', { name: '受信して内容を確認' }))
    await waitFor(() => expect(family.download).toHaveBeenCalledWith('https://relay.example', 'session-secret', 'family', artifact))
    expect(family.stage).toHaveBeenCalledWith({ householdId: 'family', artifactId: 'publication-in', packageBytes: [1, 2, 3] })
    expect(onReviewStaged).toHaveBeenCalledTimes(1)
    expect(await screen.findByText(/最終確定までは台帳へ反映されません/)).toBeInTheDocument()
  })

  it('opts in to background discovery, runs it without resending a token, and keeps apply manual', async () => {
    family.status.mockResolvedValue(connected)
    render(<FamilyDeliveryPanel householdId="family" members={members} />)
    expect(await screen.findByText('オプトイン未設定')).toBeInTheDocument()
    expect(screen.getByText(/KakeFlowが開いている間だけ/)).toBeInTheDocument()
    expect(screen.getByText(/受信・内容確認・台帳への反映はすべて手動/)).toBeInTheDocument()
    expect(screen.getByText(/自動チェック専用に使います/)).toBeInTheDocument()
    expect(screen.getByText(/手動の送信・受信・内容確認には、引き続きこの画面へのトークン入力が必要/)).toBeInTheDocument()

    fireEvent.change(screen.getByLabelText('自動受信チェックの間隔'), { target: { value: '15' } })
    fireEvent.change(screen.getByLabelText('接続トークン（この画面のみ）'), { target: { value: 'session-secret' } })
    fireEvent.click(screen.getByRole('button', { name: '自動チェックを有効にする' }))
    await waitFor(() => expect(family.backgroundEnable).toHaveBeenCalledWith({ householdId: 'family', token: 'session-secret', intervalMinutes: 15 }))
    expect(await screen.findByText('新着なし')).toBeInTheDocument()
    expect(screen.getByText('前回の結果')).toBeInTheDocument()
    expect(screen.getByText('次回予定')).toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: '今すぐ確認' }))
    await waitFor(() => expect(family.backgroundNow).toHaveBeenCalledWith('family'))
    expect(JSON.stringify(family.backgroundNow.mock.calls)).not.toContain('session-secret')
    expect(family.status).toHaveBeenCalledTimes(2)
    expect(await screen.findByText(/2件の新着を受信可能として追加/)).toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: '自動チェックを停止' }))
    await waitFor(() => expect(family.backgroundDisable).toHaveBeenCalledWith('family'))
    expect(JSON.stringify(family.backgroundDisable.mock.calls)).not.toContain('session-secret')
    expect(await screen.findByText(/OSの資格情報に保存した接続トークンを削除/)).toBeInTheDocument()
  })

  it('shows the user action required for a terminally suspended background check', async () => {
    family.status.mockResolvedValue(connected)
    family.backgroundStatus.mockResolvedValue({
      ...enabledSchedule, nextDueAt: null, lastResult: 'TERMINAL_SUSPENDED',
      suspensionReason: 'MISSING_CREDENTIAL', lastErrorCode: 'MISSING_CREDENTIAL',
    })
    render(<FamilyDeliveryPanel householdId="family" members={members} />)
    expect(await screen.findByText('ユーザー操作が必要')).toBeInTheDocument()
    expect(screen.getByRole('alert')).toHaveTextContent('保存済みの接続トークンが見つかりません')
    expect(screen.getByRole('button', { name: '今すぐ確認' })).toBeDisabled()
    expect(screen.getByRole('button', { name: '間隔とトークンを更新' })).toBeDisabled()
    fireEvent.change(screen.getByLabelText('接続トークン（この画面のみ）'), { target: { value: 'replacement-token' } })
    expect(screen.getByRole('button', { name: '間隔とトークンを更新' })).toBeEnabled()
  })
})
