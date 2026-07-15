import { describe, expect, it } from 'vitest'

import { dmgForVersion, mountIsReadOnly, runDmgInstallSmoke, validateBundleMetadata } from './dmg-install-smoke.mjs'

describe('macOS DMG install smoke harness', () => {
  it('resolves Tauri DMG architecture names without pretending to support other platforms', () => {
    expect(dmgForVersion('0.9.0', 'arm64', '/repo')).toBe('/repo/src-tauri/target/release/bundle/dmg/KakeFlow_0.9.0_aarch64.dmg')
    expect(() => dmgForVersion('0.9.0', 'x64', '/repo')).toThrow(/Unsupported macOS DMG architecture/)
    expect(() => dmgForVersion('0.9.0', 'ia32', '/repo')).toThrow(/Unsupported macOS DMG architecture/)
  })

  it('requires exact bundle identity/version/executable and a read-only mount', () => {
    expect(validateBundleMetadata({ version: '0.9.0', identifier: 'app.kakeflow.desktop', executable: 'kakeflow' }, '0.9.0')).toMatchObject({ executable: 'kakeflow' })
    expect(() => validateBundleMetadata({ version: '0.8.0', identifier: 'app.kakeflow.desktop', executable: 'kakeflow' }, '0.9.0')).toThrow(/Invalid mounted/)
    expect(mountIsReadOnly('/dev/disk4s1 on /tmp/volume (hfs, local, nodev, read-only, noowners)', '/tmp/volume')).toBe(true)
    expect(mountIsReadOnly('/dev/disk4s1 on /tmp/volume (hfs, local)', '/tmp/volume')).toBe(false)
  })

  it('rejects Windows explicitly instead of claiming installer coverage', async () => {
    await expect(runDmgInstallSmoke({ platform: 'win32', expectedVersion: '0.9.0' })).rejects.toThrow(/Windows installer coverage is not claimed/)
  })
})
