import { readFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import { expect, test, type Page } from '@playwright/test'

const passphrase = 'synthetic offline vault passphrase 2026'
const householdName = 'Synthetic Offline Household 8f2c'
const receiptPath = resolve('src/features/import/fixtures/ocr/receipt-tax-marker.synthetic.jpg')

interface OfflineNetworkAttempt {
  readonly kind: 'non-service-worker-response' | 'request-failed'
  readonly method: string
  readonly url: string
}

function monitorOfflineNetwork(page: Page) {
  const attempts: OfflineNetworkAttempt[] = []
  let active = false
  page.on('response', (response) => {
    if (active && /^https?:/u.test(response.url()) && !response.fromServiceWorker()) {
      attempts.push({ kind: 'non-service-worker-response', method: response.request().method(), url: response.url() })
    }
  })
  page.on('requestfailed', (request) => {
    if (active && /^https?:/u.test(request.url())) {
      attempts.push({ kind: 'request-failed', method: request.method(), url: request.url() })
    }
  })
  return {
    attempts,
    start: () => { active = true },
  }
}

function assertNoOfflineNetwork(attempts: readonly OfflineNetworkAttempt[]) {
  if (attempts.length > 0) {
    throw new Error(`Offline journey attempted network:\n${attempts.map(({ kind, method, url }) => `${kind} ${method} ${url}`).join('\n')}`)
  }
}

test('posts a synthetic receipt, reloads offline, and restores an encrypted archive', async ({
  context,
  page,
}) => {
  const requests: { method: string; url: string }[] = []
  const offlineNetwork = monitorOfflineNetwork(page)
  page.on('request', (request) => requests.push({ method: request.method(), url: request.url() }))

  await page.goto('/kakeflow/app/')
  await expect(page.getByRole('heading', { name: 'Own your financial record' })).toBeVisible()
  await page.getByLabel('Vault passphrase').fill(passphrase)
  await page.getByLabel('Confirm passphrase').fill(passphrase)
  await page.getByRole('button', { name: 'Create encrypted vault' }).click()

  await expect(page.getByRole('heading', { name: 'Set up your household' })).toBeVisible()
  await page.getByLabel('Household name').fill(householdName)
  await page.getByLabel('Money account').fill('Synthetic Cash')
  await page.getByLabel('Expense account').fill('Synthetic Groceries')
  await page.getByRole('button', { name: 'Save local setup' }).click()
  await expect(page.getByRole('heading', { name: 'Household overview' })).toBeVisible()

  await page.getByRole('button', { name: 'Lock vault' }).click()
  await page.evaluate(async () => { await navigator.serviceWorker.ready })
  await page.reload({ waitUntil: 'domcontentloaded' })
  await page.waitForFunction(() => Boolean(navigator.serviceWorker.controller))
  await context.setOffline(true)
  offlineNetwork.start()
  await page.reload({ waitUntil: 'domcontentloaded' })
  await expect(page.getByRole('heading', { name: 'Unlock local vault' })).toBeVisible()
  await page.getByLabel('Vault passphrase').fill(passphrase)
  await page.getByRole('button', { name: 'Unlock vault' }).click()
  await expect(page.getByRole('heading', { name: 'Household overview' })).toBeVisible()

  await page.getByRole('button', { name: 'Sources' }).click()
  const manualSource = page.getByRole('article', { name: 'Manual import' })
  await expect(manualSource).toBeVisible()
  await expect(manualSource.getByText('Pending review').locator('..')).toContainText('0 items')
  await expect(manualSource.getByRole('button')).toHaveCount(1)
  await manualSource.getByRole('button', { name: 'Open settings' }).click()
  await expect(page.getByRole('heading', { name: 'Import a receipt' })).toBeVisible()
  await page.getByLabel('Receipt image').setInputFiles(receiptPath)
  await expect(page.getByRole('heading', { name: 'Compare source and candidate' })).toBeVisible({
    timeout: 90_000,
  })
  await expect(page.getByRole('img', { name: /Original receipt receipt-tax-marker\.synthetic\.jpg/u })).toBeVisible()
  await expect(page.getByText('2022-09-06')).toBeVisible()
  await expect(page.getByText('¥254', { exact: true }).first()).toBeVisible()
  await expect(page.getByText('difference ¥0')).toBeVisible()

  await page.getByRole('button', { name: 'Sources' }).click()
  await expect(manualSource.getByText('Pending review').locator('..')).toContainText('1 item')
  await page.getByRole('button', { name: 'Review' }).click()

  const post = page.getByRole('button', { name: 'Approve and post' })
  await expect(post).toBeDisabled()
  await page.getByLabel('I compared the receipt and approve this posting').check()
  await expect(post).toBeEnabled()
  await post.click()
  await expect(page.getByText('APPROVED')).toBeVisible()
  await expect(page.getByText('POSTED')).toBeVisible()

  await page.getByRole('button', { name: 'Ledger' }).click()
  await expect(page.getByRole('heading', { name: 'Posted ledger' })).toBeVisible()
  await page.getByRole('button', { name: 'View provenance' }).click()
  await expect(page.getByRole('heading', { name: 'Transaction provenance' })).toBeVisible()
  await expect(page.getByText('receipt-tax-marker.synthetic.jpg')).toBeVisible()
  await expect(page.getByText(/SHA-256/u)).toBeVisible()

  await page.getByRole('button', { name: 'Backup' }).click()
  const downloadPromise = page.waitForEvent('download')
  await page.getByRole('button', { name: 'Download encrypted archive' }).click()
  const download = await downloadPromise
  const archivePath = await download.path()
  expect(archivePath).toBeTruthy()
  const archiveBytes = await readFile(archivePath!)
  expect(archiveBytes.byteLength).toBeGreaterThan(100)
  await page.getByLabel('Encrypted archive file').setInputFiles(archivePath!)
  await page.getByLabel('Archive passphrase').fill(passphrase)
  await page.getByRole('button', { name: 'Validate and restore' }).click()
  await expect(page.getByRole('heading', { name: 'Household overview' })).toBeVisible()
  await page.getByRole('button', { name: 'Ledger' }).click()
  await expect(page.getByText('¥254', { exact: true })).toBeVisible()

  const cacheEvidence = await page.evaluate(async ({ forbidden }) => {
    const cacheNames = await caches.keys()
    const urls: string[] = []
    const searchableBodies: string[] = []
    for (const name of cacheNames) {
      const cache = await caches.open(name)
      for (const request of await cache.keys()) {
        urls.push(request.url)
        if (/\.(?:html|css|js)$/u.test(new URL(request.url).pathname)) {
          searchableBodies.push(await (await cache.match(request))!.text())
        }
      }
    }
    const combined = searchableBodies.join('\n')
    return {
      cacheNames,
      urls,
      leakedValues: forbidden.filter((value) => combined.includes(value)),
    }
  }, { forbidden: [passphrase, householdName] })
  expect(cacheEvidence.cacheNames.length).toBeGreaterThan(0)
  expect(cacheEvidence.leakedValues).toEqual([])
  expect(cacheEvidence.urls.some((url) => /blob:|kakeflow-encrypted-vault|receipt-tax-marker/u.test(url))).toBe(false)
  assertNoOfflineNetwork(offlineNetwork.attempts)

  const networkRequests = requests.filter(({ url }) => /^https?:/u.test(url))
  expect(networkRequests.length).toBeGreaterThan(0)
  expect(networkRequests.every(({ method }) => method === 'GET')).toBe(true)
  expect(networkRequests.every(({ url }) => new URL(url).origin === 'http://127.0.0.1:4173')).toBe(true)
})

test('offline network guard rejects an unprecached fetch', async ({ context, page }) => {
  const offlineNetwork = monitorOfflineNetwork(page)
  await page.goto('/kakeflow/app/')
  await page.evaluate(async () => { await navigator.serviceWorker.ready })
  await page.reload({ waitUntil: 'domcontentloaded' })
  await page.waitForFunction(() => Boolean(navigator.serviceWorker.controller))
  await context.setOffline(true)
  offlineNetwork.start()

  await page.evaluate(async () => {
    await fetch('/kakeflow/app/unprecached-network-guard-probe.json').catch(() => undefined)
  })
  await expect.poll(() => offlineNetwork.attempts.length).toBe(1)
  expect(() => assertNoOfflineNetwork(offlineNetwork.attempts)).toThrow(/unprecached-network-guard-probe/u)
})
