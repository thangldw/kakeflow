import { describe, expect, it } from 'vitest'
import { spawn } from 'node:child_process'

import {
  executableForPlatform,
  launchArgumentsForPlatform,
  personalBuildPathFindings,
  scrubPersonalBuildRoots,
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

  it('rejects personal build roots embedded in a packaged executable', () => {
    expect(personalBuildPathFindings(Buffer.from(
      'dependency /Users/synthetic/.cargo/registry and C:\\Users\\synthetic\\.cargo',
    ))).toEqual(['/Users/', 'C:\\Users\\'])
    expect(personalBuildPathFindings(Buffer.from(
      'relative .cargo/registry and bundled runtime /home/web_user',
    ))).toEqual([])
  })

  it('scrubs exact personal build roots without changing executable length', () => {
    const original = Buffer.from(
      'one /Users/synthetic/.cargo two C:\\Users\\synthetic\\repo three',
    )
    const scrubbed = scrubPersonalBuildRoots(original, [
      '/Users/synthetic',
      'C:\\Users\\synthetic',
    ])
    expect(scrubbed).toHaveLength(original.length)
    expect(scrubbed.toString()).not.toContain('synthetic')
    expect(personalBuildPathFindings(scrubbed)).toEqual([])
  })

  it('accepts only a complete successful boot, IPC, and migration result', () => {
    const requiredPages = [
      ['ホーム', 'ホーム'], ['取引', '取引'], ['インポート', 'インポート'],
      ['撮影 Inbox', '撮影 Inbox'],
      ['カード照合', 'カード照合'], ['資産・投資', '資産・投資'], ['カレンダー・レポート', 'カレンダー・レポート'],
      ['予算・目標', '予算・目標'], ['定期取引・固定費', '定期取引・固定費'], ['分類ルール', '分類ルール'],
      ['家族スペース', '家族スペース'], ['監査・証跡', '監査・証跡'], ['設定', '設定'],
    ]
    const visualEvidence = {
      onboardingTitle: '家計簿をはじめましょう',
      householdName: 'Packaged Smoke Household',
      navigationLabels: requiredPages.map(([label]) => label),
      interactionCount: 14,
      viewportWidth: 1280,
      viewportHeight: 800,
      devicePixelRatio: 2,
      visitedPages: requiredPages.map(([navigationLabel, pageTitle]) => ({ navigationLabel, pageTitle, activeNavigation: true, headingVisible: true, mainWidth: 1000, mainHeight: 700, interactiveElementCount: 0, renderedTextLength: 100 })),
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
