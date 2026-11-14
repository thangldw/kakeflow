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
    expect(declarations('.quick-add-sheet')).toMatch(/grid-template-columns:\s*minmax\(0,\s*1fr\)/)
    expect(declarations('.quick-add-sheet')).toMatch(/max-width:\s*100%/)
    expect(declarations('.quick-add-sheet > *')).toMatch(/min-width:\s*0/)
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
