import { execFile as execFileCallback } from 'node:child_process'
import { createHash, randomUUID } from 'node:crypto'
import { lstat, mkdir, readFile, readdir, readlink, rename, rm, stat, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { promisify } from 'node:util'

const execFile = promisify(execFileCallback)
const identityFilename = 'kakeflow-build-identity.json'
const buildInputRoots = [
  'package.json', 'package-lock.json', 'src/', 'src-tauri/', 'scripts/', 'packaging/',
  'index.html', 'vite.config.', 'vitest.config.', 'tsconfig.',
]

function sha256(value) {
  return createHash('sha256').update(value).digest('hex')
}

function checkoutIdentity(repositoryRoot) {
  return sha256(path.resolve(repositoryRoot))
}

function portable(relative) {
  return relative.split(path.sep).join('/')
}

function includedBuildInput(relative) {
  return buildInputRoots.some((candidate) => candidate.endsWith('/')
    ? relative.startsWith(candidate)
    : relative === candidate || relative.startsWith(candidate))
}

export async function computeNativeBuildInputIdentity(repositoryRoot) {
  const root = path.resolve(repositoryRoot)
  const { stdout } = await execFile(
    'git', ['ls-files', '--cached', '--others', '--exclude-standard', '-z', '--'],
    { cwd: root, encoding: 'buffer', maxBuffer: 64 * 1024 * 1024 },
  )
  const files = stdout.toString('utf8').split('\0').filter(Boolean).filter(includedBuildInput).sort()
  const digest = createHash('sha256')
  for (const relative of files) {
    const absolute = path.join(root, ...relative.split('/'))
    digest.update(`path\0${relative}\0`)
    try {
      const metadata = await lstat(absolute)
      if (metadata.isSymbolicLink()) digest.update(`link\0${await readlink(absolute)}\0`)
      else if (metadata.isFile()) digest.update(Buffer.concat([Buffer.from('file\0'), await readFile(absolute), Buffer.from('\0')]))
      else digest.update('unsupported\0')
    } catch (error) {
      if (error?.code !== 'ENOENT') throw error
      digest.update('deleted\0')
    }
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
    path.resolve(context.cargoTargetDir),
    '.kakeflow-build-locks',
    `${checkout}-${context.macosTarget}.lock`,
  )
}

async function readLockOwner(lockDirectory) {
  try {
    return JSON.parse(await readFile(path.join(lockDirectory, 'owner.json'), 'utf8'))
  } catch {
    return null
  }
}

export async function acquireNativeBuildLock(context, {
  pid = process.pid,
  isProcessAlive = defaultProcessAlive,
  recoverStale = process.env.KAKEFLOW_RECOVER_STALE_BUILD_LOCK === '1',
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
    const validOwner = Number.isInteger(owner?.pid) && owner.pid > 0 &&
      typeof owner?.token === 'string' && owner.token.length > 0 &&
      owner.checkoutIdentity === expectedCheckout && owner.target === context.macosTarget
    if (!validOwner) {
      throw new Error(`Native build lock metadata is invalid at ${lockDirectory}; inspect and remove only this exact lock directory manually`)
    }
    if (isProcessAlive(owner.pid)) {
      throw new Error(`Native build lock is held by active build process ${owner.pid} at ${lockDirectory}`)
    }
    if (!recoverStale) {
      throw new Error(`Native build lock may be stale at ${lockDirectory}; confirm process ${owner.pid} is gone, then retry with KAKEFLOW_RECOVER_STALE_BUILD_LOCK=1`)
    }
    await rm(lockDirectory, { recursive: true, force: false })
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
    await rm(lockDirectory, { recursive: true, force: true })
    throw error
  }

  return {
    path: lockDirectory,
    owner,
    async release() {
      const current = await readLockOwner(lockDirectory)
      if (current?.token !== owner.token) throw new Error(`Native build lock ownership changed at ${lockDirectory}`)
      await rm(lockDirectory, { recursive: true, force: false })
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

export async function cleanNativeBuildOutputs({ context, artifacts }) {
  const candidates = [
    artifacts.app,
    artifacts.updaterArchive,
    artifacts.updaterSignature,
    artifacts.dmg,
    artifacts.identityManifest,
  ].map((candidate) => assertWithinRelease(context.releaseDirectory, candidate))
  for (const candidate of candidates) await rm(candidate, { recursive: true, force: true })
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
