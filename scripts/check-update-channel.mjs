import { readFile, readdir } from 'node:fs/promises'
import { validateUpdateChannelContract } from './update-channel-contract.mjs'

const root = new URL('../', import.meta.url)
const capabilitiesRoot = new URL('src-tauri/capabilities/', root)
const capabilityFiles = (await readdir(capabilitiesRoot)).filter((name) => name.endsWith('.json')).sort()
const capabilities = await Promise.all(capabilityFiles.map(async (name) => JSON.parse(await readFile(new URL(name, capabilitiesRoot), 'utf8'))))
const result = validateUpdateChannelContract({
  descriptor: JSON.parse(await readFile(new URL('packaging/update-channel.json', root), 'utf8')),
  tauriConfig: JSON.parse(await readFile(new URL('src-tauri/tauri.conf.json', root), 'utf8')),
  packageJson: JSON.parse(await readFile(new URL('package.json', root), 'utf8')),
  cargoToml: await readFile(new URL('src-tauri/Cargo.toml', root), 'utf8'),
  capabilities,
})
console.log(`KakeFlow update channel ${result.channel} is ${result.status}.`)
