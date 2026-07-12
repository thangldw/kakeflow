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
    const visualEvidence = {
      onboardingTitle: '家計簿をはじめましょう',
      householdName: 'Packaged Smoke Household',
      navigationLabels: ['ホーム', '取引', 'インポート', 'カレンダー・レポート'],
      interactionCount: 5,
      viewportWidth: 1280,
      viewportHeight: 800,
      devicePixelRatio: 2,
      visitedPages: [
        ['ホーム', 'Packaged Smoke Householdの家計'],
        ['取引', 'すべての取引'],
        ['インポート', 'インポート Inbox'],
        ['カレンダー・レポート', 'カレンダー・レポート'],
      ].map(([navigationLabel, pageTitle]) => ({ navigationLabel, pageTitle, activeNavigation: true, mainWidth: 1000, mainHeight: 700, interactiveElementCount: 2, renderedTextLength: 100 })),
    }
    expect(
      validateSmokeResult({
        status: 'ok',
        application: 'KakeFlow',
        window: 'main',
        ipc: true,
        databaseHealthy: true,
        schemaVersion: 12,
        visualEvidence,
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
        visualEvidence,
      }),
    ).toThrow(/Invalid packaged smoke result/)

    expect(() => validateSmokeResult({
      status: 'ok', application: 'KakeFlow', window: 'main', ipc: true,
      databaseHealthy: true, schemaVersion: 12, visualEvidence: { ...visualEvidence, visitedPages: visualEvidence.visitedPages.slice(0, 3) },
    })).toThrow(/Invalid packaged smoke result/)
  })
})
