export const KAKEFLOW_TOAST_EVENT = 'kakeflow:toast'

export type ToastTone = 'success' | 'error' | 'info'

export function showToast(message: string, tone: ToastTone = 'success'): void {
  globalThis.dispatchEvent(new CustomEvent(KAKEFLOW_TOAST_EVENT, { detail: { message, tone } }))
}
