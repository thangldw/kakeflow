import { useState } from 'react'
import type { PdfPasswordStatus } from './protectedPdfPlatform'
import './pdfPasswordPrompt.css'
import { localize } from '../../i18n'

export interface PdfPasswordPromptProps {
  readonly filename?: string
  readonly status: Exclude<PdfPasswordStatus, 'SUCCESS'>
  readonly onSubmit: (password: string) => Promise<void>
  readonly onCancel?: () => void
}

export function PdfPasswordPrompt({ filename, status, onSubmit, onCancel }: PdfPasswordPromptProps) {
  const [password, setPassword] = useState('')
  const [busy, setBusy] = useState(false)
  if (status === 'PASSWORD_UNSUPPORTED') return <aside className="pdf-password-prompt" role="alert"><strong>{localize("このPDFの暗号方式には対応していません")}</strong><p>{filename ? localize(`${filename} を`) : localize("PDFを")}{localize("作成元で開き、パスワード保護を解除したコピーを保存してから再度取り込んでください。")}</p>{onCancel && <button type="button" className="secondary-btn" onClick={onCancel}>{localize("閉じる")}</button>}</aside>

  const submit = async (event: React.FormEvent) => {
    event.preventDefault()
    if (!password || busy) return
    const ephemeralPassword = password
    setPassword('')
    setBusy(true)
    try { await onSubmit(ephemeralPassword) }
    finally { setBusy(false) }
  }
  return <form className="pdf-password-prompt" aria-label={localize("PDFパスワード入力")} onSubmit={(event) => void submit(event)}>
    <strong>{status === 'PASSWORD_INVALID' ? localize("パスワードが一致しません") : localize("このPDFはパスワードで保護されています")}</strong>
    <p>{filename ?? 'PDF'} {localize("のパスワードを入力してください。値はこの処理だけに使用し、保存しません。")}</p>
    <label>{localize("PDFパスワード")}<input type="password" autoComplete="off" spellCheck={false} value={password} onChange={(event) => setPassword(event.target.value)} /></label>
    <div>{onCancel && <button type="button" className="secondary-btn" disabled={busy} onClick={onCancel}>{localize("キャンセル")}</button>}<button type="submit" className="primary-btn" disabled={!password || busy}>{busy ? localize("確認中…") : localize("ロックを解除")}</button></div>
  </form>
}
