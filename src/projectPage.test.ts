import { existsSync, readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import sharp from 'sharp'
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
    expect(html).toContain(`v${version} 公開中 · AIトークン不要`)
    expect(html).toContain('現在のバイナリはアドホック署名済み・未公証です')
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

    for (const locale of ['ja', 'en', 'vi']) {
      for (const screen of ['overview', 'ocr-import', 'budgets', 'investments']) {
        expect(localAssetExists(`assets/demo/${screen}-${locale}.jpg`)).toBe(true)
      }
      expect(localAssetExists(`assets/demo/kakeflow-feature-tour-${locale}.gif`)).toBe(true)
    }
    expect(script).toContain("assets/demo/${screen.file}-${state.locale}.jpg")
    expect(script).toContain("assets/demo/kakeflow-feature-tour-${locale}.gif")
    expect(localAssetExists('assets/support/mb-bank-vietqr.png')).toBe(true)
  })

  it('keeps OCR, budget, investment, privacy and support conversion paths explicit', () => {
    expect(html).toContain('PP-OCRv5で日付、合計、税、品目を端末内で読み取ります。')
    expect(html).toContain('予算閾値、貯蓄目標、定期支出の変化')
    expect(html).toContain('スナップショット、FIFO実現損益、配当、資産配分')
    expect(html).toContain('署名を検証する安全な自動更新')
    expect(html).toContain('https://github.com/sponsors/thangldw')
    expect(html).toContain('data-support-backdrop')
    expect(html.match(/role="tab"/g)).toHaveLength(3)
    expect(html.match(/role="tab"[^>]+tabindex="-1"/g)).toHaveLength(2)
  })

  it('publishes a complete synthetic household use case in every locale', async () => {
    expect(html).toContain('id="use-case"')
    expect(html).toContain('合成デモデータ')
    expect(html).toContain('氏名、金額、口座番号はすべて架空です')
    expect(html.match(/class="use-case-flow"/g)).toHaveLength(1)
    expect(html.match(/useCaseStep\dTitle/g)).toHaveLength(4)
    expect(script).toContain("useCaseTitle: 'From one receipt")
    expect(script).toContain("useCaseTitle: 'Từ một biên lai")

    for (const locale of ['ja', 'en', 'vi']) {
      const metadata = await sharp(resolve(docsPath, `assets/demo/kakeflow-feature-tour-${locale}.gif`), { animated: true }).metadata()
      expect(metadata.width).toBe(960)
      expect(metadata.pageHeight).toBe(540)
      expect(metadata.pages).toBe(4)
    }
  })

  it('includes responsive and reduced-motion behavior without external runtime dependencies', () => {
    expect(css).toContain('@media (max-width: 820px)')
    expect(css).toContain('@media (max-width: 540px)')
    expect(css).toContain('@media (prefers-reduced-motion: reduce)')
    expect(css).toContain('.support-grid { grid-template-columns: 1fr; }')
    expect(css).toContain('object-fit: contain')
    expect(css).toContain(".hero-product img[src$='.gif']")
    expect(html).not.toMatch(/<script[^>]+https?:\/\//)
    expect(html).not.toMatch(/<link[^>]+href="https?:\/\/[^"]+\.css/)
  })

  it('runs the primary menu and product-gallery interactions in a browser document', () => {
    document.documentElement.innerHTML = html
    window.eval(script)

    const menuButton = document.querySelector<HTMLButtonElement>('.menu-toggle')
    const navigation = document.querySelector('#primary-nav')
    menuButton?.click()
    expect(menuButton?.getAttribute('aria-expanded')).toBe('true')
    expect(navigation).toHaveClass('is-open')

    const vietnameseButton = document.querySelector<HTMLButtonElement>('[data-locale="vi"]')
    vietnameseButton?.click()
    expect(document.documentElement.lang).toBe('vi')
    expect(document.querySelector('h1')).toHaveTextContent('Tài chính của bạn')

    const budgetsTab = document.querySelector<HTMLButtonElement>('[data-screen="budgets"]')
    budgetsTab?.click()
    expect(budgetsTab?.getAttribute('aria-selected')).toBe('true')
    expect(document.querySelector<HTMLImageElement>('#screen-image')?.src).toContain('budgets-vi.jpg')
    expect(document.querySelector('#screen-caption')).toHaveTextContent('mục tiêu tiết kiệm')

    document.querySelector<HTMLButtonElement>('[data-locale="en"]')?.click()
    expect(document.querySelector('[data-i18n-html="useCaseTitle"]')).toHaveTextContent('From one receipt')
    expect(document.querySelector<HTMLImageElement>('#screen-image')?.src).toContain('budgets-en.jpg')
    expect(document.querySelector<HTMLImageElement>('#tour-image')?.src).toContain('kakeflow-feature-tour-en.gif')
    expect(document.querySelector<HTMLImageElement>('#tour-image')?.alt).toContain('Tanaka family')

    const supportButton = document.querySelector<HTMLButtonElement>('[data-support-open]')
    supportButton?.click()
    expect(document.querySelector('[data-support-backdrop]')).not.toHaveAttribute('hidden')
    document.querySelector<HTMLButtonElement>('[data-support-close]')?.click()
    expect(document.querySelector('[data-support-backdrop]')).toHaveAttribute('hidden')
  })
})
