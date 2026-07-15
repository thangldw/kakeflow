import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import path from 'node:path'
import {
  OCR_FIXED_HASHES,
  assertOcrManifestContract,
  hostOcrTarget,
  inspectPeX64Imports,
  isAllowedStaticWindowsImport,
  ocrTargetContract,
  requiredOcrFiles,
  tesseractSmokeArguments,
} from './ocr-resource-contract.mjs'

function manifestFor(target) {
  const contract = ocrTargetContract(target)
  const files = Object.fromEntries(requiredOcrFiles(target).map((name) => [name, { bytes: 1, sha256: OCR_FIXED_HASHES[name] ?? 'a'.repeat(64) }]))
  return {
    schemaVersion: 2,
    target,
    minimumSystemVersion: contract.minimumSystemVersion,
    triplet: contract.triplet,
    vcpkgCommit: contract.vcpkgCommit,
    tesseractVersion: contract.tesseractVersion,
    linkage: { libraries: contract.libraryLinkage, crt: contract.crtLinkage },
    tessdata: { repository: 'tessdata_fast', version: contract.tessdataVersion, languages: ['eng', 'jpn'] },
    files,
  }
}

function syntheticPe(importName = 'KERNEL32.dll') {
  const bytes = Buffer.alloc(1024)
  bytes.write('MZ', 0, 'ascii')
  bytes.writeUInt32LE(0x80, 0x3c)
  bytes.write('PE\0\0', 0x80, 'binary')
  bytes.writeUInt16LE(0x8664, 0x84)
  bytes.writeUInt16LE(1, 0x86)
  bytes.writeUInt16LE(0xf0, 0x94)
  const optional = 0x98
  bytes.writeUInt16LE(0x20b, optional)
  bytes.writeUInt32LE(0x1000, optional + 120)
  bytes.writeUInt32LE(40, optional + 124)
  const section = optional + 0xf0
  bytes.writeUInt32LE(0x200, section + 8)
  bytes.writeUInt32LE(0x1000, section + 12)
  bytes.writeUInt32LE(0x200, section + 16)
  bytes.writeUInt32LE(0x200, section + 20)
  bytes.writeUInt32LE(0x1050, 0x200 + 12)
  bytes.write(`${importName}\0`, 0x250, 'ascii')
  return bytes
}

describe('packaged OCR resource contract', () => {
  it('selects only the two reproducible host targets', () => {
    expect(hostOcrTarget('darwin', 'arm64')).toBe('macos-arm64')
    expect(hostOcrTarget('win32', 'x64')).toBe('windows-x64')
    expect(() => hostOcrTarget('linux', 'x64')).toThrow('not defined')
  })

  it('requires a static x64 Windows executable layout', () => {
    const windows = ocrTargetContract('windows-x64')
    expect(windows).toMatchObject({
      executable: 'tesseract.exe',
      triplet: 'x64-windows-static-kakeflow',
      libraryLinkage: 'static',
      crtLinkage: 'static',
    })
    expect(requiredOcrFiles('windows-x64')).not.toContain('tesseract')
    expect(assertOcrManifestContract(manifestFor('windows-x64'), 'windows-x64')).toEqual(windows)
  })

  it('retains the macOS static-library and dynamic-system-CRT contract', () => {
    expect(assertOcrManifestContract(manifestFor('macos-arm64'), 'macos-arm64')).toMatchObject({
      executable: 'tesseract',
      libraryLinkage: 'static',
      crtLinkage: 'dynamic',
    })
  })

  it('rejects schema-v1 by default and accepts it only for explicit legacy macOS diagnostics', () => {
    const legacyMac = manifestFor('macos-arm64')
    legacyMac.schemaVersion = 1
    delete legacyMac.linkage
    expect(() => assertOcrManifestContract(legacyMac, 'macos-arm64')).toThrow('Unsupported OCR resource manifest')
    expect(assertOcrManifestContract(legacyMac, 'macos-arm64', { allowLegacyMacDiagnostic: true })).toMatchObject({ target: 'macos-arm64' })

    const legacyWindows = manifestFor('windows-x64')
    legacyWindows.schemaVersion = 1
    delete legacyWindows.linkage
    expect(() => assertOcrManifestContract(legacyWindows, 'windows-x64')).toThrow('Unsupported OCR resource manifest')
    expect(() => assertOcrManifestContract(legacyWindows, 'windows-x64', { allowLegacyMacDiagnostic: true })).toThrow('Unsupported OCR resource manifest')
  })

  it('rejects a target mismatch and a modified pinned model', () => {
    expect(() => assertOcrManifestContract(manifestFor('macos-arm64'), 'windows-x64')).toThrow('Unexpected OCR target')
    const changed = manifestFor('windows-x64')
    changed.files['tessdata/jpn.traineddata'].sha256 = '0'.repeat(64)
    expect(() => assertOcrManifestContract(changed, 'windows-x64')).toThrow('Pinned OCR resource is missing or changed')
  })

  it('permits only system imports for the static Windows runtime', () => {
    expect(isAllowedStaticWindowsImport('KERNEL32.dll')).toBe(true)
    expect(isAllowedStaticWindowsImport('api-ms-win-core-file-l1-2-0.dll')).toBe(true)
    expect(isAllowedStaticWindowsImport('tesseract55.dll')).toBe(false)
    expect(isAllowedStaticWindowsImport('VCRUNTIME140.dll')).toBe(false)
    expect(inspectPeX64Imports(syntheticPe())).toEqual(['kernel32.dll'])
    expect(inspectPeX64Imports(syntheticPe('tesseract55.dll'))).toEqual(['tesseract55.dll'])
    expect(() => inspectPeX64Imports(Buffer.from('not a PE'))).toThrow('Not a PE executable')
  })

  it('uses jpn and eng together for the TSV runtime smoke', () => {
    expect(tesseractSmokeArguments('windows-x64', 'receipt.pgm', 'tessdata')).toEqual({
      executable: 'tesseract.exe',
      version: ['--version'],
      listLanguages: ['--tessdata-dir', 'tessdata', '--list-langs'],
      tsv: ['receipt.pgm', 'stdout', '--tessdata-dir', 'tessdata', '-l', 'jpn+eng', 'tsv'],
    })
  })

  it('makes Windows staging explicit and verifies before NSIS packaging', () => {
    const root = path.resolve(import.meta.dirname, '..')
    const packageJson = JSON.parse(readFileSync(path.join(root, 'package.json'), 'utf8'))
    expect(packageJson.scripts['ocr:stage:windows']).toContain('stage-ocr-resources-windows.ps1')
    expect(packageJson.scripts['desktop:build:windows']).toBe('npm run ocr:verify && tauri build --bundles nsis')
    const staging = readFileSync(path.join(root, 'scripts', 'stage-ocr-resources-windows.ps1'), 'utf8')
    expect(staging).toContain("$TesseractVersion = '5.5.2'")
    expect(staging).toContain("$Triplet = 'x64-windows-static-kakeflow'")
    expect(staging).toContain("'windows-x64'")
  })
})
