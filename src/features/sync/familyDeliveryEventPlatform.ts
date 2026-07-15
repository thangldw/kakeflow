import { listen as tauriListen, type Event, type UnlistenFn } from '@tauri-apps/api/event'

export const FAMILY_DELIVERY_DISCOVERED_EVENT = 'kakeflow://family-delivery-discovered'

type Listen = <T>(event: string, handler: (event: Event<T>) => void) => Promise<UnlistenFn>

export interface FamilyDeliveryDiscoveredEventDto {
  readonly householdId: string
  readonly discoveredCount: number
  readonly result: string
  readonly intakeResult: string
  readonly stagedCount: number
}

const id = /^[A-Za-z0-9_.:-]{1,128}$/
const results = new Set(['NO_CHANGES', 'DISCOVERED', 'FAILED_RETRYABLE', 'LEASE_EXPIRED', 'TERMINAL_SUSPENDED'])
const intakeResults = new Set(['NEVER', 'DISABLED', 'NO_AVAILABLE', 'REVIEW_PENDING', 'STAGED_FOR_REVIEW', 'FAILED_RETRYABLE', 'REJECTED_INVALID', 'AUDIENCE_DENIED'])

export function createFamilyDeliveryEventPlatform(listen: Listen = tauriListen) {
  return {
    subscribe(listener: (event: FamilyDeliveryDiscoveredEventDto) => void): Promise<UnlistenFn> {
      return listen<unknown>(FAMILY_DELIVERY_DISCOVERED_EVENT, ({ payload }) => {
        if (!payload || typeof payload !== 'object') throw new TypeError('family delivery event')
        const value = payload as Record<string, unknown>
        if (typeof value.householdId !== 'string' || !id.test(value.householdId)
            || !Number.isSafeInteger(value.discoveredCount) || Number(value.discoveredCount) < 0
            || !results.has(String(value.result)) || !intakeResults.has(String(value.intakeResult))
            || !Number.isSafeInteger(value.stagedCount) || ![0, 1].includes(Number(value.stagedCount))) {
          throw new TypeError('family delivery event')
        }
        listener(value as unknown as FamilyDeliveryDiscoveredEventDto)
      })
    },
  }
}

export const familyDeliveryEventPlatform = createFamilyDeliveryEventPlatform()
