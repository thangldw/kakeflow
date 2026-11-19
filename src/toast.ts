export const KAKEFLOW_TOAST_EVENT = 'kakeflow:toast'

export type ToastTone = 'success' | 'error' | 'info'

/** An optional button shown in the toast, for example "Edit" after a save. */
export interface ToastAction {
  readonly label: string
  readonly onAction: () => void
}

export function showToast(message: string, tone: ToastTone = 'success', action?: ToastAction): void {
  const detail = action ? { message, tone, action } : { message, tone }
  globalThis.dispatchEvent(new CustomEvent(KAKEFLOW_TOAST_EVENT, { detail }))
}

/** How long a toast stays: longer with an action, so there is time to reach the button. */
export const TOAST_DURATION_MS = 2600
export const ACTION_TOAST_DURATION_MS = 8000
/** After the pointer leaves the toast or focus moves out of it, the toast stays at least this much longer. */
export const TOAST_RESUME_GRACE_MS = 3000

export type ToastPauseReason = 'hover' | 'focus'

export interface ToastDismissTimer {
  /** Starts the countdown for a newly shown toast. While a pause is active the countdown waits for resume. */
  start(durationMs: number): void
  pause(reason: ToastPauseReason): void
  /** Ends one pause; once none is left the countdown restarts with the time left, but at least the grace period. */
  resume(reason: ToastPauseReason): void
  /** Stops the countdown and forgets every pause, for a toast that is gone. */
  cancel(): void
}

/**
 * The auto-dismiss countdown of a toast. It is paused while the pointer is over the toast or focus is inside it,
 * so nobody loses the toast while reading it or reaching its button (WCAG 2.2.1 Timing Adjustable).
 */
export function createToastDismissTimer(onExpire: () => void, graceMs: number = TOAST_RESUME_GRACE_MS): ToastDismissTimer {
  let timer: ReturnType<typeof globalThis.setTimeout> | undefined
  // When the toast would have expired had nothing paused it; a pause never shortens that.
  let deadline = 0
  const reasons = new Set<ToastPauseReason>()
  const clear = () => { if (timer !== undefined) globalThis.clearTimeout(timer); timer = undefined }
  const schedule = (ms: number) => { clear(); timer = globalThis.setTimeout(() => { timer = undefined; onExpire() }, ms) }
  return {
    start(durationMs) { clear(); deadline = Date.now() + durationMs; if (reasons.size === 0) schedule(durationMs) },
    pause(reason) { reasons.add(reason); clear() },
    resume(reason) {
      if (!reasons.delete(reason)) return
      // A brief pass (a pointer crossing, a tap, a quick focus) keeps the time that was left; a long one gets the grace.
      if (reasons.size === 0) schedule(Math.max(deadline - Date.now(), graceMs))
    },
    cancel() { clear(); reasons.clear() },
  }
}
