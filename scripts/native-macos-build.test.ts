import { mkdir, mkdtemp, readFile, realpath, rm, stat, symlink, writeFile } from 'node:fs/promises'
import os from 'node:os'
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

  it('supports configured neutral target directories with spaces and non-ASCII names for arm64', () => {
    expect(nativeModule.resolveMacBuildContext).toBeTypeOf('function')
    if (typeof nativeModule.resolveMacBuildContext !== 'function') return
    const context = nativeModule.resolveMacBuildContext({
      repositoryRoot: '/Users/synthetic/家計',
      homeDirectory: '/Users/synthetic',
      temporaryDirectory: '/private/tmp',
      cargoTargetDir: '/private/tmp/KakeFlow Build/成果物',
      macosTarget: 'aarch64-apple-darwin',
    })
    expect(context).toMatchObject({
      cargoTargetDir: '/private/tmp/KakeFlow Build/成果物',
      macosTarget: 'aarch64-apple-darwin',
      artifactArchitecture: 'aarch64',
    })
    expect(context.releaseDirectory).toBe('/private/tmp/KakeFlow Build/成果物/aarch64-apple-darwin/release')
  })

  it('canonicalizes checkout and configured or derived target aliases to physical paths', async () => {
    expect(nativeModule.resolveMacBuildContext).toBeTypeOf('function')
    if (typeof nativeModule.resolveMacBuildContext !== 'function') return
    const temporaryRoot = await mkdtemp(path.join(os.tmpdir(), 'kakeflow-physical-context-test-'))
    const physicalCheckout = path.join(temporaryRoot, 'physical checkout', '家計')
    const checkoutAlias = path.join(temporaryRoot, 'checkout alias')
    const physicalTarget = path.join(temporaryRoot, 'physical target', '成果物')
    const targetAlias = path.join(temporaryRoot, 'target alias')
    const physicalTemporary = path.join(temporaryRoot, 'physical temporary')
    const temporaryAlias = path.join(temporaryRoot, 'temporary alias')
    try {
      await Promise.all([
        mkdir(physicalCheckout, { recursive: true }),
        mkdir(physicalTarget, { recursive: true }),
        mkdir(physicalTemporary, { recursive: true }),
      ])
      await Promise.all([
        symlink(physicalCheckout, checkoutAlias),
        symlink(physicalTarget, targetAlias),
        symlink(physicalTemporary, temporaryAlias),
      ])
      const configured = nativeModule.resolveMacBuildContext({
        repositoryRoot: checkoutAlias,
        cargoTargetDir: targetAlias,
        macosTarget: 'aarch64-apple-darwin',
        homeDirectory: path.join(temporaryRoot, 'personal home'),
      })
      expect(configured.repositoryRoot).toBe(await realpath(physicalCheckout))
      expect(configured.cargoTargetDir).toBe(await realpath(physicalTarget))

      const derived = nativeModule.resolveMacBuildContext({
        repositoryRoot: checkoutAlias,
        temporaryDirectory: temporaryAlias,
        architecture: 'arm64',
        homeDirectory: path.join(temporaryRoot, 'personal home'),
      })
      expect(derived.repositoryRoot).toBe(await realpath(physicalCheckout))
      expect(derived.cargoTargetDir).toMatch(new RegExp(`^${(await realpath(physicalTemporary)).replace(/[.*+?^${}()|[\]\\]/gu, '\\$&')}${path.sep}kakeflow-cargo-target-`))
    } finally {
      await rm(temporaryRoot, { recursive: true, force: true })
    }
  })

  it('rejects a neutral-looking target symlink that resolves into a personal root', async () => {
    expect(nativeModule.resolveMacBuildContext).toBeTypeOf('function')
    if (typeof nativeModule.resolveMacBuildContext !== 'function') return
    const temporaryRoot = await mkdtemp(path.join(os.tmpdir(), 'kakeflow-personal-target-link-test-'))
    const repositoryRoot = path.join(temporaryRoot, 'checkout')
    const personalHome = path.join(temporaryRoot, 'personal home')
    const physicalTarget = path.join(personalHome, 'private target')
    const targetAlias = path.join(temporaryRoot, 'neutral target alias')
    try {
      await Promise.all([
        mkdir(repositoryRoot, { recursive: true }),
        mkdir(physicalTarget, { recursive: true }),
      ])
      await symlink(physicalTarget, targetAlias)
      expect(() => nativeModule.resolveMacBuildContext({
        repositoryRoot,
        cargoTargetDir: targetAlias,
        macosTarget: 'aarch64-apple-darwin',
        homeDirectory: personalHome,
      })).toThrow(/personal build root/)
    } finally {
      await rm(temporaryRoot, { recursive: true, force: true })
    }
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
      repositoryRoot: '/repo', homeDirectory: '/Users/synthetic', temporaryDirectory: '/private/tmp', macosTarget: '', architecture: 'ia32',
    })).toThrow(/Unsupported macOS architecture/)
    expect(() => nativeModule.resolveMacBuildContext({
      repositoryRoot: '/repo', homeDirectory: '/Users/synthetic', temporaryDirectory: '/private/tmp', macosTarget: 'i686-apple-darwin',
    })).toThrow(/Unsupported macOS target/)
    for (const macosTarget of ['x86_64-apple-darwin', 'universal-apple-darwin']) {
      expect(() => nativeModule.resolveMacBuildContext({
        repositoryRoot: '/repo', homeDirectory: '/Users/synthetic', temporaryDirectory: '/private/tmp', macosTarget,
      })).toThrow(/only aarch64-apple-darwin/)
    }
    expect(() => nativeModule.resolveMacBuildContext({
      repositoryRoot: '/repo', homeDirectory: '/Users/synthetic', temporaryDirectory: '/private/tmp', macosTarget: '', architecture: 'x64',
    })).toThrow(/only arm64/)
  })

  it('builds with encoded compile-time remapping and no post-link command', () => {
    expect(nativeModule.createMacBuildPlan).toBeTypeOf('function')
    if (typeof nativeModule.createMacBuildPlan !== 'function') return
    const plan = nativeModule.createMacBuildPlan({
      bundle: 'dmg', version: '1.2.1',
      repositoryRoot: '/Users/synthetic/Repo With Spaces/家計',
      homeDirectory: '/Users/synthetic',
      temporaryDirectory: '/private/tmp',
      architecture: 'arm64',
      platform: 'darwin',
      environment: { CARGO_ENCODED_RUSTFLAGS: '-C\u001ftarget-cpu=apple-m1' },
    })
    expect(plan.commands.map((command: { args: string[] }) => command.args)).toEqual([
      ['/Users/synthetic/Repo With Spaces/家計/scripts/verify-ocr-resources.mjs', '--target', 'macos-arm64', '--expected-architecture', 'arm64'],
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
      bundle: 'app', version: '1.2.1', repositoryRoot: '/repo', homeDirectory: '/Users/synthetic', temporaryDirectory: '/private/tmp',
      architecture: 'arm64', platform: 'darwin', environment: { RUSTFLAGS: '-C target-cpu=native' },
    })).toThrow(/CARGO_ENCODED_RUSTFLAGS/)
    expect(() => nativeModule.createMacBuildPlan({
      bundle: 'app', version: '1.2.1', repositoryRoot: '/repo', homeDirectory: '/Users/synthetic', temporaryDirectory: '/private/tmp',
      architecture: 'arm64', platform: 'linux', environment: {},
    })).toThrow(/macOS only/)
  })

  it('keeps generic macOS release arguments behind the fixed target and bundle boundary', () => {
    expect(nativeModule.createMacBuildPlan).toBeTypeOf('function')
    if (typeof nativeModule.createMacBuildPlan !== 'function') return
    const plan = nativeModule.createMacBuildPlan({
      bundle: 'release', version: '1.2.1', tauriArgs: ['--verbose'], repositoryRoot: '/repo', homeDirectory: '/Users/synthetic',
      temporaryDirectory: '/private/tmp', architecture: 'arm64', platform: 'darwin', environment: {},
    })
    expect(plan.commands.at(-1)?.args).toEqual([
      'build', '--target', 'aarch64-apple-darwin', '--ci', '--verbose',
    ])
    for (const tauriArgs of [
      ['--target', 'x86_64-apple-darwin'], ['--target=universal-apple-darwin'],
      ['--bundles', 'app'], ['--config', 'alternate.json'], ['--debug'],
    ]) {
      expect(() => nativeModule.createMacBuildPlan({
        bundle: 'release', version: '1.2.1', tauriArgs, repositoryRoot: '/repo', homeDirectory: '/Users/synthetic',
        temporaryDirectory: '/private/tmp', architecture: 'arm64', platform: 'darwin', environment: {},
      })).toThrow(/protected macOS release arguments/)
    }
  })

  it('removes stale outputs before commands and writes identity only after complete success', async () => {
    expect(nativeModule.runIsolatedMacBuild).toBeTypeOf('function')
    if (typeof nativeModule.runIsolatedMacBuild !== 'function') return
    const temporaryRoot = await mkdtemp(path.join(os.tmpdir(), 'kakeflow-isolated-build-test-'))
    const repositoryRoot = path.join(temporaryRoot, 'checkout with spaces', '家計')
    const cargoTargetDir = path.join(temporaryRoot, 'neutral target', '成果物')
    try {
      await mkdir(repositoryRoot, { recursive: true })
      const plan = nativeModule.createMacBuildPlan({
        bundle: 'release', version: '1.2.1', repositoryRoot, cargoTargetDir,
        homeDirectory: '/Users/synthetic', temporaryDirectory: '/private/tmp', architecture: 'arm64',
        platform: 'darwin', environment: {},
      })
      expect(plan.artifacts.identityManifest).toBe(path.join(plan.context.releaseDirectory, 'kakeflow-build-identity.json'))
      await Promise.all([
        mkdir(path.dirname(plan.artifacts.executable), { recursive: true }),
        mkdir(path.dirname(plan.artifacts.dmg), { recursive: true }),
      ])
      await Promise.all([
        writeFile(plan.artifacts.executable, 'stale executable'),
        writeFile(plan.artifacts.updaterArchive, 'stale updater'),
        writeFile(plan.artifacts.updaterSignature, 'stale signature'),
        writeFile(plan.artifacts.dmg, 'stale dmg'),
        writeFile(plan.artifacts.identityManifest, '{"status":"stale"}\n'),
      ])
      const executed: string[] = []
      await nativeModule.runIsolatedMacBuild(plan, {
        computeBuildInputIdentity: async () => 'a'.repeat(64),
        executeCommand: async (command: { phase: string }) => {
          executed.push(command.phase)
          if (command.phase !== 'build') return
          await expect(stat(plan.artifacts.app)).rejects.toThrow()
          await expect(stat(plan.artifacts.dmg)).rejects.toThrow()
          await expect(stat(plan.artifacts.identityManifest)).rejects.toThrow()
          await Promise.all([
            mkdir(path.dirname(plan.artifacts.executable), { recursive: true }),
            mkdir(path.join(plan.artifacts.app, 'Contents', 'Resources'), { recursive: true }),
            mkdir(path.dirname(plan.artifacts.dmg), { recursive: true }),
          ])
          await Promise.all([
            writeFile(plan.artifacts.executable, 'fresh executable'),
            writeFile(path.join(plan.artifacts.app, 'Contents', 'Resources', 'resource.bin'), 'fresh resource'),
            writeFile(plan.artifacts.updaterArchive, 'fresh updater'),
            writeFile(plan.artifacts.updaterSignature, 'fresh signature'),
            writeFile(plan.artifacts.dmg, 'fresh dmg'),
          ])
        },
      })
      expect(executed).toEqual(['preflight', 'preflight', 'build'])
      expect(JSON.parse(await readFile(plan.artifacts.identityManifest, 'utf8'))).toMatchObject({
        status: 'succeeded', mode: 'release', buildInputIdentity: 'a'.repeat(64),
      })
    } finally {
      await rm(temporaryRoot, { recursive: true, force: true })
    }
  })

  it('invalidates identity before output cleanup and leaves none after an interrupted build', async () => {
    expect(nativeModule.runIsolatedMacBuild).toBeTypeOf('function')
    if (typeof nativeModule.runIsolatedMacBuild !== 'function') return
    const temporaryRoot = await mkdtemp(path.join(os.tmpdir(), 'kakeflow-cleanup-order-test-'))
    const repositoryRoot = path.join(temporaryRoot, 'checkout')
    try {
      await mkdir(repositoryRoot, { recursive: true })
      const plan = nativeModule.createMacBuildPlan({
        bundle: 'release', version: '1.2.1', repositoryRoot,
        cargoTargetDir: path.join(temporaryRoot, 'target'), homeDirectory: '/Users/synthetic',
        architecture: 'arm64', platform: 'darwin', environment: {},
      })
      await mkdir(path.dirname(plan.artifacts.identityManifest), { recursive: true })
      await writeFile(plan.artifacts.identityManifest, '{"status":"stale"}\n')
      await expect(nativeModule.runIsolatedMacBuild(plan, {
        cleanOutputs: async () => {
          try {
            await stat(plan.artifacts.identityManifest)
            throw new Error('identity was not invalidated first')
          } catch (error: unknown) {
            if ((error as NodeJS.ErrnoException)?.code !== 'ENOENT') throw error
          }
          throw new Error('synthetic output cleanup failure')
        },
      })).rejects.toThrow('synthetic output cleanup failure')
      await expect(stat(plan.artifacts.identityManifest)).rejects.toThrow()
    } finally {
      await rm(temporaryRoot, { recursive: true, force: true })
    }
  })

  it('removes a newly published identity if final lock release fails', async () => {
    expect(nativeModule.runIsolatedMacBuild).toBeTypeOf('function')
    if (typeof nativeModule.runIsolatedMacBuild !== 'function') return
    const temporaryRoot = await mkdtemp(path.join(os.tmpdir(), 'kakeflow-release-failure-test-'))
    const repositoryRoot = path.join(temporaryRoot, 'checkout')
    try {
      await mkdir(repositoryRoot, { recursive: true })
      const plan = nativeModule.createMacBuildPlan({
        bundle: 'release', version: '1.2.1', repositoryRoot,
        cargoTargetDir: path.join(temporaryRoot, 'target'), homeDirectory: '/Users/synthetic',
        architecture: 'arm64', platform: 'darwin', environment: {},
      })
      await expect(nativeModule.runIsolatedMacBuild(plan, {
        computeBuildInputIdentity: async () => 'a'.repeat(64),
        acquireBuildLock: async () => ({ release: async () => { throw new Error('synthetic lock release failure') } }),
        executeCommand: async (command: { phase: string }) => {
          if (command.phase !== 'build') return
          await Promise.all([
            mkdir(path.dirname(plan.artifacts.executable), { recursive: true }),
            mkdir(path.join(plan.artifacts.app, 'Contents', 'Resources'), { recursive: true }),
            mkdir(path.dirname(plan.artifacts.dmg), { recursive: true }),
          ])
          await Promise.all([
            writeFile(plan.artifacts.executable, 'fresh executable'),
            writeFile(path.join(plan.artifacts.app, 'Contents', 'Resources', 'resource.bin'), 'fresh resource'),
            writeFile(plan.artifacts.updaterArchive, 'fresh updater'),
            writeFile(plan.artifacts.updaterSignature, 'fresh signature'),
            writeFile(plan.artifacts.dmg, 'fresh dmg'),
          ])
        },
      })).rejects.toThrow('synthetic lock release failure')
      await expect(stat(plan.artifacts.identityManifest)).rejects.toThrow()
    } finally {
      await rm(temporaryRoot, { recursive: true, force: true })
    }
  })

  it('removes an identity if publication writes it and then reports failure', async () => {
    expect(nativeModule.runIsolatedMacBuild).toBeTypeOf('function')
    if (typeof nativeModule.runIsolatedMacBuild !== 'function') return
    const identityModule = await import('./native-build-identity.mjs')
    const temporaryRoot = await mkdtemp(path.join(os.tmpdir(), 'kakeflow-publication-failure-test-'))
    const repositoryRoot = path.join(temporaryRoot, 'checkout')
    try {
      await mkdir(repositoryRoot, { recursive: true })
      const plan = nativeModule.createMacBuildPlan({
        bundle: 'release', version: '1.2.1', repositoryRoot,
        cargoTargetDir: path.join(temporaryRoot, 'target'), homeDirectory: '/Users/synthetic',
        architecture: 'arm64', platform: 'darwin', environment: {},
      })
      await expect(nativeModule.runIsolatedMacBuild(plan, {
        computeBuildInputIdentity: async () => 'a'.repeat(64),
        executeCommand: async (command: { phase: string }) => {
          if (command.phase !== 'build') return
          await Promise.all([
            mkdir(path.dirname(plan.artifacts.executable), { recursive: true }),
            mkdir(path.join(plan.artifacts.app, 'Contents', 'Resources'), { recursive: true }),
            mkdir(path.dirname(plan.artifacts.dmg), { recursive: true }),
          ])
          await Promise.all([
            writeFile(plan.artifacts.executable, 'fresh executable'),
            writeFile(path.join(plan.artifacts.app, 'Contents', 'Resources', 'resource.bin'), 'fresh resource'),
            writeFile(plan.artifacts.updaterArchive, 'fresh updater'),
            writeFile(plan.artifacts.updaterSignature, 'fresh signature'),
            writeFile(plan.artifacts.dmg, 'fresh dmg'),
          ])
        },
        writeBuildIdentity: async (options: Parameters<typeof identityModule.writeNativeBuildIdentity>[0]) => {
          await identityModule.writeNativeBuildIdentity(options)
          throw new Error('synthetic publication failure')
        },
      })).rejects.toThrow('synthetic publication failure')
      await expect(stat(plan.artifacts.identityManifest)).rejects.toThrow()
    } finally {
      await rm(temporaryRoot, { recursive: true, force: true })
    }
  })

  it('combines a build interruption with lock-release cleanup failure without masking either', async () => {
    expect(nativeModule.runIsolatedMacBuild).toBeTypeOf('function')
    if (typeof nativeModule.runIsolatedMacBuild !== 'function') return
    const temporaryRoot = await mkdtemp(path.join(os.tmpdir(), 'kakeflow-failed-build-test-'))
    const repositoryRoot = path.join(temporaryRoot, 'checkout')
    try {
      await mkdir(repositoryRoot, { recursive: true })
      const plan = nativeModule.createMacBuildPlan({
        bundle: 'release', version: '1.2.1', repositoryRoot,
        cargoTargetDir: path.join(temporaryRoot, 'target'), homeDirectory: '/Users/synthetic',
        architecture: 'arm64', platform: 'darwin', environment: {},
      })
      await mkdir(path.dirname(plan.artifacts.identityManifest), { recursive: true })
      await writeFile(plan.artifacts.identityManifest, '{"status":"stale"}\n')
      const failure = nativeModule.runIsolatedMacBuild(plan, {
        computeBuildInputIdentity: async () => 'a'.repeat(64),
        acquireBuildLock: async () => ({ release: async () => { throw new Error('synthetic lock cleanup failure') } }),
        executeCommand: async () => { throw new Error('synthetic build failure') },
      })
      await expect(failure).rejects.toThrow(/synthetic build failure[\s\S]*synthetic lock cleanup failure/)
      await expect(stat(plan.artifacts.identityManifest)).rejects.toThrow()
    } finally {
      await rm(temporaryRoot, { recursive: true, force: true })
    }
  })

  it('keeps Tauri free of a global post-link bundle hook', async () => {
    const config = JSON.parse(await readFile(path.resolve('src-tauri/tauri.conf.json'), 'utf8'))
    expect(config.build.beforeBundleCommand).toBeUndefined()
  })
})
