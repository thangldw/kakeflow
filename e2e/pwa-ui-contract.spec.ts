import AxeBuilder from '@axe-core/playwright'
import { expect, test, type Page } from '@playwright/test'

/**
 * UI contract for the shipped PWA phone/tablet/desktop UI: every Simple-mode tab, in light and dark, at three widths, must
 * not scroll sideways and must have no serious or critical WCAG A/AA violation that axe can detect.
 * (Measured items from docs/roadmaps/UI_UX_REVIEW_2026-11.md: overflow, contrast, names.)
 */
const passphrase = 'synthetic ui contract vault passphrase 2026'
const viewports = [
  { name: 'phone', width: 375, height: 812 },
  { name: 'tablet', width: 768, height: 1024 },
  { name: 'desktop', width: 1440, height: 900 },
] as const
const schemes = ['light', 'dark'] as const
const tabs = ['Today', 'History', 'Budget', 'Savings', 'More'] as const

async function createVault(page: Page) {
  await page.goto('/kakeflow/app/')
  await expect(page.getByRole('heading', { name: 'Own your financial record' })).toBeVisible()
  await page.getByLabel('Vault passphrase').fill(passphrase)
  await page.getByLabel('Confirm passphrase').fill(passphrase)
  await page.getByRole('button', { name: 'Create encrypted vault' }).click()
  await expect(page.getByRole('heading', { name: 'Set up your household' })).toBeVisible()
  await page.getByLabel('Household name').fill('Synthetic UI Household')
  await page.getByLabel('Money account').fill('Synthetic Wallet')
  await page.getByLabel('Expense account').fill('Synthetic Dining')
  await page.getByRole('button', { name: 'Save local setup' }).click()
  await expect(page.getByRole('navigation', { name: 'Main pages' })).toBeVisible()
}

async function expectNoSidewaysScroll(page: Page, where: string) {
  const overflow = await page.evaluate(() => {
    const root = document.scrollingElement ?? document.documentElement
    return root.scrollWidth - window.innerWidth
  })
  expect(overflow, `${where}: page scrolls sideways by ${overflow}px`).toBeLessThanOrEqual(1)
}

async function expectNoSeriousViolations(page: Page, where: string) {
  const results = await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa']).analyze()
  const serious = results.violations.filter((violation) => violation.impact === 'serious' || violation.impact === 'critical')
  expect(
    serious.map((violation) => `${violation.id} (${violation.impact}): ${violation.nodes.length} node(s), e.g. ${violation.nodes[0]?.target.join(' ')}`),
    `${where}: axe found serious or critical violations`,
  ).toEqual([])
}

test('every Simple tab keeps to the layout and accessibility contract', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 })
  await createVault(page)
  for (const scheme of schemes) {
    await page.emulateMedia({ colorScheme: scheme })
    for (const viewport of viewports) {
      await page.setViewportSize({ width: viewport.width, height: viewport.height })
      for (const tab of tabs) {
        await page.getByRole('navigation', { name: 'Main pages' }).getByRole('button', { name: tab, exact: true }).click()
        await page.waitForTimeout(150)
        const where = `${tab} · ${viewport.name} · ${scheme}`
        await expectNoSidewaysScroll(page, where)
        await expectNoSeriousViolations(page, where)
      }
    }
  }
})
