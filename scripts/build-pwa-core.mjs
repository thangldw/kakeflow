import { execFileSync } from 'node:child_process'
import { readFileSync, rmSync, writeFileSync } from 'node:fs'
import { dirname, relative, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const crate = resolve(root, 'crates/kakeflow-core')
const output = resolve(root, 'src/platform/pwa/core-wasm')
const ownedOutput = relative(root, output).replaceAll('\\', '/')

if (ownedOutput !== 'src/platform/pwa/core-wasm') {
  throw new Error(`Refusing to replace unexpected output directory: ${output}`)
}

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
    env: { ...process.env, RUSTUP_TOOLCHAIN: '1.97.0' },
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
