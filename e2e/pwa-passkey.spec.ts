import { expect, test, type BrowserContext, type CDPSession, type Page, type TestInfo } from '@playwright/test'

const passphrase = 'synthetic passkey vault passphrase 2026'
const budgetJpy = 30_000
const spentJpy = 3_000
const appPath = '/kakeflow/app/'

/** The labels a test reads, in English (from src/pwa/locales/en.subset.json and src/locales/en.generated.json). */
const labels = {
  vaultHeading: 'Own your financial record',
  passphrase: 'Vault passphrase',
  confirmPassphrase: 'Confirm passphrase',
  createVault: 'Create encrypted vault',
  setupHeading: 'Set up your household',
  householdName: 'Household name',
  moneyAccount: 'Money account',
  expenseAccount: 'Expense account',
  saveSetup: 'Save local setup',
  mainPages: 'Main pages',
  tabs: { today: 'Today', budget: 'Budget', more: 'More' },
  setLimit: 'Set a monthly limit',
  budgetHeading: 'Monthly budget by category',
  groceries: 'Groceries',
  saveBudget: 'Save budget',
  budgetSaved: 'Budget saved',
  addSpending: '+ Add spending',
  sheetTitle: 'Add spending',
  save: 'Save',
  saved: 'Saved',
  leftToSpend: 'Left to spend this month',
  spent: 'Spent',
  unlockHeading: 'Unlock local vault',
  unlockVault: 'Unlock vault',
  unlockWithPasskey: 'Unlock with passkey',
  quickUnlockTitle: 'Quick unlock with fingerprint, face or PIN',
  turnOn: 'Turn on',
  continue: 'Continue',
  confirmWithPasskey: 'Confirm with fingerprint, face or PIN',
  passphraseConfirmed: 'Passphrase confirmed. Now confirm with your fingerprint, face or PIN.',
  onForDevice: 'On for this device',
  turnOff: 'Turn off',
  turnOffQuestion: 'Turn off this passkey?',
  yesTurnOff: 'Yes, turn off',
  cannotUsePasskey: "This browser or device can't unlock with a passkey. Keep using your passphrase.",
} as const

/** The virtual platform authenticator of the brief; only `hasPrf` differs between the two tests. */
function authenticatorOptions(hasPrf: boolean) {
  return {
    protocol: 'ctap2',
    transport: 'internal',
    hasResidentKey: true,
    hasUserVerification: true,
    isUserVerified: true,
    automaticPresenceSimulation: true,
    hasPrf,
  } as const
}

async function addVirtualAuthenticator(context: BrowserContext, page: Page, hasPrf: boolean) {
  const cdp = await context.newCDPSession(page)
  await cdp.send('WebAuthn.enable')
  const { authenticatorId } = await cdp.send('WebAuthn.addVirtualAuthenticator', { options: authenticatorOptions(hasPrf) })
  return { cdp, authenticatorId }
}

async function storedCredentialCount(cdp: CDPSession, authenticatorId: string) {
  const { credentials } = await cdp.send('WebAuthn.getCredentials', { authenticatorId })
  return credentials.length
}

const yen = (value: number) => `¥${value.toLocaleString('ja-JP')}`

function tab(page: Page, name: keyof typeof labels.tabs) {
  return page.getByRole('navigation', { name: labels.mainPages }).getByRole('button', { name: labels.tabs[name], exact: true })
}

function quickUnlockCard(page: Page) {
  return page.getByRole('region', { name: labels.quickUnlockTitle })
}

async function shoot(card: ReturnType<typeof quickUnlockCard>, testInfo: TestInfo, name: string) {
  await card.screenshot({ path: testInfo.outputPath(`quick-unlock-${name}.png`), animations: 'disabled' })
}

async function createVaultWithBudgetAndSpending(page: Page) {
  await page.goto(appPath)
  await expect(page.getByRole('heading', { name: labels.vaultHeading })).toBeVisible()
  await page.getByLabel(labels.passphrase).fill(passphrase)
  await page.getByLabel(labels.confirmPassphrase).fill(passphrase)
  await page.getByRole('button', { name: labels.createVault }).click()

  await expect(page.getByRole('heading', { name: labels.setupHeading })).toBeVisible()
  await page.getByLabel(labels.householdName).fill('Synthetic Passkey Household 6c3e')
  await page.getByLabel(labels.moneyAccount).fill('Synthetic Wallet')
  await page.getByLabel(labels.expenseAccount).fill('Synthetic Dining')
  await page.getByRole('button', { name: labels.saveSetup }).click()
  await expect(tab(page, 'today')).toHaveAttribute('aria-current', 'page')

  // A budget and one spending give the household a state to recognise after each unlock.
  await page.getByRole('button', { name: labels.setLimit }).click()
  await expect(page.getByRole('heading', { name: labels.budgetHeading })).toBeVisible()
  const groceriesRow = page.getByRole('form', { name: labels.groceries, exact: true })
  await groceriesRow.getByRole('textbox').fill(String(budgetJpy))
  await groceriesRow.getByRole('button', { name: labels.saveBudget }).click()
  await expect(groceriesRow.getByRole('status')).toHaveText(labels.budgetSaved)

  await tab(page, 'today').click()
  await page.getByRole('button', { name: labels.addSpending }).click()
  const sheet = page.getByRole('dialog', { name: labels.sheetTitle })
  for (const key of String(spentJpy).split('')) {
    await sheet.getByRole('button', { name: key, exact: true }).click()
  }
  await sheet.getByRole('button', { name: labels.groceries, exact: true }).click()
  await sheet.getByRole('button', { name: labels.save, exact: true }).click()
  await expect(sheet).toBeHidden()
  await expectTodayRemaining(page)
  // The "Saved" toast clears on its own; waiting keeps it out of the card screenshots.
  await expect(page.getByRole('status').filter({ hasText: new RegExp(`^${labels.saved}`, 'u') })).toHaveCount(0)
}

async function expectTodayRemaining(page: Page) {
  const hero = page.getByRole('region', { name: labels.leftToSpend })
  await expect(hero.locator('.simple-hero-value')).toHaveText(yen(budgetJpy - spentJpy))
  await expect(hero.getByRole('definition').first()).toHaveText(yen(spentJpy))
  await expect(hero.getByText(labels.spent, { exact: true })).toBeVisible()
}

/** More -> Quick unlock card -> Turn on -> passphrase + Continue -> Confirm with fingerprint, face or PIN. */
async function turnOnQuickUnlock(page: Page, testInfo: TestInfo | null) {
  await tab(page, 'more').click()
  const card = quickUnlockCard(page)
  await expect(card).toBeVisible()
  await expect(card.getByRole('button', { name: labels.turnOn })).toBeVisible()
  await expect(card.getByRole('listitem')).toHaveCount(0)
  if (testInfo) await shoot(card, testInfo, '1-off')

  await card.getByRole('button', { name: labels.turnOn }).click()
  const field = card.getByLabel(labels.passphrase)
  await expect(field).toBeFocused()
  await field.fill(passphrase)
  if (testInfo) await shoot(card, testInfo, '2-passphrase')
  await card.getByRole('button', { name: labels.continue }).click()

  const confirm = card.getByRole('button', { name: labels.confirmWithPasskey })
  await expect(confirm).toBeVisible()
  await expect(card.getByText(labels.passphraseConfirmed)).toBeVisible()
  await expect(confirm).toBeFocused()
  if (testInfo) await shoot(card, testInfo, '3-confirm')
  await confirm.click()
  return card
}

async function reloadToUnlockScreen(page: Page) {
  await page.reload({ waitUntil: 'domcontentloaded' })
  await expect(page.getByRole('heading', { name: labels.unlockHeading })).toBeVisible()
}

test.describe('PWA passkey quick unlock at phone size', () => {
  // WebAuthn needs a domain rp.id: the app hides the passkey on IP-address hosts, so these tests use localhost.
  test.use({ viewport: { width: 360, height: 800 }, baseURL: 'http://localhost:4173' })

  test('turns on, unlocks online and offline with the passkey, and turns off again', async ({ context, page }, testInfo) => {
    const { cdp, authenticatorId } = await addVirtualAuthenticator(context, page, true)
    await createVaultWithBudgetAndSpending(page)

    const card = await turnOnQuickUnlock(page, testInfo)
    await expect(card.getByText(labels.onForDevice)).toBeVisible()
    await expect(card.getByRole('listitem')).toHaveCount(1)
    await expect(card.getByRole('button', { name: labels.turnOn })).toBeVisible()
    await expect(card.getByRole('alert')).toHaveCount(0)
    await shoot(card, testInfo, '4-on')
    expect(await storedCredentialCount(cdp, authenticatorId)).toBe(1)

    // Reloading online lets the service worker take control for the offline step later.
    await page.evaluate(async () => { await navigator.serviceWorker.ready })
    await reloadToUnlockScreen(page)
    await page.waitForFunction(() => Boolean(navigator.serviceWorker.controller))
    const passkeyButton = page.getByRole('button', { name: labels.unlockWithPasskey })
    await expect(passkeyButton).toBeVisible()
    const buttonBox = await passkeyButton.boundingBox()
    const fieldBox = await page.getByLabel(labels.passphrase).boundingBox()
    expect(buttonBox && fieldBox && buttonBox.y < fieldBox.y).toBe(true)
    await page.screenshot({ path: testInfo.outputPath('unlock-screen-with-passkey.png') })

    await passkeyButton.click()
    await expect(tab(page, 'today')).toHaveAttribute('aria-current', 'page')
    await expectTodayRemaining(page)

    // Offline: the shell comes from the service worker and the passkey still opens the same vault.
    await context.setOffline(true)
    await reloadToUnlockScreen(page)
    await page.getByRole('button', { name: labels.unlockWithPasskey }).click()
    await expectTodayRemaining(page)
    await context.setOffline(false)

    // Turn off from More, with the confirmation.
    await tab(page, 'more').click()
    const entry = quickUnlockCard(page).getByRole('listitem')
    await entry.getByRole('button', { name: labels.turnOff }).click()
    await expect(entry.getByText(labels.turnOffQuestion)).toBeVisible()
    await shoot(quickUnlockCard(page), testInfo, '5-turn-off-confirm')
    await entry.getByRole('button', { name: labels.yesTurnOff }).click()
    await expect(quickUnlockCard(page).getByRole('listitem')).toHaveCount(0)
    await expect(quickUnlockCard(page).getByText(labels.onForDevice)).toHaveCount(0)

    await reloadToUnlockScreen(page)
    await expect(page.getByLabel(labels.passphrase)).toBeVisible()
    await expect(page.getByRole('button', { name: labels.unlockWithPasskey })).toHaveCount(0)
    await page.getByLabel(labels.passphrase).fill(passphrase)
    await page.getByRole('button', { name: labels.unlockVault }).click()
    await expectTodayRemaining(page)
  })

  test('without PRF, says the passkey cannot unlock here and stores nothing', async ({ context, page }, testInfo) => {
    await addVirtualAuthenticator(context, page, false)
    await createVaultWithBudgetAndSpending(page)

    const card = await turnOnQuickUnlock(page, null)
    await expect(card.getByRole('alert')).toHaveText(labels.cannotUsePasskey)
    await expect(card.getByRole('button', { name: labels.turnOn })).toBeVisible()
    await expect(card.getByRole('listitem')).toHaveCount(0)
    await expect(card.getByText(labels.onForDevice)).toHaveCount(0)
    await shoot(card, testInfo, 'no-prf-message')

    await reloadToUnlockScreen(page)
    await expect(page.getByLabel(labels.passphrase)).toBeVisible()
    await expect(page.getByRole('button', { name: labels.unlockWithPasskey })).toHaveCount(0)
    await page.getByLabel(labels.passphrase).fill(passphrase)
    await page.getByRole('button', { name: labels.unlockVault }).click()
    await expectTodayRemaining(page)
  })
})
