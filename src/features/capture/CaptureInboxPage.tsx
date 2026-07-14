import { useEffect, useMemo, useRef } from 'react'
import type { KeyboardEvent } from 'react'
import { Camera, FileImage, RefreshCw, RotateCcw, ScanLine, X } from 'lucide-react'
import type { MobileCaptureImagePreviewDto, MobileCaptureInboxItemDto, MobileCaptureInboxStateDto } from '../../platform'
import './CaptureInboxPage.css'

export interface CaptureInboxPageProps {
  readonly householdId: string | null
  readonly items: readonly MobileCaptureInboxItemDto[]
  readonly loading: boolean
  readonly busyArtifactId: string | null
  readonly token: string
  readonly preview: { readonly item: MobileCaptureInboxItemDto; readonly image: MobileCaptureImagePreviewDto } | null
  readonly previewBusy: boolean
  readonly notice: { readonly kind: 'status' | 'error'; readonly text: string } | null
  readonly onTokenChange: (token: string) => void
  readonly onPreview: (item: MobileCaptureInboxItemDto) => void
  readonly onClosePreview: () => void
  readonly onRefresh: () => void
  readonly onProcess: (item: MobileCaptureInboxItemDto) => void
  readonly onOpenImport: () => void
  readonly onRetry: (item: MobileCaptureInboxItemDto) => void
}

const stateLabels: Record<MobileCaptureInboxStateDto, string> = {
  RECEIVED: 'OCR待ち',
  OCR_READY: '読み取り完了',
  OCR_REVIEW_REQUIRED: '読み取り結果の確認が必要',
  PROMOTED: 'Import Inboxで確認待ち',
  DUPLICATE: '受信済み',
  REJECTED_INVALID: '受信不可',
  FAILED_RETRYABLE: '再試行できます',
}

const dateTime = (value: string | null): string => {
  if (!value) return '撮影日時なし'
  const parsed = new Date(value)
  if (Number.isNaN(parsed.getTime())) return '撮影日時なし'
  return new Intl.DateTimeFormat('ja-JP', { dateStyle: 'medium', timeStyle: 'short' }).format(parsed)
}

const size = (bytes: number): string => bytes >= 1024 * 1024
  ? `${(bytes / (1024 * 1024)).toFixed(1)} MB`
  : `${Math.max(1, Math.ceil(bytes / 1024))} KB`

function actionFor(item: MobileCaptureInboxItemDto): 'PROCESS' | 'IMPORT' | 'RETRY' | null {
  if (item.state === 'RECEIVED' || item.state === 'OCR_READY' || item.state === 'OCR_REVIEW_REQUIRED') return 'PROCESS'
  if (item.state === 'PROMOTED' || (item.state === 'DUPLICATE' && item.localRunId)) return 'IMPORT'
  if (item.state === 'FAILED_RETRYABLE') return 'RETRY'
  return null
}

function StateAction({ item, busy, onPreview, onOpenImport, onRetry }: {
  readonly item: MobileCaptureInboxItemDto
  readonly busy: boolean
  readonly onPreview: CaptureInboxPageProps['onPreview']
  readonly onOpenImport: CaptureInboxPageProps['onOpenImport']
  readonly onRetry: CaptureInboxPageProps['onRetry']
}) {
  const action = actionFor(item)
  if (action === 'PROCESS') return <button className="primary-btn" disabled={busy} onClick={() => onPreview(item)}><FileImage size={16} />{busy ? '原本を読込中…' : '原本画像を確認'}</button>
  if (action === 'IMPORT') return <button className="secondary-btn" disabled={busy} onClick={onOpenImport}>取引候補を確認</button>
  if (action === 'RETRY') return <button className="secondary-btn" disabled={busy} onClick={() => onRetry(item)}><RotateCcw size={16} />{busy ? '再試行中…' : 'もう一度読み取る'}</button>
  return null
}

export function CaptureInboxPage({ householdId, items, loading, busyArtifactId, token, preview, previewBusy, notice, onTokenChange, onPreview, onClosePreview, onRefresh, onProcess, onOpenImport, onRetry }: CaptureInboxPageProps) {
  const heading = useRef<HTMLHeadingElement>(null)
  const returnFocus = useRef<HTMLElement | null>(null)
  useEffect(() => { heading.current?.focus() }, [])
  const openPreview = (item: MobileCaptureInboxItemDto) => { returnFocus.current = document.activeElement instanceof HTMLElement ? document.activeElement : null; onPreview(item) }
  const closePreview = () => { onClosePreview(); globalThis.setTimeout(() => returnFocus.current?.focus(), 0) }
  const counts = useMemo(() => ({
    unreviewed: items.filter((item) => item.state === 'RECEIVED').length,
    ocrReady: items.filter((item) => item.state === 'OCR_READY' || item.state === 'OCR_REVIEW_REQUIRED').length,
    review: items.filter((item) => item.state === 'PROMOTED').length,
    unavailable: items.filter((item) => item.state === 'REJECTED_INVALID' || item.state === 'FAILED_RETRYABLE').length,
  }), [items])
  return <>
    <header className="page-header capture-page-header">
      <div><p>レシート受信</p><h1 ref={heading} tabIndex={-1}>撮影 Inbox</h1><span>スマートフォンから届いた画像を、この端末で確認・OCRして取引候補にします。</span></div>
    </header>
    <p className="capture-boundary">スマートフォンから画像を受信しても、台帳には反映されません。この端末で原本を確認し、OCR結果を承認するか、既存取引へ証憑として紐付けてください。</p>
    <section className="panel capture-receive-controls" aria-label="モバイルからの受信">
      <label>接続トークン（この画面のみ）<input type="password" autoComplete="off" value={token} disabled={loading} onChange={(event) => onTokenChange(event.target.value)} /></label>
      <button className="secondary-btn" disabled={!householdId || !token || loading} onClick={onRefresh}><RefreshCw size={17} />{loading ? '確認中…' : '受信を確認'}</button>
      <p>トークンは保存しません。受信した画像はこの端末へ保存されますが、OCRと台帳への承認は別の操作です。</p>
    </section>
    <section className="capture-status-grid" aria-label="撮影 Inboxの状態">
      <article><strong>{counts.unreviewed}</strong><span>OCR待ち</span><small>原本を保存済み</small></article>
      <article><strong>{counts.ocrReady}</strong><span>読み取り済み</span><small>台帳には未反映</small></article>
      <article><strong>{counts.review}</strong><span>確認待ち</span><small>Import Inboxで承認</small></article>
      <article><strong>{counts.unavailable}</strong><span>処理できない</span><small>原本または接続を確認</small></article>
    </section>
    {notice && <p className={notice.kind === 'error' ? 'capture-notice error' : 'capture-notice'} role={notice.kind === 'error' ? 'alert' : 'status'} aria-live={notice.kind === 'error' ? 'assertive' : 'polite'}>{notice.text}</p>}
    <section className="panel capture-inbox-panel" aria-busy={loading || Boolean(busyArtifactId)}>
      <div className="panel-head"><div><h2>届いたレシート</h2><p>受信、OCR、確認待ちはそれぞれ別の状態です。</p></div><span className="capture-local-badge"><Camera size={15} /> 自動反映なし</span></div>
      {!householdId ? <p className="empty-state">先に家族スペースを選択してください。</p> : items.length === 0 ? <div className="capture-empty"><FileImage size={36} /><h3>届いた画像はありません</h3><p>モバイルのレシート送信画面から送ったJPEGまたはPNGが、ここに表示されます。</p></div> : <div className="capture-list">{items.map((item) => {
        const busy = busyArtifactId === item.artifactId
        const invalid = item.state === 'REJECTED_INVALID'
        const duplicate = item.state === 'DUPLICATE'
        return <article className={`capture-row state-${item.state}`} key={item.artifactId}>
          <div className="capture-thumb" aria-hidden="true"><FileImage size={23} /></div>
          <div className="capture-copy"><strong>{item.originalFilename}</strong><span>{item.senderMemberName ? `${item.senderMemberName}さんから` : '家族メンバーから'}・{dateTime(item.capturedAt)}</span><small>{item.audienceVisibility === 'SHARED' ? '世帯共有' : `個人・${item.audienceMemberName ?? item.senderMemberName ?? '本人'}`} ・ {size(item.byteSize)} ・ 受信 {dateTime(item.receivedAt)}</small>
            {duplicate && <small className="capture-explanation">同じ画像はすでに受信済みです。新しい支出候補は作成していません。</small>}
            {invalid && <small className="capture-explanation error">画像の内容を検証できなかったため受信しませんでした。台帳と確認待ちは変更されていません。</small>}
            {item.receivedBeforeSenderRevocation && <small className="capture-explanation warning">配信停止前に送信済みの画像です。送信者の配信は現在停止されています。</small>}
            {item.lastErrorCode && !invalid && <small className="capture-explanation error">処理を完了できませんでした（{item.lastErrorCode}）。台帳は変更されていません。</small>}
          </div>
          <span className={`capture-state state-${item.state}`}>{stateLabels[item.state]}</span>
          <StateAction item={item} busy={busy || previewBusy} onPreview={openPreview} onOpenImport={onOpenImport} onRetry={onRetry} />
        </article>
      })}</div>}
    </section>
    {preview && <CaptureImageDialog preview={preview} busy={busyArtifactId === preview.item.artifactId} onClose={closePreview} onProcess={() => onProcess(preview.item)} />}
  </>
}

function CaptureImageDialog({ preview, busy, onClose, onProcess }: { readonly preview: NonNullable<CaptureInboxPageProps['preview']>; readonly busy: boolean; readonly onClose: () => void; readonly onProcess: () => void }) {
  const heading = useRef<HTMLHeadingElement>(null)
  useEffect(() => { heading.current?.focus() }, [])
  const handleKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    if (event.key === 'Escape' && !busy) { event.preventDefault(); onClose(); return }
    if (event.key !== 'Tab') return
    const controls = Array.from(event.currentTarget.querySelectorAll<HTMLElement>('button:not(:disabled), [tabindex="0"]'))
    if (controls.length === 0) return
    const first = controls[0]; const last = controls[controls.length - 1]
    if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last.focus() }
    else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus() }
  }
  return <div className="capture-dialog-backdrop" onMouseDown={(event) => { if (event.target === event.currentTarget && !busy) onClose() }} onKeyDown={handleKeyDown}>
    <section className="capture-dialog" role="dialog" aria-modal="true" aria-labelledby="capture-dialog-title">
      <div className="capture-dialog-head"><div><p>受信した原本</p><h2 id="capture-dialog-title" ref={heading} tabIndex={-1}>{preview.image.filename}</h2></div><button className="icon-btn" aria-label="原本画像を閉じる" disabled={busy} onClick={onClose}><X size={18} /></button></div>
      <img src={preview.image.dataUrl} alt={`${preview.item.senderMemberName ?? '家族メンバー'}さんが${dateTime(preview.item.capturedAt)}に撮影したレシート`} />
      <p className="capture-dialog-boundary">この画像をOCRしても台帳には反映されません。結果はImport Inboxの確認待ちに追加され、承認または既存取引への証憑紐付けが必要です。</p>
      <div className="capture-dialog-actions"><button className="secondary-btn" disabled={busy} onClick={onClose}>閉じる</button><button className="primary-btn" disabled={busy} onClick={onProcess}><ScanLine size={16} />{busy ? '読み取り中…' : 'この画像をOCR'}</button></div>
    </section>
  </div>
}
