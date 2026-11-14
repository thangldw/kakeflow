import { act, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { ACTION_TOAST_DURATION_MS, showToast, TOAST_DURATION_MS, TOAST_RESUME_GRACE_MS } from '../toast'
import { GlobalToast } from './GlobalToast'

const advance = (ms: number) => act(() => { vi.advanceTimersByTime(ms) })
const toast = () => screen.queryByRole('status')

function showActionToast(onAction = vi.fn()) {
  render(<><button type="button">outside</button><GlobalToast /></>)
  act(() => showToast('保存しました ¥1,500 · 食費', 'success', { label: '修正', onAction }))
  return onAction
}

beforeEach(() => { vi.useFakeTimers() })
afterEach(() => { vi.useRealTimers() })

describe('GlobalToast', () => {
  it('hides a plain toast and an action toast after their durations', () => {
    render(<GlobalToast />)
    act(() => showToast('done'))
    advance(TOAST_DURATION_MS - 1)
    expect(toast()).toHaveTextContent('done')
    advance(1)
    expect(toast()).toBeNull()

    act(() => showToast('saved', 'success', { label: 'Edit', onAction: () => undefined }))
    advance(ACTION_TOAST_DURATION_MS - 1)
    expect(toast()).not.toBeNull()
    advance(1)
    expect(toast()).toBeNull()
  })

  it('stays while the pointer is over it and leaves a grace period after the pointer leaves', () => {
    showActionToast()
    advance(ACTION_TOAST_DURATION_MS - 100)
    fireEvent.pointerEnter(toast()!)
    advance(60_000)
    expect(toast()).not.toBeNull()
    fireEvent.pointerLeave(toast()!)
    advance(TOAST_RESUME_GRACE_MS - 1)
    expect(toast()).not.toBeNull()
    advance(1)
    expect(toast()).toBeNull()
  })

  it('stays while focus is inside it and leaves a grace period after focus moves out', () => {
    showActionToast()
    act(() => screen.getByRole('button', { name: '修正' }).focus())
    advance(60_000)
    expect(toast()).not.toBeNull()
    // Moving between the toast's own buttons keeps it paused.
    act(() => screen.getByRole('button', { name: '通知を閉じる' }).focus())
    advance(60_000)
    expect(toast()).not.toBeNull()
    act(() => screen.getByRole('button', { name: 'outside' }).focus())
    advance(TOAST_RESUME_GRACE_MS - 1)
    expect(toast()).not.toBeNull()
    advance(1)
    expect(toast()).toBeNull()
  })

  it('runs the action once and closes; a later toast counts down again even though the closed one was hovered', () => {
    const onAction = showActionToast()
    fireEvent.pointerEnter(toast()!)
    fireEvent.click(screen.getByRole('button', { name: '修正' }))
    expect(onAction).toHaveBeenCalledTimes(1)
    expect(toast()).toBeNull()

    act(() => showToast('next'))
    advance(TOAST_DURATION_MS)
    expect(toast()).toBeNull()
  })
})
