import { afterEach, describe, expect, it, vi } from 'vitest'
import { KAKEFLOW_TOAST_EVENT, showToast } from './toast'

describe('showToast', () => {
  const received: unknown[] = []
  const receive = (event: Event) => received.push((event as CustomEvent).detail)
  afterEach(() => { globalThis.removeEventListener(KAKEFLOW_TOAST_EVENT, receive); received.length = 0 })

  it('dispatches the message and tone as before when no action is given', () => {
    globalThis.addEventListener(KAKEFLOW_TOAST_EVENT, receive)
    showToast('done')
    showToast('failed', 'error')
    expect(received).toEqual([{ message: 'done', tone: 'success' }, { message: 'failed', tone: 'error' }])
  })

  it('carries an optional action', () => {
    globalThis.addEventListener(KAKEFLOW_TOAST_EVENT, receive)
    const onAction = vi.fn()
    showToast('saved', 'success', { label: 'Edit', onAction })
    expect(received).toEqual([{ message: 'saved', tone: 'success', action: { label: 'Edit', onAction } }])
  })
})
