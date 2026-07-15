import { readFile } from 'node:fs/promises'
import { validateReleaseVersionContract } from './release-version-contract.mjs'

const root = new URL('../', import.meta.url)
const packageJson = JSON.parse(await readFile(new URL('package.json', root), 'utf8'))
const packageLock = JSON.parse(await readFile(new URL('package-lock.json', root), 'utf8'))
const tauriConfig = JSON.parse(await readFile(new URL('src-tauri/tauri.conf.json', root), 'utf8'))
const cargoToml = await readFile(new URL('src-tauri/Cargo.toml', root), 'utf8')
const cargoLock = await readFile(new URL('src-tauri/Cargo.lock', root), 'utf8')
const changelog = await readFile(new URL('CHANGELOG.md', root), 'utf8')
const readme = await readFile(new URL('README.md', root), 'utf8')
const projectPage = await readFile(new URL('docs/index.html', root), 'utf8')

const result = validateReleaseVersionContract({ packageJson, packageLock, tauriConfig, cargoToml, cargoLock, changelog, readme, projectPage })
console.log(`KakeFlow release metadata ${result.version} is consistent (${result.projectPageLinks.releaseNoteCtas} release-note CTA, ${result.projectPageLinks.artifactCtas} artifact CTAs).`)
