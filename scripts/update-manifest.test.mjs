import { describe, expect, it } from 'vitest'

import { buildUpdateManifest, targetForUpdaterArtifact } from './update-manifest.mjs'

describe('signed updater manifest', () => {
  it('maps release artifacts to Tauri target keys and encodes download URLs', () => {
    const manifest = buildUpdateManifest({
      version: '1.2.0',
      notes: 'Stable release',
      pubDate: '2026-08-04T00:00:00.000Z',
      baseUrl: 'https://example.com/releases/v1.2.0/',
      artifacts: [{ filename: 'KakeFlow 1.2.0 aarch64.app.tar.gz', signature: 'signed-content-abcdefghijklmnopqrstuvwxyz-1234567890' }],
    })
    expect(manifest.platforms['darwin-aarch64']).toEqual({
      signature: 'signed-content-abcdefghijklmnopqrstuvwxyz-1234567890',
      url: 'https://example.com/releases/v1.2.0/KakeFlow%201.2.0%20aarch64.app.tar.gz',
    })
  })

  it('recognizes supported updater archive names', () => {
    expect(targetForUpdaterArtifact('KakeFlow_1.2.0_aarch64.app.tar.gz')).toBe('darwin-aarch64')
    expect(targetForUpdaterArtifact('KakeFlow_1.2.0_x64-setup.nsis.zip')).toBe('windows-x86_64')
    expect(targetForUpdaterArtifact('KakeFlow_1.2.0_aarch64.dmg')).toBeNull()
  })

  it('rejects unsigned and duplicate target artifacts', () => {
    const base = { version: '1.2.0', notes: '', pubDate: '2026-08-04T00:00:00.000Z', baseUrl: 'https://example.com' }
    expect(() => buildUpdateManifest({ ...base, artifacts: [{ filename: 'KakeFlow_aarch64.app.tar.gz', signature: '' }] })).toThrow(/signature/u)
    expect(() => buildUpdateManifest({ ...base, artifacts: [
      { filename: 'KakeFlow_aarch64.app.tar.gz', signature: 'signed-content-abcdefghijklmnopqrstuvwxyz-1234567890' },
      { filename: 'KakeFlow_arm64.app.tar.gz', signature: 'signed-content-abcdefghijklmnopqrstuvwxyz-1234567890' },
    ] })).toThrow(/darwin-aarch64/u)
  })
})
