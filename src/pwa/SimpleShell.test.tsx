import 'fake-indexeddb/auto'
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { readFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest'

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

import { I18nProvider, translateText } from '../i18n'
import { PwaLedgerClient } from '../platform/pwa/client'
import type { Household } from '../platform/pwa/types'
import { defaultChart } from './defaultChart'
import { SimpleShell } from './SimpleShell'

const passphrase = 'correct horse battery staple'
const originalFetch = globalThis.fetch
const household: Household = { id: 'household', name: '山田家', baseCurrency: 'JPY' }

let vaultCount = 0
async function emptyVault() {
  vaultCount += 1
  const client = await PwaLedgerClient.createVault(`simple-shell-${vaultCount}`, passphrase, {
    vaultId: `simple-shell-vault-${vaultCount}`,
    evidence: { getDirectory: undefined },
  })
  await client.createHousehold({ id: household.id, name: household.name })
  return client
}

async function chartVault(locale: 'en' | 'vi') {
  const client = await emptyVault()
  for (const account of defaultChart(household.id, (source) => translateText(locale, source))) await client.createAccount(account)
  return client
}

/** The two accounts the original PWA setup form creates. */
async function setupFormVault() {
  const client = await emptyVault()
  await client.createAccount({ id: 'asset', householdId: household.id, name: '財布', kind: 'ASSET' })
  await client.createAccount({ id: 'expense', householdId: household.id, name: '食費', kind: 'EXPENSE' })
  return client
}

function renderShell(client: PwaLedgerClient, locale: 'en' | 'vi') {
  localStorage.setItem('kakeflow.locale', locale)
  const onOpenPage = vi.fn()
  const onSwitchToClassic = vi.fn()
  const view = render(<I18nProvider>
    <SimpleShell client={client} household={household} onOpenPage={onOpenPage} onSwitchToClassic={onSwitchToClassic} />
  </I18nProvider>)
  return { ...view, onOpenPage, onSwitchToClassic }
}

const tabBar = () => screen.getByRole('navigation', { name: /./u })
const heroValue = (container: HTMLElement) => container.querySelector('.simple-hero-value')?.textContent

/** Visible text and accessible names that start with a lower-case ASCII letter. */
function lowerCaseStarts(root: HTMLElement): string[] {
  const found: string[] = []
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT)
  for (let node = walker.nextNode(); node; node = walker.nextNode()) {
    const value = node.textContent?.trim() ?? ''
    if (/^[a-z]/u.test(value)) found.push(value)
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
  // The active locale is module state; render once in Japanese so later files start from the default.
  render(<I18nProvider>{null}</I18nProvider>)
  cleanup()
})

afterAll(() => {
  vi.unstubAllGlobals()
})

describe.each(['en', 'vi'] as const)('SimpleShell in %s', (locale) => {
  const t = (source: string) => translateText(locale, source)

  it('opens on Today with the Simple Home and the five tabs', async () => {
    const client = await chartVault(locale)
    const { container } = renderShell(client, locale)
    expect(await screen.findByRole('button', { name: t('月の上限を決める') })).toBeInTheDocument()
    expect(screen.getByText('山田家')).toBeInTheDocument()
    const tabs = within(tabBar()).getAllByRole('button')
    expect(tabs.map((tab) => tab.textContent)).toEqual(['今日', '取引一覧', '予算管理', '貯蓄管理', 'そのほか'].map(t))
    expect(tabs[0]).toHaveAttribute('aria-current', 'page')
    expect(screen.getByText(locale === 'en' ? 'Today' : 'Hôm nay')).toBeInTheDocument()
    expect(lowerCaseStarts(container)).toEqual([])
  })

  it('saves a budget, and a quick add lowers the hero by the amount with a Saved status', async () => {
    const client = await chartVault(locale)
    const { container } = renderShell(client, locale)
    const groceries = t('食料品の買い物')

    fireEvent.click(within(tabBar()).getByRole('button', { name: t('予算管理') }))
    const row = await screen.findByRole('form', { name: groceries })
    fireEvent.change(within(row).getByLabelText(groceries), { target: { value: '50000' } })
    fireEvent.click(within(row).getByRole('button', { name: t('予算を保存する') }))
    expect(await within(row).findByRole('status')).toHaveTextContent(t('予算を保存しました'))
    expect((await client.listBudgets(household.id, currentMonth()))[0]?.budgetJpy).toBe(50_000)

    fireEvent.click(within(tabBar()).getByRole('button', { name: t('今日') }))
    await waitFor(() => expect(heroValue(container)).toBe('¥50,000'))

    fireEvent.click(screen.getByRole('button', { name: t('＋ 支出を記録') }))
    const sheet = await screen.findByRole('dialog', { name: t('支出を記録') })
    fireEvent.change(within(sheet).getByLabelText(t('記録する金額')), { target: { value: '1500' } })
    fireEvent.click(within(sheet).getByRole('button', { name: groceries }))
    fireEvent.click(within(sheet).getByRole('button', { name: t('記録を保存') }))

    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument())
    expect(screen.getByText(`${t('保存しました')} ¥1,500 · ${groceries}`)).toHaveAttribute('role', 'status')
    await waitFor(() => expect(heroValue(container)).toBe('¥48,500'))
    expect(screen.queryByRole('button', { name: t('修正') })).not.toBeInTheDocument()

    fireEvent.click(within(tabBar()).getByRole('button', { name: t('取引一覧') }))
    expect(await screen.findByRole('heading', { name: groceries })).toBeInTheDocument()
  })

  it('creates a savings goal that Today then shows', async () => {
    const client = await chartVault(locale)
    renderShell(client, locale)
    fireEvent.click(within(tabBar()).getByRole('button', { name: t('貯蓄管理') }))
    const form = await screen.findByRole('form', { name: t('新しい目標を作る') })
    fireEvent.change(within(form).getByLabelText(t('目標の名前')), { target: { value: '家族旅行' } })
    fireEvent.change(within(form).getByLabelText(t('目標金額')), { target: { value: '300000' } })
    fireEvent.change(within(form).getByLabelText(t('目標の日付')), { target: { value: '2027-06-30' } })
    fireEvent.click(within(form).getByRole('button', { name: t('目標を追加する') }))
    expect(await screen.findByRole('heading', { name: '家族旅行' })).toBeInTheDocument()

    fireEvent.click(within(tabBar()).getByRole('button', { name: t('今日') }))
    const card = (await screen.findByRole('heading', { name: '家族旅行' })).closest('section')!
    expect(card).toHaveTextContent('¥0 / ¥300,000')
  })

  it('lists the PWA pages, the mode switch and the language switch under More', async () => {
    const client = await chartVault(locale)
    const { onOpenPage, onSwitchToClassic, container } = renderShell(client, locale)
    fireEvent.click(within(tabBar()).getByRole('button', { name: t('そのほか') }))

    fireEvent.click(await screen.findByRole('button', { name: t('レシートを取り込む') }))
    expect(onOpenPage).toHaveBeenLastCalledWith('import')
    fireEvent.click(screen.getByRole('button', { name: t('元帳と証跡') }))
    expect(onOpenPage).toHaveBeenLastCalledWith('ledger')
    fireEvent.click(screen.getByRole('button', { name: t('バックアップと復元') }))
    expect(onOpenPage).toHaveBeenLastCalledWith('backup')

    const mode = screen.getByRole('group', { name: t('表示モード') })
    expect(within(mode).getByRole('button', { name: t('かんたん') })).toHaveAttribute('aria-pressed', 'true')
    const language = screen.getByRole('group', { name: t('言語') })
    expect(within(language).getAllByRole('button').map((button) => button.textContent)).toEqual(['日本語', 'English', 'Tiếng Việt'])
    expect(within(language).getByRole('button', { name: locale === 'en' ? 'English' : 'Tiếng Việt' })).toHaveAttribute('aria-pressed', 'true')
    expect(lowerCaseStarts(container)).toEqual([])

    fireEvent.click(within(mode).getByRole('button', { name: t('詳細') }))
    expect(onSwitchToClassic).toHaveBeenCalledTimes(1)
  })

  it('switches the language from More', async () => {
    const client = await chartVault(locale)
    renderShell(client, locale)
    fireEvent.click(within(tabBar()).getByRole('button', { name: t('そのほか') }))
    const other = locale === 'en' ? 'vi' : 'en'
    fireEvent.click(within(await screen.findByRole('group', { name: t('言語') })).getByRole('button', { name: other === 'en' ? 'English' : 'Tiếng Việt' }))
    expect(within(tabBar()).getByRole('button', { name: translateText(other, 'そのほか') })).toBeInTheDocument()
    expect(localStorage.getItem('kakeflow.locale')).toBe(other)
  })

  it('works on a vault with only the two setup accounts', async () => {
    const client = await setupFormVault()
    renderShell(client, locale)
    // Home explains how to set a limit and that button opens the Budget tab.
    fireEvent.click(await screen.findByRole('button', { name: t('月の上限を決める') }))
    expect(within(tabBar()).getByRole('button', { name: t('予算管理') })).toHaveAttribute('aria-current', 'page')
    expect(await screen.findByRole('form', { name: '食費' })).toBeInTheDocument()

    const addForm = screen.getByRole('form', { name: t('カテゴリーの追加') })
    fireEvent.change(within(addForm).getByLabelText(t('新しいカテゴリーの名前')), { target: { value: '日用品' } })
    fireEvent.click(within(addForm).getByRole('button', { name: t('このカテゴリーを追加') }))
    expect(await screen.findByRole('form', { name: '日用品' })).toBeInTheDocument()
    const added = (await client.listAccounts(household.id)).find((account) => account.name === '日用品')
    expect(added?.kind).toBe('EXPENSE')
    expect(added?.id).not.toContain('~')

    fireEvent.click(screen.getByRole('button', { name: t('＋ 支出を記録') }))
    const sheet = await screen.findByRole('dialog', { name: t('支出を記録') })
    expect(within(sheet).getByRole('button', { name: /財布/u })).toBeInTheDocument()

    // Nothing can receive income yet: the sheet's empty state adds only the income account, once even on a double tap.
    fireEvent.click(within(sheet).getByRole('button', { name: t('収入') }))
    expect(within(sheet).getByText(t('記録できる口座がありません'))).toBeInTheDocument()
    const setUp = within(sheet).getByRole('button', { name: t('口座を設定する') })
    fireEvent.click(setUp)
    fireEvent.click(setUp)
    expect(await within(sheet).findByRole('button', { name: t('給与収入') })).toBeInTheDocument()
    expect(within(sheet).getByLabelText(t('記録する金額'))).toBeInTheDocument()
    expect(screen.queryByRole('alert')).not.toBeInTheDocument()
    const ids = (await client.listAccounts(household.id)).map((account) => account.id)
    expect(ids.filter((id) => id === 'income-salary')).toHaveLength(1)
    expect(ids.filter((id) => !id.startsWith('expense-'))).toEqual(['asset', 'expense', 'income-salary'])
    expect(ids).not.toEqual(expect.arrayContaining(['expense-groceries']))
  })
})

function currentMonth() {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Tokyo', year: 'numeric', month: '2-digit' }).format(new Date()).slice(0, 7)
}
