import { execFile, spawn } from 'node:child_process'
import { createHash } from 'node:crypto'
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, resolve } from 'node:path'
import { promisify } from 'node:util'

import { chromium } from '@playwright/test'

const execFileAsync = promisify(execFile)
const root = resolve(import.meta.dirname, '..')
const baseUrl = 'http://127.0.0.1:4173/kakeflow/app/'
const output = resolve(
  root,
  process.env.KAKEFLOW_DEMO_OUTPUT
    ?? 'docs/assets/demo/kakeflow-receipt-to-provenance.mp4',
)
const checksumOutput = `${output}.sha256`
const receiptPath = resolve(root, 'src/features/import/fixtures/ocr/receipt-tax-marker.synthetic.jpg')
const passphrase = 'synthetic public demo vault passphrase 2026'
const holdScale = Number(process.env.KAKEFLOW_DEMO_HOLD_SCALE ?? '1')
if (!Number.isFinite(holdScale) || holdScale <= 0) throw new Error('Invalid demo hold scale')

await exec('npm', ['run', 'build:pwa'])
const server = spawn(
  'npm',
  ['exec', 'vite', '--', 'preview', '--host', '127.0.0.1', '--port', '4173', '--base', '/kakeflow/app/'],
  { cwd: root, env: process.env, stdio: ['ignore', 'inherit', 'inherit'] },
)
const temporaryDirectory = await mkdtemp(resolve(tmpdir(), 'kakeflow-demo-'))

try {
  await waitForServer(baseUrl)
  const launchOptions = process.env.PLAYWRIGHT_CHANNEL
    ? { channel: process.env.PLAYWRIGHT_CHANNEL }
    : process.platform === 'darwin' ? { channel: 'chrome' } : {}
  const browser = await chromium.launch(launchOptions)
  const context = await browser.newContext({
    viewport: { width: 1440, height: 900 },
    recordVideo: { dir: temporaryDirectory, size: { width: 1440, height: 900 } },
    serviceWorkers: 'allow',
  })
  await context.addInitScript(() => {
    let sequence = Number(sessionStorage.getItem('kakeflow.demo.uuid.sequence') ?? '0')
    Object.defineProperty(crypto, 'randomUUID', {
      configurable: true,
      value: () => {
        sequence += 1
        sessionStorage.setItem('kakeflow.demo.uuid.sequence', String(sequence))
        return `00000000-0000-4000-8000-${String(sequence).padStart(12, '0')}`
      },
    })
  })
  const page = await context.newPage()
  const video = page.video()

  await page.goto(baseUrl)
  await page.getByRole('heading', { name: 'Own your financial record' }).waitFor()
  await hold(5_000)
  await page.getByLabel('Vault passphrase').fill(passphrase)
  await page.getByLabel('Confirm passphrase').fill(passphrase)
  await page.getByRole('button', { name: 'Create encrypted vault' }).click()
  await page.getByRole('heading', { name: 'Set up your household' }).waitFor()
  await page.getByLabel('Household name').fill('Synthetic Demo Household')
  await page.getByLabel('Money account').fill('Demo cash')
  await page.getByLabel('Expense account').fill('Demo groceries')
  await page.getByRole('button', { name: 'Save local setup' }).click()
  await page.getByRole('heading', { name: 'Household overview' }).waitFor()
  await hold(6_000)

  await page.getByRole('button', { name: 'Import', exact: true }).click()
  await page.getByLabel('Receipt image').setInputFiles(receiptPath)
  await page.getByRole('heading', { name: 'Compare source and candidate' }).waitFor({
    timeout: 90_000,
  })
  await hold(14_000)
  await page.getByLabel('I compared the receipt and approve this posting').check()
  await hold(4_000)
  await page.getByRole('button', { name: 'Approve and post' }).click()
  await page.getByText('POSTED').waitFor()
  await hold(8_000)

  await page.getByRole('button', { name: 'Ledger' }).click()
  await page.getByRole('heading', { name: 'Posted ledger' }).waitFor()
  await hold(6_000)
  await page.getByRole('button', { name: 'View provenance' }).click()
  await page.getByRole('heading', { name: 'Transaction provenance' }).waitFor()
  await hold(10_000)

  await page.getByRole('button', { name: 'Lock vault' }).click()
  await page.evaluate(async () => { await navigator.serviceWorker.ready })
  await page.reload({ waitUntil: 'domcontentloaded' })
  await page.waitForFunction(() => Boolean(navigator.serviceWorker.controller))
  await context.setOffline(true)
  await page.reload({ waitUntil: 'domcontentloaded' })
  await page.getByRole('heading', { name: 'Unlock local vault' }).waitFor()
  await hold(5_000)
  await page.getByLabel('Vault passphrase').fill(passphrase)
  await page.getByRole('button', { name: 'Unlock vault' }).click()
  await page.getByRole('heading', { name: 'Household overview' }).waitFor()
  await hold(6_000)

  await page.getByRole('button', { name: 'Backup' }).click()
  await page.getByRole('heading', { name: 'Backup and recovery' }).waitFor()
  await hold(5_000)
  const downloadPromise = page.waitForEvent('download')
  await page.getByRole('button', { name: 'Download encrypted archive' }).click()
  const download = await downloadPromise
  const archivePath = resolve(temporaryDirectory, 'kakeflow-encrypted-vault.kakeflow.zip')
  await download.saveAs(archivePath)
  await page.getByText('Encrypted archive downloaded').waitFor()
  await hold(4_000)
  await page.getByLabel('Encrypted archive file').setInputFiles(archivePath)
  await page.getByLabel('Archive passphrase').fill(passphrase)
  await page.getByRole('button', { name: 'Validate and restore' }).click()
  await page.getByRole('heading', { name: 'Household overview' }).waitFor()
  await page.getByRole('button', { name: 'Ledger' }).click()
  await page.getByRole('heading', { name: 'Posted ledger' }).waitFor()
  await hold(8_000)

  await context.close()
  await browser.close()
  const recordedVideo = await video.path()
  await mkdir(dirname(output), { recursive: true })
  await exec('ffmpeg', [
    '-y', '-i', recordedVideo,
    '-c:v', 'libx264', '-preset', 'medium', '-crf', '23',
    '-pix_fmt', 'yuv420p', '-movflags', '+faststart', '-an',
    '-metadata', 'title=KakeFlow synthetic receipt to provenance demo',
    '-metadata', 'comment=Synthetic data only; account-free local PWA flow',
    output,
  ])
  const duration = Number((await exec('ffprobe', [
    '-v', 'error', '-show_entries', 'format=duration',
    '-of', 'default=noprint_wrappers=1:nokey=1', output,
  ])).stdout.trim())
  if (holdScale === 1 && (duration < 85 || duration > 95)) {
    throw new Error(`Demo duration ${duration.toFixed(3)}s is outside 85-95s`)
  }
  const checksum = createHash('sha256').update(await readFile(output)).digest('hex')
  await writeFile(checksumOutput, `${checksum}  ${output.split('/').at(-1)}\n`)
  process.stdout.write(JSON.stringify({ output, checksumOutput, duration, checksum }, null, 2) + '\n')
} finally {
  server.kill('SIGTERM')
  await rm(temporaryDirectory, { recursive: true, force: true })
}

async function hold(milliseconds) {
  await new Promise((resolveHold) => setTimeout(resolveHold, milliseconds * holdScale))
}

async function waitForServer(url) {
  const deadline = Date.now() + 30_000
  while (Date.now() < deadline) {
    try {
      const response = await fetch(url)
      if (response.ok) return
    } catch {
      // Preview may not have bound the port yet.
    }
    await new Promise((resolveWait) => setTimeout(resolveWait, 250))
  }
  throw new Error('Timed out waiting for PWA preview server')
}

async function exec(command, args) {
  return execFileAsync(command, args, {
    cwd: root,
    env: process.env,
    maxBuffer: 20 * 1024 * 1024,
    timeout: 240_000,
  })
}
