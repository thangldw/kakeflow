import { expect, test, type BrowserContext, type Page } from '@playwright/test'

const passphrase = 'synthetic simple vault passphrase 2026'
const budgetJpy = 30_000
const spentJpy = 3_000

/** The Simple-mode labels a test reads, in one language (from src/pwa/locales). */
interface SimpleLabels {
  readonly setupHeading: string
  readonly householdName: string
  readonly moneyAccount: string
  readonly expenseAccount: string
  readonly saveSetup: string
  readonly mainPages: string
  readonly tabs: { readonly today: string; readonly history: string; readonly budget: string; readonly savings: string; readonly more: string }
  readonly noBudgetHero: string
  readonly setLimit: string
  readonly leftToSpend: string
  readonly spent: string
  readonly budgetHeading: string
  readonly groceries: string
  readonly saveBudget: string
  readonly budgetSaved: string
  readonly addSpending: string
  readonly sheetTitle: string
  readonly save: string
  readonly saved: string
}

const english: SimpleLabels = {
  setupHeading: 'Set up your household',
  householdName: 'Household name',
  moneyAccount: 'Money account',
  expenseAccount: 'Expense account',
  saveSetup: 'Save local setup',
  mainPages: 'Main pages',
  tabs: { today: 'Today', history: 'History', budget: 'Budget', savings: 'Savings', more: 'More' },
  noBudgetHero: 'Income minus spending (no budget set)',
  setLimit: 'Set a monthly limit',
  leftToSpend: 'Left to spend this month',
  spent: 'Spent',
  budgetHeading: 'Monthly budget by category',
  groceries: 'Groceries',
  saveBudget: 'Save budget',
  budgetSaved: 'Budget saved',
  addSpending: '+ Add spending',
  sheetTitle: 'Add spending',
  save: 'Save',
  saved: 'Saved',
}

const vietnamese: SimpleLabels = {
  setupHeading: 'Thiết lập hộ gia đình',
  householdName: 'Tên hộ gia đình',
  moneyAccount: 'Tài khoản tiền',
  expenseAccount: 'Tài khoản chi tiêu',
  saveSetup: 'Lưu thiết lập cục bộ',
  mainPages: 'Trang chính',
  tabs: { today: 'Hôm nay', history: 'Giao dịch', budget: 'Ngân sách', savings: 'Tiết kiệm', more: 'Thêm' },
  noBudgetHero: 'Thu − Chi (chưa đặt ngân sách)',
  setLimit: 'Đặt hạn mức tháng',
  leftToSpend: 'Còn được tiêu tháng này',
  spent: 'Đã chi',
  budgetHeading: 'Ngân sách tháng theo danh mục',
  groceries: 'Thực phẩm',
  saveBudget: 'Lưu ngân sách',
  budgetSaved: 'Đã lưu ngân sách',
  addSpending: '+ Ghi chi tiêu',
  sheetTitle: 'Ghi chi tiêu',
  save: 'Lưu',
  saved: 'Đã lưu',
}

const yen = (value: number) => `¥${value.toLocaleString('ja-JP')}`

function tab(page: Page, labels: SimpleLabels, name: keyof SimpleLabels['tabs']) {
  return page.getByRole('navigation', { name: labels.mainPages }).getByRole('button', { name: labels.tabs[name], exact: true })
}

/** The vault create/unlock screens are English-only; the household setup and everything after it follow the browser language. */
async function createVault(page: Page, labels: SimpleLabels) {
  await page.goto('/kakeflow/app/')
  await expect(page.getByRole('heading', { name: 'Own your financial record' })).toBeVisible()
  await page.getByLabel('Vault passphrase').fill(passphrase)
  await page.getByLabel('Confirm passphrase').fill(passphrase)
  await page.getByRole('button', { name: 'Create encrypted vault' }).click()

  await expect(page.getByRole('heading', { name: labels.setupHeading })).toBeVisible()
  await page.getByLabel(labels.householdName).fill('Synthetic Simple Household 4b1d')
  await page.getByLabel(labels.moneyAccount).fill('Synthetic Wallet')
  await page.getByLabel(labels.expenseAccount).fill('Synthetic Dining')
  await page.getByRole('button', { name: labels.saveSetup }).click()
}

async function expectTodayRemaining(page: Page, labels: SimpleLabels) {
  const hero = page.getByRole('region', { name: labels.leftToSpend })
  await expect(hero.locator('.simple-hero-value')).toHaveText(yen(budgetJpy - spentJpy))
  await expect(hero.getByRole('definition').first()).toHaveText(yen(spentJpy))
  await expect(hero.getByText(labels.spent, { exact: true })).toBeVisible()
}

async function reloadOfflineAndUnlock(context: BrowserContext, page: Page) {
  await page.evaluate(async () => { await navigator.serviceWorker.ready })
  // Reloading online first lets the service worker take control of the page.
  await page.reload({ waitUntil: 'domcontentloaded' })
  await page.waitForFunction(() => Boolean(navigator.serviceWorker.controller))
  await context.setOffline(true)
  await page.reload({ waitUntil: 'domcontentloaded' })
  await expect(page.getByRole('heading', { name: 'Unlock local vault' })).toBeVisible()
  await page.getByLabel('Vault passphrase').fill(passphrase)
  await page.getByRole('button', { name: 'Unlock vault' }).click()
}

async function simpleBudgetJourney(context: BrowserContext, page: Page, labels: SimpleLabels) {
  await createVault(page, labels)

  // A new vault opens in Simple mode on Today, with the starter chart and no budget yet.
  await expect(page.getByRole('navigation', { name: labels.mainPages })).toBeVisible()
  for (const name of ['today', 'history', 'budget', 'savings', 'more'] as const) {
    await expect(tab(page, labels, name)).toBeVisible()
  }
  await expect(tab(page, labels, 'today')).toHaveAttribute('aria-current', 'page')
  await expect(page.getByRole('heading', { name: labels.noBudgetHero })).toBeVisible()
  await expect(page.getByRole('button', { name: labels.setLimit })).toBeVisible()

  // "Set a monthly limit" opens Budget, where the starter Groceries category takes a monthly budget.
  await page.getByRole('button', { name: labels.setLimit }).click()
  await expect(page.getByRole('heading', { name: labels.budgetHeading })).toBeVisible()
  const groceriesRow = page.getByRole('form', { name: labels.groceries, exact: true })
  await groceriesRow.getByRole('textbox').fill(String(budgetJpy))
  await groceriesRow.getByRole('button', { name: labels.saveBudget }).click()
  await expect(groceriesRow.getByRole('status')).toHaveText(labels.budgetSaved)

  // Spending through the quick-add sheet: keypad amount, Groceries chip, Save.
  await tab(page, labels, 'today').click()
  await page.getByRole('button', { name: labels.addSpending }).click()
  const sheet = page.getByRole('dialog', { name: labels.sheetTitle })
  await expect(sheet).toBeVisible()
  for (const key of String(spentJpy).split('')) {
    await sheet.getByRole('button', { name: key, exact: true }).click()
  }
  await expect(sheet.getByRole('textbox').first()).toHaveValue(String(spentJpy))
  const chip = sheet.getByRole('button', { name: labels.groceries, exact: true })
  await chip.click()
  await expect(chip).toHaveAttribute('aria-pressed', 'true')
  await sheet.getByRole('button', { name: labels.save, exact: true }).click()
  await expect(sheet).toBeHidden()
  await expect(page.getByRole('status').filter({ hasText: labels.saved })).toContainText(`${yen(spentJpy)} · ${labels.groceries}`)

  await expectTodayRemaining(page, labels)

  // Budget and spending survive an offline reload and a fresh unlock.
  await reloadOfflineAndUnlock(context, page)
  await expectTodayRemaining(page, labels)
  await tab(page, labels, 'budget').click()
  await expect(page.getByRole('form', { name: labels.groceries, exact: true }).getByRole('textbox')).toHaveValue(yen(budgetJpy).slice(1))
}

test.describe('PWA Simple mode at phone size', () => {
  test.use({ viewport: { width: 360, height: 800 } })

  test('budgets, adds spending through the sheet, and keeps both across an offline reload', async ({ context, page }) => {
    await simpleBudgetJourney(context, page, english)
  })

  test.describe('in Vietnamese', () => {
    test.use({ locale: 'vi-VN' })

    test('shows the Simple screens in Vietnamese with the same numbers', async ({ context, page }) => {
      await simpleBudgetJourney(context, page, vietnamese)
      await expect(page.locator('html')).toHaveAttribute('lang', /^vi/u)
    })
  })
})
