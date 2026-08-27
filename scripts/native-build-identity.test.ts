import { mkdir, mkdtemp, readFile, rm, stat, writeFile } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { describe, expect, it } from 'vitest'

const identityModulePath = './native-build-identity.mjs'
const identityModule = await import(identityModulePath).catch(() => ({}))

function fixture(root: string) {
  const repositoryRoot = path.join(root, 'checkout with spaces', '家計')
  const cargoTargetDir = path.join(root, 'neutral target', '成果物')
  const macosTarget = 'aarch64-apple-darwin'
  const releaseDirectory = path.join(cargoTargetDir, macosTarget, 'release')
  const app = path.join(releaseDirectory, 'bundle', 'macos', 'KakeFlow.app')
  return {
    context: { repositoryRoot, cargoTargetDir, macosTarget, artifactArchitecture: 'aarch64', releaseDirectory },
    artifacts: {
      app,
      executable: path.join(app, 'Contents', 'MacOS', 'kakeflow'),
      updaterArchive: `${app}.tar.gz`,
      updaterSignature: `${app}.tar.gz.sig`,
      dmg: path.join(releaseDirectory, 'bundle', 'dmg', 'KakeFlow_1.2.1_aarch64.dmg'),
      identityManifest: path.join(releaseDirectory, 'kakeflow-build-identity.json'),
    },
  }
}

async function writeSyntheticOutputs(artifacts: ReturnType<typeof fixture>['artifacts'], marker = 'fresh') {
  await Promise.all([
    mkdir(path.dirname(artifacts.executable), { recursive: true }),
    mkdir(path.join(artifacts.app, 'Contents', 'Resources'), { recursive: true }),
    mkdir(path.dirname(artifacts.dmg), { recursive: true }),
  ])
  await Promise.all([
    writeFile(artifacts.executable, `${marker} executable`),
    writeFile(path.join(artifacts.app, 'Contents', 'Resources', 'resource.bin'), `${marker} resource`),
    writeFile(artifacts.updaterArchive, `${marker} updater`),
    writeFile(artifacts.updaterSignature, `${marker} signature`),
    writeFile(artifacts.dmg, `${marker} dmg`),
  ])
}

describe('native build identity and isolation', () => {
  it('serializes each checkout/target and recovers only a verifiably dead owner when explicitly requested', async () => {
    expect(identityModule.acquireNativeBuildLock).toBeTypeOf('function')
    if (typeof identityModule.acquireNativeBuildLock !== 'function') return
    const root = await mkdtemp(path.join(os.tmpdir(), 'kakeflow-build-lock-test-'))
    const { context } = fixture(root)
    try {
      await mkdir(context.repositoryRoot, { recursive: true })
      const first = await identityModule.acquireNativeBuildLock(context, {
        pid: 41001, isProcessAlive: () => true, recoverStale: false,
      })
      await expect(identityModule.acquireNativeBuildLock(context, {
        pid: 41002, isProcessAlive: () => true, recoverStale: false,
      })).rejects.toThrow(/active build process 41001/)
      await expect(identityModule.acquireNativeBuildLock(context, {
        pid: 41002, isProcessAlive: () => true, recoverStale: true,
      })).rejects.toThrow(/active build process 41001/)
      await first.release()

      const stale = await identityModule.acquireNativeBuildLock(context, {
        pid: 41003, isProcessAlive: () => false, recoverStale: false,
      })
      await expect(identityModule.acquireNativeBuildLock(context, {
        pid: 41004, isProcessAlive: () => false, recoverStale: false,
      })).rejects.toThrow(/KAKEFLOW_RECOVER_STALE_BUILD_LOCK=1/)
      const recovered = await identityModule.acquireNativeBuildLock(context, {
        pid: 41004, isProcessAlive: () => false, recoverStale: true,
      })
      await expect(stale.release()).rejects.toThrow(/ownership changed/)
      await recovered.release()
    } finally {
      await rm(root, { recursive: true, force: true })
    }
  })

  it('cleans only explicit bundle outputs and publishes a success identity bound to source and artifact bytes', async () => {
    expect(identityModule.cleanNativeBuildOutputs).toBeTypeOf('function')
    expect(identityModule.writeNativeBuildIdentity).toBeTypeOf('function')
    expect(identityModule.verifyNativeBuildIdentity).toBeTypeOf('function')
    if (
      typeof identityModule.cleanNativeBuildOutputs !== 'function' ||
      typeof identityModule.writeNativeBuildIdentity !== 'function' ||
      typeof identityModule.verifyNativeBuildIdentity !== 'function'
    ) return
    const root = await mkdtemp(path.join(os.tmpdir(), 'kakeflow-build-identity-test-'))
    const { context, artifacts } = fixture(root)
    const buildInputIdentity = 'a'.repeat(64)
    try {
      await mkdir(context.repositoryRoot, { recursive: true })
      await writeSyntheticOutputs(artifacts, 'stale')
      await writeFile(artifacts.identityManifest, '{"status":"stale"}\n')
      const sibling = path.join(context.releaseDirectory, 'keep-unrelated.txt')
      await writeFile(sibling, 'keep')

      await identityModule.cleanNativeBuildOutputs({ context, artifacts })
      await expect(stat(artifacts.app)).rejects.toThrow()
      await expect(stat(artifacts.dmg)).rejects.toThrow()
      await expect(stat(artifacts.identityManifest)).rejects.toThrow()
      expect(await readFile(sibling, 'utf8')).toBe('keep')

      await writeSyntheticOutputs(artifacts)
      const manifest = await identityModule.writeNativeBuildIdentity({
        context, artifacts, version: '1.2.1', mode: 'release', buildInputIdentity,
      })
      expect(manifest).toMatchObject({
        schemaVersion: 1,
        status: 'succeeded',
        target: 'aarch64-apple-darwin',
        artifactArchitecture: 'aarch64',
        version: '1.2.1',
        mode: 'release',
        buildInputIdentity,
      })
      await expect(identityModule.verifyNativeBuildIdentity({
        repositoryRoot: context.repositoryRoot,
        releaseDirectory: context.releaseDirectory,
        version: '1.2.1',
        artifact: 'app',
        buildInputIdentity,
      })).resolves.toMatchObject({ status: 'succeeded' })
      await expect(identityModule.verifyNativeBuildIdentity({
        repositoryRoot: context.repositoryRoot,
        releaseDirectory: context.releaseDirectory,
        version: '1.2.1',
        artifact: 'dmg',
        artifactPath: artifacts.dmg,
        buildInputIdentity,
      })).resolves.toMatchObject({ status: 'succeeded' })

      await writeFile(path.join(artifacts.app, 'Contents', 'Resources', 'resource.bin'), 'mutated stale resource')
      await expect(identityModule.verifyNativeBuildIdentity({
        repositoryRoot: context.repositoryRoot,
        releaseDirectory: context.releaseDirectory,
        version: '1.2.1', artifact: 'app', buildInputIdentity,
      })).rejects.toThrow(/artifact identity mismatch/)
      await expect(identityModule.verifyNativeBuildIdentity({
        repositoryRoot: context.repositoryRoot,
        releaseDirectory: context.releaseDirectory,
        version: '1.2.1', artifact: 'dmg', artifactPath: artifacts.dmg,
        buildInputIdentity: 'b'.repeat(64),
      })).rejects.toThrow(/build input identity mismatch/)
    } finally {
      await rm(root, { recursive: true, force: true })
    }
  })

  it('computes a deterministic build-input identity without embedding the checkout path', async () => {
    expect(identityModule.computeNativeBuildInputIdentity).toBeTypeOf('function')
    if (typeof identityModule.computeNativeBuildInputIdentity !== 'function') return
    const repositoryRoot = path.resolve('.')
    const first = await identityModule.computeNativeBuildInputIdentity(repositoryRoot)
    const second = await identityModule.computeNativeBuildInputIdentity(repositoryRoot)
    expect(first).toMatch(/^[a-f0-9]{64}$/u)
    expect(second).toBe(first)
    expect(first).not.toContain(repositoryRoot)
  })
})
