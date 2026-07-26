import { existsSync, readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import packageJson from '../package.json'

const docsPath = resolve(process.cwd(), 'docs')
const html = readFileSync(resolve(docsPath, 'index.html'), 'utf8')
const css = readFileSync(resolve(docsPath, 'kakeflow-page.css'), 'utf8')
const script = readFileSync(resolve(docsPath, 'kakeflow-page.js'), 'utf8')

function localAssetExists(path: string) {
  return existsSync(resolve(docsPath, path))
}

describe('KakeFlow project page', () => {
  afterEach(() => {
    vi.unstubAllGlobals()
    vi.restoreAllMocks()
    document.documentElement.innerHTML = '<head></head><body></body>'
  })

  it('keeps the published release calls to action aligned with the package version', () => {
    const version = packageJson.version
    expect(html).toContain(`releases/tag/v${version}`)
    expect(html).toContain(`releases/download/v${version}/KakeFlow_${version}_aarch64.dmg`)
    expect(html).toContain(`AVAILABLE IN v${version}`)
    expect(html).toContain('現在の公開バイナリはアドホック署名済み・未公証の macOS ARM64 版です')
    expect(html).toContain('Windows バイナリは未公開です')
    expect(html).not.toContain('github.com/thangldw/kakeflow/blob/')
  })

  it('ships every local page asset and every product screenshot it references', () => {
    expect(localAssetExists('kakeflow-page.css')).toBe(true)
    expect(localAssetExists('kakeflow-page.js')).toBe(true)

    const localImages = [...html.matchAll(/<img[^>]+src="([^"]+)"/g)]
      .map((match) => match[1])
      .filter((source) => !source.startsWith('http'))
    expect(localImages.length).toBeGreaterThan(0)
    expect(localImages.every(localAssetExists)).toBe(true)

    for (const source of [
      'assets/infographics/data-pipeline.svg',
      'assets/infographics/card-reconciliation.svg',
      'assets/infographics/mobile-capture.svg',
    ]) {
      expect(script).toContain(source)
      expect(localAssetExists(source)).toBe(true)
    }
  })

  it('keeps the workflow, accounting boundary, and screen gallery explicit', () => {
    for (const node of [
      'bank', 'card', 'wallet', 'receipt', 'securities', 'inbox', 'extract', 'dedupe',
      'receipt-match', 'card-match', 'household', 'cashflow', 'balance', 'portfolio',
    ]) {
      expect(html).toContain(`data-node="${node}"`)
    }
    expect(html).toContain('カード利用は一度だけ支出にする。')
    expect(html).toContain('後日の銀行引落は負債の返済として扱います')
    expect(script).toContain("['card-match', 'ledger']")
    expect(script).toContain("['ledger', 'cashflow']")
    expect(html.match(/role="tab"/g)).toHaveLength(3)
    expect(html.match(/role="tab"[^>]+tabindex="-1"/g)).toHaveLength(2)
  })

  it('includes responsive and reduced-motion behavior without external runtime dependencies', () => {
    expect(css).toContain('@media (max-width: 820px)')
    expect(css).toContain('@media (max-width: 540px)')
    expect(css).toContain('@media (prefers-reduced-motion: reduce)')
    expect(css).toContain('#workflow-lines { display: none; }')
    expect(css).toContain('object-fit: contain')
    expect(css).not.toContain('object-fit: cover')
    expect(html).not.toMatch(/<script[^>]+https?:\/\//)
    expect(html).not.toMatch(/<link[^>]+href="https?:\/\/[^"]+\.css/)
  })

  it('runs the primary menu and product-gallery interactions in a browser document', () => {
    document.documentElement.innerHTML = html
    vi.stubGlobal('ResizeObserver', class {
      observe() {}
      unobserve() {}
      disconnect() {}
    })
    vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue({
      scale: vi.fn(), clearRect: vi.fn(), save: vi.fn(), restore: vi.fn(), setLineDash: vi.fn(),
      beginPath: vi.fn(), moveTo: vi.fn(), bezierCurveTo: vi.fn(), stroke: vi.fn(),
      lineTo: vi.fn(), closePath: vi.fn(), fill: vi.fn(),
    } as unknown as CanvasRenderingContext2D)

    window.eval(script)

    const explanatoryNodes = [...document.querySelectorAll<HTMLElement>('[data-node]')]
    expect(explanatoryNodes.every((node) => node.tabIndex === -1)).toBe(true)

    const menuButton = document.querySelector<HTMLButtonElement>('.menu-toggle')
    const navigation = document.querySelector('#primary-nav')
    menuButton?.click()
    expect(menuButton?.getAttribute('aria-expanded')).toBe('true')
    expect(navigation).toHaveClass('is-open')

    const transactionsTab = document.querySelector<HTMLButtonElement>('[data-screen="transactions"]')
    transactionsTab?.click()
    expect(transactionsTab?.getAttribute('aria-selected')).toBe('true')
    expect(document.querySelector<HTMLImageElement>('#screen-image')?.src).toContain('card-reconciliation.svg')
    expect(document.querySelector('#screen-caption')).toHaveTextContent('カテゴリ、ラベル、タグ')
  })
})
