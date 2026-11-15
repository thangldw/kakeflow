import { useEffect, useId, useRef, useState, type FormEvent } from 'react'
import { localize, useI18n } from '../i18n'
import type { PwaLedgerClient } from '../platform/pwa/client'
import {
  browserPasskeyAuthenticator,
  passkeyAvailable,
  PasskeyCancelledError,
  type PasskeyAuthenticator,
} from '../platform/pwa/passkey'
import { PASSKEY_LIMIT } from '../platform/pwa/passkeyWrap'
import type { PasskeySummary } from '../platform/pwa/types'

interface QuickUnlockCardProps {
  readonly client: PwaLedgerClient
  /** The WebAuthn adapter; the app uses the browser one, tests inject a fake. */
  readonly authenticator?: PasskeyAuthenticator
}

/**
 * off: nothing running; passphrase and checking: the form and the slow passphrase check (first tap);
 * confirm and enrolling: the single passkey button (second tap), so no ceremony follows a slow derivation in one gesture.
 */
type Step = 'off' | 'passphrase' | 'checking' | 'confirm' | 'enrolling'
type Notice = 'short' | 'wrong' | 'expired' | 'cancelled' | 'unsupported' | 'removeFailed'

/**
 * The quick unlock (passkey) card of the PWA: turn it on with the passphrase and one passkey prompt, see the
 * passkeys on this device and turn each off. Renders nothing where the browser cannot offer a passkey.
 * The typed passphrase lives in component state only on the passphrase and confirm steps.
 */
export function QuickUnlockCard({ client, authenticator }: QuickUnlockCardProps) {
  const { localeCode } = useI18n()
  const titleId = useId()
  const [available, setAvailable] = useState(false)
  const [entries, setEntries] = useState<readonly PasskeySummary[] | null>(null)
  const [step, setStep] = useState<Step>('off')
  const [passphrase, setPassphrase] = useState('')
  const [notice, setNotice] = useState<Notice | null>(null)
  const [removing, setRemoving] = useState<string | null>(null)
  const [removeBusy, setRemoveBusy] = useState(false)
  const mounted = useRef(true)
  const touched = useRef(false)
  const inputRef = useRef<HTMLInputElement>(null)
  const confirmRef = useRef<HTMLButtonElement>(null)
  const turnOnRef = useRef<HTMLButtonElement>(null)

  useEffect(() => {
    mounted.current = true
    return () => { mounted.current = false }
  }, [])

  useEffect(() => {
    let current = true
    Promise.all([passkeyAvailable(), client.listPasskeys()]).then(
      ([ready, list]) => { if (current) { setAvailable(ready); setEntries(list) } },
      () => { if (current) setAvailable(false) },
    )
    return () => { current = false }
  }, [client])

  useEffect(() => {
    if (step === 'passphrase') inputRef.current?.focus()
    else if (step === 'confirm') confirmRef.current?.focus()
    else if (step === 'off' && touched.current) turnOnRef.current?.focus()
  }, [step])

  if (!available || entries === null) return null

  const atLimit = entries.length >= PASSKEY_LIMIT
  const busy = step === 'checking' || step === 'enrolling'

  const reload = async () => {
    try {
      const list = await client.listPasskeys()
      if (mounted.current) setEntries(list)
    } catch { /* The list on screen stays; the next action reads it again. */ }
  }

  const startTurnOn = () => {
    touched.current = true
    setNotice(null)
    setPassphrase('')
    setStep('passphrase')
  }

  const cancelTurnOn = () => {
    setPassphrase('')
    setNotice(null)
    setStep('off')
  }

  // First tap: the slow Argon2id check of the passphrase. No passkey prompt is started here.
  const checkPassphrase = async (event: FormEvent) => {
    event.preventDefault()
    if (busy) return
    if (passphrase.length < 12) {
      setNotice('short')
      return
    }
    setNotice(null)
    setStep('checking')
    try {
      await client.verifyPassphrase(passphrase)
      if (mounted.current) setStep('confirm')
    } catch {
      if (!mounted.current) return
      setPassphrase('')
      setNotice('wrong')
      setStep('passphrase')
    }
  }

  // Second tap: the passkey prompt (and any follow-up prompt the client needs) for the passphrase just checked.
  const confirmWithPasskey = async () => {
    if (busy) return
    const typed = passphrase
    setPassphrase('')
    setNotice(null)
    setStep('enrolling')
    try {
      await client.enablePasskey(typed, authenticator ?? browserPasskeyAuthenticator())
    } catch (cause) {
      if (!mounted.current) return
      if (cause instanceof Error && cause.message === 'Passphrase not verified') {
        setNotice('expired')
        setStep('passphrase')
        return
      }
      // A full list is already explained by the note under the disabled button.
      if (!(cause instanceof Error && cause.message === 'Passkey limit reached')) {
        setNotice(cause instanceof PasskeyCancelledError ? 'cancelled' : 'unsupported')
      }
      await reload()
      if (mounted.current) setStep('off')
      return
    }
    await reload()
    if (mounted.current) setStep('off')
  }

  const turnOff = async (credentialIdBase64Url: string) => {
    if (removeBusy) return
    setRemoveBusy(true)
    setNotice(null)
    try {
      await client.removePasskey(credentialIdBase64Url)
    } catch {
      if (mounted.current) setNotice('removeFailed')
    }
    await reload()
    if (!mounted.current) return
    setRemoving(null)
    setRemoveBusy(false)
  }

  const formatDate = (iso: string) => {
    const date = new Date(iso)
    return Number.isNaN(date.getTime()) ? iso : date.toLocaleDateString(localeCode, { dateStyle: 'medium' })
  }

  return <section className="simple-card pwa-quick-unlock" aria-labelledby={titleId}>
    <h2 id={titleId} className="simple-panel-title">{localize("指紋・顔・PINですばやく開く")}</h2>
    {entries.length === 0
      ? <p className="simple-note">{localize("パスフレーズの代わりに、この端末の指紋・顔・PINで保管庫を開けます。パスフレーズは今までどおり使えます。")}</p>
      : <>
        <p className="simple-card-label">{localize("この端末でオンになっています")}</p>
        <ul className="pwa-quick-unlock-list">
          {entries.map((entry) => <PasskeyRow key={entry.credentialIdBase64Url} entry={entry} date={formatDate(entry.createdAt)}
            confirming={removing === entry.credentialIdBase64Url} busy={removeBusy}
            onAsk={() => { setNotice(null); setRemoving(entry.credentialIdBase64Url) }}
            onCancel={() => setRemoving(null)}
            onConfirm={() => { void turnOff(entry.credentialIdBase64Url) }} />)}
        </ul>
      </>}
    <p className="simple-note">{localize("パスキーをクラウドのキーチェーンに保存した場合、そのアカウントを管理できる人もこの保管庫を開けられます。パスフレーズが最も強い保護で、バックアップの復元にも必要です。")}</p>

    {step === 'off' && <>
      <button ref={turnOnRef} type="button" className="primary-btn" disabled={atLimit} onClick={startTurnOn}>{localize("オンにする")}</button>
      {atLimit && <p className="simple-note">{localize("パスキーの上限に達しました。新しく追加するには、先にどれかを無効にしてください。")}</p>}
    </>}

    {(step === 'passphrase' || step === 'checking') && <form className="pwa-quick-unlock-form" onSubmit={(event) => { void checkPassphrase(event) }} aria-busy={step === 'checking'}>
      <label className="simple-field">{localize("保管庫用パスフレーズ")}
        <input ref={inputRef} type="password" autoComplete="current-password" value={passphrase} disabled={busy}
          onChange={(event) => setPassphrase(event.target.value)} />
      </label>
      <div className="pwa-quick-unlock-actions">
        <button type="submit" className="primary-btn" disabled={busy}>{step === 'checking' ? localize("パスフレーズを確認しています…") : localize("続ける")}</button>
        <button type="button" className="secondary-btn" disabled={busy} onClick={cancelTurnOn}>{localize("キャンセル")}</button>
      </div>
    </form>}

    {(step === 'confirm' || step === 'enrolling') && <div className="pwa-quick-unlock-form">
      <p className="simple-note">{localize("パスフレーズを確認しました。次に、指紋・顔・PINで確認してください。")}</p>
      <div className="pwa-quick-unlock-actions">
        <button ref={confirmRef} type="button" className="primary-btn" disabled={busy} onClick={() => { void confirmWithPasskey() }}>{localize("指紋・顔・PINで確認する")}</button>
        <button type="button" className="secondary-btn" disabled={busy} onClick={cancelTurnOn}>{localize("キャンセル")}</button>
      </div>
    </div>}

    {notice && <p className={notice === 'cancelled' ? 'simple-note' : 'simple-error-text'} role={notice === 'cancelled' ? 'status' : 'alert'}>{noticeText(notice)}</p>}
  </section>
}

function noticeText(notice: Notice): string {
  switch (notice) {
    case 'short': return localize("パスフレーズは12文字以上にしてください")
    case 'wrong': return localize("パスフレーズが正しくありません。")
    case 'expired': return localize("パスフレーズの確認の有効期限が切れました。もう一度入力してください。")
    case 'cancelled': return localize("パスキーの確認をキャンセルしました。")
    case 'unsupported': return localize("この端末やブラウザでは、パスキーで開けません。引き続きパスフレーズをお使いください。")
    case 'removeFailed': return localize("無効にできませんでした。もう一度お試しください。")
  }
}

function PasskeyRow({ entry, date, confirming, busy, onAsk, onCancel, onConfirm }: {
  readonly entry: PasskeySummary
  readonly date: string
  readonly confirming: boolean
  readonly busy: boolean
  readonly onAsk: () => void
  readonly onCancel: () => void
  readonly onConfirm: () => void
}) {
  const labelId = useId()
  const warningId = useId()
  return <li className="pwa-quick-unlock-entry">
    <span id={labelId}>{entry.label}</span>
    <span className="simple-note">{localize("登録日")} {date}</span>
    {!confirming
      ? <button type="button" className="secondary-btn" aria-describedby={labelId} onClick={onAsk}>{localize("無効にする")}</button>
      : <div role="group" aria-labelledby={warningId} className="pwa-quick-unlock-form">
        <p id={warningId} className="simple-note"><strong>{localize("このパスキーを無効にしますか？")}</strong> {localize("この操作で消えるのは、この端末に保存した解錠用のデータだけです。この端末のデータのコピーとパスキーをすでに持っている人のアクセスは取り消されません。完全に締め出すには、バックアップを新しい保管庫に復元してください。保管庫の鍵が新しくなります。")}</p>
        <div className="pwa-quick-unlock-actions">
          <button type="button" className="primary-btn" disabled={busy} onClick={onConfirm}>{localize("はい、無効にします")}</button>
          <button type="button" className="secondary-btn" disabled={busy} onClick={onCancel}>{localize("キャンセル")}</button>
        </div>
      </div>}
  </li>
}
