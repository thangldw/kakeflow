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
