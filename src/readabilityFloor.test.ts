import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

function cssFiles(directory: string): string[] {
  return readdirSync(directory).flatMap((name) => {
    const path = join(directory, name)
    if (statSync(path).isDirectory()) return cssFiles(path)
    return path.endsWith('.css') ? [path] : []
  })
}

/** font-size declarations in px below 12. The shell/Home overrides in ui-polish.css raise the measured ones. */
function smallFontDeclarations(): number {
  let count = 0
  for (const file of cssFiles('src')) {
    for (const match of readFileSync(file, 'utf8').matchAll(/font-size:\s*(\d+(?:\.\d+)?)px/g)) {
      if (Number(match[1]) < 12) count += 1
    }
  }
  return count
}

// Ratchet: lower this number when small text is raised; never raise it.
const BASELINE = 367

describe('readability floor ratchet', () => {
  it('does not add sub-12px font-size declarations', () => {
    expect(smallFontDeclarations()).toBeLessThanOrEqual(BASELINE)
  })
})
