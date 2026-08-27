import { readFile } from 'node:fs/promises'
import path from 'node:path'
import { describe, expect, it } from 'vitest'

const nativeModule = await import('./native-macos-build.mjs').catch(() => ({}))

describe('native macOS build boundary', () => {
  it('uses a neutral deterministic target for repositories inside a personal home', () => {
    expect(nativeModule.resolveMacBuildContext).toBeTypeOf('function')
    if (typeof nativeModule.resolveMacBuildContext !== 'function') return
    const context = nativeModule.resolveMacBuildContext({
      repositoryRoot: '/Users/synthetic/Repo With Spaces/家計',
      homeDirectory: '/Users/synthetic',
      temporaryDirectory: '/private/tmp',
      architecture: 'arm64',
    })
    expect(context.cargoTargetDir).toMatch(/^\/private\/tmp\/kakeflow-cargo-target-[a-f0-9]{12}$/u)
    expect(context.cargoTargetDir).not.toContain('synthetic')
    expect(context.macosTarget).toBe('aarch64-apple-darwin')
    expect(context.artifactArchitecture).toBe('aarch64')
  })

  it('supports configured target directories with spaces and non-ASCII names', () => {
    expect(nativeModule.resolveMacBuildContext).toBeTypeOf('function')
    if (typeof nativeModule.resolveMacBuildContext !== 'function') return
    const context = nativeModule.resolveMacBuildContext({
      repositoryRoot: '/Users/synthetic/家計',
      homeDirectory: '/Users/synthetic',
      temporaryDirectory: '/private/tmp',
      cargoTargetDir: '/private/tmp/KakeFlow Build/成果物',
      macosTarget: 'universal-apple-darwin',
    })
    expect(context).toMatchObject({
      cargoTargetDir: '/private/tmp/KakeFlow Build/成果物',
      macosTarget: 'universal-apple-darwin',
      artifactArchitecture: 'universal',
    })
    expect(context.releaseDirectory).toBe('/private/tmp/KakeFlow Build/成果物/universal-apple-darwin/release')
  })

  it('fails closed for personal target roots and unsupported architectures', () => {
    expect(nativeModule.resolveMacBuildContext).toBeTypeOf('function')
    if (typeof nativeModule.resolveMacBuildContext !== 'function') return
    expect(() => nativeModule.resolveMacBuildContext({
      repositoryRoot: '/Users/synthetic/repo',
      homeDirectory: '/Users/synthetic',
      temporaryDirectory: '/private/tmp',
      cargoTargetDir: '/Users/synthetic/target',
      macosTarget: 'aarch64-apple-darwin',
    })).toThrow(/personal build root/)
    expect(() => nativeModule.resolveMacBuildContext({
      repositoryRoot: '/repo', homeDirectory: '/Users/synthetic', temporaryDirectory: '/private/tmp', architecture: 'ia32',
    })).toThrow(/Unsupported macOS architecture/)
    expect(() => nativeModule.resolveMacBuildContext({
      repositoryRoot: '/repo', homeDirectory: '/Users/synthetic', temporaryDirectory: '/private/tmp', macosTarget: 'i686-apple-darwin',
    })).toThrow(/Unsupported macOS target/)
  })

  it('builds with encoded compile-time remapping and no post-link command', () => {
    expect(nativeModule.createMacBuildPlan).toBeTypeOf('function')
    if (typeof nativeModule.createMacBuildPlan !== 'function') return
    const plan = nativeModule.createMacBuildPlan({
      bundle: 'dmg',
      repositoryRoot: '/Users/synthetic/Repo With Spaces/家計',
      homeDirectory: '/Users/synthetic',
      temporaryDirectory: '/private/tmp',
      architecture: 'arm64',
      platform: 'darwin',
      environment: { CARGO_ENCODED_RUSTFLAGS: '-C\u001ftarget-cpu=apple-m1' },
    })
    expect(plan.commands.map((command: { args: string[] }) => command.args)).toEqual([
      ['/Users/synthetic/Repo With Spaces/家計/scripts/verify-ocr-resources.mjs'],
      ['/Users/synthetic/Repo With Spaces/家計/scripts/stage-paddleocr-resources.mjs', '--verify-only'],
      ['build', '--bundles', 'dmg', '--target', 'aarch64-apple-darwin', '--ci'],
    ])
    expect(plan.environment.CARGO_TARGET_DIR).toMatch(/^\/private\/tmp\/kakeflow-cargo-target-/u)
    expect(plan.environment.CARGO_ENCODED_RUSTFLAGS.split('\u001f')).toEqual([
      '-C',
      'target-cpu=apple-m1',
      '--remap-path-prefix=/Users/synthetic=/kakeflow-build-home',
      '--remap-path-scope=all',
    ])
    expect(plan.commands).not.toEqual(expect.arrayContaining([
      expect.objectContaining({ phase: 'post-link' }),
    ]))
  })

  it('rejects ambiguous unencoded Rust flags instead of dropping them', () => {
    expect(nativeModule.createMacBuildPlan).toBeTypeOf('function')
    if (typeof nativeModule.createMacBuildPlan !== 'function') return
    expect(() => nativeModule.createMacBuildPlan({
      bundle: 'app', repositoryRoot: '/repo', homeDirectory: '/Users/synthetic', temporaryDirectory: '/private/tmp',
      architecture: 'arm64', platform: 'darwin', environment: { RUSTFLAGS: '-C target-cpu=native' },
    })).toThrow(/CARGO_ENCODED_RUSTFLAGS/)
    expect(() => nativeModule.createMacBuildPlan({
      bundle: 'app', repositoryRoot: '/repo', homeDirectory: '/Users/synthetic', temporaryDirectory: '/private/tmp',
      architecture: 'arm64', platform: 'linux', environment: {},
    })).toThrow(/macOS only/)
  })

  it('keeps Tauri free of a global post-link bundle hook', async () => {
    const config = JSON.parse(await readFile(path.resolve('src-tauri/tauri.conf.json'), 'utf8'))
    expect(config.build.beforeBundleCommand).toBeUndefined()
  })
})
