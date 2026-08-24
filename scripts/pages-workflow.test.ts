import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'

const workflow = readFileSync(resolve(process.cwd(), '.github/workflows/pages.yml'), 'utf8')

describe('GitHub Pages PWA deployment contract', () => {
  it('mounts the built PWA below the existing product site', () => {
    expect(workflow).toContain('npm run build:pwa')
    expect(workflow).toContain('cp -R docs/. pages-site/')
    expect(workflow).toContain('cp -R dist/. pages-site/app/')
    expect(workflow).toContain('path: pages-site')
  })

  it('deploys only from main with the Pages OIDC boundary', () => {
    expect(workflow).toContain('branches: [main]')
    expect(workflow).toContain('pages: write')
    expect(workflow).toContain('id-token: write')
    expect(workflow).toContain('environment:')
    expect(workflow).toContain('name: github-pages')
  })
})
