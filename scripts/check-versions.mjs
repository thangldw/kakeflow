import { readFile } from 'node:fs/promises'

const root = new URL('../', import.meta.url)
const packageJson = JSON.parse(await readFile(new URL('package.json', root), 'utf8'))
const tauriConfig = JSON.parse(await readFile(new URL('src-tauri/tauri.conf.json', root), 'utf8'))
const cargoToml = await readFile(new URL('src-tauri/Cargo.toml', root), 'utf8')
const cargoVersion = /^version\s*=\s*"([^"]+)"/m.exec(cargoToml)?.[1]
const versions = { package: packageJson.version, tauri: tauriConfig.version, cargo: cargoVersion }
const distinct = new Set(Object.values(versions))
if (distinct.size !== 1 || [...distinct].includes(undefined)) {
  throw new Error(`KakeFlow version mismatch: ${JSON.stringify(versions)}`)
}
console.log(`KakeFlow version ${packageJson.version} is consistent.`)
