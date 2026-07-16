import { useCallback, useEffect, useRef, useState } from 'react'
import { buildReceiptImport } from '../import/receiptText'
import { sha256Text } from '../import/importService'
import { platformClient } from '../../platform'
import type { AccountDto, MobileCaptureBackgroundStatusDto, MobileCaptureImagePreviewDto, MobileCaptureInboxItemDto, WatchedFolderDto } from '../../platform'
import { CaptureInboxPage } from './CaptureInboxPage'
import { downloadRemoteMobileCapture, listRemoteMobileCaptures, MobileCaptureHttpError } from './mobileCaptureHttp'
import { showToast } from '../../toast'

interface Props {
  readonly householdId: string | null
  readonly accounts: readonly AccountDto[]
  readonly onOpenImport: () => void
  readonly onChanged: () => void
  readonly onInboxCountChanged?: (count: number) => void
}

type Notice = { readonly kind: 'status' | 'error'; readonly text: string } | null

function upsert(items: readonly MobileCaptureInboxItemDto[], next: MobileCaptureInboxItemDto): readonly MobileCaptureInboxItemDto[] {
  return [next, ...items.filter((item) => item.artifactId !== next.artifactId)]
}

export function CaptureInboxWorkspace({ householdId, accounts, onOpenImport, onChanged, onInboxCountChanged }: Props) {
  const [items, setItems] = useState<readonly MobileCaptureInboxItemDto[]>([])
  const [loading, setLoading] = useState(false)
  const [localBusy, setLocalBusy] = useState(false)
  const [localPendingFiles, setLocalPendingFiles] = useState<readonly string[]>([])
  const [ocrProgress, setOcrProgress] = useState<Record<string, number>>({})
  const [ocrConfidence, setOcrConfidence] = useState<Record<string, number>>({})
  const [watchedFolder, setWatchedFolder] = useState<WatchedFolderDto | null>(null)
  const [busyArtifactId, setBusyArtifactId] = useState<string | null>(null)
  const [token, setToken] = useState('')
  const [background, setBackground] = useState<MobileCaptureBackgroundStatusDto | null>(null)
  const [backgroundInterval, setBackgroundInterval] = useState<15 | 30 | 60>(30)
  const [backgroundBusy, setBackgroundBusy] = useState(false)
  const [preview, setPreview] = useState<{ readonly item: MobileCaptureInboxItemDto; readonly image: MobileCaptureImagePreviewDto } | null>(null)
  const [previewBusy, setPreviewBusy] = useState(false)
  const [notice, setNotice] = useState<Notice>(null)
  const request = useRef(0)
  const cashAccount = accounts.find((account) => account.accountKind === 'ASSET' && account.accountSubtype === 'CASH')
  useEffect(() => {
    onInboxCountChanged?.(items.filter((item) => ['RECEIVED', 'OCR_READY', 'OCR_REVIEW_REQUIRED', 'FAILED_RETRYABLE'].includes(item.state)).length)
  }, [items, onInboxCountChanged])

  const loadLocal = useCallback(async () => {
    const current = ++request.current
    if (!householdId || platformClient.runtime !== 'tauri') { setItems([]); return }
    setLoading(true)
    try {
      const next = await platformClient.listMobileCaptureInbox(householdId)
      if (current === request.current) setItems(next)
      const folders = await platformClient.listWatchedFolders(householdId)
      if (current === request.current) setWatchedFolder(folders.find((folder) => folder.label === 'レシート Inbox') ?? null)
    } catch {
      if (current === request.current) setNotice({ kind: 'error', text: '撮影 Inboxを読み込めませんでした。接続を確認してもう一度お試しください。' })
    } finally { if (current === request.current) setLoading(false) }
  }, [householdId])

  const loadBackground = useCallback(async () => {
    if (!householdId || platformClient.runtime !== 'tauri') { setBackground(null); return }
    try {
      const next = await platformClient.getMobileCaptureBackgroundStatus(householdId)
      setBackground(next)
      setBackgroundInterval(next.intervalMinutes as 15 | 30 | 60)
    } catch { setBackground(null) }
  }, [householdId])

  useEffect(() => { setItems([]); setNotice(null); setBusyArtifactId(null); setToken(''); setPreview(null); setWatchedFolder(null); setLocalPendingFiles([]); setOcrProgress({}); setOcrConfidence({}); void loadLocal(); void loadBackground() }, [loadBackground, loadLocal])
  useEffect(() => {
    if (!background?.enabled) return
    const timer = globalThis.setInterval(() => { void loadBackground(); void loadLocal() }, 15_000)
    return () => globalThis.clearInterval(timer)
  }, [background?.enabled, loadBackground, loadLocal])

  const enableBackground = async () => {
    if (!householdId || !token || backgroundBusy) return
    setBackgroundBusy(true); setNotice(null)
    try {
      const next = await platformClient.enableMobileCaptureBackground({ householdId, token, intervalMinutes: backgroundInterval })
      setBackground(next); setToken('')
      setNotice({ kind: 'status', text: 'KakeFlowを開いている間の自動受信を有効にしました。画像の保存だけを行い、OCRや台帳反映は行いません。' })
    } catch { setNotice({ kind: 'error', text: '自動受信を有効にできませんでした。接続トークンと家族スペースを確認してください。' }) }
    finally { setBackgroundBusy(false) }
  }

  const disableBackground = async () => {
    if (!householdId || backgroundBusy) return
    setBackgroundBusy(true); setNotice(null)
    try {
      setBackground(await platformClient.disableMobileCaptureBackground(householdId))
      setNotice({ kind: 'status', text: '自動受信を停止しました。受信済みの原本画像は削除していません。' })
    } catch { setNotice({ kind: 'error', text: '自動受信を停止できませんでした。もう一度お試しください。' }) }
    finally { setBackgroundBusy(false) }
  }

  const runBackgroundNow = async () => {
    if (!householdId || backgroundBusy) return
    setBackgroundBusy(true); setNotice({ kind: 'status', text: '原本画像を確認しています。OCRと台帳反映は行いません。' })
    try {
      const next = await platformClient.runMobileCaptureBackgroundNow(householdId)
      setBackground(next); await loadLocal()
      setNotice({ kind: 'status', text: next.lastIngestedCount ? `${next.lastIngestedCount}件の原本画像を保存しました。OCRはまだ行っていません。` : '新しい原本画像はありません。' })
    } catch { await loadBackground(); setNotice({ kind: 'error', text: '自動受信を完了できませんでした。状態を確認して再試行してください。' }) }
    finally { setBackgroundBusy(false) }
  }

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
    const promoteOnly = item.state === 'OCR_READY'
    setBusyArtifactId(item.artifactId); setOcrProgress((current) => ({ ...current, [item.artifactId]: promoteOnly ? 100 : 10 })); setNotice({ kind: 'status', text: promoteOnly ? 'OCR結果をImport Inboxの確認待ちへ昇格しています。' : 'この端末で原本をOCRしています。台帳にはまだ反映しません。' })
    try {
      const result = await platformClient.ocrMobileCapture(householdId, item.artifactId)
      setOcrProgress((current) => ({ ...current, [item.artifactId]: 75 }))
      setOcrConfidence((current) => ({ ...current, [item.artifactId]: result.document.confidenceBps }))
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
      if (!promoteOnly) {
        setPreview(null)
        setNotice({ kind: result.document.confidenceBps < 7_500 ? 'error' : 'status', text: result.document.confidenceBps < 7_500
          ? `OCRが完了しました（信頼度 ${Math.round(result.document.confidenceBps / 100)}%）。内容を確認してから昇格してください。`
          : `OCRが完了しました（信頼度 ${Math.round(result.document.confidenceBps / 100)}%）。台帳には未反映です。` })
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
    } finally { setBusyArtifactId(null); setOcrProgress((current) => { const next = { ...current }; delete next[item.artifactId]; return next }) }
  }

  const discard = async (item: MobileCaptureInboxItemDto) => {
    if (!householdId || busyArtifactId) return
    setBusyArtifactId(item.artifactId); setNotice(null)
    try {
      await platformClient.discardMobileCapture(householdId, item.artifactId)
      setItems((current) => current.filter((candidate) => candidate.artifactId !== item.artifactId))
      setPreview((current) => current?.item.artifactId === item.artifactId ? null : current)
      setNotice({ kind: 'status', text: '撮影 Inboxから破棄しました。暗号化原本の監査記録は変更していません。' })
      showToast('レシート原本を撮影 Inboxから破棄しました。')
    } catch { setNotice({ kind: 'error', text: 'この原本を破棄できませんでした。状態を更新してもう一度お試しください。' }) }
    finally { setBusyArtifactId(null) }
  }

  const ingestLocalFiles = async (files: readonly File[], sourceKind: 'LOCAL' | 'WATCHED_FOLDER' = 'LOCAL') => {
    if (!householdId || localBusy) return
    const supported = files.filter((file) => ['image/png', 'image/jpeg', 'application/pdf'].includes(file.type) || /\.(?:png|jpe?g|pdf)$/i.test(file.name))
    if (supported.length === 0) { setNotice({ kind: 'error', text: 'JPEG、PNG、またはPDFのレシート原本を選択してください。' }); return }
    setLocalPendingFiles((current) => [...current, ...supported.map((file) => file.name)])
    setLocalBusy(true); setNotice({ kind: 'status', text: `${supported.length}件の原本をこの端末へ保存しています。台帳には反映しません。` })
    let stored = 0; let duplicates = 0; let failed = files.length - supported.length
    for (const file of supported) {
      if (file.size <= 0 || file.size > 25 * 1024 * 1024) { failed += 1; setLocalPendingFiles((current) => current.filter((name) => name !== file.name)); continue }
      try {
        const artifactId = globalThis.crypto.randomUUID()
        const mediaType = file.type === 'application/pdf' || /\.pdf$/i.test(file.name) ? 'application/pdf' as const : file.type === 'image/png' || /\.png$/i.test(file.name) ? 'image/png' as const : 'image/jpeg' as const
        const item = await platformClient.ingestLocalCapture({
          householdId, artifactId, captureId: artifactId, originalFilename: file.name,
          mediaType,
          capturedAt: Number.isFinite(file.lastModified) ? new Date(file.lastModified).toISOString() : null,
          audienceVisibility: 'SHARED', audienceMemberId: null, sourceKind,
          fileBytes: Array.from(new Uint8Array(await file.arrayBuffer())),
        })
        if (item.artifactId === artifactId) stored += 1; else duplicates += 1
        setItems((current) => upsert(current, item))
      } catch { failed += 1 }
      finally { setLocalPendingFiles((current) => { const index = current.indexOf(file.name); return index < 0 ? current : [...current.slice(0, index), ...current.slice(index + 1)] }) }
    }
    setNotice({ kind: failed > 0 ? 'error' : 'status', text: `${stored}件を撮影 Inboxへ保存しました${duplicates ? `（${duplicates}件は保存済み）` : ''}${failed ? `。${failed}件は形式またはサイズを確認してください` : '。OCRと台帳反映はまだ行っていません。'}` })
    showToast(`${stored}件の原本画像を保存しました。`, failed ? 'info' : 'success')
    setLocalBusy(false)
  }

  const configureWatchedFolder = async () => {
    if (!householdId || localBusy) return
    setLocalBusy(true); setNotice(null)
    try {
      const selected = await platformClient.selectWatchedFolder(householdId, 'レシート Inbox')
      if (!selected) { setNotice({ kind: 'status', text: '監視フォルダの設定をキャンセルしました。' }); return }
      setWatchedFolder(selected)
      const scan = await platformClient.scanWatchedFolder(householdId, selected.id)
      const files: File[] = []
      for (const metadata of scan.files.filter((file) => ['image/png', 'image/jpeg', 'application/pdf'].includes(file.mediaType)).slice(0, 100)) {
        const loaded = await platformClient.readWatchedFile(householdId, selected.id, metadata.relativePath)
        files.push(new File([new Uint8Array(loaded.fileBytes)], loaded.fileName, { type: loaded.mediaType, lastModified: loaded.modifiedUnixMs ?? Date.now() }))
      }
      setLocalBusy(false)
      if (files.length > 0) await ingestLocalFiles(files, 'WATCHED_FOLDER')
      else setNotice({ kind: 'status', text: `${selected.label} を監視対象に追加しました。新しいレシート原本は撮影 Inboxへ届きます。` })
    } catch { setNotice({ kind: 'error', text: '監視フォルダを設定できませんでした。フォルダのアクセス権を確認してください。' }) }
    finally { setLocalBusy(false) }
  }

  useEffect(() => {
    if (!householdId || !watchedFolder || platformClient.runtime !== 'tauri') return
    let active = true
    const sync = async () => {
      if (!active || localBusy) return
      try {
        const scan = await platformClient.scanWatchedFolder(householdId, watchedFolder.id)
        const files: File[] = []
        for (const metadata of scan.files.filter((file) => ['image/png', 'image/jpeg', 'application/pdf'].includes(file.mediaType)).slice(0, 100)) {
          const loaded = await platformClient.readWatchedFile(householdId, watchedFolder.id, metadata.relativePath)
          files.push(new File([new Uint8Array(loaded.fileBytes)], loaded.fileName, { type: loaded.mediaType, lastModified: loaded.modifiedUnixMs ?? Date.now() }))
        }
        if (active && files.length > 0) await ingestLocalFiles(files, 'WATCHED_FOLDER')
      } catch { /* the manual folder action reports access errors */ }
    }
    void sync()
    const timer = globalThis.setInterval(() => { void sync() }, 30_000)
    return () => { active = false; globalThis.clearInterval(timer) }
    // The scanner intentionally follows the selected durable folder identity.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [householdId, watchedFolder?.id])

  return <CaptureInboxPage householdId={householdId} items={items} loading={loading} busyArtifactId={busyArtifactId} token={token} preview={preview} previewBusy={previewBusy} notice={notice}
    showConnectorControls={false}
    background={background} backgroundInterval={backgroundInterval} backgroundBusy={backgroundBusy}
    onBackgroundIntervalChange={setBackgroundInterval} onEnableBackground={() => void enableBackground()} onDisableBackground={() => void disableBackground()} onRunBackgroundNow={() => void runBackgroundNow()}
    onTokenChange={setToken} onPreview={(item) => void openPreview(item)} onClosePreview={() => setPreview(null)} onRefresh={() => void receive()} onProcess={(item) => void process(item)} onOpenImport={onOpenImport} onRetry={(item) => void process(item)} onDiscard={(item) => void discard(item)}
    localBusy={localBusy} localPendingFiles={localPendingFiles} ocrProgress={ocrProgress} ocrConfidence={ocrConfidence} watchedFolderPath={watchedFolder?.displayName ?? null} onLocalFiles={(files) => void ingestLocalFiles(files)} onConfigureWatchedFolder={() => void configureWatchedFolder()} />
}
