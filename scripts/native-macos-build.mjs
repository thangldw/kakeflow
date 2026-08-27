import { spawn } from 'node:child_process'
import { createHash } from 'node:crypto'
import os from 'node:os'
import path from 'node:path'

import { macDmgArtifactName } from './release-version-contract.mjs'

const encodedFlagSeparator = '\u001f'
const macTargets = new Map([
  ['aarch64-apple-darwin', 'aarch64'],
  ['x86_64-apple-darwin', 'x64'],
  ['universal-apple-darwin', 'universal'],
])
const hostTargets = new Map([
  ['arm64', 'aarch64-apple-darwin'],
  ['x64', 'x86_64-apple-darwin'],
])

function personalRootFinding(candidate, homeDirectory) {
  const normalized = path.resolve(candidate)
  const home = path.resolve(homeDirectory)
  if (normalized === home || normalized.startsWith(`${home}${path.sep}`)) return home
  if (normalized.includes('/Users/')) return '/Users/'
  return null
}

function resolveTarget(macosTarget, architecture) {
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

export function createMacBuildPlan({
  bundle,
  platform = process.platform,
  environment = process.env,
  homeDirectory = os.homedir(),
  ...contextOptions
} = {}) {
  if (platform !== 'darwin') throw new Error('Native macOS packaging is macOS only')
  if (!['app', 'dmg'].includes(bundle)) throw new Error(`Unsupported macOS bundle: ${bundle}`)
  const context = resolveMacBuildContext({ ...contextOptions, homeDirectory })
  const commands = [
    {
      phase: 'preflight',
      command: process.execPath,
      args: [path.join(context.repositoryRoot, 'scripts', 'verify-ocr-resources.mjs')],
    },
    {
      phase: 'preflight',
      command: process.execPath,
      args: [path.join(context.repositoryRoot, 'scripts', 'stage-paddleocr-resources.mjs'), '--verify-only'],
    },
    {
      phase: 'build',
      command: path.join(context.repositoryRoot, 'node_modules', '.bin', 'tauri'),
      args: ['build', '--bundles', bundle, '--target', context.macosTarget, '--ci'],
    },
  ]
  return {
    context,
    commands,
    environment: {
      ...environment,
      APPLE_SIGNING_IDENTITY: '-',
      CARGO_TARGET_DIR: context.cargoTargetDir,
      CARGO_ENCODED_RUSTFLAGS: encodedRustFlags(environment, homeDirectory),
    },
  }
}

export async function runMacBuild(plan) {
  for (const command of plan.commands) {
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
}

const isMain = process.argv[1] && path.basename(process.argv[1]) === 'native-macos-build.mjs'
if (isMain) {
  const plan = createMacBuildPlan({ bundle: process.argv[2] })
  runMacBuild(plan).catch((error) => {
    console.error(error instanceof Error ? error.message : error)
    process.exitCode = 1
  })
}
