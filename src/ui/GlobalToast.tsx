import { Check, X } from 'lucide-react'
import { useEffect, useRef, useState, type FocusEvent } from 'react'
import { localize } from '../i18n'
import { ACTION_TOAST_DURATION_MS, createToastDismissTimer, KAKEFLOW_TOAST_EVENT, TOAST_DURATION_MS, type ToastAction, type ToastDismissTimer, type ToastTone } from '../toast'

interface ShownToast {
  readonly message: string
  readonly tone: ToastTone
  readonly action?: ToastAction
}

/** The app-wide toast. It listens for `showToast` events and hides itself after a while unless hovered or focused. */
export function GlobalToast() {
  const [toast, setToast] = useState<ShownToast | null>(null)
  const timerRef = useRef<ToastDismissTimer | null>(null)

  useEffect(() => {
    const timer = createToastDismissTimer(() => setToast(null))
    timerRef.current = timer
    const receive = (event: Event) => {
      const detail = (event as CustomEvent<{ message?: unknown; tone?: unknown; action?: Partial<ToastAction> }>).detail
      if (typeof detail?.message !== 'string' || !detail.message.trim()) return
      const tone: ToastTone = detail.tone === 'error' || detail.tone === 'info' ? detail.tone : 'success'
      const action = typeof detail.action?.label === 'string' && typeof detail.action.onAction === 'function' ? { label: detail.action.label, onAction: detail.action.onAction } : undefined
      setToast({ message: detail.message, tone, action })
      timer.start(action ? ACTION_TOAST_DURATION_MS : TOAST_DURATION_MS)
    }
    globalThis.addEventListener(KAKEFLOW_TOAST_EVENT, receive)
    return () => { globalThis.removeEventListener(KAKEFLOW_TOAST_EVENT, receive); timer.cancel(); timerRef.current = null }
  }, [])

  if (!toast) return null
  // The element goes away without pointerleave or blur events, so a closed toast must forget its pauses.
  const dismiss = () => { timerRef.current?.cancel(); setToast(null) }
  const focusLeaves = (event: FocusEvent<HTMLDivElement>) => {
    if (!event.currentTarget.contains(event.relatedTarget as Node | null)) timerRef.current?.resume('focus')
  }
  return <div
    className={`global-toast global-toast-${toast.tone}${toast.action ? ' global-toast--action' : ''}`}
    role={toast.tone === 'error' ? 'alert' : 'status'}
    onPointerEnter={() => timerRef.current?.pause('hover')}
    onPointerLeave={() => timerRef.current?.resume('hover')}
    onFocus={() => timerRef.current?.pause('focus')}
    onBlur={focusLeaves}
  >
    <span>{toast.tone === 'error' ? <X size={15} /> : <Check size={15} />}</span>
    <p>{toast.message}</p>
    {toast.action && <button type="button" className="text-btn global-toast-action" onClick={() => { const { onAction } = toast.action ?? {}; dismiss(); onAction?.() }}>{toast.action.label}</button>}
    <button className="icon-btn" aria-label={localize("通知を閉じる")} onClick={dismiss}><X size={14} /></button>
  </div>
}
