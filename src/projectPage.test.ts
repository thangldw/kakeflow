import { existsSync, readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import sharp from 'sharp'
import { afterEach, describe, expect, it } from 'vitest'
import packageJson from '../package.json'

const docsPath = resolve(process.cwd(), 'docs')
const html = readFileSync(resolve(docsPath, 'index.html'), 'utf8')
const css = readFileSync(resolve(docsPath, 'kakeflow-page.css'), 'utf8')
const script = readFileSync(resolve(docsPath, 'kakeflow-page.js'), 'utf8')

function loadPage() {
  const page = new DOMParser().parseFromString(html, 'text/html')
  document.documentElement.innerHTML = page.documentElement.innerHTML
  document.documentElement.lang = page.documentElement.lang
  document.documentElement.dataset.theme = page.documentElement.dataset.theme
  window.eval(script)
}
function localAssetExists(path: string) {
  return existsSync(resolve(docsPath, path.split('?')[0]))
}

describe('KakeFlow project page', () => {
  afterEach(() => { document.documentElement.innerHTML = '<head></head><body></body>' })

  it('keeps published download, source and signing boundaries aligned with the release', () => {
    loadPage()
    const version = packageJson.version
    expect(document.querySelector(`a[href$="releases/tag/v${version}"]`)).not.toBeNull()
    expect(document.querySelector(`a[href$="releases/download/v${version}/KakeFlow_${version}_aarch64.dmg"]`)).not.toBeNull()
    expect(document.querySelector('[data-copy="boundary"]')).toHaveTextContent('Ad-hoc signed and not notarized')
    expect(document.querySelector('a[href="https://github.com/thangldw/kakeflow"]')).not.toBeNull()
  })

  it('ships actual product screenshots and keeps their synthetic-data boundary explicit', async () => {
    loadPage()
    const images = Array.from(document.querySelectorAll<HTMLImageElement>('.usecase-row img'))
    expect(images).toHaveLength(3)
    for (const image of images) {
      const path = image.getAttribute('src')!
      expect(localAssetExists(path)).toBe(true)
      expect(image.alt).toContain('synthetic Tanaka family data')
      const metadata = await sharp(resolve(docsPath, path)).metadata()
      expect(metadata.width).toBeGreaterThan(600)
      expect(metadata.height).toBeGreaterThan(300)
    }
    expect(document.querySelector('.flow figcaption')).toHaveTextContent('synthetic examples')
  })

  it('distinguishes native capabilities from the account-free browser foundation', () => {
    loadPage()
    const desktop = document.querySelector<HTMLElement>('#desktop-panel')!
    const browser = document.querySelector<HTMLElement>('#browser-panel')!
    expect(desktop.hidden).toBe(false)
    expect(browser.hidden).toBe(true)
    expect(desktop).toHaveTextContent('Multiple source imports, budgets, recurring costs, card matching, and investments')
    expect(desktop).toHaveTextContent('App UI: Japanese, English, Vietnamese')
    document.querySelector<HTMLButtonElement>('[data-environment="browser"]')!.click()
    expect(browser.hidden).toBe(false)
    expect(desktop.hidden).toBe(true)
    expect(browser).toHaveTextContent('Account-free encrypted vault')
    expect(browser).toHaveTextContent('Desktop connectors, budgets, and investments are not available here')
    expect(document.querySelector('[data-environment="browser"]')).toHaveAttribute('aria-pressed', 'true')
    document.querySelector<HTMLButtonElement>('[data-environment="desktop"]')!.click()
    expect(desktop.hidden).toBe(false)
    expect(browser.hidden).toBe(true)
    expect(document.querySelector('a[href="app/"]')).not.toBeNull()
  })

  it('retains explicit posting, privacy and source-evidence boundaries', () => {
    loadPage()
    expect(document.querySelector('.ledger')).toHaveTextContent('Review candidates before posting')
    expect(document.querySelector('[data-copy="privacycopy"]')).toHaveTextContent('Missing dates are not invented')
    expect(document.querySelector('[data-copy="privacycopy"]')).toHaveTextContent('Posting requires explicit approval')
    expect(document.querySelector('[data-copy="privacycopy"]')).toHaveTextContent('does not initiate payments')
    expect(document.querySelector('[data-copy="privacycopy"]')).toHaveTextContent('Desktop and browser backups are separate formats')
  })

  it('publishes the reviewed account-free PWA evidence artifact without autoplay', () => {
    loadPage()
    const video = document.querySelector<HTMLVideoElement>('.browser-demo video')!
    expect(video).toHaveAttribute('controls')
    expect(video).not.toHaveAttribute('autoplay')
    expect(video).toHaveAttribute('preload', 'none')
    for (const asset of ['assets/demo/kakeflow-receipt-to-provenance.mp4', 'assets/demo/kakeflow-receipt-to-provenance.mp4.sha256']) {
      expect(html).toContain(asset)
      expect(localAssetExists(asset)).toBe(true)
    }
    expect(document.querySelector('.browser-demo')).toHaveTextContent('synthetic demo')
  })

  it('inherits the official design entry and shared theme/support owners', () => {
    loadPage()
    expect(document.documentElement.dataset.theme).toBe('light')
    const styles = Array.from(document.querySelectorAll<HTMLLinkElement>('link[rel="stylesheet"]'))
    expect(styles.at(-1)?.href).toBe('https://thangldw.github.io/css/site-shell.css?v=20261011vi')
    const scripts = Array.from(document.querySelectorAll<HTMLScriptElement>('script[src]'))
    expect(scripts.filter(s => s.src.startsWith('https://')).map(s => new URL(s.src).hostname)).toEqual(['thangldw.github.io', 'thangldw.github.io'])
    expect(html).toContain('/js/site-shell.js')
    expect(html).toContain('/js/support-dialog.js')
    expect(document.body).toHaveAttribute('data-support-shared')
    expect(css).not.toMatch(/#[0-9a-f]{3,8}\b/i)
  })

  it('switches the website language and all core copy while keeping product identity', () => {
    loadPage()
    const headlines = { vi: 'Hiểu tiền của bạn đi đâu', ja: 'お金の流れを知る', zh: '看清资金流向', en: 'See where your money goes' }
    for (const [locale, headline] of Object.entries(headlines)) {
      document.querySelector<HTMLButtonElement>(`[data-locale="${locale}"]`)!.click()
      expect(document.documentElement.lang).toBe(locale)
      expect(document.querySelector('h1')).toHaveTextContent(headline)
      expect(document.querySelector(`[data-locale="${locale}"]`)).toHaveAttribute('aria-pressed', 'true')
      expect(document.querySelectorAll('[data-locale][aria-pressed="true"]')).toHaveLength(1)
      expect(document.querySelector('.site-brand')).toHaveTextContent('thang.')
    }
  })
})
