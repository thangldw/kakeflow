import 'fake-indexeddb/auto'
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { readFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'

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

import { I18nProvider } from '../i18n'
import { PwaLedgerClient } from '../platform/pwa/client'
import { PasskeyCancelledError, PasskeyUnsupportedError, type PasskeyAuthenticator } from '../platform/pwa/passkey'
import { PASSKEY_LIMIT } from '../platform/pwa/passkeyWrap'
import { fakePasskeyAuthenticator } from '../test/fakePasskey'
import { QuickUnlockCard } from './QuickUnlockCard'

const passphrase = 'correct horse battery staple'
const originalFetch = globalThis.fetch

const copy = {
  en: {
    title: 'Quick unlock with fingerprint, face or PIN',
    turnOn: 'Turn on',
    field: 'Vault passphrase',
    next: 'Continue',
    cancel: 'Cancel',
    confirm: 'Confirm with fingerprint, face or PIN',
    wrong: 'That passphrase is not correct.',
    short: 'Use a passphrase of at least 12 characters',
    cancelled: 'Passkey confirmation was cancelled.',
    unsupported: "This browser or device can't unlock with a passkey. Keep using your passphrase.",
    expired: 'The passphrase check expired. Please enter it again.',
    on: 'On for this device',
    turnOff: 'Turn off',
    yes: 'Yes, turn off',
    ask: 'Turn off this passkey?',
    revoke: /does not revoke access for anyone who already has a copy of this device's data and the passkey/u,
    rekey: /restore a backup into a new vault, which re-keys the vault/u,
    limit: 'Limit reached. Turn one off before adding another.',
    addAnother: 'Add another passkey',
    already: "This device's passkey is already on.",
    passkeyName: 'Passkey',
    added: 'Added',
  },
  vi: {
    title: 'Mở nhanh bằng vân tay, khuôn mặt hoặc mã PIN',
    turnOn: 'Bật',
    field: 'Cụm mật khẩu của kho dữ liệu',
    next: 'Tiếp tục',
    cancel: 'Hủy bỏ',
    confirm: 'Xác nhận bằng vân tay, khuôn mặt hoặc mã PIN',
    wrong: 'Cụm mật khẩu không đúng.',
    short: 'Hãy dùng cụm mật khẩu dài ít nhất 12 ký tự',
    cancelled: 'Đã hủy xác nhận khóa truy cập.',
    unsupported: 'Trình duyệt hoặc thiết bị này không thể mở khóa bằng khóa truy cập. Hãy tiếp tục dùng cụm mật khẩu.',
    expired: 'Phiên kiểm tra cụm mật khẩu đã hết hạn. Vui lòng nhập lại.',
    on: 'Mở nhanh đang bật trên thiết bị này',
    turnOff: 'Tắt',
    yes: 'Có, tắt',
    ask: 'Tắt mở nhanh cho khóa truy cập này?',
    revoke: /Nó không thu hồi quyền truy cập của người đã có bản sao dữ liệu của thiết bị này cùng khóa truy cập/u,
    rekey: /khôi phục bản sao lưu vào một kho dữ liệu mới/u,
    limit: 'Đã đạt giới hạn. Hãy tắt một khóa trước khi thêm khóa khác.',
    addAnother: 'Thêm khóa truy cập khác',
    already: 'Khóa truy cập của thiết bị này đã được bật.',
    passkeyName: 'Khóa truy cập',
    added: 'Ngày thêm',
  },
  ja: {
    title: '指紋・顔・PINですばやく開く',
    turnOn: 'オンにする',
    field: '保管庫用パスフレーズ',
    next: '続ける',
    cancel: 'キャンセル',
    confirm: '指紋・顔・PINで確認する',
    wrong: 'パスフレーズが正しくありません。',
    short: 'パスフレーズは12文字以上にしてください',
    cancelled: 'パスキーの確認をキャンセルしました。',
    unsupported: 'この端末やブラウザでは、パスキーで開けません。引き続きパスフレーズをお使いください。',
    expired: 'パスフレーズの確認の有効期限が切れました。もう一度入力してください。',
    on: 'この端末でオンになっています',
    turnOff: '無効にする',
    yes: 'はい、無効にします',
    ask: 'このパスキーを無効にしますか？',
    revoke: /すでに持っている人のアクセスは取り消されません/u,
    rekey: /バックアップを新しい保管庫に復元してください/u,
    limit: 'パスキーの上限に達しました。新しく追加するには、先にどれかを無効にしてください。',
    addAnother: '別のパスキーを追加',
    already: 'この端末のパスキーはすでにオンになっています。',
    passkeyName: '解錠用パスキー',
    added: '登録日',
  },
} as const

let vaultCount = 0
async function newVault() {
  vaultCount += 1
  return PwaLedgerClient.createVault(`quick-unlock-${vaultCount}`, passphrase, {
    vaultId: `quick-unlock-vault-${vaultCount}`,
    evidence: { getDirectory: undefined },
  })
}

async function seedPasskeys(client: PwaLedgerClient, count: number, label?: string) {
  const seed = fakePasskeyAuthenticator()
  for (let index = 0; index < count; index += 1) {
    await client.verifyPassphrase(passphrase)
    await client.enablePasskey(passphrase, seed, label)
  }
}

function escapeRegExp(value: string) {
  return value.replace(/[.*+?^${}()|[\]\\]/gu, '\\$&')
}

function renderCard(client: PwaLedgerClient, locale: 'en' | 'vi' | 'ja', authenticator: PasskeyAuthenticator) {
  localStorage.setItem('kakeflow.locale', locale)
  return render(<I18nProvider><QuickUnlockCard client={client} authenticator={authenticator} /></I18nProvider>)
}

function typePassphrase(label: string, value: string) {
  fireEvent.change(screen.getByLabelText(label), { target: { value } })
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

beforeEach(() => {
  vi.stubGlobal('PublicKeyCredential', class {})
})

afterEach(() => {
  cleanup()
  localStorage.clear()
  Reflect.deleteProperty(globalThis, 'PublicKeyCredential')
  vi.restoreAllMocks()
  // The active locale is module state; render once in Japanese so later files start from the default.
  render(<I18nProvider>{null}</I18nProvider>)
  cleanup()
})

afterAll(() => {
  vi.unstubAllGlobals()
})

describe.each(['en', 'vi', 'ja'] as const)('QuickUnlockCard in %s', (locale) => {
  const text = copy[locale]
  // Each Turn off button is named after its entry, so its accessible name starts with the visible text.
  const turnOff = new RegExp(`^${escapeRegExp(text.turnOff)} `, 'u')

  it('turns on in two taps: the passphrase check first, then one passkey prompt, and lists the passkey', async () => {
    const client = await newVault()
    const authenticator = fakePasskeyAuthenticator()
    const verify = vi.spyOn(client, 'verifyPassphrase')
    const enable = vi.spyOn(client, 'enablePasskey')
    renderCard(client, locale, authenticator)

    expect(await screen.findByRole('heading', { name: text.title })).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: text.turnOn }))
    typePassphrase(text.field, passphrase)
    fireEvent.click(screen.getByRole('button', { name: text.next }))

    // The slow check ran on the first tap; no passkey prompt has started and the single confirm button is shown.
    const confirm = await screen.findByRole('button', { name: text.confirm })
    expect(verify).toHaveBeenCalledWith(passphrase)
    expect(enable).not.toHaveBeenCalled()
    expect(authenticator.create).not.toHaveBeenCalled()
    expect(screen.queryByLabelText(text.field)).not.toBeInTheDocument()

    fireEvent.click(confirm)
    expect(await screen.findByText(text.on)).toBeInTheDocument()
    expect(enable).toHaveBeenCalledTimes(1)
    expect(enable).toHaveBeenCalledWith(passphrase, authenticator)
    expect(authenticator.create).toHaveBeenCalledTimes(1)
    expect(await client.listPasskeys()).toHaveLength(1)
    const entries = screen.getAllByRole('listitem')
    expect(entries).toHaveLength(1)
    expect(entries[0]).not.toHaveTextContent(/Passkey \d{4}-\d{2}-\d{2}/u)
    expect(entries[0]).toHaveTextContent(text.passkeyName)
    expect(within(entries[0]).getByRole('button', { name: turnOff })).toHaveTextContent(text.turnOff)
    // Once on, the action adds another passkey instead of offering to turn it on again.
    expect(screen.getByRole('button', { name: text.addAnother })).toBeEnabled()
    expect(screen.queryByRole('button', { name: text.turnOn })).not.toBeInTheDocument()
    expect(screen.queryByLabelText(text.field)).not.toBeInTheDocument()
    expect(screen.queryByRole('alert')).not.toBeInTheDocument()
  })

  it('shows an inline error for a wrong passphrase and never reaches the confirm button', async () => {
    const client = await newVault()
    const authenticator = fakePasskeyAuthenticator()
    renderCard(client, locale, authenticator)
    fireEvent.click(await screen.findByRole('button', { name: text.turnOn }))
    typePassphrase(text.field, 'another passphrase here')
    fireEvent.click(screen.getByRole('button', { name: text.next }))

    expect(await screen.findByRole('alert')).toHaveTextContent(text.wrong)
    expect(screen.queryByRole('button', { name: text.confirm })).not.toBeInTheDocument()
    // The wrong text is gone from the field and the form is usable again.
    expect(screen.getByLabelText(text.field)).toHaveValue('')
    expect(screen.getByRole('button', { name: text.next })).toBeEnabled()
    expect(authenticator.create).not.toHaveBeenCalled()
    expect(await client.listPasskeys()).toEqual([])
  })

  it('does not start the slow check for a passphrase shorter than 12 characters', async () => {
    const client = await newVault()
    const verify = vi.spyOn(client, 'verifyPassphrase')
    renderCard(client, locale, fakePasskeyAuthenticator())
    fireEvent.click(await screen.findByRole('button', { name: text.turnOn }))
    typePassphrase(text.field, 'too short')
    fireEvent.click(screen.getByRole('button', { name: text.next }))
    expect(await screen.findByRole('alert')).toHaveTextContent(text.short)
    expect(verify).not.toHaveBeenCalled()
  })

  it('returns to the off state with a message when the passkey prompt is cancelled, and keeps no passphrase', async () => {
    const client = await newVault()
    const authenticator = fakePasskeyAuthenticator({ create: () => Promise.reject(new PasskeyCancelledError()) })
    renderCard(client, locale, authenticator)
    fireEvent.click(await screen.findByRole('button', { name: text.turnOn }))
    typePassphrase(text.field, passphrase)
    fireEvent.click(screen.getByRole('button', { name: text.next }))
    fireEvent.click(await screen.findByRole('button', { name: text.confirm }))

    expect(await screen.findByText(text.cancelled)).toBeInTheDocument()
    expect(screen.getByRole('button', { name: text.turnOn })).toBeEnabled()
    expect(screen.queryByRole('button', { name: text.confirm })).not.toBeInTheDocument()
    expect(screen.queryByLabelText(text.field)).not.toBeInTheDocument()
    expect(await client.listPasskeys()).toEqual([])

    // Starting again asks for the passphrase afresh.
    fireEvent.click(screen.getByRole('button', { name: text.turnOn }))
    expect(screen.getByLabelText(text.field)).toHaveValue('')
    expect(screen.queryByText(text.cancelled)).not.toBeInTheDocument()
  })

  it('says the passphrase stays the way in, and stores nothing, when the browser cannot do it', async () => {
    const client = await newVault()
    const authenticator = fakePasskeyAuthenticator({ create: () => Promise.reject(new PasskeyUnsupportedError()) })
    renderCard(client, locale, authenticator)
    fireEvent.click(await screen.findByRole('button', { name: text.turnOn }))
    typePassphrase(text.field, passphrase)
    fireEvent.click(screen.getByRole('button', { name: text.next }))
    fireEvent.click(await screen.findByRole('button', { name: text.confirm }))

    expect(await screen.findByRole('alert')).toHaveTextContent(text.unsupported)
    expect(screen.getByRole('button', { name: text.turnOn })).toBeEnabled()
    expect(await client.listPasskeys()).toEqual([])
  })

  it('treats any other failure like an unsupported browser and shows no detail', async () => {
    const client = await newVault()
    const authenticator = fakePasskeyAuthenticator({ create: () => Promise.reject(new Error('device exploded with secret detail')) })
    renderCard(client, locale, authenticator)
    fireEvent.click(await screen.findByRole('button', { name: text.turnOn }))
    typePassphrase(text.field, passphrase)
    fireEvent.click(screen.getByRole('button', { name: text.next }))
    fireEvent.click(await screen.findByRole('button', { name: text.confirm }))

    const alert = await screen.findByRole('alert')
    expect(alert).toHaveTextContent(text.unsupported)
    expect(alert).not.toHaveTextContent('secret detail')
  })

  it('goes back to the passphrase step with a short message when the client no longer holds the verified passphrase', async () => {
    const client = await newVault()
    vi.spyOn(client, 'enablePasskey').mockRejectedValueOnce(new Error('Passphrase not verified'))
    renderCard(client, locale, fakePasskeyAuthenticator())
    fireEvent.click(await screen.findByRole('button', { name: text.turnOn }))
    typePassphrase(text.field, passphrase)
    fireEvent.click(screen.getByRole('button', { name: text.next }))
    fireEvent.click(await screen.findByRole('button', { name: text.confirm }))

    expect(await screen.findByRole('alert')).toHaveTextContent(text.expired)
    expect(screen.getByLabelText(text.field)).toHaveValue('')
    expect(screen.queryByRole('button', { name: text.confirm })).not.toBeInTheDocument()
  })

  it('asks before turning off, explains what that does not undo, then removes only that entry', async () => {
    const client = await newVault()
    await seedPasskeys(client, 1)
    const remove = vi.spyOn(client, 'removePasskey')
    renderCard(client, locale, fakePasskeyAuthenticator())
    expect(await screen.findByText(text.on)).toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: turnOff }))
    const group = await screen.findByRole('group', { name: new RegExp(text.ask, 'u') })
    expect(group).toHaveTextContent(text.revoke)
    expect(group).toHaveTextContent(text.rekey)
    expect(remove).not.toHaveBeenCalled()

    // Cancelling keeps the passkey.
    fireEvent.click(within(group).getByRole('button', { name: text.cancel }))
    expect(screen.queryByRole('group')).not.toBeInTheDocument()
    expect(await client.listPasskeys()).toHaveLength(1)

    fireEvent.click(screen.getByRole('button', { name: turnOff }))
    fireEvent.click(await screen.findByRole('button', { name: text.yes }))
    await waitFor(() => expect(screen.queryByText(text.on)).not.toBeInTheDocument())
    expect(remove).toHaveBeenCalledTimes(1)
    expect(await client.listPasskeys()).toEqual([])
    expect(screen.getByRole('button', { name: text.turnOn })).toBeEnabled()
  })

  it('disables Turn on at the limit with a short note, and a turn-off frees it again', async () => {
    const client = await newVault()
    await seedPasskeys(client, PASSKEY_LIMIT)
    renderCard(client, locale, fakePasskeyAuthenticator())
    expect(await screen.findByText(text.on)).toBeInTheDocument()
    expect(screen.getAllByRole('listitem')).toHaveLength(PASSKEY_LIMIT)
    expect(screen.getByRole('button', { name: text.addAnother })).toBeDisabled()
    expect(screen.getByText(text.limit)).toBeInTheDocument()

    fireEvent.click(screen.getAllByRole('button', { name: turnOff })[0])
    fireEvent.click(await screen.findByRole('button', { name: text.yes }))
    await waitFor(() => expect(screen.getAllByRole('listitem')).toHaveLength(PASSKEY_LIMIT - 1))
    expect(screen.getByRole('button', { name: text.addAnother })).toBeEnabled()
    expect(screen.queryByText(text.limit)).not.toBeInTheDocument()
  })

  it('says the passkey is already on when the browser finds this device already enrolled', async () => {
    const client = await newVault()
    await seedPasskeys(client, 1)
    const authenticator = fakePasskeyAuthenticator({
      create: () => Promise.reject(Object.assign(new Error('excluded credential'), { name: 'InvalidStateError' })),
    })
    renderCard(client, locale, authenticator)
    fireEvent.click(await screen.findByRole('button', { name: text.addAnother }))
    typePassphrase(text.field, passphrase)
    fireEvent.click(screen.getByRole('button', { name: text.next }))
    fireEvent.click(await screen.findByRole('button', { name: text.confirm }))

    expect(await screen.findByRole('status')).toHaveTextContent(text.already)
    expect(screen.queryByText(text.unsupported)).not.toBeInTheDocument()
    expect(screen.queryByRole('alert')).not.toBeInTheDocument()
    expect(screen.getAllByRole('listitem')).toHaveLength(1)
    expect(screen.getByRole('button', { name: text.addAnother })).toBeEnabled()
    expect(await client.listPasskeys()).toHaveLength(1)
  })

  it('says the passkey is already on when the client finds the same credential stored', async () => {
    const client = await newVault()
    await seedPasskeys(client, 1)
    // A fresh fake hands out the same first credential id as the one that seeded the vault.
    renderCard(client, locale, fakePasskeyAuthenticator())
    fireEvent.click(await screen.findByRole('button', { name: text.addAnother }))
    typePassphrase(text.field, passphrase)
    fireEvent.click(screen.getByRole('button', { name: text.next }))
    fireEvent.click(await screen.findByRole('button', { name: text.confirm }))

    expect(await screen.findByRole('status')).toHaveTextContent(text.already)
    expect(screen.queryByText(text.unsupported)).not.toBeInTheDocument()
    expect(await client.listPasskeys()).toHaveLength(1)
  })

  it('names a default entry in the screen language with its date once, and each Turn off after its entry', async () => {
    const client = await newVault()
    await seedPasskeys(client, 2)
    renderCard(client, locale, fakePasskeyAuthenticator())
    const entries = await screen.findAllByRole('listitem')
    expect(entries).toHaveLength(2)
    const [stored] = await client.listPasskeys()
    const date = new Date(stored.createdAt).toLocaleDateString(
      { en: 'en-US', vi: 'vi-VN', ja: 'ja-JP' }[locale],
      { dateStyle: 'medium' },
    )
    for (const [index, entry] of entries.entries()) {
      const name = `${text.passkeyName} ${index + 1}`
      expect(entry).toHaveTextContent(name)
      expect(entry).not.toHaveTextContent(/Passkey \d{4}-\d{2}-\d{2}/u)
      expect(entry.textContent!.split(date)).toHaveLength(2)
      expect(within(entry).getByRole('button', { name: `${text.turnOff} ${name} (${text.added} ${date})` }))
        .toHaveTextContent(text.turnOff)
    }
    const names = screen.getAllByRole('button', { name: turnOff }).map((button) => button.getAttribute('aria-label'))
    expect(new Set(names).size).toBe(2)
  })

  it('shows a stored custom label as is', async () => {
    const client = await newVault()
    await seedPasskeys(client, 1, 'Work phone')
    renderCard(client, locale, fakePasskeyAuthenticator())
    const [entry] = await screen.findAllByRole('listitem')
    expect(entry).toHaveTextContent('Work phone')
    expect(entry).not.toHaveTextContent(text.passkeyName)
    expect(within(entry).getByRole('button', { name: new RegExp(`^${escapeRegExp(text.turnOff)} Work phone `, 'u') }))
      .toBeInTheDocument()
  })

  it('offers every action as a Simple button with the 44px touch target class', async () => {
    const client = await newVault()
    renderCard(client, locale, fakePasskeyAuthenticator())
    fireEvent.click(await screen.findByRole('button', { name: text.turnOn }))
    const hasTouchClass = (button: HTMLElement) => button.classList.contains('primary-btn') || button.classList.contains('secondary-btn')
    expect(screen.getAllByRole('button').every(hasTouchClass)).toBe(true)
    typePassphrase(text.field, passphrase)
    fireEvent.click(screen.getByRole('button', { name: text.next }))
    await screen.findByRole('button', { name: text.confirm })
    expect(screen.getAllByRole('button').every(hasTouchClass)).toBe(true)
    fireEvent.click(screen.getByRole('button', { name: text.cancel }))
    expect(screen.getAllByRole('button').every(hasTouchClass)).toBe(true)
  })
})

describe('QuickUnlockCard availability', () => {
  it('renders nothing when this browser cannot offer a passkey', async () => {
    Reflect.deleteProperty(globalThis, 'PublicKeyCredential')
    const client = await newVault()
    const list = vi.spyOn(client, 'listPasskeys')
    const { container } = renderCard(client, 'en', fakePasskeyAuthenticator())
    await waitFor(() => expect(list).toHaveBeenCalled())
    await new Promise((done) => setTimeout(done, 20))
    expect(container).toBeEmptyDOMElement()
    expect(screen.queryByRole('heading')).not.toBeInTheDocument()
  })

  it('renders nothing when the passkey list cannot be read', async () => {
    const client = await newVault()
    const list = vi.spyOn(client, 'listPasskeys').mockRejectedValue(new Error('unreadable'))
    const { container } = renderCard(client, 'en', fakePasskeyAuthenticator())
    await waitFor(() => expect(list).toHaveBeenCalled())
    await new Promise((done) => setTimeout(done, 20))
    expect(container).toBeEmptyDOMElement()
  })
})
