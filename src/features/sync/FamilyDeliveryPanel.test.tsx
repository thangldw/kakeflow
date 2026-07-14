import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const family = vi.hoisted(() => ({
  status: vi.fn(), save: vi.fn(), disconnect: vi.fn(), registerRemote: vi.fn(), prepare: vi.fn(), accept: vi.fn(), fail: vi.fn(), registerInbound: vi.fn(), stage: vi.fn(),
  remote: vi.fn(), createHousehold: vi.fn(), previewInvite: vi.fn(), createInvite: vi.fn(), cancelInvite: vi.fn(), redeem: vi.fn(), revoke: vi.fn(), upload: vi.fn(), list: vi.fn(), download: vi.fn(),
}))
vi.mock('../../platform', () => ({ platformClient: {
  runtime: 'tauri', getFamilyDeliveryStatus: (...args: unknown[]) => family.status(...args),
  saveFamilyDeliveryConnection: (...args: unknown[]) => family.save(...args), disconnectFamilyDelivery: (...args: unknown[]) => family.disconnect(...args),
  registerFamilyDeliveryRemoteState: (...args: unknown[]) => family.registerRemote(...args), prepareFamilyDelivery: (...args: unknown[]) => family.prepare(...args),
  acceptFamilyDelivery: (...args: unknown[]) => family.accept(...args), failFamilyDelivery: (...args: unknown[]) => family.fail(...args),
  registerFamilyDeliveryInbound: (...args: unknown[]) => family.registerInbound(...args), stageFamilyDeliveryInbound: (...args: unknown[]) => family.stage(...args),
} }))
vi.mock('./familyDeliveryHttp', () => ({
  FamilyDeliveryHttpError: class FamilyDeliveryHttpError extends Error { constructor(readonly code: string) { super(code) } },
  getFamilyRemoteState: (...args: unknown[]) => family.remote(...args), createFamilyHousehold: (...args: unknown[]) => family.createHousehold(...args),
  previewFamilyInvitation: (...args: unknown[]) => family.previewInvite(...args),
  createFamilyInvitation: (...args: unknown[]) => family.createInvite(...args), cancelFamilyInvitation: (...args: unknown[]) => family.cancelInvite(...args),
  redeemFamilyInvitation: (...args: unknown[]) => family.redeem(...args), revokeFamilyMembership: (...args: unknown[]) => family.revoke(...args),
  uploadFamilyArtifact: (...args: unknown[]) => family.upload(...args), listFamilyArtifacts: (...args: unknown[]) => family.list(...args),
  downloadFamilyArtifact: (...args: unknown[]) => family.download(...args),
}))

import { FamilyDeliveryPanel } from './FamilyDeliveryPanel'
import type { FamilyDeliveryStatusDto, HouseholdMemberDto } from '../../platform/types'

const members: readonly HouseholdMemberDto[] = [
  { id: 'member-taro', householdId: 'family', displayName: '太郎', relationshipLabel: '父', sortOrder: 0, status: 'ACTIVE', createdAt: '2026-07-14T00:00:00Z', updatedAt: '2026-07-14T00:00:00Z' },
  { id: 'member-hanako', householdId: 'family', displayName: '花子', relationshipLabel: '母', sortOrder: 1, status: 'ACTIVE', createdAt: '2026-07-14T00:00:00Z', updatedAt: '2026-07-14T00:00:00Z' },
]
const membership = { membershipId: 'membership-owner', householdId: 'family', principalId: 'principal-owner', domainMemberId: 'member-taro', role: 'OWNER' as const, state: 'ACTIVE' as const, generation: 1, joinedAt: '2026-07-14T00:00:00Z', revokedAt: null }
const remote = { householdId: 'family', remotePrincipalId: 'principal-owner', localMembership: membership, memberships: [membership], invites: [] }
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
    { audienceKey: 'SHARED', audienceVisibility: 'SHARED', audienceMemberId: null, audienceMemberName: null, recipientNames: ['花子'], pendingChangeCount: 4, state: 'READY', withheldReason: null },
    { audienceKey: 'PERSONAL:member-hanako', audienceVisibility: 'PERSONAL', audienceMemberId: 'member-hanako', audienceMemberName: '花子', recipientNames: [], pendingChangeCount: 2, state: 'BLOCKED_NO_RECIPIENT', withheldReason: '配信先未設定' },
  ],
  withheldChangeCount: 2,
}

describe('FamilyDeliveryPanel', () => {
  beforeEach(() => {
    for (const mock of Object.values(family)) mock.mockReset()
    family.status.mockResolvedValue(base); family.remote.mockResolvedValue(remote); family.save.mockResolvedValue(connected)
    family.disconnect.mockResolvedValue(base); family.registerRemote.mockResolvedValue(connected)
    family.prepare.mockResolvedValue([{ deliveryId: 'delivery-1', artifactId: 'publication-1', digest: 'a'.repeat(64), householdId: 'family', originDeviceId: 'device-local', audienceKey: 'SHARED', audienceVisibility: 'SHARED', audienceMemberId: null, artifactSchema: 'FAMILY_AUDIENCE_PARTITION_V1', packageBytes: [1] }])
    family.upload.mockResolvedValue({ deliveryId: 'delivery-1', artifactId: 'publication-1', digest: 'a'.repeat(64), acceptedAt: '2026-07-14T01:00:00Z' })
    family.accept.mockResolvedValue({ ...connected, outbound: connected.outbound.map((item) => item.audienceKey === 'SHARED' ? { ...item, pendingChangeCount: 0, state: 'RELAY_ACCEPTED' as const } : item) })
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
    expect(screen.getByText(/家族には送らず、この端末に保留/)).toBeInTheDocument()
    const checkboxes = screen.getAllByRole('checkbox')
    expect(checkboxes[0]).toBeChecked(); expect(checkboxes[1]).toBeDisabled()
    fireEvent.change(screen.getByLabelText('接続トークン（この画面のみ）'), { target: { value: 'session-secret' } })
    fireEvent.click(screen.getByRole('button', { name: '選択した範囲を送信' }))
    await waitFor(() => expect(family.prepare).toHaveBeenCalledWith({ householdId: 'family', audienceKeys: ['SHARED'] }))
    expect(family.upload).toHaveBeenCalledWith('https://relay.example', 'session-secret', expect.objectContaining({ audienceVisibility: 'SHARED' }))
    expect(await screen.findByText(/受信・反映完了ではありません/)).toBeInTheDocument()
  })

  it('uses an accessible confirmation before creating a member-bound invitation', async () => {
    family.status.mockResolvedValue(connected)
    family.createInvite.mockResolvedValue({ inviteId: 'invite-1', inviteCode: 'kfi_long-invite-code-for-hanako', expiresAt: '2026-07-15T00:00:00Z' })
    family.remote.mockResolvedValue({ ...remote, invites: [{ inviteId: 'invite-1', householdId: 'family', domainMemberId: 'member-hanako', state: 'ACTIVE', expiresAt: '2026-07-15T00:00:00Z' }] })
    render(<FamilyDeliveryPanel householdId="family" members={members} />)
    await screen.findByText('配信先未設定')
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
})
