import { execFile as execFileCallback } from 'node:child_process'
import { existsSync } from 'node:fs'
import { mkdir, mkdtemp, readFile, rm, stat, writeFile } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { promisify } from 'node:util'

import { runPackagedSmoke } from './packaged-app-smoke.mjs'
import {
  installationLayout,
  installerForVersion,
  productVersionMatches,
  silentInstallArguments,
  silentUninstallArguments,
  validateWindowsInstallerEvidence,
} from './windows-installer-smoke-helpers.mjs'

const execFile = promisify(execFileCallback)
const root = path.resolve(process.env.INIT_CWD || process.cwd())
const processTimeoutMs = 120_000

async function waitFor(predicate, description, timeoutMs = 30_000) {
  const deadline = Date.now() + timeoutMs
  while (Date.now() < deadline) {
    if (await predicate()) return
    await new Promise((resolve) => setTimeout(resolve, 250))
  }
  throw new Error(`Timed out waiting for ${description}`)
}

async function nonEmptyFile(file, description) {
  const metadata = await stat(file).catch(() => null)
  if (!metadata?.isFile() || metadata.size <= 0) throw new Error(`${description} is missing or empty: ${file}`)
  return metadata
}

async function windowsProductVersion(executable) {
  const command = '[System.Diagnostics.FileVersionInfo]::GetVersionInfo($args[0]).ProductVersion'
  const result = await execFile(
    'powershell.exe',
    ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-Command', command, executable],
    { timeout: 30_000, windowsHide: true },
  )
  return result.stdout.trim()
}

async function writeEvidence(directory, evidence) {
  await mkdir(directory, { recursive: true })
  const destination = path.join(directory, 'windows-installer-smoke-win32.json')
  await writeFile(destination, `${JSON.stringify(evidence, null, 2)}\n`, 'utf8')
  return destination
}

export async function runWindowsInstallerSmoke({
  platform = process.platform,
  expectedVersion,
  installer,
  artifactDirectory = process.env.KAKEFLOW_SMOKE_ARTIFACT_DIR,
} = {}) {
  if (platform !== 'win32') {
    throw new Error('Windows NSIS installer acceptance is supported only on Windows; no installer coverage was run')
  }

  const version = expectedVersion
    ?? JSON.parse(await readFile(path.join(root, 'package.json'), 'utf8')).version
  const installerPath = path.resolve(
    installer
      ?? process.env.KAKEFLOW_WINDOWS_INSTALLER_PATH
      ?? installerForVersion(version, process.arch === 'arm64' ? 'arm64' : 'x64', root),
  )
  const evidenceDirectory = path.resolve(
    artifactDirectory ?? path.join(root, 'artifacts', 'packaged-smoke', 'Windows'),
  )
  await mkdir(evidenceDirectory, { recursive: true })
  const temporaryRoot = await mkdtemp(path.join(os.tmpdir(), 'kakeflow-windows-installer-smoke-'))
  const layout = installationLayout(path.join(temporaryRoot, 'installed'))
  let installerStat
  let uninstallCompleted = false
  let failure
  let evidence

  try {
    installerStat = await nonEmptyFile(installerPath, 'NSIS installer')
    await execFile(installerPath, silentInstallArguments(layout.root), {
      timeout: processTimeoutMs,
      windowsHide: true,
    })
    await waitFor(
      () => Promise.resolve(existsSync(layout.executable) && existsSync(layout.uninstaller)),
      'the installed executable and uninstaller',
    )
    const executableStat = await nonEmptyFile(layout.executable, 'Installed KakeFlow executable')
    await nonEmptyFile(layout.uninstaller, 'Installed KakeFlow uninstaller')
    const installedResources = []
    for (const resource of layout.resources) {
      await nonEmptyFile(resource, 'Installed KakeFlow resource')
      installedResources.push(path.relative(layout.root, resource).replaceAll('\\', '/'))
    }

    const installedVersion = await windowsProductVersion(layout.executable)
    if (!productVersionMatches(installedVersion, version)) {
      throw new Error(`Installed KakeFlow version ${installedVersion || '(empty)'} does not match ${version}`)
    }

    const packaged = await runPackagedSmoke({
      executable: layout.executable,
      artifactDirectory: evidenceDirectory,
    })

    await execFile(layout.uninstaller, silentUninstallArguments(), {
      timeout: processTimeoutMs,
      windowsHide: true,
    })
    await waitFor(() => Promise.resolve(!existsSync(layout.root)), 'silent uninstall cleanup')
    uninstallCompleted = true
    evidence = validateWindowsInstallerEvidence({
      status: 'ok',
      platform: 'win32',
      version,
      architecture: process.arch,
      installer: path.basename(installerPath),
      installerBytes: installerStat.size,
      installScope: 'isolated-current-user',
      executable: path.basename(layout.executable),
      executableBytes: executableStat.size,
      installedProductVersion: installedVersion,
      resources: installedResources,
      uninstallerPresent: true,
      packagedSmoke: {
        status: packaged.status,
        schemaVersion: packaged.schemaVersion,
        databaseHealthy: packaged.databaseHealthy,
        visitedPageCount: packaged.visualEvidence.visitedPages.length,
        interactionCount: packaged.visualEvidence.interactionCount,
      },
      uninstallCompleted,
      installDirectoryRemoved: !existsSync(layout.root),
    }, version)
    const evidencePath = await writeEvidence(evidenceDirectory, evidence)
    console.log(`Windows NSIS installer smoke passed (${evidence.installer}, v${version}, installed launch, silent uninstall)`)
    return { ...evidence, evidencePath }
  } catch (error) {
    failure = error
  } finally {
    if (!uninstallCompleted && existsSync(layout.uninstaller)) {
      try {
        await execFile(layout.uninstaller, silentUninstallArguments(), {
          timeout: processTimeoutMs,
          windowsHide: true,
        })
        await waitFor(() => Promise.resolve(!existsSync(layout.root)), 'failure-path uninstall cleanup')
        uninstallCompleted = true
      } catch (cleanupError) {
        failure = new Error(
          `${failure instanceof Error ? failure.message : failure}; installer cleanup failed: ${cleanupError instanceof Error ? cleanupError.message : cleanupError}`,
        )
      }
    }
    // The destination is always below our newly-created temporary root. If a
    // broken installer did not create a usable uninstaller, remove only that
    // isolated destination so the acceptance harness never leaves test files.
    if (existsSync(layout.root)) {
      await rm(layout.root, { recursive: true, force: true, maxRetries: 10, retryDelay: 200 })
    }
    if (failure) {
      await writeEvidence(evidenceDirectory, {
        status: 'failed',
        platform: 'win32',
        version,
        installer: path.basename(installerPath),
        installScope: 'isolated-current-user',
        uninstallCompleted,
        installDirectoryRemoved: !existsSync(layout.root),
        error: failure instanceof Error ? failure.message : String(failure),
      }).catch(() => {})
    }
    await rm(temporaryRoot, { recursive: true, force: true, maxRetries: 10, retryDelay: 200 })
  }

  throw failure
}

const isMain = process.argv[1] && path.basename(process.argv[1]) === 'windows-installer-smoke.mjs'
if (isMain) {
  runWindowsInstallerSmoke().catch((error) => {
    console.error(error instanceof Error ? error.message : error)
    process.exitCode = 1
  })
}
