import { describe, expect, it } from 'vitest'
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'

import { dmgForVersion, mountIsReadOnly, runDmgInstallSmoke, validateBundleMetadata } from './dmg-install-smoke.mjs'

describe('macOS DMG install smoke harness', () => {
  it('resolves Tauri DMG architecture names without pretending to support other platforms', () => {
    expect(dmgForVersion('0.9.0', {
      repositoryRoot: '/repo with spaces/財務',
      cargoTargetDir: '/private/tmp/KakeFlow Build/成果物',
      macosTarget: 'aarch64-apple-darwin',
      homeDirectory: '/Users/synthetic',
      temporaryDirectory: '/private/tmp',
    })).toBe('/private/tmp/KakeFlow Build/成果物/aarch64-apple-darwin/release/bundle/dmg/KakeFlow_0.9.0_aarch64.dmg')
    for (const macosTarget of ['x86_64-apple-darwin', 'universal-apple-darwin']) {
      expect(() => dmgForVersion('0.9.0', { macosTarget })).toThrow(/only aarch64-apple-darwin/)
    }
    expect(() => dmgForVersion('0.9.0', { macosTarget: 'i686-apple-darwin' })).toThrow(/Unsupported macOS target/)
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

  it('rejects a DMG without a successful build identity before mounting it', async () => {
    const temporaryRoot = await mkdtemp(path.join(os.tmpdir(), 'kakeflow-dmg-identity-test-'))
    const dmg = path.join(temporaryRoot, 'release', 'bundle', 'dmg', 'KakeFlow_1.2.1_aarch64.dmg')
    try {
      await mkdir(path.dirname(dmg), { recursive: true })
      await writeFile(dmg, 'stale dmg without a build identity')
      await expect(runDmgInstallSmoke({ platform: 'darwin', expectedVersion: '1.2.1', dmg })).rejects.toThrow(/Successful native build identity is required/)
    } finally {
      await rm(temporaryRoot, { recursive: true, force: true })
    }
  })
})
