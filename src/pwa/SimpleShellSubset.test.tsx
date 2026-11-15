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
import { PasskeyCancelledError, PasskeyUnsupportedError } from '../platform/pwa/passkey'
import { fakePasskeyAuthenticator } from '../test/fakePasskey'
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
  Reflect.deleteProperty(globalThis, 'PublicKeyCredential')
  vi.restoreAllMocks()
  render(<I18nProvider>{null}</I18nProvider>)
  cleanup()
})

afterAll(() => {
  vi.unstubAllGlobals()
})

describe.each([['en', enSubset], ['vi', viSubset]] as const)('Simple screens on the %s PWA catalog subset', (locale, subset) => {
  const t = (source: string) => translateText(locale, source)
  // Each Turn off button is named after its entry, so its accessible name starts with the visible text.
  const turnOff = new RegExp(`^${t('無効にする')} `, 'u')

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

  it('shows no Japanese in any step, message or confirmation of the quick unlock card', async () => {
    vi.stubGlobal('PublicKeyCredential', class {})
    const client = await chartVault(locale)
    // The first prompt is cancelled, the second is unsupported, the third works.
    let prompts = 0
    const authenticator = fakePasskeyAuthenticator({ create: () => {
      prompts += 1
      if (prompts === 1) return Promise.reject(new PasskeyCancelledError())
      if (prompts === 2) return Promise.reject(new PasskeyUnsupportedError())
      return Promise.resolve() as Promise<never>
    } })
    localStorage.setItem('kakeflow.locale', locale)
    render(<I18nProvider>
      <SimpleShell client={client} household={household} usageKey="subset:household" onOpenPage={vi.fn()} onSwitchToClassic={vi.fn()} passkeyAuthenticator={authenticator} />
    </I18nProvider>)
    const body = document.body
    fireEvent.click(within(screen.getByRole('navigation', { name: t('主なページ') })).getByRole('button', { name: t('そのほか') }))
    const card = (await screen.findByRole('heading', { name: t('指紋・顔・PINですばやく開く') })).closest('section')!
    // The language switch names each language in itself, so 日本語 is the one expected Japanese text.
    const expected = ['日本語']
    expect(japaneseText(body)).toEqual(expected)

    const startAndCheck = async (value: string) => {
      fireEvent.click(within(card).getByRole('button', { name: t('オンにする') }))
      fireEvent.change(within(card).getByLabelText(t('保管庫用パスフレーズ')), { target: { value } })
      expect(japaneseText(body)).toEqual(expected)
      fireEvent.click(within(card).getByRole('button', { name: t('続ける') }))
    }

    // A short passphrase, then a wrong one.
    fireEvent.click(within(card).getByRole('button', { name: t('オンにする') }))
    fireEvent.change(within(card).getByLabelText(t('保管庫用パスフレーズ')), { target: { value: 'short' } })
    fireEvent.click(within(card).getByRole('button', { name: t('続ける') }))
    expect(await within(card).findByText(t('パスフレーズは12文字以上にしてください'))).toBeInTheDocument()
    expect(japaneseText(body)).toEqual(expected)
    fireEvent.change(within(card).getByLabelText(t('保管庫用パスフレーズ')), { target: { value: 'another passphrase here' } })
    fireEvent.click(within(card).getByRole('button', { name: t('続ける') }))
    expect(await within(card).findByText(t('パスフレーズが正しくありません。'))).toBeInTheDocument()
    expect(japaneseText(body)).toEqual(expected)
    fireEvent.click(within(card).getByRole('button', { name: t('キャンセル') }))

    // Cancelled, then unsupported, then turned on.
    await startAndCheck('correct horse battery staple')
    fireEvent.click(await within(card).findByRole('button', { name: t('指紋・顔・PINで確認する') }))
    expect(await within(card).findByText(t('パスキーの確認をキャンセルしました。'))).toBeInTheDocument()
    expect(japaneseText(body)).toEqual(expected)
    await startAndCheck('correct horse battery staple')
    expect(japaneseText(body)).toEqual(expected)
    fireEvent.click(await within(card).findByRole('button', { name: t('指紋・顔・PINで確認する') }))
    expect(await within(card).findByText(t('この端末やブラウザでは、パスキーで開けません。引き続きパスフレーズをお使いください。'))).toBeInTheDocument()
    expect(japaneseText(body)).toEqual(expected)
    await startAndCheck('correct horse battery staple')
    fireEvent.click(await within(card).findByRole('button', { name: t('指紋・顔・PINで確認する') }))
    expect(await within(card).findByText(t('この端末でオンになっています'))).toBeInTheDocument()
    expect(within(card).getByText(t('解錠用パスキー'))).toBeInTheDocument()
    expect(within(card).getByRole('button', { name: t('別のパスキーを追加') })).toBeInTheDocument()
    expect(japaneseText(body)).toEqual(expected)

    // The turn-off confirmation, a failed removal, then the removal.
    fireEvent.click(within(card).getByRole('button', { name: turnOff }))
    expect(await within(card).findByText(t('このパスキーを無効にしますか？'))).toBeInTheDocument()
    expect(japaneseText(body)).toEqual(expected)
    vi.spyOn(client, 'removePasskey').mockRejectedValueOnce(new Error('disk full'))
    fireEvent.click(within(card).getByRole('button', { name: t('はい、無効にします') }))
    expect(await within(card).findByText(t('無効にできませんでした。もう一度お試しください。'))).toBeInTheDocument()
    expect(japaneseText(body)).toEqual(expected)
    fireEvent.click(await within(card).findByRole('button', { name: turnOff }))
    fireEvent.click(within(card).getByRole('button', { name: t('はい、無効にします') }))
    await waitFor(() => expect(within(card).queryByText(t('この端末でオンになっています'))).not.toBeInTheDocument())
    expect(japaneseText(body)).toEqual(expected)
  })

  it('shows no Japanese on the quick unlock card at the passkey limit or after the passphrase check expires', async () => {
    vi.stubGlobal('PublicKeyCredential', class {})
    const client = await chartVault(locale)
    const seed = fakePasskeyAuthenticator()
    for (let index = 0; index < 3; index += 1) {
      await client.verifyPassphrase('correct horse battery staple')
      await client.enablePasskey('correct horse battery staple', seed)
    }
    localStorage.setItem('kakeflow.locale', locale)
    render(<I18nProvider>
      <SimpleShell client={client} household={household} usageKey="subset:household" onOpenPage={vi.fn()} onSwitchToClassic={vi.fn()} passkeyAuthenticator={fakePasskeyAuthenticator()} />
    </I18nProvider>)
    fireEvent.click(within(screen.getByRole('navigation', { name: t('主なページ') })).getByRole('button', { name: t('そのほか') }))
    expect(await screen.findByText(t('パスキーの上限に達しました。新しく追加するには、先にどれかを無効にしてください。'))).toBeInTheDocument()
    expect(japaneseText(document.body)).toEqual(['日本語'])

    fireEvent.click(screen.getAllByRole('button', { name: turnOff })[0])
    fireEvent.click(await screen.findByRole('button', { name: t('はい、無効にします') }))
    await waitFor(() => expect(screen.queryByText(t('パスキーの上限に達しました。新しく追加するには、先にどれかを無効にしてください。'))).not.toBeInTheDocument())

    vi.spyOn(client, 'enablePasskey').mockRejectedValueOnce(new Error('Passkey already enabled'))
    fireEvent.click(screen.getByRole('button', { name: t('別のパスキーを追加') }))
    fireEvent.change(screen.getByLabelText(t('保管庫用パスフレーズ')), { target: { value: 'correct horse battery staple' } })
    fireEvent.click(screen.getByRole('button', { name: t('続ける') }))
    fireEvent.click(await screen.findByRole('button', { name: t('指紋・顔・PINで確認する') }))
    expect(await screen.findByText(t('この端末のパスキーはすでにオンになっています。'))).toBeInTheDocument()
    expect(japaneseText(document.body)).toEqual(['日本語'])

    vi.spyOn(client, 'enablePasskey').mockRejectedValueOnce(new Error('Passphrase not verified'))
    fireEvent.click(screen.getByRole('button', { name: t('別のパスキーを追加') }))
    fireEvent.change(screen.getByLabelText(t('保管庫用パスフレーズ')), { target: { value: 'correct horse battery staple' } })
    fireEvent.click(screen.getByRole('button', { name: t('続ける') }))
    fireEvent.click(await screen.findByRole('button', { name: t('指紋・顔・PINで確認する') }))
    expect(await screen.findByText(t('パスフレーズの確認の有効期限が切れました。もう一度入力してください。'))).toBeInTheDocument()
    expect(japaneseText(document.body)).toEqual(['日本語'])
  })
})
