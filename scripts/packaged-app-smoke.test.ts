import { describe, expect, it } from 'vitest'
import { execFile as execFileCallback, spawn } from 'node:child_process'
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { promisify } from 'node:util'

import {
  executableForPlatform,
  launchArgumentsForPlatform,
  packagedBuildPathFindings,
  personalBuildPathFindings,
  runPackagedSmoke,
  terminateChild,
  validateSmokeResult,
} from './packaged-app-smoke.mjs'
import { computeNativeBuildInputIdentity, writeNativeBuildIdentity } from './native-build-identity.mjs'

const execFile = promisify(execFileCallback)

async function staleInputAppFixture(root: string) {
  const repositoryRoot = path.join(root, 'checkout')
  const releaseDirectory = path.join(root, 'target', 'aarch64-apple-darwin', 'release')
  const app = path.join(releaseDirectory, 'bundle', 'macos', 'KakeFlow.app')
  const executable = path.join(app, 'Contents', 'MacOS', 'kakeflow')
  const context = {
    repositoryRoot,
    cargoTargetDir: path.join(root, 'target'),
    macosTarget: 'aarch64-apple-darwin',
    artifactArchitecture: 'aarch64',
    releaseDirectory,
  }
  const artifacts = {
    app,
    executable,
    updaterArchive: `${app}.tar.gz`,
    updaterSignature: `${app}.tar.gz.sig`,
    dmg: path.join(releaseDirectory, 'bundle', 'dmg', 'KakeFlow_1.2.1_aarch64.dmg'),
    identityManifest: path.join(releaseDirectory, 'kakeflow-build-identity.json'),
  }
  const ocr = path.join(repositoryRoot, 'src-tauri', 'generated-resources', 'ocr', 'tesseract')
  await Promise.all([
    mkdir(path.dirname(executable), { recursive: true }),
    mkdir(path.dirname(ocr), { recursive: true }),
  ])
  await Promise.all([
    writeFile(path.join(repositoryRoot, 'package.json'), '{"version":"1.2.1"}\n'),
    writeFile(path.join(repositoryRoot, '.gitignore'), 'src-tauri/generated-resources/ocr/*\n'),
    writeFile(ocr, 'staged OCR v1'),
    writeFile(executable, 'synthetic app'),
    writeFile(artifacts.updaterArchive, 'synthetic updater'),
    writeFile(artifacts.updaterSignature, 'synthetic signature'),
  ])
  await execFile('git', ['init', '-q'], { cwd: repositoryRoot })
  await execFile('git', ['add', '.'], { cwd: repositoryRoot })
  const buildInputIdentity = await computeNativeBuildInputIdentity(repositoryRoot)
  await writeNativeBuildIdentity({ context, artifacts, version: '1.2.1', mode: 'app', buildInputIdentity })
  return { repositoryRoot, executable, ocr }
}

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
      macosTarget: 'aarch64-apple-darwin',
      homeDirectory: '/Users/synthetic',
      temporaryDirectory: '/private/tmp',
    })).toBe(
      '/private/tmp/KakeFlow Build/成果物/aarch64-apple-darwin/release/bundle/macos/KakeFlow.app/Contents/MacOS/kakeflow',
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

  it('rejects an app bundle without a successful build identity before launch', async () => {
    const temporaryRoot = await mkdtemp(path.join(os.tmpdir(), 'kakeflow-packaged-identity-test-'))
    const executable = path.join(temporaryRoot, 'release', 'bundle', 'macos', 'KakeFlow.app', 'Contents', 'MacOS', 'kakeflow')
    try {
      await mkdir(path.dirname(executable), { recursive: true })
      await writeFile(executable, 'stale executable without a build identity')
      await expect(runPackagedSmoke({ executable, timeoutMs: 50 })).rejects.toThrow(/Successful native build identity is required/)
    } finally {
      await rm(temporaryRoot, { recursive: true, force: true })
    }
  })

  it('rejects a previously successful app identity after an ignored staged OCR input changes', async () => {
    const temporaryRoot = await mkdtemp(path.join(os.tmpdir(), 'kakeflow-packaged-stale-source-test-'))
    try {
      const fixture = await staleInputAppFixture(temporaryRoot)
      await writeFile(fixture.ocr, 'staged OCR v2')
      await expect(runPackagedSmoke({
        executable: fixture.executable,
        repositoryRoot: fixture.repositoryRoot,
        timeoutMs: 50,
      })).rejects.toThrow(/build input identity mismatch/)
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
