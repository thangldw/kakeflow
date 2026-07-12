import { describe, expect, it } from 'vitest'

import { executableForPlatform, validateSmokeResult } from './packaged-app-smoke.mjs'

describe('packaged app smoke harness', () => {
  it('resolves the native artifacts produced by each CI package build', () => {
    expect(executableForPlatform('darwin', '/repo')).toBe(
      '/repo/src-tauri/target/release/bundle/macos/KakeFlow.app/Contents/MacOS/kakeflow',
    )
    expect(executableForPlatform('win32', 'C:\\repo')).toMatch(/kakeflow\.exe$/)
    expect(() => executableForPlatform('linux', '/repo')).toThrow(/macOS and Windows/)
  })

  it('accepts only a complete successful boot, IPC, and migration result', () => {
    expect(
      validateSmokeResult({
        status: 'ok',
        application: 'KakeFlow',
        window: 'main',
        ipc: true,
        databaseHealthy: true,
        schemaVersion: 12,
      }),
    ).toMatchObject({ schemaVersion: 12 })

    expect(() =>
      validateSmokeResult({
        status: 'ok',
        application: 'KakeFlow',
        window: 'main',
        ipc: false,
        databaseHealthy: true,
        schemaVersion: 12,
      }),
    ).toThrow(/Invalid packaged smoke result/)
  })
})
