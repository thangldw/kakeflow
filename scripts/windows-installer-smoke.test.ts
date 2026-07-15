import { describe, expect, it } from 'vitest'

import {
  installationLayout,
  installerForVersion,
  productVersionMatches,
  silentInstallArguments,
  silentUninstallArguments,
  validateWindowsInstallerEvidence,
} from './windows-installer-smoke-helpers.mjs'
import { runWindowsInstallerSmoke } from './windows-installer-smoke.mjs'

describe('Windows installer acceptance helpers', () => {
  it('refuses to create Windows installer evidence on another operating system', async () => {
    await expect(runWindowsInstallerSmoke({ platform: 'darwin', expectedVersion: '0.90.0' }))
      .rejects.toThrow(/supported only on Windows; no installer coverage was run/u)
  })

  it('resolves the exact Tauri NSIS artifact and isolated installation layout', () => {
    expect(installerForVersion('0.90.0', 'x64', 'C:\\repo')).toMatch(/KakeFlow_0\.90\.0_x64-setup\.exe$/u)
    expect(() => installerForVersion('../escape', 'x64', 'C:\\repo')).toThrow(/Invalid KakeFlow version/u)
    expect(() => installerForVersion('0.90.0', 'ia32', 'C:\\repo')).toThrow(/Unsupported Windows/u)

    const layout = installationLayout('C:\\Temp\\KakeFlow acceptance')
    expect(layout.executable).toMatch(/kakeflow\.exe$/u)
    expect(layout.uninstaller).toMatch(/uninstall\.exe$/u)
    expect(layout.resources.map((item) => item.replaceAll('\\', '/'))).toEqual([
      expect.stringMatching(/fonts\/OFL\.txt$/u),
      expect.stringMatching(/fonts\/SOURCE\.md$/u),
      expect.stringMatching(/ocr\/manifest\.json$/u),
      expect.stringMatching(/ocr\/tesseract\.exe$/u),
      expect.stringMatching(/ocr\/tessdata\/eng\.traineddata$/u),
      expect.stringMatching(/ocr\/tessdata\/jpn\.traineddata$/u),
      expect.stringMatching(/ocr\/tessdata\/configs\/tsv$/u),
      expect.stringMatching(/ocr\/notices\/tesseract-Apache-2\.0\.txt$/u),
      expect.stringMatching(/ocr\/notices\/THIRD_PARTY_NOTICES\.txt$/u),
    ])
    expect(silentInstallArguments(layout.root)).toEqual(['/S', `/D=${layout.root}`])
    expect(silentUninstallArguments()).toEqual(['/S'])
  })

  it('accepts Windows file-version padding but not a different release', () => {
    expect(productVersionMatches('0.90.0', '0.90.0')).toBe(true)
    expect(productVersionMatches('0.90.0.0\r\n', '0.90.0')).toBe(true)
    expect(productVersionMatches('0.90.1.0', '0.90.0')).toBe(false)
  })

  it('requires install, packaged launch, and cleanup evidence together', () => {
    const evidence = {
      status: 'ok', platform: 'win32', version: '0.90.0', installScope: 'isolated-current-user',
      installerBytes: 100, executableBytes: 200, uninstallerPresent: true,
      resources: [
        'fonts/OFL.txt', 'fonts/SOURCE.md', 'ocr/manifest.json', 'ocr/tesseract.exe',
        'ocr/tessdata/eng.traineddata', 'ocr/tessdata/jpn.traineddata',
        'ocr/tessdata/configs/tsv', 'ocr/notices/tesseract-Apache-2.0.txt',
        'ocr/notices/THIRD_PARTY_NOTICES.txt',
      ],
      ocr: { status: 'ok', target: 'windows-x64', manifestSchemaVersion: 2, tsvSmoke: true },
      packagedSmoke: { status: 'ok', schemaVersion: 51, databaseHealthy: true },
      uninstallCompleted: true, installDirectoryRemoved: true,
    }
    expect(validateWindowsInstallerEvidence(evidence, '0.90.0')).toBe(evidence)
    expect(() => validateWindowsInstallerEvidence({ ...evidence, installDirectoryRemoved: false }, '0.90.0')).toThrow(/Invalid Windows installer smoke evidence/u)
    expect(() => validateWindowsInstallerEvidence({ ...evidence, packagedSmoke: { status: 'failed' } }, '0.90.0')).toThrow(/Invalid Windows installer smoke evidence/u)
  })
})
