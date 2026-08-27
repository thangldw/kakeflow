import { describe, expect, it } from 'vitest'
import { spawn } from 'node:child_process'
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'

import {
  executableForPlatform,
  launchArgumentsForPlatform,
  packagedBuildPathFindings,
  personalBuildPathFindings,
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
    expect(executableForPlatform('darwin', {
      repositoryRoot: '/repo with spaces/財務',
      cargoTargetDir: '/private/tmp/KakeFlow Build/成果物',
      macosTarget: 'universal-apple-darwin',
      homeDirectory: '/Users/synthetic',
      temporaryDirectory: '/private/tmp',
    })).toBe(
      '/private/tmp/KakeFlow Build/成果物/universal-apple-darwin/release/bundle/macos/KakeFlow.app/Contents/MacOS/kakeflow',
    )
    expect(executableForPlatform('win32', { repositoryRoot: 'C:\\repo' })).toMatch(/kakeflow\.exe$/)
    expect(() => executableForPlatform('linux', '/repo')).toThrow(/macOS and Windows/)
    expect(launchArgumentsForPlatform('darwin')).toEqual(['-ApplePersistenceIgnoreState', 'YES'])
    expect(launchArgumentsForPlatform('win32')).toEqual([])
  })

  it('rejects personal build roots anywhere in a packaged app bundle', async () => {
    expect(personalBuildPathFindings(Buffer.from(
      'dependency /Users/synthetic/.cargo/registry and C:\\Users\\synthetic\\.cargo',
    ))).toEqual(['/Users/', 'C:\\Users\\'])
    expect(personalBuildPathFindings(Buffer.from(
      'relative .cargo/registry and bundled runtime /home/web_user',
    ))).toEqual([])

    const temporaryRoot = await mkdtemp(path.join(os.tmpdir(), 'kakeflow-packaged-privacy-test-'))
    const executable = path.join(temporaryRoot, 'KakeFlow.app', 'Contents', 'MacOS', 'kakeflow')
    const resource = path.join(temporaryRoot, 'KakeFlow.app', 'Contents', 'Resources', 'nested', 'metadata.bin')
    try {
      await Promise.all([
        mkdir(path.dirname(executable), { recursive: true }),
        mkdir(path.dirname(resource), { recursive: true }),
      ])
      await Promise.all([
        writeFile(executable, 'neutral executable'),
        writeFile(resource, 'dependency /Users/synthetic/build'),
      ])
      expect(await packagedBuildPathFindings(executable, 'darwin')).toEqual([
        'Contents/Resources/nested/metadata.bin:/Users/',
      ])
      await writeFile(resource, 'dependency /kakeflow-build-home/build')
      expect(await packagedBuildPathFindings(executable, 'darwin')).toEqual([])
    } finally {
      await rm(temporaryRoot, { recursive: true, force: true })
    }
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
