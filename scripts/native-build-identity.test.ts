import { execFile as execFileCallback } from 'node:child_process'
import { chmod, mkdir, mkdtemp, readFile, rename, rm, stat, symlink, writeFile } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { promisify } from 'node:util'
import { describe, expect, it } from 'vitest'

const identityModulePath = './native-build-identity.mjs'
const identityModule = await import(identityModulePath).catch(() => ({}))
const execFile = promisify(execFileCallback)

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

async function writeBuildInputFixture(repositoryRoot: string) {
  const files = new Map([
    ['package.json', '{"version":"1.2.1"}\n'],
    ['package-lock.json', '{"lockfileVersion":3}\n'],
    ['Cargo.toml', '[workspace]\nmembers=["crates/kakeflow-core"]\n'],
    ['Cargo.lock', 'version = 4\n'],
    ['rust-toolchain.toml', '[toolchain]\nchannel="1.97.0"\n'],
    ['index.html', '<main id="root"></main>\n'],
    ['vite.config.ts', 'export default {}\n'],
    ['tsconfig.json', '{"files":[]}\n'],
    ['src/main.ts', 'export const app = true\n'],
    ['src/space name/日本語.ts', 'export const locale = "ja"\n'],
    ['src-tauri/Cargo.toml', '[package]\nname="kakeflow"\nversion="1.2.1"\n'],
    ['src-tauri/src/main.rs', 'fn main() {}\n'],
    ['scripts/native-macos-build.mjs', 'export const wrapper = true\n'],
    ['scripts/release-version-contract.mjs', 'export const artifactName = true\n'],
    ['scripts/stage-paddleocr-resources.mjs', 'export const stage = true\n'],
    ['crates/kakeflow-core/Cargo.toml', '[package]\nname="kakeflow-core"\nversion="1.2.1"\n'],
    ['crates/kakeflow-core/src/lib.rs', 'pub fn posting() {}\n'],
    ['public/pwa/icon-192.png', 'synthetic icon\n'],
    ['public/ocr/paddleocr/models/model with space 日本語.bin', 'synthetic paddle model\n'],
    ['src-tauri/generated-resources/ocr/tesseract', 'synthetic tesseract\n'],
    ['docs/evidence/result.md', 'post-build evidence only\n'],
  ])
  for (const [relative, contents] of files) {
    const destination = path.join(repositoryRoot, ...relative.split('/'))
    await mkdir(path.dirname(destination), { recursive: true })
    await writeFile(destination, contents)
  }
  await writeFile(path.join(repositoryRoot, '.gitignore'), [
    'public/ocr/paddleocr/',
    'src-tauri/generated-resources/ocr/*',
    'dist/',
    'target/',
    '',
  ].join('\n'))
  await execFile('git', ['init', '-q'], { cwd: repositoryRoot })
  await execFile('git', ['add', '.'], { cwd: repositoryRoot })
  await chmod(path.join(repositoryRoot, 'src-tauri', 'generated-resources', 'ocr', 'tesseract'), 0o755)
  return files
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

  it('uses physical checkout and target identities so symlink aliases contend on one lock', async () => {
    expect(identityModule.acquireNativeBuildLock).toBeTypeOf('function')
    if (typeof identityModule.acquireNativeBuildLock !== 'function') return
    const root = await mkdtemp(path.join(os.tmpdir(), 'kakeflow-build-alias-lock-test-'))
    const physical = fixture(path.join(root, 'physical'))
    const repositoryAlias = path.join(root, 'checkout alias')
    const targetAlias = path.join(root, 'target alias')
    try {
      await Promise.all([
        mkdir(physical.context.repositoryRoot, { recursive: true }),
        mkdir(physical.context.cargoTargetDir, { recursive: true }),
      ])
      await Promise.all([
        symlink(physical.context.repositoryRoot, repositoryAlias),
        symlink(physical.context.cargoTargetDir, targetAlias),
      ])
      const first = await identityModule.acquireNativeBuildLock(physical.context, {
        pid: 42001, isProcessAlive: () => true,
      })
      const aliasContext = {
        ...physical.context,
        repositoryRoot: repositoryAlias,
        cargoTargetDir: targetAlias,
        releaseDirectory: path.join(targetAlias, physical.context.macosTarget, 'release'),
      }
      await expect(identityModule.acquireNativeBuildLock(aliasContext, {
        pid: 42002, isProcessAlive: () => true,
      })).rejects.toThrow(/active build process 42001/)
      await first.release()
    } finally {
      await rm(root, { recursive: true, force: true })
    }
  })

  it('atomically quarantines an observed stale lock and preserves a concurrently replaced owner', async () => {
    expect(identityModule.acquireNativeBuildLock).toBeTypeOf('function')
    if (typeof identityModule.acquireNativeBuildLock !== 'function') return
    const root = await mkdtemp(path.join(os.tmpdir(), 'kakeflow-build-lock-race-test-'))
    const { context } = fixture(root)
    try {
      await mkdir(context.repositoryRoot, { recursive: true })
      const stale = await identityModule.acquireNativeBuildLock(context, {
        pid: 43001, isProcessAlive: () => false,
      })
      const replacement = { ...stale.owner, pid: 43002, token: 'replacement-owner-token' }
      let raced = false
      await expect(identityModule.acquireNativeBuildLock(context, {
        pid: 43003,
        isProcessAlive: () => false,
        recoverStale: true,
        renamePath: async (source: string, destination: string) => {
          if (!raced && source === stale.path) {
            raced = true
            await rm(source, { recursive: true, force: false })
            await mkdir(source)
            await writeFile(path.join(source, 'owner.json'), `${JSON.stringify(replacement)}\n`)
          }
          await rename(source, destination)
        },
      })).rejects.toThrow(/ownership changed during stale recovery/)
      expect(JSON.parse(await readFile(path.join(stale.path, 'owner.json'), 'utf8'))).toMatchObject(replacement)
    } finally {
      await rm(root, { recursive: true, force: true })
    }
  })

  it('restores an owned live lock if quarantine deletion fails during release', async () => {
    expect(identityModule.acquireNativeBuildLock).toBeTypeOf('function')
    if (typeof identityModule.acquireNativeBuildLock !== 'function') return
    const root = await mkdtemp(path.join(os.tmpdir(), 'kakeflow-build-lock-release-cleanup-test-'))
    const { context } = fixture(root)
    try {
      await mkdir(context.repositoryRoot, { recursive: true })
      const lock = await identityModule.acquireNativeBuildLock(context, {
        pid: 44001,
        isProcessAlive: () => true,
        removePath: async () => { throw new Error('synthetic quarantine deletion failure') },
      })
      await expect(lock.release()).rejects.toThrow(/synthetic quarantine deletion failure/)
      expect(JSON.parse(await readFile(path.join(lock.path, 'owner.json'), 'utf8'))).toMatchObject(lock.owner)
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

  it('rejects symlink traversal before removing any cleanup target', async () => {
    expect(identityModule.cleanNativeBuildOutputs).toBeTypeOf('function')
    if (typeof identityModule.cleanNativeBuildOutputs !== 'function') return
    const root = await mkdtemp(path.join(os.tmpdir(), 'kakeflow-build-cleanup-symlink-test-'))
    const { context, artifacts } = fixture(root)
    const outsideBundle = path.join(root, 'outside bundle')
    const outsideApp = path.join(outsideBundle, 'macos', 'KakeFlow.app')
    try {
      await Promise.all([
        mkdir(context.repositoryRoot, { recursive: true }),
        mkdir(path.join(context.releaseDirectory), { recursive: true }),
        mkdir(outsideApp, { recursive: true }),
      ])
      await writeFile(path.join(outsideApp, 'must-survive.txt'), 'preserve')
      await symlink(outsideBundle, path.join(context.releaseDirectory, 'bundle'))
      await expect(identityModule.cleanNativeBuildOutputs({ context, artifacts })).rejects.toThrow(/symlink traversal/)
      expect(await readFile(path.join(outsideApp, 'must-survive.txt'), 'utf8')).toBe('preserve')
    } finally {
      await rm(root, { recursive: true, force: true })
    }
  })

  it('hashes every effective tracked and ignored build input with deterministic records', async () => {
    expect(identityModule.computeNativeBuildInputIdentity).toBeTypeOf('function')
    expect(identityModule.collectNativeBuildInputRecords).toBeTypeOf('function')
    if (
      typeof identityModule.computeNativeBuildInputIdentity !== 'function' ||
      typeof identityModule.collectNativeBuildInputRecords !== 'function'
    ) return
    const root = await mkdtemp(path.join(os.tmpdir(), 'kakeflow-build-input-test-'))
    const repositoryRoot = path.join(root, 'checkout with spaces', '家計')
    try {
      await mkdir(repositoryRoot, { recursive: true })
      const fixtureFiles = await writeBuildInputFixture(repositoryRoot)
      const linkedInput = path.join(repositoryRoot, 'src', 'linked-input.ts')
      await symlink('main.ts', linkedInput)
      const first = await identityModule.computeNativeBuildInputIdentity(repositoryRoot)
      const second = await identityModule.computeNativeBuildInputIdentity(repositoryRoot)
      expect(first).toMatch(/^[a-f0-9]{64}$/u)
      expect(second).toBe(first)
      expect(first).not.toContain(repositoryRoot)

      const records = await identityModule.collectNativeBuildInputRecords(repositoryRoot)
      expect(records.map((record: { path: string }) => record.path)).toEqual(
        [...records.map((record: { path: string }) => record.path)].sort(),
      )
      expect(records).toEqual(expect.arrayContaining([
        expect.objectContaining({ type: 'file', path: 'crates/kakeflow-core/src/lib.rs', length: expect.any(Number), digest: expect.stringMatching(/^[a-f0-9]{64}$/u), mode: '0644' }),
        expect.objectContaining({ type: 'file', path: 'rust-toolchain.toml' }),
        expect.objectContaining({ type: 'file', path: 'public/ocr/paddleocr/models/model with space 日本語.bin' }),
        expect.objectContaining({ type: 'file', path: 'src-tauri/generated-resources/ocr/tesseract', mode: '0755' }),
        expect.objectContaining({ type: 'symlink', path: 'src/linked-input.ts', target: 'main.ts' }),
      ]))

      for (const relative of [
        'crates/kakeflow-core/src/lib.rs',
        'rust-toolchain.toml',
        'public/pwa/icon-192.png',
        'public/ocr/paddleocr/models/model with space 日本語.bin',
        'scripts/release-version-contract.mjs',
        'src-tauri/generated-resources/ocr/tesseract',
      ]) {
        const destination = path.join(repositoryRoot, ...relative.split('/'))
        const original = fixtureFiles.get(relative) ?? ''
        await writeFile(destination, `${original}mutation\n`)
        expect(await identityModule.computeNativeBuildInputIdentity(repositoryRoot), relative).not.toBe(first)
        await writeFile(destination, original)
        if (relative.endsWith('tesseract')) await chmod(destination, 0o755)
      }

      const executable = path.join(repositoryRoot, 'scripts', 'native-macos-build.mjs')
      await chmod(executable, 0o755)
      expect(await identityModule.computeNativeBuildInputIdentity(repositoryRoot)).not.toBe(first)
      await chmod(executable, 0o644)

      const linkedDigest = await identityModule.computeNativeBuildInputIdentity(repositoryRoot)
      await rm(linkedInput)
      await symlink('space name/日本語.ts', linkedInput)
      expect(await identityModule.computeNativeBuildInputIdentity(repositoryRoot)).not.toBe(linkedDigest)

      await writeFile(path.join(repositoryRoot, 'docs', 'evidence', 'result.md'), 'updated after build\n')
      await rm(linkedInput)
      await symlink('main.ts', linkedInput)
      expect(await identityModule.computeNativeBuildInputIdentity(repositoryRoot)).toBe(first)
    } finally {
      await rm(root, { recursive: true, force: true })
    }
  })
})
