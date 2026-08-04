import { readFile, readdir, writeFile } from 'node:fs/promises'
import path from 'node:path'
import process from 'node:process'

import { buildUpdateManifest, targetForUpdaterArtifact } from './update-manifest.mjs'

function option(name, fallback = null) {
  const index = process.argv.indexOf(`--${name}`)
  return index >= 0 ? process.argv[index + 1] : fallback
}

const root = new URL('../', import.meta.url)
const packageJson = JSON.parse(await readFile(new URL('package.json', root), 'utf8'))
const version = option('version', packageJson.version)
const artifactsDirectory = path.resolve(option('artifacts', `packaging/release/v${version}`))
const output = path.resolve(option('output', path.join(artifactsDirectory, 'latest.json')))
const baseUrl = option('base-url', `https://github.com/thangldw/kakeflow-releases/releases/download/v${version}`)
const notes = option('notes', `KakeFlow ${version}`)
const pubDate = option('pub-date', new Date().toISOString())

const filenames = (await readdir(artifactsDirectory)).filter((name) => targetForUpdaterArtifact(name)).sort()
const artifacts = await Promise.all(filenames.map(async (filename) => ({
  filename,
  signature: await readFile(path.join(artifactsDirectory, `${filename}.sig`), 'utf8'),
})))
const manifest = buildUpdateManifest({ version, notes, pubDate, baseUrl, artifacts })
await writeFile(output, `${JSON.stringify(manifest, null, 2)}\n`, 'utf8')
console.log(`Signed updater manifest written to ${output} for ${Object.keys(manifest.platforms).join(', ')}.`)
