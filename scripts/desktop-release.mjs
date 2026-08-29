import { spawn } from 'node:child_process'
import path from 'node:path'

import { resolveMacBuildContext, validateMacReleaseArguments } from './native-macos-build.mjs'

export function createDesktopReleasePlan({
  platform = process.platform,
  repositoryRoot = path.resolve(process.env.INIT_CWD || process.cwd()),
  argv = [],
  environment = process.env,
} = {}) {
  const root = path.resolve(repositoryRoot)
  if (platform === 'darwin') {
    const passthrough = validateMacReleaseArguments(argv)
    resolveMacBuildContext({
      repositoryRoot: root,
      cargoTargetDir: environment.CARGO_TARGET_DIR,
      macosTarget: environment.KAKEFLOW_MACOS_TARGET,
      architecture: process.arch,
    })
    return {
      command: process.execPath,
      args: [path.join(root, 'scripts', 'native-macos-build.mjs'), 'release', '--', ...passthrough],
      cwd: root,
      environment,
    }
  }
  return { command: 'tauri', args: ['build', ...argv], cwd: root, environment }
}

async function executePlan(plan) {
  await new Promise((resolve, reject) => {
    const child = spawn(plan.command, plan.args, { cwd: plan.cwd, env: plan.environment, stdio: 'inherit' })
    child.once('error', reject)
    child.once('exit', (code, signal) => {
      if (code === 0) resolve()
      else reject(new Error(`Desktop release command failed with code ${code ?? 'null'} signal ${signal ?? 'none'}`))
    })
  })
}

export async function runDesktopRelease(plan, execute = executePlan) {
  await execute(plan)
}

const isMain = process.argv[1] && path.basename(process.argv[1]) === 'desktop-release.mjs'
if (isMain) {
  const plan = createDesktopReleasePlan({ argv: process.argv.slice(2) })
  runDesktopRelease(plan).catch((error) => {
    console.error(error instanceof Error ? error.message : error)
    process.exitCode = 1
  })
}
