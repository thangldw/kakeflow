import { execFileSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { readFileSync, rmSync, writeFileSync } from 'node:fs'
import os from 'node:os'
import { dirname, relative, resolve, sep } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const crate = resolve(root, 'crates/kakeflow-core')
const output = resolve(root, 'src/platform/pwa/core-wasm')
const ownedOutput = relative(root, output).replaceAll('\\', '/')

if (ownedOutput !== 'src/platform/pwa/core-wasm') {
  throw new Error(`Refusing to replace unexpected output directory: ${output}`)
}

const homeDirectory = resolve(os.homedir())
const configuredTarget = process.env.CARGO_TARGET_DIR
const cargoTargetDirectory = configuredTarget
  ? resolve(root, configuredTarget)
  : resolve(os.tmpdir(), `kakeflow-wasm-target-${createHash('sha256').update(root).digest('hex').slice(0, 12)}`)
const portableTargetDirectory = cargoTargetDirectory.replaceAll('\\', '/')
if (
  cargoTargetDirectory === homeDirectory ||
  cargoTargetDirectory.startsWith(`${homeDirectory}${sep}`) ||
  portableTargetDirectory.includes('/Users/') ||
  /^[A-Za-z]:\/Users\//u.test(portableTargetDirectory)
) {
  throw new Error('CARGO_TARGET_DIR contains a personal build root; configure a neutral target directory')
}
if (process.env.RUSTFLAGS?.trim()) {
  throw new Error('RUSTFLAGS is ambiguous for paths with spaces; provide existing flags through CARGO_ENCODED_RUSTFLAGS')
}
const encodedFlagSeparator = '\u001f'
const encodedRustFlags = [
  ...(process.env.CARGO_ENCODED_RUSTFLAGS?.split(encodedFlagSeparator).filter(Boolean) ?? []),
  `--remap-path-prefix=${homeDirectory}=/kakeflow-build-home`,
  '--remap-path-scope=all',
].join(encodedFlagSeparator)

const wasmPackVersion = execFileSync('wasm-pack', ['--version'], { encoding: 'utf8' }).trim()
if (wasmPackVersion !== 'wasm-pack 0.15.0') {
  throw new Error(`Expected wasm-pack 0.15.0, received ${wasmPackVersion}`)
}

rmSync(output, { recursive: true, force: true })
execFileSync(
  'wasm-pack',
  ['build', crate, '--target', 'web', '--release', '--out-dir', output, '--out-name', 'kakeflow_core', '--locked'],
  {
    cwd: root,
    env: {
      ...process.env,
      RUSTUP_TOOLCHAIN: '1.97.0',
      CARGO_TARGET_DIR: cargoTargetDirectory,
      CARGO_ENCODED_RUSTFLAGS: encodedRustFlags,
    },
    stdio: 'inherit',
  },
)

const packagePath = resolve(output, 'package.json')
const generatedPackage = JSON.parse(readFileSync(packagePath, 'utf8'))
const normalizedPackage = {
  name: '@kakeflow/core-wasm',
  version: generatedPackage.version,
  type: 'module',
  files: [
    'LICENSE',
    'kakeflow_core_bg.wasm',
    'kakeflow_core.js',
    'kakeflow_core.d.ts',
    'kakeflow_core_bg.wasm.d.ts',
  ],
  module: 'kakeflow_core.js',
  types: 'kakeflow_core.d.ts',
  sideEffects: false,
}
writeFileSync(packagePath, `${JSON.stringify(normalizedPackage, null, 2)}\n`)
for (const declaration of ['kakeflow_core.d.ts', 'kakeflow_core_bg.wasm.d.ts']) {
  const declarationPath = resolve(output, declaration)
  const normalized = readFileSync(declarationPath, 'utf8').replace('/* eslint-disable */\n', '')
  writeFileSync(declarationPath, normalized)
}
rmSync(resolve(output, '.gitignore'), { force: true })
