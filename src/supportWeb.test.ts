import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { runInNewContext } from 'node:vm'
import { describe, expect, it } from 'vitest'

const script = readFileSync(resolve('public/support-web.js'), 'utf8')
function render(origin: string, pathname: string) {
  const links: Record<string, unknown>[] = []
  const document = { createElement: () => ({ style: { cssText: '' } }), body: { appendChild: (link: Record<string, unknown>) => links.push(link) } }
  runInNewContext(script, { location: { origin, pathname }, document })
  return links
}
describe('optional web support', () => {
  it('opens the existing payment choices from the published PWA', () => {
    const links = render('https://thangldw.github.io', '/kakeflow/app/')
    expect(links).toHaveLength(1)
    expect(links[0]).toMatchObject({ href: 'https://thangldw.github.io/kakeflow/#support', target: '_blank', rel: 'noopener noreferrer', textContent: 'Support my work' })
  })
  it('keeps desktop and local offline runtimes independent of the website', () => {
    for (const [origin, pathname] of [['tauri://localhost', '/'], ['http://localhost:5173', '/'], ['https://thangldw.github.io', '/kakeflow/']]) expect(render(origin, pathname)).toHaveLength(0)
  })
})
