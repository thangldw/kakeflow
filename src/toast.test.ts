import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createToastDismissTimer, KAKEFLOW_TOAST_EVENT, showToast, TOAST_RESUME_GRACE_MS } from './toast'

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

describe('createToastDismissTimer', () => {
  beforeEach(() => { vi.useFakeTimers() })
  afterEach(() => { vi.useRealTimers() })

  it('expires after the given duration', () => {
    const expire = vi.fn()
    createToastDismissTimer(expire).start(8000)
    vi.advanceTimersByTime(7999)
    expect(expire).not.toHaveBeenCalled()
    vi.advanceTimersByTime(1)
    expect(expire).toHaveBeenCalledTimes(1)
  })

  it('does not expire while hovered, then gives a fresh grace period after the pointer leaves', () => {
    const expire = vi.fn()
    const timer = createToastDismissTimer(expire)
    timer.start(8000)
    vi.advanceTimersByTime(7000)
    timer.pause('hover')
    vi.advanceTimersByTime(60_000)
    expect(expire).not.toHaveBeenCalled()
    timer.resume('hover')
    vi.advanceTimersByTime(TOAST_RESUME_GRACE_MS - 1)
    expect(expire).not.toHaveBeenCalled()
    vi.advanceTimersByTime(1)
    expect(expire).toHaveBeenCalledTimes(1)
  })

  it('keeps the time that was left after a brief pause, so a quick pass never shortens the toast', () => {
    const expire = vi.fn()
    const timer = createToastDismissTimer(expire)
    timer.start(8000)
    timer.pause('hover')
    timer.resume('hover')
    vi.advanceTimersByTime(7900)
    expect(expire).not.toHaveBeenCalled()
    vi.advanceTimersByTime(100)
    expect(expire).toHaveBeenCalledTimes(1)
  })

  it('stays paused until both hover and focus have ended', () => {
    const expire = vi.fn()
    const timer = createToastDismissTimer(expire, 1000)
    timer.start(2600)
    timer.pause('hover')
    timer.pause('focus')
    timer.resume('hover')
    vi.advanceTimersByTime(60_000)
    expect(expire).not.toHaveBeenCalled()
    timer.resume('focus')
    vi.advanceTimersByTime(1000)
    expect(expire).toHaveBeenCalledTimes(1)
  })

  it('ignores a resume without a matching pause', () => {
    const expire = vi.fn()
    const timer = createToastDismissTimer(expire, 1000)
    timer.start(8000)
    timer.resume('hover')
    vi.advanceTimersByTime(1000)
    expect(expire).not.toHaveBeenCalled()
    vi.advanceTimersByTime(7000)
    expect(expire).toHaveBeenCalledTimes(1)
  })

  it('waits for the resume when a new toast starts while the pointer is still over it', () => {
    const expire = vi.fn()
    const timer = createToastDismissTimer(expire, 1000)
    timer.start(2600)
    timer.pause('hover')
    timer.start(2600)
    vi.advanceTimersByTime(10_000)
    expect(expire).not.toHaveBeenCalled()
    timer.resume('hover')
    vi.advanceTimersByTime(1000)
    expect(expire).toHaveBeenCalledTimes(1)
  })

  it('forgets its pauses when cancelled, so the next toast counts down again', () => {
    const expire = vi.fn()
    const timer = createToastDismissTimer(expire)
    timer.start(8000)
    timer.pause('focus')
    timer.cancel()
    vi.advanceTimersByTime(60_000)
    expect(expire).not.toHaveBeenCalled()
    timer.start(2600)
    vi.advanceTimersByTime(2600)
    expect(expire).toHaveBeenCalledTimes(1)
  })
})
