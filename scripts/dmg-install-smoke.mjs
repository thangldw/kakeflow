import { execFile as execFileCallback } from 'node:child_process'
import { existsSync } from 'node:fs'
import { mkdir, mkdtemp, readFile, realpath, rm, stat, writeFile } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { promisify } from 'node:util'
import { macArtifactPaths } from './native-macos-build.mjs'
import { packagedBuildPathFindings } from './packaged-app-smoke.mjs'

const execFile = promisify(execFileCallback)
const root = path.resolve(process.env.INIT_CWD || process.cwd())

export function dmgForVersion(version, options = {}) {
  const normalized = typeof options === 'string' ? { repositoryRoot: options } : options
  return macArtifactPaths(version, { repositoryRoot: root, ...normalized }).dmg
}

export function validateBundleMetadata(metadata, expectedVersion) {
  if (
    metadata.version !== expectedVersion ||
    metadata.identifier !== 'app.kakeflow.desktop' ||
    metadata.executable !== 'kakeflow'
  ) {
    throw new Error(`Invalid mounted KakeFlow bundle metadata: ${JSON.stringify(metadata)}`)
  }
  return metadata
}

export function mountIsReadOnly(mountOutput, mountPoint) {
  return mountOutput
    .split(/\r?\n/u)
    .some((line) => line.includes(` on ${mountPoint} `) && /\bread-only\b/u.test(line))
}

async function plistValue(plist, key) {
  const { stdout } = await execFile('/usr/bin/plutil', ['-extract', key, 'raw', '-o', '-', plist])
  return stdout.trim()
}

async function detachDmg(device) {
  let lastError
  for (let attempt = 0; attempt < 5; attempt += 1) {
    try {
      await execFile('/usr/bin/hdiutil', ['detach', device])
      return
    } catch (error) {
      lastError = error
      await new Promise((resolve) => setTimeout(resolve, 250))
    }
  }
  try {
    await execFile('/usr/bin/hdiutil', ['detach', device, '-force'])
  } catch (error) {
    throw new Error(`KakeFlow DMG could not be detached: ${error instanceof Error ? error.message : lastError}`)
  }
}

export async function runDmgInstallSmoke({
  platform = process.platform,
  expectedVersion,
  dmg,
  artifactDirectory = process.env.KAKEFLOW_SMOKE_ARTIFACT_DIR,
  keepMount = process.env.KAKEFLOW_KEEP_DMG_MOUNT === '1',
} = {}) {
  if (platform !== 'darwin') {
    throw new Error('DMG mount/install validation is supported only on macOS; Windows installer coverage is not claimed')
  }
  const packageVersion = expectedVersion ?? JSON.parse(await readFile(path.join(root, 'package.json'), 'utf8')).version
  const image = dmg ?? process.env.KAKEFLOW_DMG_PATH ?? dmgForVersion(packageVersion)
  if (!existsSync(image)) throw new Error(`KakeFlow DMG does not exist: ${image}`)
  const imageStat = await stat(image)
  if (!imageStat.isFile() || imageStat.size === 0) throw new Error(`KakeFlow DMG is invalid: ${image}`)

  const temporaryRoot = await mkdtemp(path.join(os.tmpdir(), 'kakeflow-dmg-smoke-'))
  const mountPoint = path.join(temporaryRoot, 'volume')
  await mkdir(mountPoint)
  let attached = false
  let attachedDevice
  let failure
  let result
  try {
    const { stdout: attachOutput } = await execFile('/usr/bin/hdiutil', ['attach', image, '-readonly', '-nobrowse', '-mountpoint', mountPoint])
    attached = true
    attachedDevice = /^\/dev\/disk\d+/mu.exec(attachOutput)?.[0]
    if (!attachedDevice) throw new Error('KakeFlow DMG attachment device could not be resolved')
    const mountRealPath = await realpath(mountPoint)
    const { stdout: mounts } = await execFile('/sbin/mount', [])
    if (!mountIsReadOnly(mounts, mountRealPath)) throw new Error('KakeFlow DMG was not mounted read-only')

    const app = path.join(mountPoint, 'KakeFlow.app')
    const plist = path.join(app, 'Contents', 'Info.plist')
    const metadata = validateBundleMetadata({
      version: await plistValue(plist, 'CFBundleShortVersionString'),
      identifier: await plistValue(plist, 'CFBundleIdentifier'),
      executable: await plistValue(plist, 'CFBundleExecutable'),
    }, packageVersion)
    const executable = path.join(app, 'Contents', 'MacOS', metadata.executable)
    const [executableRealPath, executableStat] = await Promise.all([
      realpath(executable), stat(executable),
    ])
    if (!executableRealPath.startsWith(`${mountRealPath}${path.sep}`) || !executableStat.isFile() || executableStat.size === 0 || (executableStat.mode & 0o111) === 0) {
      throw new Error('Mounted KakeFlow executable is invalid')
    }
    const buildPathFindings = await packagedBuildPathFindings(executable, 'darwin')
    if (buildPathFindings.length > 0) {
      throw new Error(`Mounted KakeFlow bundle contains personal build roots: ${buildPathFindings.join(', ')}`)
    }

    const resources = path.join(app, 'Contents', 'Resources')
    const resourcesStat = await stat(resources)
    if (!resourcesStat.isDirectory()) throw new Error('Mounted KakeFlow resources are missing')
    await execFile(process.execPath, [path.join(root, 'scripts', 'verify-ocr-resources.mjs')], {
      cwd: root,
      env: { ...process.env, KAKEFLOW_OCR_RESOURCE_ROOT: path.join(resources, 'ocr') },
    })
    await execFile('/usr/bin/codesign', ['--verify', '--deep', '--strict', app])
    result = {
      status: 'ok',
      image: path.basename(image),
      mountedReadOnly: true,
      bundle: 'KakeFlow.app',
      version: metadata.version,
      identifier: metadata.identifier,
      executable: metadata.executable,
      executableBytes: executableStat.size,
      resourcesPresent: true,
      packagedOcrVerified: true,
      packagedPrivacyVerified: true,
      codeSignatureValid: true,
      packagedUiGate: 'separate-app-bundle-smoke',
    }
    if (artifactDirectory) {
      const destination = path.resolve(artifactDirectory)
      await mkdir(destination, { recursive: true })
      await writeFile(path.join(destination, 'dmg-install-smoke-darwin.json'), `${JSON.stringify(result, null, 2)}\n`, 'utf8')
    }
  } catch (error) {
    failure = error
  } finally {
    let detached = !attached
    if (attached) {
      try {
        await detachDmg(attachedDevice ?? mountPoint)
        detached = true
      } catch (detachError) {
        failure ??= new Error(`KakeFlow DMG could not be detached: ${detachError instanceof Error ? detachError.message : detachError}`)
      }
    }
    if (keepMount) console.log(`DMG smoke mount workspace retained at ${temporaryRoot}`)
    else if (detached) await rm(temporaryRoot, { recursive: true, force: true, maxRetries: 10, retryDelay: 200 })
  }
  if (failure) throw failure
  console.log(`DMG mount smoke passed (${result.image}, ${result.bundle}, v${result.version}, read-only mount, bundle privacy, bundle integrity)`)
  return result
}

const isMain = process.argv[1] && path.basename(process.argv[1]) === 'dmg-install-smoke.mjs'
if (isMain) {
  runDmgInstallSmoke().catch((error) => {
    console.error(error instanceof Error ? error.message : error)
    process.exitCode = 1
  })
}
