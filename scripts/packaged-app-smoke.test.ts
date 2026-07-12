import { describe, expect, it } from 'vitest'
import { spawn } from 'node:child_process'

import {
  executableForPlatform,
  launchArgumentsForPlatform,
  terminateChild,
  validateSmokeResult,
} from './packaged-app-smoke.mjs'

describe('packaged app smoke harness', () => {
  it('terminates a timed-out child before returning control to cleanup', async () => {
    const child = spawn(process.execPath, ['-e', 'setInterval(() => {}, 1000)'])
    await terminateChild(child, 50)
    expect(child.exitCode !== null || child.signalCode !== null).toBe(true)
  })

  it('resolves the native artifacts produced by each CI package build', () => {
    expect(executableForPlatform('darwin', '/repo')).toBe(
      '/repo/src-tauri/target/release/bundle/macos/KakeFlow.app/Contents/MacOS/kakeflow',
    )
    expect(executableForPlatform('win32', 'C:\\repo')).toMatch(/kakeflow\.exe$/)
    expect(() => executableForPlatform('linux', '/repo')).toThrow(/macOS and Windows/)
    expect(launchArgumentsForPlatform('darwin')).toEqual(['-ApplePersistenceIgnoreState', 'YES'])
    expect(launchArgumentsForPlatform('win32')).toEqual([])
  })

  it('accepts only a complete successful boot, IPC, and migration result', () => {
    const visualEvidence = {
      onboardingTitle: '家計簿をはじめましょう',
      householdName: 'Packaged Smoke Household',
      navigationLabels: ['ホーム', '取引', 'インポート', 'カレンダー・レポート'],
      interactionCount: 1,
      viewportWidth: 1280,
      viewportHeight: 800,
      devicePixelRatio: 2,
      visitedPages: [['ホーム', 'Packaged Smoke Householdの家計']].map(([navigationLabel, pageTitle]) => ({ navigationLabel, pageTitle, activeNavigation: true, mainWidth: 1000, mainHeight: 700, interactiveElementCount: 2, renderedTextLength: 100 })),
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
      databaseHealthy: true, schemaVersion: 12, visualEvidence: { ...visualEvidence, visitedPages: [] },
    })).toThrow(/Invalid packaged smoke result/)
  })
})
