import { readFile } from 'node:fs/promises'
import path from 'node:path'
import { describe, expect, it } from 'vitest'

const releaseModulePath = './desktop-release.mjs'
const releaseModule = await import(releaseModulePath).catch(() => ({}))

describe('desktop release platform dispatcher', () => {
  it('routes macOS through the protected native wrapper and forwards only safe argv and env', async () => {
    expect(releaseModule.createDesktopReleasePlan).toBeTypeOf('function')
    if (typeof releaseModule.createDesktopReleasePlan !== 'function') return
    const environment = {
      PATH: '/controlled/bin',
      RELEASE_MARKER: 'synthetic',
      KAKEFLOW_MACOS_TARGET: 'aarch64-apple-darwin',
    }
    const plan = releaseModule.createDesktopReleasePlan({
      platform: 'darwin',
      repositoryRoot: '/repo with spaces/家計',
      argv: ['--verbose'],
      environment,
    })
    expect(plan).toEqual({
      command: process.execPath,
      args: ['/repo with spaces/家計/scripts/native-macos-build.mjs', 'release', '--', '--verbose'],
      cwd: '/repo with spaces/家計',
      environment,
    })
    for (const argv of [
      ['--target', 'x86_64-apple-darwin'],
      ['--target=universal-apple-darwin'],
      ['--bundles', 'app'],
      ['--config', 'alternate.json'],
      ['--debug'],
    ]) {
      expect(() => releaseModule.createDesktopReleasePlan({
        platform: 'darwin', repositoryRoot: '/repo', argv, environment: {},
      })).toThrow(/protected macOS release arguments/)
    }
    expect(() => releaseModule.createDesktopReleasePlan({
      platform: 'darwin', repositoryRoot: '/repo', argv: [],
      environment: { KAKEFLOW_MACOS_TARGET: 'x86_64-apple-darwin' },
    })).toThrow(/only aarch64-apple-darwin/)
  })

  it('preserves direct Tauri argv and environment outside macOS', () => {
    expect(releaseModule.createDesktopReleasePlan).toBeTypeOf('function')
    if (typeof releaseModule.createDesktopReleasePlan !== 'function') return
    const environment = { PATH: '/controlled/bin', CARGO_TARGET_DIR: '/build/output' }
    for (const platform of ['linux', 'win32']) {
      expect(releaseModule.createDesktopReleasePlan({
        platform,
        repositoryRoot: '/repo',
        argv: ['--target', 'synthetic-target', '--features', 'synthetic-feature'],
        environment,
      })).toEqual({
        command: 'tauri',
        args: ['build', '--target', 'synthetic-target', '--features', 'synthetic-feature'],
        cwd: '/repo',
        environment,
      })
    }
  })

  it('executes the resolved plan without rewriting argv or environment', async () => {
    expect(releaseModule.runDesktopRelease).toBeTypeOf('function')
    if (typeof releaseModule.runDesktopRelease !== 'function') return
    const plan = { command: 'tauri', args: ['build', '--verbose'], cwd: '/repo', environment: { PATH: '/bin' } }
    const calls: unknown[] = []
    await releaseModule.runDesktopRelease(plan, async (actual: unknown) => calls.push(actual))
    expect(calls).toEqual([plan])
  })

  it('keeps the package entry point on the dispatcher', async () => {
    const packageJson = JSON.parse(await readFile(path.resolve('package.json'), 'utf8'))
    expect(packageJson.scripts['desktop:release']).toBe('node scripts/desktop-release.mjs')
    expect(packageJson.scripts['desktop:build:mac:ci']).toBe('node scripts/native-macos-build.mjs release')
  })
})
