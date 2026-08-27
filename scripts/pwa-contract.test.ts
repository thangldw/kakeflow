import { execFile } from 'node:child_process'
import { readFile, readdir, stat } from 'node:fs/promises'
import { resolve } from 'node:path'
import { promisify } from 'node:util'
import { beforeAll, describe, expect, it } from 'vitest'

const execFileAsync = promisify(execFile)
const root = resolve(import.meta.dirname, '..')
const dist = resolve(root, 'dist')
const nativeChunkPattern = /(?:^|\/)(?:vendor-)?tauri(?:-|\/)|@tauri-apps/iu
const nativeRuntimePattern = /(?:__TAURI_INTERNALS__|__TAURI_IPC__|@tauri-apps\/)/u
const nativeCommandPattern = /(?:connector_(?:control|binding|bindings|refresh)_|google_drive_|gmail_|watched_(?:folder|folders|file_inbox)_|relay_)/u
const providerAuthPattern = /(?:DRIVE_READONLY|GMAIL_READONLY|SYSTEM_BROWSER_LOOPBACK|Authenticating Gmail in system browser|Authorizing Google Drive in system browser|complete authentication using your system browser|https:\/\/www\.googleapis\.com\/auth\/(?:drive|gmail))/iu
const nativePathKeyPattern = /(?:folderPath|relativePath|watchedFolderId|absolutePath.{0,160}(?:relativePath|watchedFolderId)|(?:relativePath|watchedFolderId).{0,160}absolutePath)/u
const keychainPattern = /Keychain/u

interface JavascriptArtifact {
  readonly file: string
  readonly source: string
}

function forbiddenJavascriptFindings({ file, source }: JavascriptArtifact): string[] {
  return [
    nativeChunkPattern.test(file) ? 'tauri-chunk' : null,
    nativeRuntimePattern.test(source) ? 'tauri-runtime' : null,
    nativeCommandPattern.test(source) ? 'native-command' : null,
    providerAuthPattern.test(source) ? 'provider-auth' : null,
    keychainPattern.test(source) ? 'keychain' : null,
    nativePathKeyPattern.test(source) ? 'native-path-dto' : null,
  ].filter((finding): finding is string => finding !== null)
}

async function filesBelow(directory: string): Promise<string[]> {
  const entries = await readdir(directory)
  const nested = await Promise.all(entries.map(async (entry) => {
    const target = resolve(directory, entry)
    return (await stat(target)).isDirectory()
      ? (await filesBelow(target)).map((child) => `${entry}/${child}`)
      : [entry]
  }))
  return nested.flat().sort()
}

describe('production PWA contract', () => {
  beforeAll(async () => {
    await execFileAsync('npm', ['run', 'build:pwa'], {
      cwd: root,
      env: { ...process.env, NODE_ENV: 'production', PATH: process.env.PATH },
      timeout: 120_000,
      maxBuffer: 10 * 1024 * 1024,
    })
  }, 125_000)

  it('pins the install scope, start URL, display mode, and required icons', async () => {
    const manifest = JSON.parse(await readFile(resolve(dist, 'manifest.webmanifest'), 'utf8')) as {
      scope: string
      start_url: string
      display: string
      icons: Array<{ src: string; sizes: string; purpose?: string }>
    }

    expect(manifest).toMatchObject({
      scope: '/kakeflow/app/',
      start_url: '/kakeflow/app/',
      display: 'standalone',
    })
    expect(manifest.icons).toEqual(expect.arrayContaining([
      expect.objectContaining({ src: 'pwa/icon-192.png', sizes: '192x192' }),
      expect.objectContaining({ src: 'pwa/icon-512.png', sizes: '512x512' }),
      expect.objectContaining({ src: 'pwa/icon-maskable-512.png', purpose: 'maskable' }),
    ]))
  })

  it('builds a scoped app shell and explicit service worker without cacheable data paths', async () => {
    const [index, serviceWorker, files] = await Promise.all([
      readFile(resolve(dist, 'index.html'), 'utf8'),
      readFile(resolve(dist, 'sw.js'), 'utf8'),
      filesBelow(dist),
    ])

    expect(index).toContain('content="default-src \'self\'')
    expect(index).toContain("script-src 'self' 'wasm-unsafe-eval' 'unsafe-eval'")
    expect(index).not.toContain("script-src 'self' 'unsafe-inline'")
    expect(index).toContain('href="/kakeflow/app/manifest.webmanifest"')
    expect(index).toMatch(/(?:src|href)="\/kakeflow\/app\//u)
    expect(files).toEqual(expect.arrayContaining([
      'manifest.webmanifest',
      'pwa/icon-192.png',
      'pwa/icon-512.png',
      'pwa/icon-maskable-512.png',
      'sw.js',
    ]))
    expect(serviceWorker).toContain('/kakeflow/app/')
    expect(serviceWorker).toContain('SKIP_WAITING')
    expect(serviceWorker).not.toMatch(/(?:BackgroundSyncPlugin|NetworkFirst|StaleWhileRevalidate)/u)
    expect(serviceWorker).not.toMatch(/(?:\/api\/|evidence|archive|backup|indexeddb)/iu)

    const rootAsset = files.find((file) => /^assets\/PwaRoot-.*\.js$/u.test(file))
    expect(rootAsset).toBeDefined()
    expect(await readFile(resolve(dist, rootAsset!), 'utf8')).toContain('serviceWorker.register')
  })

  it('precaches the local OCR runtime but never imports a desktop or account connector', async () => {
    const [serviceWorker, files] = await Promise.all([
      readFile(resolve(dist, 'sw.js'), 'utf8'),
      filesBelow(dist),
    ])
    const javascriptArtifacts = await Promise.all(files
      .filter((file) => file.endsWith('.js'))
      .map(async (file) => ({ file, source: await readFile(resolve(dist, file), 'utf8') })))
    expect(serviceWorker).toMatch(/PP-OCRv5_mobile_det\.tar/u)
    expect(serviceWorker).toMatch(/PP-OCRv5_mobile_rec\.tar/u)
    expect(serviceWorker).toMatch(/ort-wasm-simd-threaded\.jsep/u)
    expect(serviceWorker).not.toMatch(/ort-wasm-simd-threaded\.(?:asyncify|jspi)/u)
    expect(serviceWorker).not.toMatch(/assets\/ort-wasm-simd-threaded\.jsep-[^"\s]+\.wasm/u)
    expect(serviceWorker).not.toMatch(/(?:google-drive|gmail|moneyforward|relay-service|watched-folder)/iu)
    expect(javascriptArtifacts.length).toBeGreaterThan(0)
    expect(javascriptArtifacts.flatMap((artifact) => (
      forbiddenJavascriptFindings(artifact).map((finding) => `${artifact.file}: ${finding}`)
    ))).toEqual([])
  })

  it.each([
    ['Tauri vendor chunk', { file: 'assets/vendor-tauri-deadbeef.js', source: '' }, 'tauri-chunk'],
    ['Tauri runtime in a generic entry chunk', { file: 'assets/index-a1.js', source: 'globalThis.__TAURI_INTERNALS__' }, 'tauri-runtime'],
    ['minified connector command in a generic chunk', { file: 'assets/index-a2.js', source: 'const c="connector_refresh_one"' }, 'native-command'],
    ['provider system-browser authorization copy', { file: 'assets/index-a3.js', source: 'Authorizing Google Drive in system browser...' }, 'provider-auth'],
    ['provider OAuth scope', { file: 'assets/index-a4.js', source: 'https://www.googleapis.com/auth/gmail.readonly' }, 'provider-auth'],
    ['Keychain runtime copy', { file: 'assets/index-a5.js', source: 'Open macOS Keychain' }, 'keychain'],
    ['minified native path DTO', { file: 'assets/index-a6.js', source: 'const x={absolutePath:e,relativePath:t}' }, 'native-path-dto'],
  ] as const)('recognizes forbidden %s mutations', (_name, artifact, finding) => {
    expect(forbiddenJavascriptFindings(artifact)).toContain(finding)
  })
})
