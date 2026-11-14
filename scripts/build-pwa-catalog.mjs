#!/usr/bin/env node
// Builds the English and Vietnamese catalog subsets that the production PWA bundles instead of the full desktop
// catalogs (src/locales/*.generated.json), which hold connector and provider words the PWA contract forbids.
// Keys are the Japanese source strings the PWA-reachable UI passes to the i18n helpers:
// - string literals in localize("…") and text("…") calls under src/features/simple, src/ui and src/pwa;
// - Japanese string literals in src/features/simple (label sources such as SIMPLE_TABS and the More entries,
//   which reach localize() through a variable);
// - the page labels of the `navigation` array in src/navigation.ts, which the More page lists.
// Test files are skipped. A key missing from a full catalog is an error, never silently dropped.
import { readFile, readdir, writeFile } from 'node:fs/promises'
import { join, relative, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

export const PWA_CATALOG_ROOTS = ['src/features/simple', 'src/ui', 'src/pwa']
export const LABEL_SOURCE_ROOT = 'src/features/simple'
export const NAVIGATION_SOURCE = 'src/navigation.ts'
export const FULL_CATALOG_PATHS = { en: 'src/locales/en.generated.json', vi: 'src/locales/vi.generated.json' }
export const SUBSET_PATHS = { en: 'src/pwa/locales/en.subset.json', vi: 'src/pwa/locales/vi.subset.json' }

const sourceFilePattern = /\.(?:ts|tsx|js|jsx|mjs)$/u
const testFilePattern = /\.test\.[cm]?[jt]sx?$/u
const japanesePattern = /[\u3040-\u30ff\u3400-\u4dbf\u4e00-\u9fff]/u
const helperCallPattern = /\b(?:localize|text)\(\s*(["'])((?:\\.|(?!\1)[^\\\n])*)\1\s*\)/gu
const stringLiteralPattern = /(["'])((?:\\.|(?!\1)[^\\\n])*)\1/gu
const labelPattern = /\blabel:\s*(["'])((?:\\.|(?!\1)[^\\\n])*)\1/gu

function toPosix(path) {
  return path.split('\\').join('/')
}

function unescapeLiteral(body) {
  return body.replace(/\\(.)/gu, (_match, character) => ({ n: '\n', t: '\t', r: '\r' })[character] ?? character)
}

// Drops block comments and whole-line comments so quoted examples in comments are not taken as keys.
function stripComments(source) {
  return source
    .replace(/\/\*[\s\S]*?\*\//gu, '')
    .split('\n')
    .filter((line) => !/^\s*\/\//u.test(line))
    .join('\n')
}

function navigationDeclaration(source) {
  const start = source.indexOf('export const navigation')
  if (start < 0) throw new Error(`${NAVIGATION_SOURCE}: no \`export const navigation\` declaration`)
  const end = source.indexOf('\n]', start)
  if (end < 0) throw new Error(`${NAVIGATION_SOURCE}: unterminated \`navigation\` array`)
  return source.slice(start, end)
}

/**
 * Returns the sorted, de-duplicated catalog keys used by the given sources.
 * @param {ReadonlyArray<{ readonly path: string, readonly source: string }>} files paths relative to the repo root
 * @returns {string[]}
 */
export function collectKeys(files) {
  const keys = new Set()
  for (const { path, source } of files) {
    const posixPath = toPosix(path)
    if (testFilePattern.test(posixPath)) continue
    const code = stripComments(source)
    if (posixPath === NAVIGATION_SOURCE) {
      for (const match of navigationDeclaration(code).matchAll(labelPattern)) keys.add(unescapeLiteral(match[2]))
      continue
    }
    for (const match of code.matchAll(helperCallPattern)) keys.add(unescapeLiteral(match[2]))
    if (posixPath.startsWith(`${LABEL_SOURCE_ROOT}/`)) {
      for (const match of code.matchAll(stringLiteralPattern)) {
        if (japanesePattern.test(match[2])) keys.add(unescapeLiteral(match[2]))
      }
    }
  }
  return [...keys].sort()
}

/**
 * Picks the given keys from the full catalogs.
 * @param {Readonly<Record<string, string>>} fullEn
 * @param {Readonly<Record<string, string>>} fullVi
 * @param {readonly string[]} keys
 * @returns {{ en: Record<string, string>, vi: Record<string, string>, missing: string[] }}
 */
export function buildSubsets(fullEn, fullVi, keys) {
  const en = {}
  const vi = {}
  const missing = []
  for (const key of [...keys].sort()) {
    const enValue = Object.hasOwn(fullEn, key) ? fullEn[key] : undefined
    const viValue = Object.hasOwn(fullVi, key) ? fullVi[key] : undefined
    if (typeof enValue !== 'string' || enValue.trim() === '') missing.push(`en: ${key}`)
    else en[key] = enValue
    if (typeof viValue !== 'string' || viValue.trim() === '') missing.push(`vi: ${key}`)
    else vi[key] = viValue
  }
  return { en, vi, missing }
}

/** Sorted keys, 2-space indentation, trailing newline. */
export function serializeCatalog(catalog) {
  const sorted = Object.fromEntries(Object.keys(catalog).sort().map((key) => [key, catalog[key]]))
  return `${JSON.stringify(sorted, null, 2)}\n`
}

async function filesBelow(directory) {
  const entries = await readdir(directory, { withFileTypes: true })
  const nested = await Promise.all(entries.map(async (entry) => {
    const target = join(directory, entry.name)
    return entry.isDirectory() ? filesBelow(target) : [target]
  }))
  return nested.flat()
}

/**
 * Reads every source file the subset is built from.
 * @param {string} rootDir repository root
 * @returns {Promise<Array<{ path: string, source: string }>>}
 */
export async function listPwaCatalogSources(rootDir) {
  const root = resolve(rootDir)
  const paths = (await Promise.all(PWA_CATALOG_ROOTS.map((directory) => filesBelow(join(root, directory)))))
    .flat()
    .map((file) => toPosix(relative(root, file)))
    .filter((path) => sourceFilePattern.test(path) && !testFilePattern.test(path))
  paths.push(NAVIGATION_SOURCE)
  const unique = [...new Set(paths)].sort()
  return Promise.all(unique.map(async (path) => ({ path, source: await readFile(join(root, path), 'utf8') })))
}

/**
 * Computes the subset files' contents without writing them.
 * @param {string} rootDir repository root
 * @returns {Promise<{ keys: string[], en: string, vi: string, missing: string[] }>}
 */
export async function generatePwaCatalog(rootDir) {
  const root = resolve(rootDir)
  const [files, fullEn, fullVi] = await Promise.all([
    listPwaCatalogSources(root),
    readFile(join(root, FULL_CATALOG_PATHS.en), 'utf8').then(JSON.parse),
    readFile(join(root, FULL_CATALOG_PATHS.vi), 'utf8').then(JSON.parse),
  ])
  const keys = collectKeys(files)
  const subsets = buildSubsets(fullEn, fullVi, keys)
  return { keys, en: serializeCatalog(subsets.en), vi: serializeCatalog(subsets.vi), missing: subsets.missing }
}

async function main() {
  const root = resolve(fileURLToPath(new URL('..', import.meta.url)))
  const result = await generatePwaCatalog(root)
  if (result.missing.length > 0) {
    console.error(`PWA catalog: ${result.missing.length} key(s) have no translation in the full catalogs:`)
    for (const entry of result.missing) console.error(`  ${entry}`)
    process.exitCode = 1
    return
  }
  await Promise.all([
    writeFile(join(root, SUBSET_PATHS.en), result.en),
    writeFile(join(root, SUBSET_PATHS.vi), result.vi),
  ])
  console.log(`PWA catalog: wrote ${result.keys.length} keys to ${SUBSET_PATHS.en} and ${SUBSET_PATHS.vi}`)
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  await main()
}
