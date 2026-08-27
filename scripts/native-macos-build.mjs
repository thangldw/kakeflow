import { spawn } from 'node:child_process'
import { createHash } from 'node:crypto'
import { readFileSync } from 'node:fs'
import os from 'node:os'
import path from 'node:path'

import {
  acquireNativeBuildLock,
  cleanNativeBuildOutputs,
  computeNativeBuildInputIdentity,
  nativeBuildIdentityFilename,
  writeNativeBuildIdentity,
} from './native-build-identity.mjs'
import { macOcrContractForTauriTarget } from './ocr-resource-contract.mjs'
import { macDmgArtifactName } from './release-version-contract.mjs'

const encodedFlagSeparator = '\u001f'
const macTargets = new Map([
  ['aarch64-apple-darwin', 'aarch64'],
])
const hostTargets = new Map([
  ['arm64', 'aarch64-apple-darwin'],
])

function personalRootFinding(candidate, homeDirectory) {
  const normalized = path.resolve(candidate)
  const home = path.resolve(homeDirectory)
  if (normalized === home || normalized.startsWith(`${home}${path.sep}`)) return home
  if (normalized.includes('/Users/')) return '/Users/'
  return null
}

function resolveTarget(macosTarget, architecture) {
  if (macosTarget === 'x86_64-apple-darwin' || macosTarget === 'universal-apple-darwin') {
    throw new Error(`OCR-backed macOS packaging supports only aarch64-apple-darwin, not ${macosTarget}`)
  }
  if (!macosTarget && architecture === 'x64') {
    throw new Error('OCR-backed macOS packaging supports only arm64 hosts')
  }
  const target = macosTarget || hostTargets.get(architecture)
  if (!target && architecture) throw new Error(`Unsupported macOS architecture: ${architecture}`)
  if (!macTargets.has(target)) throw new Error(`Unsupported macOS target: ${target}`)
  return target
}

export function resolveMacBuildContext({
  repositoryRoot = path.resolve(process.env.INIT_CWD || process.cwd()),
  cargoTargetDir = process.env.CARGO_TARGET_DIR,
  macosTarget = process.env.KAKEFLOW_MACOS_TARGET,
  architecture = process.arch,
  homeDirectory = os.homedir(),
  temporaryDirectory = os.tmpdir(),
} = {}) {
  const root = path.resolve(repositoryRoot)
  const target = resolveTarget(macosTarget, architecture)
  const defaultTargetName = `kakeflow-cargo-target-${createHash('sha256').update(root).digest('hex').slice(0, 12)}`
  const resolvedTargetDir = cargoTargetDir
    ? path.resolve(root, cargoTargetDir)
    : path.resolve(temporaryDirectory, defaultTargetName)
  const personalFinding = personalRootFinding(resolvedTargetDir, homeDirectory)
  if (personalFinding) {
    throw new Error(`CARGO_TARGET_DIR contains a personal build root (${personalFinding}); configure a neutral target directory`)
  }
  return {
    repositoryRoot: root,
    cargoTargetDir: resolvedTargetDir,
    macosTarget: target,
    artifactArchitecture: macTargets.get(target),
    releaseDirectory: path.join(resolvedTargetDir, target, 'release'),
  }
}

export function macArtifactPaths(version, options = {}) {
  const context = resolveMacBuildContext(options)
  const bundleRoot = path.join(context.releaseDirectory, 'bundle')
  const app = path.join(bundleRoot, 'macos', 'KakeFlow.app')
  return {
    ...context,
    rawExecutable: path.join(context.releaseDirectory, 'kakeflow'),
    app,
    executable: path.join(app, 'Contents', 'MacOS', 'kakeflow'),
    updaterArchive: `${app}.tar.gz`,
    updaterSignature: `${app}.tar.gz.sig`,
    dmg: path.join(bundleRoot, 'dmg', macDmgArtifactName(version, context.artifactArchitecture)),
    identityManifest: path.join(context.releaseDirectory, nativeBuildIdentityFilename),
  }
}

function encodedRustFlags(environment, homeDirectory) {
  if (environment.RUSTFLAGS?.trim()) {
    throw new Error('RUSTFLAGS is ambiguous for paths with spaces; provide existing flags through CARGO_ENCODED_RUSTFLAGS')
  }
  const existing = environment.CARGO_ENCODED_RUSTFLAGS
    ? environment.CARGO_ENCODED_RUSTFLAGS.split(encodedFlagSeparator).filter(Boolean)
    : []
  return [
    ...existing,
    `--remap-path-prefix=${path.resolve(homeDirectory)}=/kakeflow-build-home`,
    '--remap-path-scope=all',
  ].join(encodedFlagSeparator)
}

export function validateMacReleaseArguments(args = []) {
  const allowed = new Set(['--verbose', '-v'])
  const rejected = args.filter((argument) => !allowed.has(argument))
  if (rejected.length > 0) {
    throw new Error(`Cannot override protected macOS release arguments: ${rejected.join(' ')}`)
  }
  return [...args]
}

export function createMacBuildPlan({
  bundle,
  tauriArgs = [],
  version,
  platform = process.platform,
  environment = process.env,
  homeDirectory = os.homedir(),
  ...contextOptions
} = {}) {
  if (platform !== 'darwin') throw new Error('Native macOS packaging is macOS only')
  if (!['app', 'dmg', 'release'].includes(bundle)) throw new Error(`Unsupported macOS bundle: ${bundle}`)
  const passthrough = validateMacReleaseArguments(tauriArgs)
  const context = resolveMacBuildContext({ ...contextOptions, homeDirectory })
  const packageVersion = version ?? JSON.parse(readFileSync(path.join(context.repositoryRoot, 'package.json'), 'utf8')).version
  const ocr = macOcrContractForTauriTarget(context.macosTarget)
  const artifacts = macArtifactPaths(packageVersion, {
    repositoryRoot: context.repositoryRoot,
    cargoTargetDir: context.cargoTargetDir,
    macosTarget: context.macosTarget,
    homeDirectory,
  })
  const commands = [
    {
      phase: 'preflight',
      command: process.execPath,
      args: [
        path.join(context.repositoryRoot, 'scripts', 'verify-ocr-resources.mjs'),
        '--target', ocr.target,
        '--expected-architecture', ocr.architecture,
      ],
    },
    {
      phase: 'preflight',
      command: process.execPath,
      args: [path.join(context.repositoryRoot, 'scripts', 'stage-paddleocr-resources.mjs'), '--verify-only'],
    },
    {
      phase: 'build',
      command: path.join(context.repositoryRoot, 'node_modules', '.bin', 'tauri'),
      args: bundle === 'release'
        ? ['build', '--target', context.macosTarget, '--ci', ...passthrough]
        : ['build', '--bundles', bundle, '--target', context.macosTarget, '--ci', ...passthrough],
    },
  ]
  return {
    context,
    artifacts,
    version: packageVersion,
    mode: bundle,
    commands,
    environment: {
      ...environment,
      APPLE_SIGNING_IDENTITY: '-',
      CARGO_TARGET_DIR: context.cargoTargetDir,
      CARGO_ENCODED_RUSTFLAGS: encodedRustFlags(environment, homeDirectory),
    },
  }
}

async function executeMacBuildCommand(command, plan) {
  await new Promise((resolve, reject) => {
    const child = spawn(command.command, command.args, {
      cwd: plan.context.repositoryRoot,
      env: plan.environment,
      stdio: 'inherit',
    })
    child.once('error', reject)
    child.once('exit', (code, signal) => {
      if (code === 0) resolve()
      else reject(new Error(`macOS ${command.phase} command failed with code ${code ?? 'null'} signal ${signal ?? 'none'}`))
    })
  })
}

export async function runIsolatedMacBuild(plan, {
  acquireBuildLock = acquireNativeBuildLock,
  cleanOutputs = cleanNativeBuildOutputs,
  computeBuildInputIdentity = computeNativeBuildInputIdentity,
  executeCommand = executeMacBuildCommand,
  writeBuildIdentity = writeNativeBuildIdentity,
  reportCleanupError = (error) => console.error(`Native build lock cleanup failed: ${error instanceof Error ? error.message : error}`),
} = {}) {
  let lock
  let result
  let primaryError
  try {
    lock = await acquireBuildLock(plan.context)
    await cleanOutputs({ context: plan.context, artifacts: plan.artifacts })
    const inputBeforeBuild = await computeBuildInputIdentity(plan.context.repositoryRoot)
    for (const command of plan.commands) await executeCommand(command, plan)
    const inputAfterBuild = await computeBuildInputIdentity(plan.context.repositoryRoot)
    if (inputAfterBuild !== inputBeforeBuild) {
      throw new Error('Native build inputs changed during packaging; no success identity was published')
    }
    result = await writeBuildIdentity({
      context: plan.context,
      artifacts: plan.artifacts,
      version: plan.version,
      mode: plan.mode,
      buildInputIdentity: inputAfterBuild,
    })
  } catch (error) {
    primaryError = error
  } finally {
    if (lock) {
      try {
        await lock.release()
      } catch (cleanupError) {
        if (primaryError) reportCleanupError(cleanupError)
        else primaryError = cleanupError
      }
    }
  }
  if (primaryError) throw primaryError
  return result
}

export async function runMacBuild(plan) {
  return runIsolatedMacBuild(plan)
}

const isMain = process.argv[1] && path.basename(process.argv[1]) === 'native-macos-build.mjs'
if (isMain) {
  const separator = process.argv[3]
  if (separator && separator !== '--') {
    console.error('Native macOS build arguments must follow --')
    process.exitCode = 1
  } else {
    const plan = createMacBuildPlan({ bundle: process.argv[2], tauriArgs: separator === '--' ? process.argv.slice(4) : [] })
    runIsolatedMacBuild(plan).catch((error) => {
      console.error(error instanceof Error ? error.message : error)
      process.exitCode = 1
    })
  }
}
