import { spawnSync } from 'node:child_process'
import { existsSync, statSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import path from 'node:path'

const root = fileURLToPath(new URL('../', import.meta.url))
const tauriRoot = path.join(root, 'src-tauri')
const npm = process.platform === 'win32' ? 'npm.cmd' : 'npm'
const cargo = process.platform === 'win32' ? 'cargo.exe' : 'cargo'

function run(label, command, args, cwd = root) {
  console.log(`\n==> ${label}`)
  const result = spawnSync(command, args, {
    cwd,
    env: process.env,
    stdio: 'inherit',
    // npm.cmd and cargo.exe are resolved through cmd.exe on GitHub's Windows
    // runners. Node 22 otherwise rejects direct .cmd execution with EINVAL.
    shell: process.platform === 'win32',
  })

  if (result.error) {
    throw result.error
  }
  if (result.status !== 0) {
    process.exit(result.status ?? 1)
  }
}

run('Check application version consistency', npm, ['run', 'check:versions'])
run('Run frontend tests', npm, ['test'])
run('Lint frontend', npm, ['run', 'lint'])
run('Build frontend', npm, ['run', 'build'])
run('Check Rust formatting', cargo, ['fmt', '--all', '--', '--check'], tauriRoot)
run(
  'Run Clippy',
  cargo,
  ['clippy', '--locked', '--all-targets', '--all-features', '--', '-D', 'warnings'],
  tauriRoot,
)
run('Run Rust tests', cargo, ['test', '--locked', '--all-features'], tauriRoot)
run('Build desktop binary without packaging or signing', npm, ['run', 'desktop:build'])

const executable = path.join(
  tauriRoot,
  'target',
  'release',
  process.platform === 'win32' ? 'kakeflow.exe' : 'kakeflow',
)

if (!existsSync(executable) || !statSync(executable).isFile() || statSync(executable).size === 0) {
  throw new Error(`Expected a non-empty desktop executable at ${executable}`)
}

console.log(`\nDesktop smoke validation passed: ${executable}`)
