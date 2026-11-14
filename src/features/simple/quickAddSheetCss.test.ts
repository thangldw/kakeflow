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

  it('lets the amount input shrink to the field', () => {
    const input = declarations('.quick-add-amount-field input')
    expect(input).toMatch(/min-width:\s*0/)
    expect(input).toMatch(/max-width:\s*100%/)
    expect(input).toMatch(/(?:^|[\s;])width:\s*100%/)
  })
})
