import { useState } from 'react'
import type { PdfPasswordStatus } from './protectedPdfPlatform'
import './pdfPasswordPrompt.css'

export interface PdfPasswordPromptProps {
  readonly filename?: string
  readonly status: Exclude<PdfPasswordStatus, 'SUCCESS'>
  readonly onSubmit: (password: string) => Promise<void>
  readonly onCancel?: () => void
}

export function PdfPasswordPrompt({ filename, status, onSubmit, onCancel }: PdfPasswordPromptProps) {
  const [password, setPassword] = useState('')
  const [busy, setBusy] = useState(false)
  if (status === 'PASSWORD_UNSUPPORTED') return <aside className="pdf-password-prompt" role="alert"><strong>このPDFの暗号方式には対応していません</strong><p>{filename ? `${filename} を` : 'PDFを'}作成元で開き、パスワード保護を解除したコピーを保存してから再度取り込んでください。</p>{onCancel && <button type="button" className="secondary-btn" onClick={onCancel}>閉じる</button>}</aside>

  const submit = async (event: React.FormEvent) => {
    event.preventDefault()
    if (!password || busy) return
    const ephemeralPassword = password
    setPassword('')
    setBusy(true)
    try { await onSubmit(ephemeralPassword) }
    finally { setBusy(false) }
  }
  return <form className="pdf-password-prompt" aria-label="PDFパスワード入力" onSubmit={(event) => void submit(event)}>
    <strong>{status === 'PASSWORD_INVALID' ? 'パスワードが一致しません' : 'このPDFはパスワードで保護されています'}</strong>
    <p>{filename ?? 'PDF'} のパスワードを入力してください。値はこの処理だけに使用し、保存しません。</p>
    <label>PDFパスワード<input type="password" autoComplete="off" spellCheck={false} value={password} onChange={(event) => setPassword(event.target.value)} /></label>
    <div>{onCancel && <button type="button" className="secondary-btn" disabled={busy} onClick={onCancel}>キャンセル</button>}<button type="submit" className="primary-btn" disabled={!password || busy}>{busy ? '確認中…' : 'ロックを解除'}</button></div>
  </form>
}
