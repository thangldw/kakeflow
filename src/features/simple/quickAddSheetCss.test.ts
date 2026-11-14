import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

// jsdom does no layout, so the real check (every control inside the sheet at 320px and 360px) can only be done in a
// browser. This guard just keeps the rules that fixed it: the amount input's intrinsic width (about 500px at its
// font size) widened the sheet's implicit grid track until the keypad, the close button and the Income toggle were
// pushed off-screen.
const css = readFileSync('src/features/simple/simpleMode.css', 'utf8')

function declarations(selector: string): string {
  const escaped = selector.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  const match = css.match(new RegExp(`(?:^|\\n)${escaped}\\s*\\{([^}]*)\\}`))
  if (!match) throw new Error(`No rule for ${selector}`)
  return match[1]
}

describe('quick-add sheet width rules', () => {
  it('gives the sheet and its inner grids tracks that can shrink', () => {
    expect(declarations('.quick-add-body')).toMatch(/grid-template-columns:\s*minmax\(0,\s*1fr\)/)
    expect(declarations('.quick-add-sheet')).toMatch(/max-width:\s*100%/)
    expect(declarations('.quick-add-sheet > *')).toMatch(/min-width:\s*0/)
    expect(declarations('.quick-add-body > *')).toMatch(/min-width:\s*0/)
    expect(declarations('.quick-add-kind')).toMatch(/grid-template-columns:\s*repeat\(2,\s*minmax\(0,\s*1fr\)\)/)
    expect(declarations('.quick-add-keypad')).toMatch(/grid-template-columns:\s*repeat\(3,\s*minmax\(0,\s*1fr\)\)/)
  })

  it('gives the details, paying, field and category grids shrinkable tracks', () => {
    for (const selector of ['.quick-add-details', '.quick-add-paying, .quick-add-field', '.quick-add-categories']) {
      expect(declarations(selector)).toMatch(/grid-template-columns:\s*minmax\(0,\s*1fr\)/)
    }
    expect(declarations('.quick-add-paying, .quick-add-field')).toMatch(/min-width:\s*0/)
    expect(declarations('.quick-add-categories')).toMatch(/min-width:\s*0/)
  })

  it('keeps the "More…" category select and the paying select inside the sheet', () => {
    const categories = declarations('.quick-add-categories select')
    expect(categories).toMatch(/(?:^|[\s;])width:\s*100%/)
    expect(categories).toMatch(/max-width:\s*100%/)
    expect(categories).toMatch(/min-width:\s*0/)
    expect(declarations('.quick-add-paying select, .quick-add-field input')).toMatch(/(?:^|[\s;])width:\s*100%/)
  })

  it('lets the amount input shrink to the field', () => {
    const input = declarations('.quick-add-amount-field input')
    expect(input).toMatch(/min-width:\s*0/)
    expect(input).toMatch(/max-width:\s*100%/)
    expect(input).toMatch(/(?:^|[\s;])width:\s*100%/)
  })
})

// Save off-screen when the sheet opened was measured in Chromium (Save at y 881..973 on a 360x800 viewport) and the fix
// was re-measured there at 320x568 to 1280x800. jsdom cannot measure any of that; this only guards the structure that
// makes it work: a flex column whose head and footer never shrink, a body that is the only scroller, a dvh-aware
// max-height, and a footer with the safe-area inset on phones.
describe('quick-add sheet sticky footer rules', () => {
  const phone = css.slice(css.indexOf('@media (max-width: 720px) {\n  .quick-add-backdrop'))
  const phoneRule = (selector: string) => {
    const match = phone.match(new RegExp(`\\n\\s*${selector.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\s*\\{([^}]*)\\}`))
    if (!match) throw new Error(`No phone rule for ${selector}`)
    return match[1]
  }

  it('makes the sheet a column that does not scroll as a whole', () => {
    const sheet = declarations('.quick-add-sheet')
    expect(sheet).toMatch(/display:\s*flex/)
    expect(sheet).toMatch(/flex-direction:\s*column/)
    expect(sheet).toMatch(/overflow:\s*hidden/)
    expect(sheet).toMatch(/box-sizing:\s*border-box/)
    expect(sheet).toMatch(/max-height:\s*calc\(100vh - 48px\);\s*max-height:\s*calc\(100dvh - 48px\)/)
  })

  it('lets only the body scroll, vertically', () => {
    const body = declarations('.quick-add-body')
    expect(body).toMatch(/flex:\s*1 1 auto/)
    expect(body).toMatch(/min-height:\s*0/)
    expect(body).toMatch(/overflow-y:\s*auto/)
    expect(body).toMatch(/overflow-x:\s*hidden/)
  })

  it('keeps the head and the footer at their own height', () => {
    expect(declarations('.quick-add-head')).toMatch(/flex:\s*none/)
    expect(declarations('.quick-add-footer')).toMatch(/flex:\s*none/)
    expect(declarations('.quick-add-footer')).toMatch(/background:\s*var\(--surface\)/)
  })

  it('keeps Save 52px tall, also under the PWA button reset', () => {
    expect(declarations('.quick-add-save')).toMatch(/min-height:\s*52px/)
    const tokens = readFileSync('src/pwa/simple-tokens.css', 'utf8')
    expect(tokens).toMatch(/html body :is\(\.pwa-shell--simple, \.pwa-mode-panel, \.pwa-auth-card\) \.quick-add-save \{[^}]*min-height:\s*52px/)
    // The override must come after the reset it beats on source order.
    expect(tokens.indexOf('.quick-add-save {')).toBeGreaterThan(tokens.indexOf('min-height: 44px'))
  })

  it('sizes the phone sheet to the visible viewport and pads the footer for the home indicator', () => {
    expect(phoneRule('.quick-add-sheet')).toMatch(/max-height:\s*calc\(100vh - 12px\);\s*max-height:\s*calc\(100dvh - 12px\)/)
    expect(phoneRule('.quick-add-footer')).toMatch(/env\(safe-area-inset-bottom/)
    expect(phoneRule('.quick-add-body:last-child')).toMatch(/env\(safe-area-inset-bottom/)
  })
})

describe('Simple shell layering rules', () => {
  // Real layout was measured in Chromium; these guard the rules that keep the toast off the floating add button.
  it('stacks the toast above the floating add button wherever the button shows', () => {
    const toastRules = [...css.matchAll(/\.app-shell--simple \.global-toast \{([^}]*)\}/g)].map((match) => match[1])
    const bottoms = toastRules.filter((rule) => /bottom:/.test(rule))
    expect(bottoms).toHaveLength(2)
    for (const rule of bottoms) expect(rule).toMatch(/var\(--simple-fab-height\)\s*\+\s*8px/)
  })

  it('uses a fixed dark veil for the sheet backdrop so dark mode darkens the page too', () => {
    expect(declarations('.quick-add-backdrop')).not.toMatch(/var\(--text\)/)
    expect(declarations('.quick-add-backdrop')).toMatch(/rgba\(28,\s*35,\s*30,\s*\.38\)/)
    expect(declarations("html[data-theme='dark'] .quick-add-backdrop")).toMatch(/rgb\(0 0 0 \/ 55%\)/)
  })
})
