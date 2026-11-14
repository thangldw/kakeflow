import 'fake-indexeddb/auto'
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { readFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest'

// The PWA build swaps the full desktop catalogs for the generated subsets and serves no provider names (see
// vite.config.ts). The same swap here catches any Simple screen text the subset generator missed.
vi.mock('../locales/en.generated.json', async () => ({ default: (await import('./locales/en.subset.json')).default }))
vi.mock('../locales/vi.generated.json', async () => ({ default: (await import('./locales/vi.subset.json')).default }))
vi.mock('../locales/provider-names.json', () => ({ default: {} }))

const argonMock = vi.hoisted(() => ({
  derive: vi.fn(async (passphrase: Uint8Array, salt: Uint8Array) => {
    const output = new Uint8Array(32)
    for (let index = 0; index < output.length; index += 1) {
      output[index] = passphrase[index % passphrase.length] ^ salt[index % salt.length] ^ index
    }
    return output
  }),
}))

vi.mock('../platform/pwa/argonWorker', () => ({ deriveArgon2idInWorker: argonMock.derive }))

import enSubset from './locales/en.subset.json'
import viSubset from './locales/vi.subset.json'
import { previousMonths } from '../features/simple/homeMath'
import { I18nProvider, translateText } from '../i18n'
import { PwaLedgerClient } from '../platform/pwa/client'
import type { Household } from '../platform/pwa/types'
import { defaultChart } from './defaultChart'
import { SimpleShell } from './SimpleShell'

/** Hiragana, katakana (full and half width), CJK ideographs and the CJK symbols block: any of it means a Japanese fallback. */
const japanese = /[\u3000-\u30ff\u3400-\u4dbf\u4e00-\u9fff\uf900-\ufaff\uff66-\uff9f]/u
// User data typed in this test stays ASCII, so every Japanese character found is app text.
const household: Household = { id: 'household', name: 'Nguyen Home', baseCurrency: 'JPY' }
const originalFetch = globalThis.fetch

let vaultCount = 0
async function chartVault(locale: 'en' | 'vi') {
  vaultCount += 1
  const client = await PwaLedgerClient.createVault(`simple-subset-${vaultCount}`, 'correct horse battery staple', {
    vaultId: `simple-subset-vault-${vaultCount}`,
    evidence: { getDirectory: undefined },
  })
  await client.createHousehold({ id: household.id, name: household.name })
  for (const account of defaultChart(household.id, (source) => translateText(locale, source))) await client.createAccount(account)
  return client
}

/** Every visible text node and every accessible name or hint attribute that contains Japanese. */
function japaneseText(root: ParentNode): string[] {
  const found: string[] = []
  const walker = document.createTreeWalker(root as Node, NodeFilter.SHOW_TEXT)
  for (let node = walker.nextNode(); node; node = walker.nextNode()) {
    const value = node.textContent ?? ''
    if (japanese.test(value)) found.push(value.trim())
  }
  for (const element of root.querySelectorAll('[aria-label],[placeholder],[title],[alt]')) {
    for (const name of ['aria-label', 'placeholder', 'title', 'alt']) {
      const value = element.getAttribute(name)
      if (value && japanese.test(value)) found.push(`${name}: ${value}`)
    }
  }
  return found
}

beforeAll(() => {
  vi.stubGlobal('fetch', async (input: RequestInfo | URL) => {
    if (String(input).endsWith('kakeflow_core_bg.wasm')) {
      const bytes = await readFile(resolve('src/platform/pwa/core-wasm/kakeflow_core_bg.wasm'))
      return new Response(bytes, { headers: { 'Content-Type': 'application/wasm' } })
    }
    return originalFetch(input)
  })
})

afterEach(() => {
  cleanup()
  localStorage.clear()
  render(<I18nProvider>{null}</I18nProvider>)
  cleanup()
})

afterAll(() => {
  vi.unstubAllGlobals()
})

describe.each([['en', enSubset], ['vi', viSubset]] as const)('Simple screens on the %s PWA catalog subset', (locale, subset) => {
  const t = (source: string) => translateText(locale, source)

  it('serves every subset key in the language, never its Japanese source', () => {
    const fallbacks = Object.keys(subset).filter((source) => t(source) === source || japanese.test(t(source)))
    expect(fallbacks).toEqual([])
    // A desktop-only key is missing, which proves the subset replaced the full catalog.
    expect(t('レビュー範囲を管理')).toBe('レビュー範囲を管理')
  })

  it('shows no Japanese on the five tabs, the open quick-add sheet, the carried-over Budget, Savings and More', async () => {
    const client = await chartVault(locale)
    const month = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Tokyo', year: 'numeric', month: '2-digit' }).format(new Date()).slice(0, 7)
    await client.upsertBudget({ householdId: household.id, month: previousMonths(month, 1)[0], categoryAccountId: 'expense-groceries', budgetJpy: 40_000 })
    localStorage.setItem('kakeflow.locale', locale)
    render(<I18nProvider>
      <SimpleShell client={client} household={household} usageKey="subset:household" onOpenPage={vi.fn()} onSwitchToClassic={vi.fn()} />
    </I18nProvider>)
    const body = document.body
    const tabBar = () => screen.getByRole('navigation', { name: t('主なページ') })
    const openTab = (source: string) => fireEvent.click(within(tabBar()).getByRole('button', { name: t(source) }))

    // Today, with last month's budget and the empty goal card.
    await waitFor(() => expect(body.querySelector('.simple-hero-value')?.textContent).toBe('¥40,000'))
    expect(japaneseText(body)).toEqual([])

    // The quick-add sheet, its More details and its paying-account list, then one saved entry for History.
    fireEvent.click(screen.getByRole('button', { name: t('＋ 支出を記録') }))
    const sheet = await screen.findByRole('dialog', { name: t('支出を記録') })
    fireEvent.change(within(sheet).getByLabelText(t('記録する金額')), { target: { value: '1500' } })
    fireEvent.click(within(sheet).getByRole('button', { name: t('食料品の買い物') }))
    for (const button of within(sheet).getAllByRole('button', { expanded: false })) fireEvent.click(button)
    expect(japaneseText(body)).toEqual([])
    fireEvent.click(within(sheet).getByRole('button', { name: t('記録を保存') }))
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument())
    expect(japaneseText(body)).toEqual([])

    openTab('取引一覧')
    expect(await screen.findByRole('heading', { name: t('食料品の買い物') })).toBeInTheDocument()
    expect(japaneseText(body)).toEqual([])

    openTab('予算管理')
    expect(await screen.findByText(t('予算の引き継ぎ元'))).toBeInTheDocument()
    expect(japaneseText(body)).toEqual([])

    openTab('貯蓄管理')
    const form = await screen.findByRole('form', { name: t('新しい目標を作る') })
    fireEvent.click(within(form).getByRole('button', { name: t('目標を追加する') }))
    expect(await within(form).findByRole('alert')).toBeInTheDocument()
    fireEvent.change(within(form).getByLabelText(t('目標の名前')), { target: { value: 'Trip' } })
    fireEvent.change(within(form).getByLabelText(t('目標金額')), { target: { value: '300000' } })
    fireEvent.change(within(form).getByLabelText(t('目標の日付')), { target: { value: '2027-06-30' } })
    fireEvent.click(within(form).getByRole('button', { name: t('目標を追加する') }))
    expect(await screen.findByRole('heading', { name: 'Trip' })).toBeInTheDocument()
    expect(japaneseText(body)).toEqual([])

    openTab('そのほか')
    expect(await screen.findByRole('group', { name: t('表示モード') })).toBeInTheDocument()
    // The language switch names each language in itself, so 日本語 is the one expected Japanese text.
    expect(japaneseText(body)).toEqual(['日本語'])

    openTab('今日')
    expect(await screen.findByRole('heading', { name: 'Trip' })).toBeInTheDocument()
    expect(japaneseText(body)).toEqual([])
  })
})
