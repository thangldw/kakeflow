import { describe, expect, it } from 'vitest'

import { canActivatePwaUpdate, pwaServiceWorkerUrl } from './serviceWorker'

describe('PWA service worker safety boundary', () => {
  it('registers only below the dedicated app scope', () => {
    expect(pwaServiceWorkerUrl('/kakeflow/app/')).toBe('/kakeflow/app/sw.js')
    expect(pwaServiceWorkerUrl('/kakeflow/app')).toBe('/kakeflow/app/sw.js')
  })

  it('allows activation only while locked or with no active review/posting operation', () => {
    expect(canActivatePwaUpdate({ vaultUnlocked: false, activeOperation: true })).toBe(true)
    expect(canActivatePwaUpdate({ vaultUnlocked: true, activeOperation: false })).toBe(true)
    expect(canActivatePwaUpdate({ vaultUnlocked: true, activeOperation: true })).toBe(false)
  })
})
