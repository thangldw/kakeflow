import { useEffect, useMemo, useRef, useState } from 'react'
import type { KeyboardEvent } from 'react'
import { Camera, FileImage, RefreshCw, RotateCcw, ScanLine, X } from 'lucide-react'
import type { MobileCaptureBackgroundStatusDto, MobileCaptureImagePreviewDto, MobileCaptureInboxItemDto, MobileCaptureInboxStateDto } from '../../platform'
import './CaptureInboxPage.css'
import { localize } from '../../i18n'

export interface CaptureInboxPageProps {
  readonly householdId: string | null
  readonly items: readonly MobileCaptureInboxItemDto[]
  readonly loading: boolean
  readonly busyArtifactId: string | null
  readonly token: string
  readonly preview: { readonly item: MobileCaptureInboxItemDto; readonly image: MobileCaptureImagePreviewDto } | null
  readonly previewBusy: boolean
  readonly notice: { readonly kind: 'status' | 'error'; readonly text: string } | null
  readonly background?: MobileCaptureBackgroundStatusDto | null
  readonly backgroundInterval?: 15 | 30 | 60
  readonly backgroundBusy?: boolean
  readonly showConnectorControls?: boolean
  readonly onBackgroundIntervalChange?: (interval: 15 | 30 | 60) => void
  readonly onEnableBackground?: () => void
  readonly onDisableBackground?: () => void
  readonly onRunBackgroundNow?: () => void
  readonly onTokenChange: (token: string) => void
  readonly onPreview: (item: MobileCaptureInboxItemDto) => void
  readonly onClosePreview: () => void
  readonly onRefresh: () => void
  readonly onProcess: (item: MobileCaptureInboxItemDto) => void
  readonly onOpenImport: () => void
  readonly onRetry: (item: MobileCaptureInboxItemDto) => void
  readonly onDiscard?: (item: MobileCaptureInboxItemDto) => void
  readonly localBusy?: boolean
  readonly localPendingFiles?: readonly string[]
  readonly ocrProgress?: Readonly<Record<string, number>>
  readonly ocrConfidence?: Readonly<Record<string, number>>
  readonly watchedFolderPath?: string | null
  readonly onLocalFiles?: (files: readonly File[]) => void
  readonly onConfigureWatchedFolder?: () => void
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
  if (!value) return localize("撮影日時なし")
  const parsed = new Date(value)
  if (Number.isNaN(parsed.getTime())) return localize("撮影日時なし")
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

function StateAction({ item, busy, onPreview, onOpenImport, onRetry, onDiscard }: {
  readonly item: MobileCaptureInboxItemDto
  readonly busy: boolean
  readonly onPreview: CaptureInboxPageProps['onPreview']
  readonly onOpenImport: CaptureInboxPageProps['onOpenImport']
  readonly onRetry: CaptureInboxPageProps['onRetry']
  readonly onDiscard: NonNullable<CaptureInboxPageProps['onDiscard']>
}) {
  const action = actionFor(item)
  if (action === 'PROCESS') return <div className="capture-row-actions"><button className="primary-btn" disabled={busy} onClick={() => onPreview(item)}><FileImage size={16} />{busy ? localize("原本を読込中…") : localize("原本画像を確認")}</button><button className="text-btn capture-discard" disabled={busy} onClick={() => onDiscard(item)}>{localize("破棄")}</button></div>
  if (action === 'IMPORT') return <button className="secondary-btn" disabled={busy} onClick={onOpenImport}>{localize("取引候補を確認")}</button>
  if (action === 'RETRY') return <div className="capture-row-actions"><button className="secondary-btn" disabled={busy} onClick={() => onRetry(item)}><RotateCcw size={16} />{busy ? localize("再試行中…") : localize("もう一度読み取る")}</button><button className="text-btn capture-discard" disabled={busy} onClick={() => onDiscard(item)}>{localize("破棄")}</button></div>
  return null
}

export function CaptureInboxPage({ householdId, items, loading, busyArtifactId, token, preview, previewBusy, notice, background = null, backgroundInterval = 30, backgroundBusy = false, showConnectorControls = true, onBackgroundIntervalChange = () => undefined, onEnableBackground = () => undefined, onDisableBackground = () => undefined, onRunBackgroundNow = () => undefined, onTokenChange, onPreview, onClosePreview, onRefresh, onProcess, onOpenImport, onRetry, onDiscard = () => undefined, localBusy = false, localPendingFiles = [], ocrProgress = {}, ocrConfidence = {}, watchedFolderPath = null, onLocalFiles = () => undefined, onConfigureWatchedFolder = () => undefined }: CaptureInboxPageProps) {
  const heading = useRef<HTMLHeadingElement>(null)
  const returnFocus = useRef<HTMLElement | null>(null)
  const localInput = useRef<HTMLInputElement>(null)
  const [dragging, setDragging] = useState(false)
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
      <div><p>{localize("レシート受信")}</p><h1 ref={heading} tabIndex={-1}>{localize("撮影 Inbox")}</h1><span>{localize("スマートフォンから届いた画像を、この端末で確認・OCRして取引候補にします。")}</span></div>
    </header>
    <section className={`capture-local-intake${dragging ? ' is-dragging' : ''}`} aria-label={localize("ローカルレシート取り込み")} onDragEnter={(event) => { event.preventDefault(); setDragging(true) }} onDragOver={(event) => { event.preventDefault(); event.dataTransfer.dropEffect = 'copy' }} onDragLeave={(event) => { if (!event.currentTarget.contains(event.relatedTarget as Node | null)) setDragging(false) }} onDrop={(event) => { event.preventDefault(); setDragging(false); onLocalFiles(Array.from(event.dataTransfer.files)) }}>
      <FileImage size={24} aria-hidden="true" />
      <div><strong>{localize("レシート画像をここにドラッグ＆ドロップ")}</strong><span>{localize("JPEG / PNG / PDF · 原本は暗号化してこの端末だけに保存されます")}</span></div>
      <button className="primary-btn" type="button" disabled={!householdId || localBusy} onClick={() => localInput.current?.click()}>{localBusy ? localize("保存中…") : localize("ファイルを選択…")}</button>
      <input ref={localInput} className="visually-hidden" aria-label={localize("撮影 Inboxへ追加するレシート画像")} type="file" accept="image/png,image/jpeg,application/pdf,.png,.jpg,.jpeg,.pdf" multiple onChange={(event) => { const files = Array.from(event.currentTarget.files ?? []); event.currentTarget.value = ''; onLocalFiles(files) }} />
      <button className="secondary-btn" type="button" disabled={!householdId || localBusy} onClick={onConfigureWatchedFolder}>{localize("監視フォルダを設定…")}</button>
      <small>{watchedFolderPath ? localize(`監視中: ${watchedFolderPath}`) : localize("監視フォルダは未設定")} {localize("・ 明細書CSVは")} <button type="button" className="text-btn" onClick={onOpenImport}>Import Inbox</button></small>
    </section>
    <p className="capture-boundary">{localize("画像を受信しても、台帳には反映されません。原本とOCRの抽出結果を確認してからImport Inboxへ昇格します。")}</p>
    {showConnectorControls && <section className="panel capture-receive-controls" aria-label={localize("モバイルからの受信")}>
      <label>{localize("接続トークン")}<input type="password" autoComplete="off" value={token} disabled={loading} onChange={(event) => onTokenChange(event.target.value)} /></label>
      <button className="secondary-btn" disabled={!householdId || !token || loading || Boolean(background?.enabled)} onClick={onRefresh}><RefreshCw size={17} />{loading ? localize("確認中…") : localize("受信を確認")}</button>
      <p>{background?.enabled ? localize("自動受信が有効です。「今すぐ確認」を使うと、同じネイティブ受信処理を実行できます。") : localize("手動確認ではトークンを保存しません。自動受信を有効にした場合だけ、デスクトップの接続資格情報として保存します。")} {localize("受信した画像はこの端末へ保存されますが、OCRと台帳への承認は別の操作です。")}</p>
    </section>}
    {showConnectorControls && <section className="panel capture-background-controls" aria-label={localize("原本画像の自動受信")}>
      <div>
        <h2>{localize("アプリ起動中の自動受信")}</h2>
        <p>{localize("KakeFlowを開いている間だけ定期確認し、検証済みの原本画像を撮影 Inboxへ保存します。OCR、分類、取引照合、台帳反映は自動実行しません。")}</p>
      </div>
      <label>{localize("確認間隔")}
        <select value={backgroundInterval} disabled={backgroundBusy || background?.enabled} onChange={(event) => onBackgroundIntervalChange(Number(event.target.value) as 15 | 30 | 60)}>
          <option value={15}>{localize("15分")}</option><option value={30}>{localize("30分")}</option><option value={60}>{localize("60分")}</option>
        </select>
      </label>
      {background?.enabled
        ? background.lastResult === 'TERMINAL_SUSPENDED'
          ? <><button className="primary-btn" disabled={!token || backgroundBusy} onClick={onEnableBackground}>{localize("接続を更新")}</button><button className="secondary-btn" disabled={backgroundBusy} onClick={onDisableBackground}>{localize("自動受信を停止")}</button></>
          : <><button className="secondary-btn" disabled={backgroundBusy || background.running} onClick={onRunBackgroundNow}><RefreshCw size={17} />{background.running ? localize("受信中…") : localize("今すぐ確認")}</button><button className="secondary-btn" disabled={backgroundBusy || background.running} onClick={onDisableBackground}>{localize("自動受信を停止")}</button></>
        : <button className="primary-btn" disabled={!householdId || !token || backgroundBusy} onClick={onEnableBackground}>{localize("自動受信を有効にする")}</button>}
      <div className="capture-background-status" role="status">
        <strong>{background?.enabled ? localize("有効") : localize("無効")}</strong>
        {background?.lastSuccessAt && <span>{localize("最終成功")} {dateTime(background.lastSuccessAt)}{localize("・原本")} {background.lastIngestedCount}{localize("件")}</span>}
        {background?.enabled && background.nextDueAt && <span>{localize("次回")} {dateTime(background.nextDueAt)}</span>}
        {background?.lastResult === 'TERMINAL_SUSPENDED' && <span className="error">{localize("認証または家族メンバー状態を確認して、接続トークンを入力し直してください。")}</span>}
      </div>
    </section>}
    <section className="capture-status-grid" aria-label={localize("撮影 Inboxの状態")}>
      <article><strong>{counts.unreviewed}</strong><span>{localize("OCR待ち")}</span><small>{localize("原本を保存済み")}</small></article>
      <article><strong>{counts.ocrReady}</strong><span>{localize("読み取り済み")}</span><small>{localize("台帳には未反映")}</small></article>
      <article><strong>{counts.review}</strong><span>{localize("確認待ち")}</span><small>{localize("Import Inboxで承認")}</small></article>
      <article><strong>{counts.unavailable}</strong><span>{localize("処理できない")}</span><small>{localize("原本または接続を確認")}</small></article>
    </section>
    {notice && <p className={notice.kind === 'error' ? 'capture-notice error' : 'capture-notice'} role={notice.kind === 'error' ? 'alert' : 'status'} aria-live={notice.kind === 'error' ? 'assertive' : 'polite'}>{notice.text}</p>}
    <section className="panel capture-inbox-panel" aria-busy={loading || Boolean(busyArtifactId)}>
      <div className="panel-head"><div><h2>{localize("届いたレシート")}</h2><p>{localize("受信、OCR、確認待ちはそれぞれ別の状態です。")}</p></div><span className="capture-local-badge"><Camera size={15} /> {localize("自動反映なし")}</span></div>
      {!householdId ? <p className="empty-state">{localize("先に家族スペースを選択してください。")}</p> : items.length === 0 && localPendingFiles.length === 0 ? <div className="capture-empty"><FileImage size={36} /><h3>{localize("届いた原本はありません")}</h3><p>{localize("JPEG、PNG、PDFを追加するか、監視フォルダを設定してください。")}</p></div> : <div className="capture-list">{localPendingFiles.map((filename, index) => <article className="capture-row state-RECEIVED capture-row-pending" key={`${filename}:${index}`}><div className="capture-thumb" aria-hidden="true"><FileImage size={23} /></div><div className="capture-copy"><strong>{filename}</strong><span>{localize("この端末から追加")}</span><small>{localize("暗号化原本のSHA-256を計算しています")}</small></div><span className="capture-state">{localize("受信済み（ハッシュ計算中）")}</span></article>)}{items.map((item) => {
        const busy = busyArtifactId === item.artifactId
        const invalid = item.state === 'REJECTED_INVALID'
        const duplicate = item.state === 'DUPLICATE'
        return <article className={`capture-row state-${item.state}`} key={item.artifactId}>
          <div className="capture-thumb" aria-hidden="true"><FileImage size={23} /></div>
          <div className="capture-copy"><strong>{item.originalFilename}</strong><span>{item.senderMembershipId === 'watched-folder' ? localize("監視フォルダ") : item.senderMembershipId === 'local-desktop' ? localize("この端末から追加") : item.senderMemberName ? localize(`${item.senderMemberName}さんから`) : localize("モバイル転送")}・{dateTime(item.capturedAt)}</span><small>{item.audienceVisibility === 'SHARED' ? localize("世帯共有") : localize(`個人・${item.audienceMemberName ?? item.senderMemberName ?? localize("本人")}`)} ・ {size(item.byteSize)} {localize("・ 受信")} {dateTime(item.receivedAt)}{ocrConfidence[item.artifactId] != null ? ` ・ OCR ${Math.round(ocrConfidence[item.artifactId] / 100)}%` : ''}</small>
            {duplicate && <small className="capture-explanation">{localize("同じ画像はすでに受信済みです。新しい支出候補は作成していません。")}</small>}
            {invalid && <small className="capture-explanation error">{localize("画像の内容を検証できなかったため受信しませんでした。台帳と確認待ちは変更されていません。")}</small>}
            {item.receivedBeforeSenderRevocation && <small className="capture-explanation warning">{localize("配信停止前に送信済みの画像です。送信者の配信は現在停止されています。")}</small>}
            {item.lastErrorCode && !invalid && <small className="capture-explanation error">{localize("処理を完了できませんでした（")}{item.lastErrorCode}{localize("）。台帳は変更されていません。")}</small>}
          </div>
          <span className={`capture-state state-${item.state}`}>{ocrProgress[item.artifactId] != null ? localize(`OCR実行中 ${ocrProgress[item.artifactId]}%`) : localize(stateLabels[item.state])}</span>
          <StateAction item={item} busy={busy || previewBusy} onPreview={openPreview} onOpenImport={onOpenImport} onRetry={onRetry} onDiscard={onDiscard} />
        </article>
      })}</div>}
    </section>
    {preview && <CaptureImageDialog preview={preview} busy={busyArtifactId === preview.item.artifactId} onClose={closePreview} onProcess={() => onProcess(preview.item)} onDiscard={() => onDiscard(preview.item)} />}
  </>
}

function CaptureImageDialog({ preview, busy, onClose, onProcess, onDiscard }: { readonly preview: NonNullable<CaptureInboxPageProps['preview']>; readonly busy: boolean; readonly onClose: () => void; readonly onProcess: () => void; readonly onDiscard: () => void }) {
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
      <div className="capture-dialog-head"><div><p>{localize("受信した原本")}</p><h2 id="capture-dialog-title" ref={heading} tabIndex={-1}>{preview.image.filename}</h2></div><button className="icon-btn" aria-label={localize("原本画像を閉じる")} disabled={busy} onClick={onClose}><X size={18} /></button></div>
      <div className="capture-dialog-media">
        {preview.image.mediaType === 'application/pdf' ? <object className="capture-pdf-preview" data={preview.image.dataUrl} type="application/pdf" aria-label={localize(`${preview.image.filename}のPDFプレビュー`)}><p>{localize("PDFプレビューを表示できません。")}</p></object> : <img src={preview.image.dataUrl} alt={localize(`${preview.item.senderMemberName ?? localize("家族メンバー")}さんが${dateTime(preview.item.capturedAt)}に撮影したレシート`)} />}
      </div>
      <p className="capture-dialog-boundary">{localize("この画像をOCRしても台帳には反映されません。結果はImport Inboxの確認待ちに追加され、承認または既存取引への証憑紐付けが必要です。")}</p>
      <div className="capture-dialog-actions"><button className="text-btn capture-discard" disabled={busy} onClick={onDiscard}>{localize("破棄")}</button><button className="secondary-btn" disabled={busy} onClick={onClose}>{localize("閉じる")}</button><button className="primary-btn" disabled={busy} onClick={onProcess}><ScanLine size={16} />{busy ? localize("処理中…") : preview.item.state === 'OCR_READY' ? localize("インポートへ昇格") : localize("この画像をOCR")}</button></div>
    </section>
  </div>
}
