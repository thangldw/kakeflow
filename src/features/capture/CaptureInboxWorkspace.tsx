import { useCallback, useEffect, useRef, useState } from 'react'
import { buildReceiptImport } from '../import/receiptText'
import { sha256Text } from '../import/importService'
import { platformClient } from '../../platform'
import type { AccountDto, MobileCaptureImagePreviewDto, MobileCaptureInboxItemDto } from '../../platform'
import { CaptureInboxPage } from './CaptureInboxPage'
import { downloadRemoteMobileCapture, listRemoteMobileCaptures, MobileCaptureHttpError } from './mobileCaptureHttp'

interface Props {
  readonly householdId: string | null
  readonly accounts: readonly AccountDto[]
  readonly onOpenImport: () => void
  readonly onChanged: () => void
}

type Notice = { readonly kind: 'status' | 'error'; readonly text: string } | null

function upsert(items: readonly MobileCaptureInboxItemDto[], next: MobileCaptureInboxItemDto): readonly MobileCaptureInboxItemDto[] {
  return [next, ...items.filter((item) => item.artifactId !== next.artifactId)]
}

export function CaptureInboxWorkspace({ householdId, accounts, onOpenImport, onChanged }: Props) {
  const [items, setItems] = useState<readonly MobileCaptureInboxItemDto[]>([])
  const [loading, setLoading] = useState(false)
  const [busyArtifactId, setBusyArtifactId] = useState<string | null>(null)
  const [token, setToken] = useState('')
  const [preview, setPreview] = useState<{ readonly item: MobileCaptureInboxItemDto; readonly image: MobileCaptureImagePreviewDto } | null>(null)
  const [previewBusy, setPreviewBusy] = useState(false)
  const [notice, setNotice] = useState<Notice>(null)
  const request = useRef(0)
  const cashAccount = accounts.find((account) => account.accountKind === 'ASSET' && account.accountSubtype === 'CASH')

  const loadLocal = useCallback(async () => {
    const current = ++request.current
    if (!householdId || platformClient.runtime !== 'tauri') { setItems([]); return }
    setLoading(true)
    try {
      const next = await platformClient.listMobileCaptureInbox(householdId)
      if (current === request.current) setItems(next)
    } catch {
      if (current === request.current) setNotice({ kind: 'error', text: '撮影 Inboxを読み込めませんでした。接続を確認してもう一度お試しください。' })
    } finally { if (current === request.current) setLoading(false) }
  }, [householdId])

  useEffect(() => { setItems([]); setNotice(null); setBusyArtifactId(null); setToken(''); setPreview(null); void loadLocal() }, [loadLocal])

  const openPreview = async (item: MobileCaptureInboxItemDto) => {
    if (!householdId || previewBusy) return
    setPreviewBusy(true); setNotice(null)
    try { setPreview({ item, image: await platformClient.getMobileCaptureImagePreview(householdId, item.artifactId) }) }
    catch { setNotice({ kind: 'error', text: '原本画像を表示できませんでした。画像は削除せず、この端末に保持しています。' }) }
    finally { setPreviewBusy(false) }
  }

  const receive = async () => {
    if (!householdId || !token || loading) return
    const current = ++request.current; setLoading(true)
    setNotice({ kind: 'status', text: 'モバイルから届いた画像を確認しています。受信だけでは台帳を変更しません。' })
    try {
      const [family, captureStatus] = await Promise.all([platformClient.getFamilyDeliveryStatus(householdId), platformClient.getMobileCaptureStatus(householdId)])
      if (!captureStatus.endpoint || family.connectionState === 'NOT_CONFIGURED') throw new Error('NOT_CONFIGURED')
      if (family.connectionState === 'MEMBERSHIP_REVOKED') throw new MobileCaptureHttpError('MEMBERSHIP_REVOKED')
      const page = await listRemoteMobileCaptures(captureStatus.endpoint, token, householdId, captureStatus.captureInboundCursor, captureStatus.localDeviceId)
      let received = 0; let duplicates = 0
      for (const capture of page.captures) {
        const capsuleBytes = await downloadRemoteMobileCapture(captureStatus.endpoint, token, capture)
        const ingested = await platformClient.ingestMobileCapture({
          householdId, artifactId: capture.captureId, claimedDigest: capture.digest,
          originDeviceId: capture.originDeviceId, senderMembershipId: capture.senderMembershipId,
          audienceVisibility: capture.audienceVisibility, audienceMemberId: capture.audienceMemberId, capsuleBytes,
        })
        const sender = family.memberships.find((membership) => membership.remoteMembershipIds.includes(capture.senderMembershipId))
        const audience = capture.audienceMemberId ? family.memberships.find((membership) => membership.memberId === capture.audienceMemberId) : null
        const named = { ...ingested, senderMemberName: sender?.memberName ?? null, audienceMemberName: audience?.memberName ?? null }
        setItems((existing) => upsert(existing, named))
        if (ingested.state === 'DUPLICATE') duplicates += 1; else received += 1
      }
      const updated = await platformClient.updateMobileCaptureCursor(householdId, page.nextCursor)
      if (current === request.current) {
        const names = new Map(family.memberships.flatMap((membership) => membership.remoteMembershipIds.map((remoteId) => [remoteId, membership.memberName] as const)))
        setItems(updated.items.map((item) => ({ ...item, senderMemberName: item.senderMemberName ?? (item.senderMembershipId ? names.get(item.senderMembershipId) ?? null : null) })))
        setNotice({ kind: 'status', text: page.captures.length === 0 ? '新しく届いた画像はありません。台帳は変更されていません。' : `${received}件をこの端末へ受信しました${duplicates ? `（${duplicates}件は受信済み）` : ''}。OCRと台帳への承認はまだ行っていません。` })
      }
    } catch (error) {
      if (current !== request.current) return
      const code = error instanceof MobileCaptureHttpError ? error.code : 'INVALID_RESPONSE'
      const text = code === 'AUTH_EXPIRED' ? '接続トークンの有効期限が切れています。入力し直して再試行してください。'
        : code === 'MEMBERSHIP_REVOKED' ? 'この家族スペースへの配信は停止されています。新しい画像は受信できません。すでに保存した画像と取引は自動削除されません。'
        : code === 'AUDIENCE_DENIED' ? 'この画像は現在のメンバーの配信対象外です。台帳は変更されていません。'
        : code === 'INVALID_CAPTURE' ? '画像の内容を検証できなかったため受信しませんでした。台帳と確認待ちは変更されていません。'
        : 'モバイルからの受信を完了できませんでした。接続を確認して再試行してください。'
      setNotice({ kind: 'error', text })
      try { setItems(await platformClient.listMobileCaptureInbox(householdId)) } catch { /* keep the last valid local list */ }
    } finally { if (current === request.current) setLoading(false) }
  }

  const process = async (item: MobileCaptureInboxItemDto) => {
    if (!householdId || busyArtifactId) return
    if (!cashAccount) {
      setNotice({ kind: 'error', text: 'OCR結果を取引候補にするには、設定で有効な現金口座を追加してください。画像はこの端末に残っています。' })
      return
    }
    setBusyArtifactId(item.artifactId); setNotice({ kind: 'status', text: 'この端末で画像をOCRしています。台帳にはまだ反映しません。' })
    try {
      const result = await platformClient.ocrMobileCapture(householdId, item.artifactId)
      setItems((current) => upsert(current, result.item))
      const normalized = await buildReceiptImport(result.document, {
        householdId, filename: item.originalFilename, mediaType: item.mediaType, byteSize: item.byteSize,
        sha256: item.sourceSha256, sourceModifiedAt: item.capturedAt, accountId: cashAccount.id, sourceType: 'CAMERA_SCAN',
        audienceVisibility: item.audienceVisibility, audienceMemberId: item.audienceMemberId,
        attributionKind: item.audienceVisibility === 'PERSONAL' ? 'MEMBER' : 'HOUSEHOLD',
        attributedMemberId: item.audienceVisibility === 'PERSONAL' ? item.audienceMemberId : null,
      }, () => globalThis.crypto.randomUUID(), sha256Text)
      if (!normalized.request) {
        const marked = await platformClient.markMobileCaptureOcrReviewRequired(householdId, item.artifactId)
        setItems((current) => upsert(current, marked))
        setNotice({ kind: 'error', text: normalized.fields.issues.includes('STATEMENT_LIKELY')
          ? '明細書の可能性があるため、1件の支出候補にはしませんでした。原本画像はこの端末に残っています。'
          : '日付または合計金額を読み取れませんでした。原本画像はこの端末に残り、台帳は変更されていません。' })
        return
      }
      const promoted = await platformClient.promoteMobileCapture({ householdId, artifactId: item.artifactId, extractionId: result.extractionId, import: normalized.request })
      setItems((current) => upsert(current, promoted.item)); setPreview(null); onChanged()
      setNotice({ kind: 'status', text: promoted.reusedExisting
        ? '同じ画像の既存の確認待ちを表示できます。新しい支出候補は作成していません。'
        : 'OCR結果をImport Inboxの確認待ちに追加しました。台帳へは自動反映していません。' })
    } catch {
      setNotice({ kind: 'error', text: '画像をOCRして確認待ちへ追加できませんでした。原本画像はこの端末に残り、台帳は変更されていません。' })
      await loadLocal()
    } finally { setBusyArtifactId(null) }
  }

  return <CaptureInboxPage householdId={householdId} items={items} loading={loading} busyArtifactId={busyArtifactId} token={token} preview={preview} previewBusy={previewBusy} notice={notice}
    onTokenChange={setToken} onPreview={(item) => void openPreview(item)} onClosePreview={() => setPreview(null)} onRefresh={() => void receive()} onProcess={(item) => void process(item)} onOpenImport={onOpenImport} onRetry={(item) => void process(item)} />
}
