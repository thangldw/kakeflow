import { useEffect, useRef, useState } from 'react'
import { CloudDownload, CloudUpload, Copy, Link2Off, RefreshCw, UserPlus, X } from 'lucide-react'

import { platformClient } from '../../platform'
import type { FamilyDeliveryMembershipDto, FamilyDeliveryRecipientSetChangedDto, FamilyDeliveryRemoteArtifactDto, FamilyDeliveryScheduleStatusDto, FamilyDeliveryStatusDto, HouseholdMemberDto } from '../../platform'
import {
  cancelFamilyInvitation, createFamilyInvitation, downloadFamilyArtifact, FamilyDeliveryHttpError,
  createFamilyHousehold, getFamilyRemoteState, listFamilyArtifacts, previewFamilyInvitation, redeemFamilyInvitation,
  familyRecipientSetDigest, registerFamilyEncryptionKey, revokeFamilyMembership, uploadFamilyArtifact,
} from './familyDeliveryHttp'
import type { FamilyEncryptedArtifactUpload, FamilyRemoteMembership, FamilyRemoteState } from './familyDeliveryHttp'
import './FamilyDeliveryPanel.css'

interface Props {
  readonly householdId: string | null
  readonly members: readonly HouseholdMemberDto[]
  readonly onReviewStaged?: () => void
}
type Notice = { readonly kind: 'status' | 'error'; readonly text: string } | null
type DialogState =
  | { readonly kind: 'INVITE'; readonly member: FamilyDeliveryMembershipDto }
  | { readonly kind: 'REVOKE'; readonly member: FamilyDeliveryMembershipDto }
  | { readonly kind: 'CANCEL_INVITE'; readonly member: FamilyDeliveryMembershipDto }
  | { readonly kind: 'INVITE_CODE'; readonly memberName: string; readonly code: string; readonly expiresAt: string }
  | { readonly kind: 'REDEEM'; readonly memberName: string; readonly expiresAt: string }
  | null

const connectionLabels: Readonly<Record<FamilyDeliveryStatusDto['connectionState'], string>> = {
  NOT_CONFIGURED: '未接続', CONNECTED: '接続済み', AUTH_EXPIRED: '再接続が必要',
  NETWORK_UNAVAILABLE: '一時的に接続不可', MEMBERSHIP_REVOKED: '配信停止',
}
const membershipLabels: Readonly<Record<FamilyDeliveryMembershipDto['state'], string>> = {
  UNLINKED: '配信先未設定', INVITED: '招待待ち', ACTIVE: '配信中', REVOKED: '停止済み', ARCHIVED_BLOCKED: 'アーカイブ済み',
}
const inboundLabels: Readonly<Record<FamilyDeliveryStatusDto['inbound'][number]['state'], string>> = {
  AVAILABLE: '受信可能', DOWNLOADING: '受信中', WAITING_FOR_REVIEW: '内容確認待ち', READY_TO_APPLY: '反映準備完了',
  APPLIED: '反映済み', DUPLICATE: '受信済み', REJECTED_INVALID: '受信不可', AUDIENCE_DENIED: '配信対象外', FAILED_RETRYABLE: '再取得できます',
}
const domainLabels: Readonly<Record<keyof FamilyDeliveryStatusDto['outbound'][number]['domainCounts'], string>> = {
  LEDGER: '台帳', PLANNING: '計画', CONFIG: '設定', CARD: 'カード', INVESTMENT: '投資',
}
const withheldLabels: Readonly<Record<string, string>> = {
  EVIDENCE_REQUIRED: '原本・証跡が必要', EVIDENCE_REQUIRED_CARD: 'カードの原本・証跡が必要', EVIDENCE_REQUIRED_INVESTMENT: '投資の原本・証跡が必要',
  EVIDENCE_MISSING: '原本・証跡が不足', MISSING_CARD_EVIDENCE: 'カードの原本・証跡が不足', MISSING_INVESTMENT_EVIDENCE: '投資の原本・証跡が不足',
  EVIDENCE_AUDIENCE_MISMATCH: '原本をこの配信範囲へ安全に分けられない', EVIDENCE_SIZE_LIMIT: '原本を含む配信サイズが上限を超える',
  EVIDENCE_DEPENDENT_INVESTMENT: '投資の原本・証跡が不足', MIXED_PERSONAL_MEMBERS: '複数メンバーの個人データにまたがる',
  OTHER_MEMBER_PERSONAL: '別メンバーの個人データ', UNASSIGNED_SCOPE: '配信範囲が未設定', UNSUPPORTED_KIND: '未対応のデータ種類',
}
const scheduleResultLabels: Readonly<Record<FamilyDeliveryScheduleStatusDto['lastResult'], string>> = {
  NEVER: 'まだ確認していません', DISABLED: '停止中', RUNNING: '確認中', NO_CHANGES: '新着なし',
  DISCOVERED: '新着を発見', FAILED_RETRYABLE: '再試行待ち', LEASE_EXPIRED: '前回の確認が中断', TERMINAL_SUSPENDED: 'ユーザー操作が必要',
}
const scheduleSuspensionLabels: Readonly<Record<string, string>> = {
  RETRY_BACKOFF: '接続エラーのため、次回の自動再試行まで待機しています。',
  AUTH_EXPIRED: '接続トークンの有効期限が切れました。トークンを入力して自動チェックを更新してください。',
  MEMBERSHIP_REVOKED: '家族スペースへの参加が停止されました。参加状態を確認してください。',
  MISSING_CREDENTIAL: '保存済みの接続トークンが見つかりません。トークンを入力して自動チェックを更新してください。',
}

function displayScheduleTime(value: string | null): string {
  if (!value) return '—'
  return new Intl.DateTimeFormat('ja-JP', { dateStyle: 'short', timeStyle: 'short' }).format(new Date(value))
}

function withheldLabel(reason: string): string {
  return withheldLabels[reason] ?? `その他の保留理由（${reason}）`
}

function errorCopy(error: unknown): string {
  if (!(error instanceof FamilyDeliveryHttpError)) return '操作を完了できませんでした。台帳は変更されていません。'
  return {
    AUTH_EXPIRED: '接続の有効期限が切れました。再接続してから送受信を再試行してください。',
    NETWORK_RETRYABLE: '配信サービスに接続できません。台帳は変更されていません。',
    INVITE_EXPIRED: 'この招待コードは期限切れです。招待した人に新しいコードを依頼してください。',
    INVITE_USED: 'この招待はすでに使用されています。別のアカウントでは利用できません。',
    INVITE_REVOKED: 'この招待は取り消されています。招待した人に新しいコードを依頼してください。',
    INVITE_UNAVAILABLE: 'この招待コードは利用できません。招待した人に新しいコードを依頼してください。',
    HOUSEHOLD_MISMATCH: 'この招待は別の家族スペース用です。現在の世帯には追加できません。',
    MEMBER_ARCHIVED: '対象のメンバーはアーカイブ済みのため参加できません。',
    PRINCIPAL_ALREADY_LINKED: 'このアカウントはすでに別のメンバーに対応付けられています。',
    MEMBERSHIP_REVOKED: 'この家族スペースへの配信は停止されています。新しいデータは送受信できません。',
    AUDIENCE_DENIED: 'このデータは現在のメンバーへの配信対象ではありません。台帳は変更されていません。',
    INVALID_ARTIFACT: '内容を検証できないため受信しませんでした。台帳は変更されていません。',
    RECIPIENT_UNAVAILABLE: '配信先が有効ではないため保留しました。家族スペースで対応付けを確認してください。',
    RECIPIENT_SET_CHANGED: '配信先が変更されたため、この範囲の送信を保留しました。再送信すると現在の配信先に封印し直します。',
    INVALID_ENDPOINT: 'HTTPSの配信サービスURLを確認してください。',
    INVALID_RESPONSE: '配信サービスの応答を確認できませんでした。台帳は変更されていません。',
    REJECTED: '配信サービスが操作を受け付けませんでした。接続と家族メンバーの状態を確認してください。',
    OWNER_REQUIRED: 'この操作は家族スペースの管理者だけが行えます。',
  }[error.code]
}

export function FamilyDeliveryPanel({ householdId, members, onReviewStaged }: Props) {
  const [status, setStatus] = useState<FamilyDeliveryStatusDto | null>(null)
  const [endpoint, setEndpoint] = useState('')
  const [token, setToken] = useState('')
  const [inviteCode, setInviteCode] = useState('')
  const [ownerMemberId, setOwnerMemberId] = useState(() => members.find((member) => member.status === 'ACTIVE')?.id ?? '')
  const [selected, setSelected] = useState<readonly string[]>([])
  const [remoteArtifacts, setRemoteArtifacts] = useState<readonly FamilyDeliveryRemoteArtifactDto[]>([])
  const [schedule, setSchedule] = useState<FamilyDeliveryScheduleStatusDto | null>(null)
  const [scheduleInterval, setScheduleInterval] = useState<15 | 30 | 60>(30)
  const [busy, setBusy] = useState('')
  const [notice, setNotice] = useState<Notice>(null)
  const [dialog, setDialog] = useState<DialogState>(null)
  const request = useRef(0)
  const pendingRecipientSetChanges = useRef<readonly FamilyDeliveryRecipientSetChangedDto[]>([])
  const sendInFlight = useRef(false)

  const load = async () => {
    if (!householdId || platformClient.runtime !== 'tauri') { setStatus(null); return }
    const id = ++request.current; setBusy('LOAD'); setNotice(null)
    try {
      const next = await platformClient.getFamilyDeliveryStatus(householdId)
      if (id !== request.current) return
      setStatus(next); setEndpoint(next.endpoint ?? '')
      if (next.connectionState !== 'NOT_CONFIGURED') {
        try {
          const background = await platformClient.getFamilyDeliveryBackgroundStatus(householdId)
          if (id === request.current) { setSchedule(background); setScheduleInterval(background.intervalMinutes as 15 | 30 | 60) }
        } catch { if (id === request.current) setSchedule(null) }
      } else setSchedule(null)
    } catch { if (id === request.current) setNotice({ kind: 'error', text: '家族配信の状態を確認できませんでした。' }) }
    finally { if (id === request.current) setBusy('') }
  }
  useEffect(() => { setStatus(null); setSchedule(null); setToken(''); setInviteCode(''); setDialog(null); pendingRecipientSetChanges.current = []; void load(); return () => { request.current += 1 } }, [householdId]) // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => {
    setSelected((current) => status?.outbound.filter((part) => part.pendingChangeCount > 0 && ['READY', 'FAILED_RETRYABLE'].includes(part.state))
      .map((part) => part.audienceKey).filter((key) => current.length === 0 || current.includes(key)) ?? [])
  }, [status?.outbound])

  const localMemberships = (remote: FamilyRemoteState): readonly FamilyDeliveryMembershipDto[] => members.map((member) => {
    const active = remote.memberships.find((item) => item.domainMemberId === member.id && item.state === 'ACTIVE')
    const latest = remote.memberships.filter((item) => item.domainMemberId === member.id).sort((a, b) => b.generation - a.generation)[0]
    const invite = remote.invites.find((item) => item.domainMemberId === member.id && item.state === 'ACTIVE' && Date.parse(item.expiresAt) > Date.now())
    const state: FamilyDeliveryMembershipDto['state'] = member.status === 'ARCHIVED' ? 'ARCHIVED_BLOCKED' : active ? 'ACTIVE' : invite ? 'INVITED' : latest?.state === 'REVOKED' ? 'REVOKED' : 'UNLINKED'
    return {
      memberId: member.id, memberName: member.displayName, state,
      remoteMembershipIds: remote.memberships.filter((item) => item.domainMemberId === member.id && item.state === 'ACTIVE').map((item) => item.membershipId),
      inviteId: invite?.inviteId ?? null, inviteExpiresAt: invite?.expiresAt ?? null,
      deviceCount: remote.memberships.filter((item) => item.domainMemberId === member.id && item.state === 'ACTIVE').length, lastDeliveryAt: null,
    }
  })
  const ensureEncryptionIdentity = async (serviceEndpoint: string, remote: FamilyRemoteState): Promise<FamilyRemoteState> => {
    if (!householdId || !remote.localMembership) throw new FamilyDeliveryHttpError('MEMBERSHIP_REVOKED')
    const identity = await platformClient.getFamilyEnvelopeIdentity()
    await registerFamilyEncryptionKey(serviceEndpoint, token, householdId, identity)
    const refreshed = await getFamilyRemoteState(serviceEndpoint, token, householdId)
    if (!refreshed.localMembership || refreshed.localMembership.encryptionKeyId !== identity.keyId) throw new FamilyDeliveryHttpError('INVALID_RESPONSE')
    return refreshed
  }
  const encryptedRecipients = (remote: FamilyRemoteState, artifact: Awaited<ReturnType<typeof platformClient.prepareFamilyDelivery>>[number]): readonly FamilyRemoteMembership[] => {
    if (!remote.localMembership) throw new FamilyDeliveryHttpError('MEMBERSHIP_REVOKED')
    const intended = remote.memberships.filter((membership) => membership.state === 'ACTIVE'
      && membership.membershipId !== remote.localMembership!.membershipId
      && (artifact.audienceVisibility === 'SHARED' || membership.domainMemberId === artifact.audienceMemberId))
    if (intended.length === 0 || intended.some((membership) => !membership.encryptionKeyId || !membership.encryptionPublicKey || membership.encryptionKeyGeneration < 1)) {
      throw new FamilyDeliveryHttpError('RECIPIENT_UNAVAILABLE')
    }
    return intended
  }
  const registerRemote = async (remote: FamilyRemoteState) => {
    if (!householdId || remote.householdId !== householdId) throw new FamilyDeliveryHttpError('HOUSEHOLD_MISMATCH')
    const localMember = members.find((member) => member.id === remote.localMembership?.domainMemberId)
    const next = await platformClient.registerFamilyDeliveryRemoteState({
      householdId, remotePrincipalId: remote.remotePrincipalId,
      localMemberId: localMember?.id ?? null, localMemberName: localMember?.displayName ?? null,
      memberships: localMemberships(remote),
    })
    setStatus(next); return next
  }
  const connect = async () => {
    if (!householdId || !endpoint.trim() || !token) { setNotice({ kind: 'error', text: '配信サービスURLと、この画面で使う接続トークンを入力してください。' }); return }
    setBusy('CONNECT'); setNotice({ kind: 'status', text: '配信サービスのアカウントを確認しています…' })
    try {
      const normalized = new URL(endpoint.trim()).toString().replace(/\/$/, '')
      let remote = await getFamilyRemoteState(normalized, token, householdId)
      if (!remote.localMembership) {
        if (!ownerMemberId) throw new FamilyDeliveryHttpError('MEMBER_ARCHIVED')
        await createFamilyHousehold(normalized, token, householdId, ownerMemberId, `family-create:${householdId}:${ownerMemberId}`)
        remote = await getFamilyRemoteState(normalized, token, householdId)
      }
      remote = await ensureEncryptionIdentity(normalized, remote)
      const localMember = members.find((member) => member.id === remote.localMembership?.domainMemberId)
      const next = await platformClient.saveFamilyDeliveryConnection({
        householdId, endpoint: normalized, remotePrincipalId: remote.remotePrincipalId,
        localMemberId: localMember?.id ?? null, localMemberName: localMember?.displayName ?? null,
        memberships: localMemberships(remote),
      })
      setStatus(next); setEndpoint(normalized); setNotice({ kind: 'status', text: `${localMember?.displayName ?? '家族メンバー'}として接続しました。データはまだ送信されていません。` })
    } catch (error) { setNotice({ kind: 'error', text: errorCopy(error) }) }
    finally { setBusy('') }
  }
  const disconnect = async () => {
    if (!householdId) return
    setBusy('DISCONNECT')
    try { setStatus(await platformClient.disconnectFamilyDelivery(householdId)); setSchedule(null); setToken(''); setNotice({ kind: 'status', text: '家族配信の接続を解除しました。未送信の変更はこの端末に残っています。' }) }
    catch { setNotice({ kind: 'error', text: '家族配信の接続を解除できませんでした。' }) }
    finally { setBusy('') }
  }
  const refresh = async () => {
    if (!householdId || !status?.endpoint || !token) { setNotice({ kind: 'error', text: '受信確認には、この画面で使う接続トークンが必要です。' }); return }
    setBusy('REFRESH'); setNotice({ kind: 'status', text: '家族からの新しいデータを確認しています…' })
    try {
      const remote = await ensureEncryptionIdentity(status.endpoint, await getFamilyRemoteState(status.endpoint, token, householdId))
      await registerRemote(remote)
      const page = await listFamilyArtifacts(status.endpoint, token, householdId, status.inboundCursor, status.localDeviceId); setRemoteArtifacts(page.artifacts)
      const next = await platformClient.registerFamilyDeliveryInbound({ householdId, artifacts: page.artifacts, nextCursor: page.nextCursor }); setStatus(next)
      setNotice({ kind: 'status', text: `${page.artifacts.length}件を確認しました。台帳へは自動反映していません。` })
    } catch (error) { setNotice({ kind: 'error', text: errorCopy(error) }) }
    finally { setBusy('') }
  }
  const send = async () => {
    if (!householdId || !status?.endpoint || !token || selected.length === 0 || sendInFlight.current) return
    sendInFlight.current = true
    let prepared: Awaited<ReturnType<typeof platformClient.prepareFamilyDelivery>> = []
    let encrypted: readonly FamilyEncryptedArtifactUpload[] = []
    setBusy('SEND'); setNotice({ kind: 'status', text: '選択した配信範囲を送信しています…' })
    try {
      if (pendingRecipientSetChanges.current.length > 0) {
        const pending = pendingRecipientSetChanges.current
        setStatus(await platformClient.resetFamilyDeliveryRecipientSetChanged(householdId, pending))
        pendingRecipientSetChanges.current = []
      }
      const remote = await ensureEncryptionIdentity(status.endpoint, await getFamilyRemoteState(status.endpoint, token, householdId))
      await registerRemote(remote)
      prepared = await platformClient.prepareFamilyDelivery({ householdId, audienceKeys: selected })
      encrypted = await Promise.all(prepared.map(async (artifact): Promise<FamilyEncryptedArtifactUpload> => {
        const metadata = { householdId, publicationId: artifact.artifactId, originInstallationId: artifact.originDeviceId, artifactSchema: artifact.artifactSchema, innerSha256: artifact.digest }
        let sealed = await platformClient.getCachedFamilyDeliveryEnvelope({ deliveryId: artifact.deliveryId, metadata })
        if (!sealed) {
          const recipients = encryptedRecipients(remote, artifact)
          const recipientSetDigest = await familyRecipientSetDigest(recipients)
          sealed = await platformClient.prepareEncryptedFamilyEnvelope({
            deliveryId: artifact.deliveryId, metadata,
            recipients: recipients.map((membership) => ({ membershipId: membership.membershipId, keyId: membership.encryptionKeyId!, publicKey: membership.encryptionPublicKey!, generation: membership.encryptionKeyGeneration })),
            recipientSetDigest,
          })
          if (sealed.cacheDisposition !== 'STALE_CACHE_REUSED'
            && (sealed.recipientCount !== recipients.length || sealed.recipientSetDigest !== recipientSetDigest)) {
            throw new FamilyDeliveryHttpError('INVALID_RESPONSE')
          }
        }
        return { ...artifact, envelopeSchema: 'FAMILY_ENCRYPTED_ENVELOPE_V1', envelopeBytes: sealed.envelopeBytes, transportDigest: sealed.envelopeSha256, innerDigest: artifact.digest, recipientSetDigest: sealed.recipientSetDigest }
      }))
      const uploads = await Promise.allSettled(encrypted.map((artifact) => uploadFamilyArtifact(status.endpoint!, token, artifact)))
      const receipts = uploads.flatMap((result, index) => {
        if (result.status !== 'fulfilled') return []
        const source = encrypted[index]
        if (source.artifactId !== result.value.artifactId || source.transportDigest !== result.value.digest || source.deliveryId !== result.value.deliveryId) {
          return []
        }
        return [result.value]
      })
      const invalidAcceptanceIds = uploads.flatMap((result, index) => result.status === 'fulfilled'
        && !receipts.some((receipt) => receipt.deliveryId === encrypted[index].deliveryId) ? [encrypted[index].deliveryId] : [])
      const changed = uploads.flatMap((result, index) => result.status === 'rejected'
        && result.reason instanceof FamilyDeliveryHttpError && result.reason.code === 'RECIPIENT_SET_CHANGED'
        ? [{ deliveryId: encrypted[index].deliveryId, transportSha256: encrypted[index].transportDigest, recipientSetDigest: encrypted[index].recipientSetDigest }]
        : [])
      const retryable = uploads.flatMap((result, index) => result.status === 'rejected'
        && !(result.reason instanceof FamilyDeliveryHttpError && result.reason.code === 'RECIPIENT_SET_CHANGED')
        ? [encrypted[index].deliveryId] : [])
      if (changed.length > 0) pendingRecipientSetChanges.current = changed
      if (receipts.length > 0) setStatus(await platformClient.acceptFamilyDelivery({ householdId, receipts }))
      if (changed.length > 0) {
        let resetError: unknown
        for (let attempt = 0; attempt < 2; attempt += 1) {
          try {
            setStatus(await platformClient.resetFamilyDeliveryRecipientSetChanged(householdId, changed))
            pendingRecipientSetChanges.current = []
            resetError = undefined
            break
          } catch (error) { resetError = error }
        }
        if (resetError) throw resetError
      }
      if (retryable.length > 0 || invalidAcceptanceIds.length > 0) {
        setStatus(await platformClient.failFamilyDelivery(householdId, [...retryable, ...invalidAcceptanceIds]))
      }
      const rejected = uploads.find((result) => result.status === 'rejected')
      if (rejected?.status === 'rejected') throw rejected.reason
      if (invalidAcceptanceIds.length > 0) throw new FamilyDeliveryHttpError('INVALID_RESPONSE')
      const sent = status.outbound.filter((part) => selected.includes(part.audienceKey)).map((part) => part.audienceVisibility === 'SHARED' ? '世帯共有' : `個人・${part.audienceMemberName}`).join('、')
      setNotice({ kind: 'status', text: `${sent}をリレーが受理しました。受信・反映完了ではありません。` })
    } catch (error) {
      if (prepared.length > 0 && encrypted.length === 0) try { setStatus(await platformClient.failFamilyDelivery(householdId, prepared.map((item) => item.deliveryId))) } catch { /* preserve last status */ }
      setNotice({ kind: 'error', text: errorCopy(error) })
    } finally { sendInFlight.current = false; setBusy('') }
  }
  const stage = async (artifactId: string) => {
    if (!householdId || !status?.endpoint || !token) return
    setBusy(`STAGE:${artifactId}`); setNotice({ kind: 'status', text: '受信データの配信範囲と内容を検証しています…' })
    try {
      let artifact = remoteArtifacts.find((item) => item.artifactId === artifactId)
      if (!artifact) { const page = await listFamilyArtifacts(status.endpoint, token, householdId, 0, status.localDeviceId); setRemoteArtifacts(page.artifacts); artifact = page.artifacts.find((item) => item.artifactId === artifactId) }
      if (!artifact) throw new FamilyDeliveryHttpError('AUDIENCE_DENIED')
      const packageBytes = await downloadFamilyArtifact(status.endpoint, token, householdId, artifact)
      if (artifact.envelopeSchema) {
        const remote = await ensureEncryptionIdentity(status.endpoint, await getFamilyRemoteState(status.endpoint, token, householdId))
        if (!remote.localMembership) throw new FamilyDeliveryHttpError('MEMBERSHIP_REVOKED')
        setStatus(await platformClient.stageEncryptedFamilyDeliveryInbound({
          householdId, artifactId, envelopeBytes: packageBytes, localMembershipId: remote.localMembership.membershipId,
        }))
      } else {
        setStatus(await platformClient.stageFamilyDeliveryInbound({ householdId, artifactId, packageBytes }))
      }
      onReviewStaged?.()
      setNotice({ kind: 'status', text: '内容確認待ちに追加しました。最終確定までは台帳へ反映されません。' })
    } catch (error) { setNotice({ kind: 'error', text: errorCopy(error) }) }
    finally { setBusy('') }
  }

  const enableBackground = async () => {
    if (!householdId || !token) { setNotice({ kind: 'error', text: '自動確認を有効化または更新するには、現在の接続トークンを入力してください。' }); return }
    setBusy('BACKGROUND_ENABLE')
    try {
      const next = await platformClient.enableFamilyDeliveryBackground({ householdId, token, intervalMinutes: scheduleInterval })
      setSchedule(next)
      setNotice({ kind: 'status', text: `自動受信チェックを${scheduleInterval}分間隔で有効にしました。KakeFlowが開いている間だけ確認します。` })
    } catch { setNotice({ kind: 'error', text: '自動受信チェックを設定できませんでした。接続トークンを確認してください。' }) }
    finally { setBusy('') }
  }
  const disableBackground = async () => {
    if (!householdId) return
    setBusy('BACKGROUND_DISABLE')
    try {
      setSchedule(await platformClient.disableFamilyDeliveryBackground(householdId))
      setNotice({ kind: 'status', text: '自動受信チェックを停止し、OSの資格情報に保存した接続トークンを削除しました。' })
    } catch { setNotice({ kind: 'error', text: '自動受信チェックを停止できませんでした。' }) }
    finally { setBusy('') }
  }
  const runBackgroundNow = async () => {
    if (!householdId) return
    setBusy('BACKGROUND_NOW')
    try {
      const next = await platformClient.runFamilyDeliveryBackgroundNow(householdId)
      setSchedule(next)
      setStatus(await platformClient.getFamilyDeliveryStatus(householdId))
      setNotice({ kind: 'status', text: next.lastDiscoveredCount > 0 ? `${next.lastDiscoveredCount}件の新着を受信可能として追加しました。内容の受信・確認・反映は手動です。` : '新しい家族データはありませんでした。' })
    } catch { setNotice({ kind: 'error', text: '今すぐ受信確認を完了できませんでした。次回の自動確認で再試行します。' }) }
    finally { setBusy('') }
  }

  const membershipAction = async () => {
    if (!dialog || !householdId || !status?.endpoint || !token) return
    setBusy('MEMBERSHIP')
    try {
      if (dialog.kind === 'INVITE') {
        const result = await createFamilyInvitation(status.endpoint, token, householdId, dialog.member.memberId, `invite:${householdId}:${dialog.member.memberId}:${crypto.randomUUID()}`)
        await registerRemote(await getFamilyRemoteState(status.endpoint, token, householdId))
        setDialog({ kind: 'INVITE_CODE', memberName: dialog.member.memberName, code: result.inviteCode, expiresAt: result.expiresAt })
      } else if (dialog.kind === 'CANCEL_INVITE' && dialog.member.inviteId) {
        await cancelFamilyInvitation(status.endpoint, token, householdId, dialog.member.inviteId); await registerRemote(await getFamilyRemoteState(status.endpoint, token, householdId)); setDialog(null)
        setNotice({ kind: 'status', text: `${dialog.member.memberName}さんへの招待を取り消しました。` })
      } else if (dialog.kind === 'REVOKE') {
        if (dialog.member.remoteMembershipIds.length === 0) throw new FamilyDeliveryHttpError('MEMBERSHIP_REVOKED')
        await Promise.all(dialog.member.remoteMembershipIds.map((membershipId) => revokeFamilyMembership(status.endpoint!, token, householdId, membershipId)))
        await registerRemote(await getFamilyRemoteState(status.endpoint, token, householdId)); setDialog(null)
        setNotice({ kind: 'status', text: `${dialog.member.memberName}さんへの今後の配信を停止しました。` })
      } else if (dialog.kind === 'REDEEM') {
        const membership = await redeemFamilyInvitation(endpoint.trim(), token, inviteCode)
        if (membership.householdId !== householdId) throw new FamilyDeliveryHttpError('HOUSEHOLD_MISMATCH')
        const remote = await ensureEncryptionIdentity(endpoint.trim(), await getFamilyRemoteState(endpoint.trim(), token, householdId))
        const member = members.find((item) => item.id === membership.domainMemberId)
        const next = await platformClient.saveFamilyDeliveryConnection({ householdId, endpoint: endpoint.trim().replace(/\/$/, ''), remotePrincipalId: remote.remotePrincipalId, localMemberId: member?.id ?? null, localMemberName: member?.displayName ?? null, memberships: localMemberships(remote) })
        setStatus(next); setDialog(null); setInviteCode('')
        setNotice({ kind: 'status', text: `${member?.displayName ?? '家族メンバー'}として参加しました。データはまだ受信していません。` })
      }
    } catch (error) { setNotice({ kind: 'error', text: errorCopy(error) }); setDialog(null) }
    finally { setBusy('') }
  }
  const inspectInvite = async () => {
    if (!householdId || !endpoint.trim() || !token || !inviteCode.trim()) { setNotice({ kind: 'error', text: '配信サービスURL、接続トークン、招待コードを入力してください。' }); return }
    setBusy('PREVIEW_INVITE')
    try {
      const preview = await previewFamilyInvitation(endpoint.trim(), token, inviteCode.trim())
      if (preview.householdId !== householdId) throw new FamilyDeliveryHttpError('HOUSEHOLD_MISMATCH')
      const member = members.find((item) => item.id === preview.domainMemberId && item.status === 'ACTIVE')
      if (!member) throw new FamilyDeliveryHttpError('MEMBER_ARCHIVED')
      setDialog({ kind: 'REDEEM', memberName: member.displayName, expiresAt: preview.expiresAt })
    } catch (error) { setNotice({ kind: 'error', text: errorCopy(error) }) }
    finally { setBusy('') }
  }

  if (platformClient.runtime !== 'tauri') return null
  const connected = status && status.connectionState !== 'NOT_CONFIGURED'
  const displayMemberships = status?.memberships ?? members.map((member) => ({ memberId: member.id, memberName: member.displayName, state: member.status === 'ARCHIVED' ? 'ARCHIVED_BLOCKED' as const : 'UNLINKED' as const, remoteMembershipIds: [], inviteId: null, inviteExpiresAt: null, deviceCount: 0, lastDeliveryAt: null }))
  return <section className="panel family-delivery" aria-busy={Boolean(busy)}>
    <div className="panel-head"><div><h2>家族へのデータ配信</h2><p>本人確認された家族メンバーへ、世帯共有または指定メンバーの個人データを手動で届けます。</p></div><b className={`family-delivery-state state-${status?.connectionState ?? 'NOT_CONFIGURED'}`}>{connectionLabels[status?.connectionState ?? 'NOT_CONFIGURED']}</b></div>
    <p className="family-delivery-boundary">送信・受信だけでは台帳を変更しません。個人データの配信先はメンバー対応付けから自動決定され、任意の相手へ広げることはできません。</p>
    <div className="family-connection-form">
      <label>配信サービスURL<input type="url" value={endpoint} disabled={Boolean(busy) || Boolean(connected)} placeholder="https://relay.example" onChange={(event) => setEndpoint(event.target.value)} /></label>
      <label>接続トークン（この画面のみ）<input type="password" autoComplete="off" value={token} disabled={Boolean(busy)} onChange={(event) => setToken(event.target.value)} /></label>
      {!connected && <label>このアカウントのメンバー<select value={ownerMemberId} disabled={Boolean(busy)} onChange={(event) => setOwnerMemberId(event.target.value)}>{members.filter((member) => member.status === 'ACTIVE').map((member) => <option key={member.id} value={member.id}>{member.displayName}</option>)}</select></label>}
      {!connected ? <button className="primary-btn" disabled={Boolean(busy)} onClick={() => void connect()}>{busy === 'CONNECT' ? '確認中…' : '配信サービスに接続'}</button> : <button className="text-btn" disabled={Boolean(busy)} onClick={() => void disconnect()}><Link2Off size={16} /> 接続を解除</button>}
    </div>
    {!connected && <div className="family-join-row"><label>招待コード<input value={inviteCode} disabled={Boolean(busy)} onChange={(event) => setInviteCode(event.target.value)} /></label><button className="secondary-btn" disabled={Boolean(busy)} onClick={() => void inspectInvite()}><UserPlus size={16} /> 招待内容を確認</button></div>}
    {connected && <>
      <dl className="family-identity-summary"><div><dt>接続中のアカウント</dt><dd>確認済み</dd></div><div><dt>このアカウントのメンバー</dt><dd>{status.localMemberName ?? '未参加'}</dd></div></dl>
      <section className="family-background-section" aria-labelledby="family-background-heading">
        <div className="family-section-head"><div><h3 id="family-background-heading">自動受信チェック</h3><p>KakeFlowが開いている間だけ、暗号化された新着の有無を確認します。発見したデータは「受信可能」のまま残り、受信・内容確認・台帳への反映はすべて手動です。</p></div><b className={schedule?.enabled ? 'background-enabled' : 'background-disabled'}>{schedule?.enabled ? '有効' : 'オプトイン未設定'}</b></div>
        <p className="family-background-credential">有効化した場合だけ接続トークンをOSの資格情報に保存し、自動チェック専用に使います。手動の送信・受信・内容確認には、引き続きこの画面へのトークン入力が必要です。停止時には保存したトークンを削除します。</p>
        <div className="family-background-controls">
          <label>確認間隔<select aria-label="自動受信チェックの間隔" value={scheduleInterval} disabled={Boolean(busy)} onChange={(event) => setScheduleInterval(Number(event.target.value) as 15 | 30 | 60)}><option value={15}>15分</option><option value={30}>30分</option><option value={60}>60分</option></select></label>
          <button className="secondary-btn" disabled={Boolean(busy) || !token} onClick={() => void enableBackground()}>{schedule?.enabled ? '間隔とトークンを更新' : '自動チェックを有効にする'}</button>
          {schedule?.enabled && <button className="text-btn" disabled={Boolean(busy)} onClick={() => void disableBackground()}>自動チェックを停止</button>}
          {schedule?.enabled && <button className="secondary-btn" disabled={Boolean(busy) || schedule.running || schedule.lastResult === 'TERMINAL_SUSPENDED'} onClick={() => void runBackgroundNow()}><RefreshCw size={16} /> {busy === 'BACKGROUND_NOW' ? '確認中…' : '今すぐ確認'}</button>}
        </div>
        {schedule && <dl className="family-background-status"><div><dt>前回の結果</dt><dd>{scheduleResultLabels[schedule.lastResult]}{schedule.lastResult === 'DISCOVERED' ? `（${schedule.lastDiscoveredCount}件）` : ''}</dd></div><div><dt>前回の確認</dt><dd>{displayScheduleTime(schedule.lastAttemptAt)}</dd></div><div><dt>次回予定</dt><dd>{displayScheduleTime(schedule.nextDueAt)}</dd></div><div><dt>連続失敗</dt><dd>{schedule.consecutiveFailures}回</dd></div></dl>}
        {schedule?.suspensionReason && <p className={schedule.lastResult === 'TERMINAL_SUSPENDED' ? 'family-delivery-error' : 'family-delivery-notice'} role={schedule.lastResult === 'TERMINAL_SUSPENDED' ? 'alert' : 'status'}>{scheduleSuspensionLabels[schedule.suspensionReason] ?? `自動チェックを一時停止しています（${schedule.suspensionReason}）。`}</p>}
      </section>
      {status.connectionState === 'AUTH_EXPIRED' && <p className="family-delivery-error" role="alert">接続の有効期限が切れました。トークンを入力し直して再接続してください。</p>}
      {status.connectionState === 'MEMBERSHIP_REVOKED' && <p className="family-delivery-error" role="alert">この家族スペースへの配信は停止されています。新しいデータは送受信できません。</p>}
      <div className="family-membership-section"><h3>家族メンバーと配信先</h3>{displayMemberships.map((membership) => <article key={membership.memberId} className="family-delivery-member">
        <div><strong>{membership.memberName}</strong><span className={`membership-${membership.state}`}>{membershipLabels[membership.state]}</span><small>{membership.state === 'UNLINKED' ? '表示名から自動で対応付けません。' : membership.state === 'INVITED' ? `有効期限 ${membership.inviteExpiresAt}` : membership.state === 'ACTIVE' ? `${membership.deviceCount}台・最終配信 ${membership.lastDeliveryAt ?? '—'}` : membership.state === 'REVOKED' ? '新しいデータは配信されません。過去のローカルデータは残ります。' : 'アーカイブ済みメンバーは招待できません。'}</small></div>
        {membership.state === 'UNLINKED' && <button className="secondary-btn" disabled={Boolean(busy) || !token} onClick={() => setDialog({ kind: 'INVITE', member: membership })}>招待を作成</button>}
        {membership.state === 'INVITED' && <button className="text-btn" disabled={Boolean(busy) || !token} onClick={() => setDialog({ kind: 'CANCEL_INVITE', member: membership })}>招待を取り消す</button>}
        {membership.state === 'ACTIVE' && membership.memberId !== status.localMemberId && <button className="text-btn" disabled={Boolean(busy) || !token} onClick={() => setDialog({ kind: 'REVOKE', member: membership })}>配信を停止</button>}
        {membership.state === 'REVOKED' && <button className="secondary-btn" disabled={Boolean(busy) || !token} onClick={() => setDialog({ kind: 'INVITE', member: membership })}>新しい招待を作成</button>}
      </article>)}</div>
      <div className="family-outbound-section"><div className="family-section-head"><div><h3>家族へ送る変更</h3><p>配信先は家族メンバーの対応付けから自動決定されます。</p></div></div>
        {status.outbound.length === 0 ? <p className="empty-state">送信できる変更はありません。</p> : status.outbound.map((part) => {
          const enabled = part.pendingChangeCount > 0 && ['READY', 'FAILED_RETRYABLE'].includes(part.state)
          const audience = part.audienceVisibility === 'SHARED' ? '世帯共有' : `個人・${part.audienceMemberName}`
          const includedDomains = Object.entries(part.domainCounts).filter(([, count]) => count > 0)
          const withheldDomains = Object.entries(part.withheldDomainCounts).filter(([, count]) => count > 0)
          const withheld = Object.entries(part.withheldCountsByReason).filter((entry) => entry[1] > 0)
          return <label key={part.audienceKey} className={`family-partition ${enabled ? '' : 'blocked'}`}><input type="checkbox" checked={selected.includes(part.audienceKey)} disabled={!enabled || Boolean(busy)} onChange={(event) => setSelected((current) => event.target.checked ? [...current, part.audienceKey] : current.filter((key) => key !== part.audienceKey))} /><span><span className="family-partition-title"><strong>{audience} → {part.recipientNames.length ? part.recipientNames.join('、') : '配信先未設定'}</strong><b className={`family-coverage-state coverage-${part.coverageState}`}>{part.coverageState === 'COMPLETE' ? '全範囲' : '一部保留'}</b></span><small>{part.pendingChangeCount}件 · 原本 {part.evidenceFileCount}ファイル / 証跡 {part.evidenceRecordCount}件</small>{includedDomains.length > 0 && <span className="family-domain-counts" aria-label="この配信で送る内容">{includedDomains.map(([domain, count]) => <span key={domain}>{domainLabels[domain as keyof typeof domainLabels]} {count}</span>)}</span>}{part.withheldReason && <small className="family-partition-blocked-reason">{part.withheldReason}</small>}{withheld.length > 0 && <span className="family-withheld-detail" role="status"><strong>この配信に含まれない内容</strong>{withheld.map(([reason, count]) => <span key={reason}>{withheldLabel(reason)} <b>{count}件</b></span>)}{withheldDomains.length > 0 && <span>{withheldDomains.map(([domain, count]) => `${domainLabels[domain as keyof typeof domainLabels]} ${count}件`).join(' · ')}</span>}</span>}</span></label>
        })}
        {status.withheldChangeCount > 0 && <p className="family-withheld" role="status">家族へ送らず、この端末に保留した変更が合計{status.withheldChangeCount}件あります。理由は各配信範囲に表示しています。</p>}
        <div className="family-delivery-actions"><button className="primary-btn" disabled={Boolean(busy) || !token || selected.length === 0} onClick={() => void send()}><CloudUpload size={16} /> {busy === 'SEND' ? '送信中…' : '選択した範囲を送信'}</button><button className="secondary-btn" disabled={Boolean(busy) || !token} onClick={() => void refresh()}><RefreshCw size={16} /> {busy === 'REFRESH' ? '確認中…' : '家族からの受信を確認'}</button></div>
      </div>
      <div className="family-inbound-section"><h3>家族から受け取ったデータ</h3>{status.inbound.length === 0 ? <p className="empty-state">受信した家族データはありません。</p> : status.inbound.map((item) => <article key={item.artifactId}><div><strong>{item.senderMemberName}さんから・{item.audienceVisibility === 'SHARED' ? '世帯共有' : `個人・${item.audienceMemberName}`}</strong><small>{item.itemCount > 0 ? `${item.itemCount}件` : '内容は受信時に確認'}・{item.createdAt}</small>{item.receivedBeforeRevocation && <span className="family-revocation-warning">受信後にメンバー配信が停止されました。停止前に受信済みです。</span>}</div><span className="family-inbound-state">{inboundLabels[item.state]}</span>{['AVAILABLE', 'FAILED_RETRYABLE'].includes(item.state) && <button className="secondary-btn" disabled={Boolean(busy) || !token} onClick={() => void stage(item.artifactId)}><CloudDownload size={16} /> {busy === `STAGE:${item.artifactId}` ? '検証中…' : '受信して内容を確認'}</button>}{['WAITING_FOR_REVIEW', 'READY_TO_APPLY'].includes(item.state) && <button className="secondary-btn" onClick={onReviewStaged}>確認内容を開く</button>}</article>)}</div>
    </>}
    {notice && <p className={notice.kind === 'error' ? 'family-delivery-error' : 'family-delivery-notice'} role={notice.kind === 'error' ? 'alert' : 'status'} aria-live={notice.kind === 'error' ? 'assertive' : 'polite'}>{notice.text}</p>}
    {dialog && <FamilyDialog state={dialog} busy={Boolean(busy)} close={() => setDialog(null)} confirm={() => void membershipAction()} />}
  </section>
}

function FamilyDialog({ state, busy, close, confirm }: { readonly state: NonNullable<DialogState>; readonly busy: boolean; readonly close: () => void; readonly confirm: () => void }) {
  const heading = useRef<HTMLHeadingElement>(null)
  useEffect(() => { heading.current?.focus() }, [])
  const invite = state.kind === 'INVITE'; const revoke = state.kind === 'REVOKE'; const cancel = state.kind === 'CANCEL_INVITE'; const code = state.kind === 'INVITE_CODE'; const redeem = state.kind === 'REDEEM'
  const title = invite ? `${state.member.memberName}さんを家族スペースに招待` : revoke ? `${state.member.memberName}さんへの配信を停止しますか？` : cancel ? `${state.member.memberName}さんへの招待を取り消しますか？` : code ? `${state.memberName}さんの招待コード` : `${state.memberName}さんとして参加しますか？`
  return <div className="family-dialog-backdrop" onMouseDown={(event) => { if (event.target === event.currentTarget && !busy) close() }} onKeyDown={(event) => { if (event.key === 'Escape' && !busy) close() }}><section role="dialog" aria-modal="true" aria-labelledby="family-dialog-title" className="family-dialog">
    <div className="family-dialog-head"><h3 id="family-dialog-title" ref={heading} tabIndex={-1}>{title}</h3><button className="icon-btn" aria-label="ダイアログを閉じる" disabled={busy} onClick={close}><X size={18} /></button></div>
    {invite && <p>招待を受けたアカウントは、世帯共有データと「個人・{state.member.memberName}」に指定したデータを受け取れます。他のメンバーの個人データは配信されません。</p>}
    {revoke && <p>今後の送受信を停止します。すでにこの端末へ受信・反映されたデータは自動削除されません。未送信データはこの端末に残ります。</p>}
    {cancel && <p>この招待コードは利用できなくなります。データはまだ配信されていません。</p>}
    {code && <><p className="family-invite-code">{state.code}</p><p>有効期限 {state.expiresAt}。この画面を閉じる前に、安全な方法で本人へ渡してください。</p><button className="secondary-btn" onClick={() => void navigator.clipboard.writeText(state.code)}><Copy size={16} /> コードをコピー</button></>}
    {redeem && <><p>この端末の同じ家族スペースに、{state.memberName}さんとして参加します。招待の有効期限は {state.expiresAt} です。</p><dl className="family-redeem-summary"><div><dt>配信される範囲</dt><dd>世帯共有 / 個人・{state.memberName}</dd></div><div><dt>配信されない範囲</dt><dd>他のメンバーの個人データ</dd></div></dl></>}
    <div className="family-dialog-actions">{!code && <button className="secondary-btn" disabled={busy} onClick={close}>キャンセル</button>}{!code && <button className={revoke || cancel ? 'danger-btn' : 'primary-btn'} disabled={busy} onClick={confirm}>{busy ? '処理中…' : invite ? '招待コードを発行' : revoke ? '配信を停止' : cancel ? '招待を取り消す' : 'この内容で参加'}</button>}{code && <button className="primary-btn" onClick={close}>閉じる</button>}</div>
  </section></div>
}
