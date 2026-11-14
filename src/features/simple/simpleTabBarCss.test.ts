import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

// jsdom does no layout, so the real check (no tab label cut at 320, 360 and 400px in every locale) is done in a
// browser. This guard keeps the rules that fixed it: labels wrap at spaces onto at most two lines instead of being
// cut with an ellipsis, and the bar height every offset is derived from matches the item height.
const css = readFileSync('src/features/simple/simpleMode.css', 'utf8')

function declarations(selector: string): string {
  const escaped = selector.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  const match = css.match(new RegExp(`(?:^|\\n)\\s*${escaped}\\s*\\{([^}]*)\\}`))
  if (!match) throw new Error(`No rule for ${selector}`)
  return match[1]
}

const px = (block: string, property: string): number => {
  const match = block.match(new RegExp(`(?:^|[;{\\s])${property}:\\s*(\\d+(?:\\.\\d+)?)px`))
  if (!match) throw new Error(`No ${property} in px`)
  return Number(match[1])
}

describe('Simple tab bar label rules', () => {
  const label = declarations('.simple-tabbar-item .simple-tab-label')
  const item = declarations('.simple-tabbar-item')

  it('wraps labels at spaces onto at most two centred lines and never cuts them with an ellipsis', () => {
    expect(label).toMatch(/white-space:\s*normal/)
    expect(label).toMatch(/text-align:\s*center/)
    expect(label).toMatch(/-webkit-line-clamp:\s*2/)
    expect(label).not.toMatch(/nowrap|text-overflow|anywhere|break-all/)
  })

  it('keeps the label at 12px or more', () => {
    expect(px(item, 'font-size')).toBeGreaterThanOrEqual(12)
    expect(css).not.toMatch(/\.simple-tab-label[^{]*\{[^}]*font-size/)
  })

  it('makes the bar height variable equal to border + padding + an item that fits two lines', () => {
    const lineHeight = px(label, 'line-height')
    const itemHeight = px(item, 'min-height')
    const [padY] = (item.match(/padding:\s*(\d+)px/) ?? []).slice(1).map(Number)
    // Icon 22px + 2px gap + two label lines + vertical padding.
    expect(itemHeight).toBeGreaterThanOrEqual(22 + 2 + 2 * lineHeight + 2 * padY)
    const tabbarHeight = px(declarations('.app-shell--simple'), '--simple-tabbar-height')
    // 1px top border + 4px top padding of the bar.
    expect(tabbarHeight).toBe(1 + 4 + itemHeight)
  })

  it('derives every bottom offset of the floating button, the toast and the page from the bar height', () => {
    const narrow = css.slice(css.lastIndexOf('@media (max-width: 720px) {'))
    expect(narrow).toMatch(/\.app-shell--simple \.main-shell > main \{ padding-bottom: calc\(var\(--simple-tabbar-height\)/)
    expect(narrow).toMatch(/\.simple-add-fab \{ bottom: calc\(var\(--simple-tabbar-height\)/)
    expect(narrow).toMatch(/\.app-shell--simple \.global-toast \{ bottom: calc\(var\(--simple-tabbar-height\) \+ 12px \+ var\(--simple-fab-height\)/)
  })
})
