import { execFile as execFileCallback } from 'node:child_process'
import { createHash, randomUUID } from 'node:crypto'
import { lstatSync, realpathSync } from 'node:fs'
import { lstat, mkdir, readFile, readdir, readlink, rename, rm, stat, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { promisify } from 'node:util'

const execFile = promisify(execFileCallback)
const identityFilename = 'kakeflow-build-identity.json'
const buildInputPrefixes = [
  '.cargo/',
  'crates/kakeflow-core/',
  'packaging/ocr/',
  'public/',
  'src/',
  'src-tauri/',
]
const buildInputExact = new Set([
  '.nvmrc',
  'Cargo.lock',
  'Cargo.toml',
  'index.html',
  'ocr-fixture-renderer.html',
  'ocr-harness.html',
  'ocr-regression.html',
  'package-lock.json',
  'package.json',
  'rust-toolchain.toml',
  'scripts/desktop-release.mjs',
  'scripts/native-build-identity.mjs',
  'scripts/native-macos-build.mjs',
  'scripts/ocr-resource-contract.mjs',
  'scripts/paddleocr-resource-metadata.mjs',
  'scripts/release-version-contract.mjs',
  'scripts/stage-paddleocr-resources.mjs',
  'scripts/verify-ocr-resources.mjs',
  'tsconfig.app.json',
  'tsconfig.json',
  'tsconfig.node.json',
  'vite.config.ts',
])
const ignoredBuildInputRoots = [
  'public/ocr/paddleocr',
  'src-tauri/generated-resources/ocr',
]

function sha256(value) {
  return createHash('sha256').update(value).digest('hex')
}

export function resolvePhysicalPath(candidate) {
  let cursor = path.resolve(candidate)
  const suffix = []
  for (;;) {
    try {
      lstatSync(cursor)
      break
    } catch (error) {
      if (error?.code !== 'ENOENT') throw error
      const parent = path.dirname(cursor)
      if (parent === cursor) throw new Error(`No existing ancestor for path: ${candidate}`)
      suffix.unshift(path.basename(cursor))
      cursor = parent
    }
  }
  return path.join(realpathSync.native(cursor), ...suffix)
}

function checkoutIdentity(repositoryRoot) {
  return sha256(resolvePhysicalPath(repositoryRoot))
}

function portable(relative) {
  return relative.split(path.sep).join('/')
}

function includedBuildInput(relative) {
  return buildInputExact.has(relative) || buildInputPrefixes.some((candidate) => relative.startsWith(candidate))
}

async function filesystemEntries(root, relativeRoot) {
  const entries = []
  const visit = async (relative) => {
    const absolute = path.join(root, ...relative.split('/'))
    let metadata
    try {
      metadata = await lstat(absolute)
    } catch (error) {
      if (error?.code === 'ENOENT') return
      throw error
    }
    if (metadata.isSymbolicLink() || metadata.isFile()) {
      entries.push(relative)
      return
    }
    if (!metadata.isDirectory()) return
    const children = await readdir(absolute)
    children.sort()
    for (const child of children) await visit(`${relative}/${child}`)
  }
  await visit(relativeRoot)
  return entries
}

function fileMode(metadata) {
  return (metadata.mode & 0o7777).toString(8).padStart(4, '0')
}

async function buildInputRecord(root, relative) {
  const absolute = path.join(root, ...relative.split('/'))
  try {
    const metadata = await lstat(absolute)
    if (metadata.isSymbolicLink()) {
      const target = await readlink(absolute)
      const targetBytes = Buffer.from(target, 'utf8')
      return { type: 'symlink', path: relative, target, mode: fileMode(metadata), length: targetBytes.length, digest: sha256(targetBytes) }
    }
    if (metadata.isFile()) {
      const bytes = await readFile(absolute)
      return { type: 'file', path: relative, mode: fileMode(metadata), length: bytes.length, digest: sha256(bytes) }
    }
    return { type: 'unsupported', path: relative, mode: fileMode(metadata), length: 0, digest: sha256('') }
  } catch (error) {
    if (error?.code !== 'ENOENT') throw error
    return { type: 'deleted', path: relative, mode: '0000', length: 0, digest: sha256('') }
  }
}

export async function collectNativeBuildInputRecords(repositoryRoot) {
  const root = resolvePhysicalPath(repositoryRoot)
  const { stdout } = await execFile(
    'git', ['ls-files', '--cached', '--others', '--exclude-standard', '-z', '--'],
    { cwd: root, encoding: 'buffer', maxBuffer: 64 * 1024 * 1024 },
  )
  const files = new Set(stdout.toString('utf8').split('\0').filter(Boolean).filter(includedBuildInput))
  for (const ignoredRoot of ignoredBuildInputRoots) {
    for (const relative of await filesystemEntries(root, ignoredRoot)) files.add(relative)
  }
  return Promise.all([...files].sort().map((relative) => buildInputRecord(root, relative)))
}

export async function computeNativeBuildInputIdentity(repositoryRoot) {
  const records = await collectNativeBuildInputRecords(repositoryRoot)
  const digest = createHash('sha256')
  for (const record of records) {
    const encoded = Buffer.from(JSON.stringify(record), 'utf8')
    const length = Buffer.alloc(8)
    length.writeBigUInt64BE(BigInt(encoded.length))
    digest.update(length)
    digest.update(encoded)
  }
  return digest.digest('hex')
}

function defaultProcessAlive(pid) {
  try {
    process.kill(pid, 0)
    return true
  } catch (error) {
    if (error?.code === 'ESRCH') return false
    return true
  }
}

function lockDirectoryFor(context) {
  const checkout = checkoutIdentity(context.repositoryRoot)
  return path.join(
    resolvePhysicalPath(context.cargoTargetDir),
    '.kakeflow-build-locks',
    `${checkout}-${context.macosTarget}.lock`,
  )
}

async function readLockOwner(lockDirectory) {
  try {
    const metadata = await lstat(lockDirectory)
    if (!metadata.isDirectory() || metadata.isSymbolicLink()) return null
    return JSON.parse(await readFile(path.join(lockDirectory, 'owner.json'), 'utf8'))
  } catch {
    return null
  }
}

function validLockOwner(owner, expectedCheckout, target) {
  return owner?.schemaVersion === 1 && Number.isInteger(owner.pid) && owner.pid > 0 &&
    typeof owner.token === 'string' && owner.token.length > 0 &&
    owner.checkoutIdentity === expectedCheckout && owner.target === target
}

function sameLockOwner(left, right) {
  return left?.schemaVersion === right?.schemaVersion && left?.pid === right?.pid &&
    left?.token === right?.token && left?.checkoutIdentity === right?.checkoutIdentity &&
    left?.target === right?.target
}

async function restoreQuarantinedLock(quarantine, lockDirectory, renamePath) {
  try {
    await renamePath(quarantine, lockDirectory)
    return `restored at ${lockDirectory}`
  } catch (error) {
    return `preserved at ${quarantine}; restore failed: ${error instanceof Error ? error.message : error}`
  }
}

async function quarantineObservedLock(lockDirectory, observed, {
  renamePath,
  removePath,
  operation,
}) {
  const quarantine = path.join(
    path.dirname(lockDirectory),
    `.${path.basename(lockDirectory)}.${operation}-${randomUUID()}`,
  )
  await renamePath(lockDirectory, quarantine)
  const moved = await readLockOwner(quarantine)
  if (!sameLockOwner(moved, observed)) {
    const preservation = await restoreQuarantinedLock(quarantine, lockDirectory, renamePath)
    throw new Error(`Native build lock ownership changed during ${operation}; replacement ${preservation}`)
  }
  try {
    await removePath(quarantine, { recursive: true, force: false })
  } catch (error) {
    const preservation = await restoreQuarantinedLock(quarantine, lockDirectory, renamePath)
    throw new Error(`Native build lock quarantine deletion failed during ${operation}: ${error instanceof Error ? error.message : error}; owner ${preservation}`)
  }
}

export async function acquireNativeBuildLock(context, {
  pid = process.pid,
  isProcessAlive = defaultProcessAlive,
  recoverStale = process.env.KAKEFLOW_RECOVER_STALE_BUILD_LOCK === '1',
  renamePath = rename,
  removePath = rm,
} = {}) {
  const lockDirectory = lockDirectoryFor(context)
  const lockParent = path.dirname(lockDirectory)
  const expectedCheckout = checkoutIdentity(context.repositoryRoot)
  await mkdir(lockParent, { recursive: true })

  const acquire = async () => {
    try {
      await mkdir(lockDirectory)
    } catch (error) {
      if (error?.code !== 'EEXIST') throw error
      return false
    }
    return true
  }

  if (!await acquire()) {
    const owner = await readLockOwner(lockDirectory)
    if (!validLockOwner(owner, expectedCheckout, context.macosTarget)) {
      throw new Error(`Native build lock metadata is invalid at ${lockDirectory}; inspect and remove only this exact lock directory manually`)
    }
    if (isProcessAlive(owner.pid)) {
      throw new Error(`Native build lock is held by active build process ${owner.pid} at ${lockDirectory}`)
    }
    if (!recoverStale) {
      throw new Error(`Native build lock may be stale at ${lockDirectory}; confirm process ${owner.pid} is gone, then retry with KAKEFLOW_RECOVER_STALE_BUILD_LOCK=1`)
    }
    await quarantineObservedLock(lockDirectory, owner, {
      renamePath, removePath, operation: 'stale recovery',
    })
    if (!await acquire()) throw new Error(`Native build lock was concurrently reacquired at ${lockDirectory}`)
  }

  const owner = {
    schemaVersion: 1,
    checkoutIdentity: expectedCheckout,
    target: context.macosTarget,
    pid,
    token: randomUUID(),
  }
  try {
    await writeFile(path.join(lockDirectory, 'owner.json'), `${JSON.stringify(owner)}\n`, { encoding: 'utf8', flag: 'wx' })
  } catch (error) {
    const quarantine = path.join(lockParent, `.${path.basename(lockDirectory)}.failed-acquire-${randomUUID()}`)
    try {
      await renamePath(lockDirectory, quarantine)
      const moved = await readLockOwner(quarantine)
      if (moved && !sameLockOwner(moved, owner)) {
        const preservation = await restoreQuarantinedLock(quarantine, lockDirectory, renamePath)
        throw new Error(`Native build lock ownership changed after owner-write failure; replacement ${preservation}`)
      }
      await removePath(quarantine, { recursive: true, force: false })
    } catch (cleanupError) {
      throw new AggregateError([error, cleanupError], `Native build lock owner write failed: ${error instanceof Error ? error.message : error}; cleanup failed: ${cleanupError instanceof Error ? cleanupError.message : cleanupError}`)
    }
    throw error
  }

  return {
    path: lockDirectory,
    owner,
    async release() {
      const current = await readLockOwner(lockDirectory)
      if (current?.token !== owner.token) throw new Error(`Native build lock ownership changed at ${lockDirectory}`)
      await quarantineObservedLock(lockDirectory, owner, {
        renamePath, removePath, operation: 'release',
      })
    },
  }
}

function assertWithinRelease(releaseDirectory, candidate) {
  const release = path.resolve(releaseDirectory)
  const resolved = path.resolve(candidate)
  if (resolved === release || !resolved.startsWith(`${release}${path.sep}`)) {
    throw new Error(`Refusing native build cleanup outside the resolved release directory: ${resolved}`)
  }
  return resolved
}

async function assertPhysicalCleanupPath(context, candidate) {
  const cargoTarget = resolvePhysicalPath(context.cargoTargetDir)
  const release = assertWithinRelease(
    cargoTarget,
    resolvePhysicalPath(context.releaseDirectory),
  )
  const logicalRelease = path.resolve(context.releaseDirectory)
  const logicalCandidate = assertWithinRelease(logicalRelease, candidate)
  const resolved = path.join(release, path.relative(logicalRelease, logicalCandidate))
  const components = path.relative(cargoTarget, resolved).split(path.sep).filter(Boolean)
  let cursor = cargoTarget
  for (const component of components) {
    cursor = path.join(cursor, component)
    try {
      const metadata = await lstat(cursor)
      if (metadata.isSymbolicLink()) {
        throw new Error(`Refusing native build cleanup through symlink traversal: ${cursor}`)
      }
    } catch (error) {
      if (error?.code === 'ENOENT') break
      throw error
    }
  }
  const physicalCandidate = resolvePhysicalPath(resolved)
  if (physicalCandidate === release || !physicalCandidate.startsWith(`${release}${path.sep}`)) {
    throw new Error(`Refusing native build cleanup outside the physical release directory: ${physicalCandidate}`)
  }
  return resolved
}

export async function invalidateNativeBuildIdentity({ context, artifacts }) {
  const identity = await assertPhysicalCleanupPath(context, artifacts.identityManifest)
  await rm(identity, { force: true })
}

export async function cleanNativeBuildOutputs({ context, artifacts }) {
  await invalidateNativeBuildIdentity({ context, artifacts })
  const candidates = [
    artifacts.app,
    artifacts.updaterArchive,
    artifacts.updaterSignature,
    artifacts.dmg,
  ]
  for (const candidate of candidates) {
    const resolved = await assertPhysicalCleanupPath(context, candidate)
    await rm(resolved, { recursive: true, force: true })
  }
}

async function regularTreeEntries(directory, prefix = '') {
  const entries = []
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const absolute = path.join(directory, entry.name)
    const relative = portable(path.join(prefix, entry.name))
    if (entry.isDirectory()) entries.push(...await regularTreeEntries(absolute, relative))
    else if (entry.isFile()) entries.push({ type: 'file', absolute, relative })
    else if (entry.isSymbolicLink()) entries.push({ type: 'link', absolute, relative })
  }
  return entries.sort((left, right) => left.relative.localeCompare(right.relative, 'en'))
}

async function treeIdentity(directory) {
  const digest = createHash('sha256')
  const entries = await regularTreeEntries(directory)
  for (const entry of entries) {
    digest.update(`${entry.type}\0${entry.relative}\0`)
    if (entry.type === 'link') digest.update(`${await readlink(entry.absolute)}\0`)
    else digest.update(Buffer.concat([await readFile(entry.absolute), Buffer.from('\0')]))
  }
  return { sha256: digest.digest('hex'), files: entries.length }
}

async function fileIdentity(file) {
  const bytes = await readFile(file)
  return { sha256: sha256(bytes), bytes: bytes.length }
}

function relativeArtifact(releaseDirectory, candidate) {
  const resolved = assertWithinRelease(releaseDirectory, candidate)
  return portable(path.relative(path.resolve(releaseDirectory), resolved))
}

export async function writeNativeBuildIdentity({ context, artifacts, version, mode, buildInputIdentity }) {
  if (!/^[a-f0-9]{64}$/u.test(buildInputIdentity)) throw new Error('Invalid native build input identity')
  if (!['app', 'dmg', 'release'].includes(mode)) throw new Error(`Unsupported native build identity mode: ${mode}`)
  const outputs = {
    app: {
      path: relativeArtifact(context.releaseDirectory, artifacts.app),
      ...await treeIdentity(artifacts.app),
    },
    updaterArchive: {
      path: relativeArtifact(context.releaseDirectory, artifacts.updaterArchive),
      ...await fileIdentity(artifacts.updaterArchive),
    },
    updaterSignature: {
      path: relativeArtifact(context.releaseDirectory, artifacts.updaterSignature),
      ...await fileIdentity(artifacts.updaterSignature),
    },
  }
  if (mode !== 'app') {
    outputs.dmg = {
      path: relativeArtifact(context.releaseDirectory, artifacts.dmg),
      ...await fileIdentity(artifacts.dmg),
    }
  }
  const manifest = {
    schemaVersion: 1,
    status: 'succeeded',
    checkoutIdentity: checkoutIdentity(context.repositoryRoot),
    buildInputIdentity,
    target: context.macosTarget,
    artifactArchitecture: context.artifactArchitecture,
    version,
    mode,
    outputs,
  }
  const destination = assertWithinRelease(context.releaseDirectory, artifacts.identityManifest)
  const temporary = path.join(path.dirname(destination), `.${identityFilename}.${process.pid}.${randomUUID()}.tmp`)
  await mkdir(path.dirname(destination), { recursive: true })
  try {
    await writeFile(temporary, `${JSON.stringify(manifest, null, 2)}\n`, { encoding: 'utf8', flag: 'wx' })
    await rename(temporary, destination)
  } finally {
    await rm(temporary, { force: true })
  }
  return manifest
}

export async function verifyNativeBuildIdentity({
  repositoryRoot,
  releaseDirectory,
  version,
  artifact,
  artifactPath,
  buildInputIdentity,
}) {
  const manifestPath = path.join(path.resolve(releaseDirectory), identityFilename)
  let manifest
  try {
    manifest = JSON.parse(await readFile(manifestPath, 'utf8'))
  } catch (error) {
    throw new Error(`Successful native build identity is required at ${manifestPath}: ${error instanceof Error ? error.message : error}`)
  }
  if (manifest.schemaVersion !== 1 || manifest.status !== 'succeeded') throw new Error('Native build identity is not a successful schema-v1 manifest')
  if (manifest.checkoutIdentity !== checkoutIdentity(repositoryRoot)) throw new Error('Native build checkout identity mismatch')
  const expectedInput = buildInputIdentity ?? await computeNativeBuildInputIdentity(repositoryRoot)
  if (manifest.buildInputIdentity !== expectedInput) throw new Error('Native build input identity mismatch')
  if (manifest.target !== 'aarch64-apple-darwin' || manifest.artifactArchitecture !== 'aarch64') {
    throw new Error('Native build identity is not arm64-only')
  }
  if (manifest.version !== version) throw new Error(`Native build version mismatch: ${manifest.version}`)
  const recorded = manifest.outputs?.[artifact]
  if (!recorded) throw new Error(`Native build identity has no ${artifact} output`)
  const recordedPath = assertWithinRelease(releaseDirectory, path.join(releaseDirectory, ...recorded.path.split('/')))
  if (artifactPath && path.resolve(artifactPath) !== recordedPath) throw new Error(`Native build ${artifact} path mismatch`)
  const actual = artifact === 'app' ? await treeIdentity(recordedPath) : await fileIdentity(recordedPath)
  if (actual.sha256 !== recorded.sha256 || actual.files !== recorded.files || actual.bytes !== recorded.bytes) {
    throw new Error(`Native build ${artifact} artifact identity mismatch`)
  }
  return manifest
}

export const nativeBuildIdentityFilename = identityFilename
