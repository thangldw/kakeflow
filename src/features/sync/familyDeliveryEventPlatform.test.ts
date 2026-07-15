import type { Event, UnlistenFn } from '@tauri-apps/api/event'
import { describe, expect, it, vi } from 'vitest'
import { createFamilyDeliveryEventPlatform, FAMILY_DELIVERY_DISCOVERED_EVENT } from './familyDeliveryEventPlatform'

describe('family delivery event platform', () => {
  it('accepts only bounded redacted scheduler events', async () => {
    let handler: ((event: Event<unknown>) => void) | undefined
    const listener = vi.fn()
    await createFamilyDeliveryEventPlatform(async <T>(name: string, next: (event: Event<T>) => void): Promise<UnlistenFn> => {
      expect(name).toBe(FAMILY_DELIVERY_DISCOVERED_EVENT); handler = next as (event: Event<unknown>) => void; return () => undefined
    }).subscribe(listener)
    handler?.({ id: 1, event: FAMILY_DELIVERY_DISCOVERED_EVENT, payload: { householdId: 'family', discoveredCount: 2, result: 'DISCOVERED', intakeResult: 'STAGED_FOR_REVIEW', stagedCount: 1 } })
    expect(listener).toHaveBeenCalledWith({ householdId: 'family', discoveredCount: 2, result: 'DISCOVERED', intakeResult: 'STAGED_FOR_REVIEW', stagedCount: 1 })
  })

  it.each([null, { householdId: '../family', discoveredCount: 0, result: 'NO_CHANGES', intakeResult: 'NO_AVAILABLE', stagedCount: 0 }, { householdId: 'family', discoveredCount: 0, result: 'NO_CHANGES', intakeResult: 'APPLIED', stagedCount: 0 }, { householdId: 'family', discoveredCount: 0, result: 'NO_CHANGES', intakeResult: 'NO_AVAILABLE', stagedCount: 2 }])('rejects malformed payloads %#', async (payload) => {
    let handler: ((event: Event<unknown>) => void) | undefined
    await createFamilyDeliveryEventPlatform(async <T>(_name: string, next: (event: Event<T>) => void): Promise<UnlistenFn> => { handler = next as (event: Event<unknown>) => void; return () => undefined }).subscribe(vi.fn())
    expect(() => handler?.({ id: 1, event: FAMILY_DELIVERY_DISCOVERED_EVENT, payload })).toThrow(TypeError)
  })
})
