import { existsSync, readFileSync, readdirSync } from 'node:fs'
import { dirname, join, relative, resolve } from 'node:path'
import { describe, expect, it } from 'vitest'

const root = process.cwd()
const ignoredDirectories = new Set(['.git', 'dist', 'node_modules', 'public', 'target'])

function markdownFiles(directory = root): string[] {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const path = join(directory, entry.name)
    if (entry.isDirectory()) return ignoredDirectories.has(entry.name) ? [] : markdownFiles(path)
    return entry.isFile() && entry.name.endsWith('.md') ? [path] : []
  })
}

describe('repository hygiene', () => {
  it('keeps only the canonical documentation and current style layers', () => {
    const obsoletePaths = [
      'GEMINI_PORT.md',
      'design-implementation-top.png',
      'design-implementation.png',
      'design-reference-gemini-top.png',
      'design-reference-gemini.png',
      'docs/assets/demo/kakeflow-feature-tour.gif',
      'docs/assets/social',
      'docs/social',
      'src/gemini-theme.css',
      'src/kakeflow-v2.css',
    ]
    expect(obsoletePaths.filter((path) => existsSync(resolve(root, path)))).toEqual([])

    const entrypoint = readFileSync(resolve(root, 'src/main.tsx'), 'utf8')
    expect(entrypoint).toContain("import './theme.css'")
    expect(entrypoint).toContain("import './ui-polish.css'")
  })

  it('keeps local Markdown links valid and removes retired repository references', () => {
    const brokenLinks: string[] = []
    for (const file of markdownFiles()) {
      const markdown = readFileSync(file, 'utf8')
      expect(markdown).not.toContain('thangldw/kakeflow-releases')
      for (const match of markdown.matchAll(/\[[^\]]+\]\((?!https?:|mailto:|#)([^)#?]+)(?:[?#][^)]*)?\)/g)) {
        const target = resolve(dirname(file), decodeURIComponent(match[1]))
        if (!existsSync(target)) brokenLinks.push(`${relative(root, file)} -> ${match[1]}`)
      }
    }
    expect(brokenLinks).toEqual([])
  })

  it('keeps maintained Mermaid sources for product flow and trust boundaries', () => {
    const readme = readFileSync(resolve(root, 'README.md'), 'utf8')
    const architecture = readFileSync(resolve(root, 'docs/ARCHITECTURE.md'), 'utf8')
    expect(readme.match(/```mermaid/g)).toHaveLength(1)
    expect(architecture.match(/```mermaid/g)).toHaveLength(2)
    expect(architecture).toContain('SQLCipher double-entry ledger')
    expect(architecture).toContain('explicit approval')
  })
})
