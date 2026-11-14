import { existsSync, readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { generatePwaCatalog, listPwaCatalogSources, collectKeys } from '../../../scripts/build-pwa-catalog.mjs'

// Copied from scripts/pwa-contract.test.ts (providerCatalogPattern and unusedConnectorCatalogPattern): the production
// PWA bundle must not contain these words, and the subset catalogs end up in that bundle.
const providerCatalogPattern = /(?:GOOGLE_DRIVE|GMAIL|WATCHED_FOLDER|Google Drive|Gmail|同期フォルダー)/u
const unusedConnectorCatalogPattern = /(?:["'](?:REFRESH_NOW|RETRY|DISCONNECT|DISCONNECTED|ACCOUNT_BINDING)["']|すべて更新|接続解除|レビュー範囲を管理|レビュー対象口座|読み取りプロファイル|コネクタ更新の進行状況)/u

const subsetPaths = {
  en: 'src/pwa/locales/en.subset.json',
  vi: 'src/pwa/locales/vi.subset.json',
} as const

function readSubset(locale: keyof typeof subsetPaths): Record<string, string> {
  return JSON.parse(readFileSync(subsetPaths[locale], 'utf8')) as Record<string, string>
}

describe('PWA catalog subset', () => {
  it('is up to date with the generator (run `npm run build:pwa-catalog` after changing UI text)', async () => {
    const generated = await generatePwaCatalog('.')
    expect(generated.missing).toEqual([])
    expect(existsSync(subsetPaths.en) ? readFileSync(subsetPaths.en, 'utf8') : null).toBe(generated.en)
    expect(existsSync(subsetPaths.vi) ? readFileSync(subsetPaths.vi, 'utf8') : null).toBe(generated.vi)
  })

  it('covers the Simple tab and More labels and every localize() key', async () => {
    const keys = collectKeys(await listPwaCatalogSources('.'))
    // Tab labels (simpleNavigation.ts), More entries (SimpleMorePage.tsx and navigation.ts) and a localize() call.
    expect(keys).toEqual(expect.arrayContaining(['今日', '取引一覧', 'そのほか', '設定', '監査の記録', '撮影 Inbox', 'カード照合', '主なページ']))
    expect(Object.keys(readSubset('en'))).toEqual(keys)
    expect(Object.keys(readSubset('vi'))).toEqual(keys)
  })

  it('has a non-empty English and Vietnamese value for every key', () => {
    for (const locale of ['en', 'vi'] as const) {
      const subset = readSubset(locale)
      expect(Object.keys(subset).length).toBeGreaterThan(0)
      expect(Object.entries(subset).filter(([, value]) => typeof value !== 'string' || value.trim() === '')).toEqual([])
    }
  })

  it('contains no provider or connector words forbidden in the PWA bundle', () => {
    for (const locale of ['en', 'vi'] as const) {
      const findings = Object.entries(readSubset(locale)).filter(([key, value]) => (
        [key, value].some((text) => providerCatalogPattern.test(text) || unusedConnectorCatalogPattern.test(JSON.stringify(text)))
      ))
      expect(findings).toEqual([])
    }
  })
})

describe('Simple components', () => {
  it('never import the desktop platform layer as a value', async () => {
    const { readdir } = await import('node:fs/promises')
    const directory = 'src/features/simple'
    const files = (await readdir(directory)).filter((file) => /\.tsx?$/u.test(file) && !/\.test\.tsx?$/u.test(file))
    expect(files.length).toBeGreaterThan(0)
    const findings = files.flatMap((file) => {
      const source = readFileSync(`${directory}/${file}`, 'utf8')
      const statements = source.match(/^(?:import|export)\b[^'"]*?\bfrom\s+['"][^'"]*\/platform(?:\/[^'"]*)?['"]/gmu) ?? []
      const dynamicImports = source.match(/\bimport\(\s*['"][^'"]*\/platform(?:\/[^'"]*)?['"]\s*\)/gu) ?? []
      return [
        ...statements.filter((statement) => !/^(?:import|export)\s+type\b/u.test(statement)),
        ...dynamicImports,
      ].map((statement) => `${file}: ${statement}`)
    })
    expect(findings).toEqual([])
  })
})
