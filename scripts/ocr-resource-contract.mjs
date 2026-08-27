export const OCR_VCPKG_COMMIT = 'b5229343b4b80264ed51e89c6a7dcd0cbe85e9cc'
export const OCR_TESSERACT_VERSION = '5.5.2'
export const OCR_TESSDATA_VERSION = '4.1.0'

export const OCR_FIXED_HASHES = Object.freeze({
  'tessdata/eng.traineddata': '7d4322bd2a7749724879683fc3912cb542f19906c83bcc1a52132556427170b2',
  'tessdata/jpn.traineddata': '1f5de9236d2e85f5fdf4b3c500f2d4926f8d9449f28f5394472d9e8d83b91b4d',
  'tessdata/configs/tsv': '59d079bb75d8b3d7c839a3564580cb559e362c93a9d70f234e421c0c3e767e04',
})

const personalBuildRootMarkers = ['/Users/', 'C:\\Users\\']

export function personalBuildPathFindings(bytes) {
  const executableBytes = Buffer.isBuffer(bytes) ? bytes : Buffer.from(bytes)
  return personalBuildRootMarkers.filter((marker) => executableBytes.includes(Buffer.from(marker)))
}

const TARGETS = Object.freeze({
  'macos-arm64': Object.freeze({
    target: 'macos-arm64',
    minimumSystemVersion: '12.0',
    triplet: 'arm64-osx-kakeflow',
    executable: 'tesseract',
    libraryLinkage: 'static',
    crtLinkage: 'dynamic',
  }),
  'windows-x64': Object.freeze({
    target: 'windows-x64',
    minimumSystemVersion: '10.0',
    triplet: 'x64-windows-static-kakeflow',
    executable: 'tesseract.exe',
    libraryLinkage: 'static',
    crtLinkage: 'static',
  }),
})

export function hostOcrTarget(platform = process.platform, architecture = process.arch) {
  if (platform === 'darwin' && architecture === 'arm64') return 'macos-arm64'
  if (platform === 'win32' && architecture === 'x64') return 'windows-x64'
  throw new Error(`Packaged OCR is not defined for ${platform}/${architecture}`)
}

export function ocrTargetContract(target) {
  const platform = TARGETS[target]
  if (!platform) throw new Error(`Unsupported packaged OCR target: ${target}`)
  return {
    ...platform,
    vcpkgCommit: OCR_VCPKG_COMMIT,
    tesseractVersion: OCR_TESSERACT_VERSION,
    tessdataVersion: OCR_TESSDATA_VERSION,
    fixedHashes: OCR_FIXED_HASHES,
  }
}

export function requiredOcrFiles(target) {
  const contract = ocrTargetContract(target)
  return [
    contract.executable,
    'tessdata/eng.traineddata',
    'tessdata/jpn.traineddata',
    'tessdata/configs/tsv',
    'notices/tesseract-Apache-2.0.txt',
    'notices/THIRD_PARTY_NOTICES.txt',
  ]
}

export function assertOcrManifestContract(manifest, target, { allowLegacyMacDiagnostic = false } = {}) {
  const expected = ocrTargetContract(target)
  const legacyMacManifest = allowLegacyMacDiagnostic && manifest?.schemaVersion === 1 && target === 'macos-arm64'
  if (manifest?.schemaVersion !== 2 && !legacyMacManifest) throw new Error('Unsupported OCR resource manifest')
  for (const key of ['target', 'minimumSystemVersion', 'triplet', 'vcpkgCommit', 'tesseractVersion']) {
    if (manifest[key] !== expected[key]) throw new Error(`Unexpected OCR ${key}: ${manifest[key]}`)
  }
  if (!legacyMacManifest && (manifest.linkage?.libraries !== expected.libraryLinkage || manifest.linkage?.crt !== expected.crtLinkage)) {
    throw new Error(`Unexpected OCR linkage for ${target}`)
  }
  if (manifest.tessdata?.repository !== 'tessdata_fast' || manifest.tessdata?.version !== expected.tessdataVersion) {
    throw new Error('Unexpected tessdata source')
  }
  if (JSON.stringify(manifest.tessdata.languages) !== JSON.stringify(['eng', 'jpn'])) {
    throw new Error('Packaged OCR requires exactly eng and jpn models')
  }
  for (const relative of requiredOcrFiles(target)) {
    if (!manifest.files?.[relative]) throw new Error(`Required OCR resource is missing from manifest: ${relative}`)
  }
  for (const [relative, hash] of Object.entries(expected.fixedHashes)) {
    if (manifest.files?.[relative]?.sha256 !== hash) throw new Error(`Pinned OCR resource is missing or changed: ${relative}`)
  }
  return expected
}

const WINDOWS_SYSTEM_DLLS = new Set([
  'advapi32.dll', 'bcrypt.dll', 'comdlg32.dll', 'crypt32.dll', 'gdi32.dll',
  'iphlpapi.dll', 'kernel32.dll', 'ntdll.dll', 'ole32.dll', 'oleaut32.dll',
  'rpcrt4.dll', 'shell32.dll', 'shlwapi.dll', 'user32.dll', 'userenv.dll',
  'version.dll', 'winmm.dll', 'winspool.drv', 'ws2_32.dll',
])

export function isAllowedStaticWindowsImport(name) {
  const normalized = String(name).toLowerCase()
  return WINDOWS_SYSTEM_DLLS.has(normalized) || normalized.startsWith('api-ms-win-') || normalized.startsWith('ext-ms-win-')
}

export function inspectPeX64Imports(bytes) {
  if (!Buffer.isBuffer(bytes) || bytes.length < 64 || bytes.subarray(0, 2).toString('ascii') !== 'MZ') throw new Error('Not a PE executable')
  const pe = bytes.readUInt32LE(0x3c)
  if (pe + 24 > bytes.length || bytes.subarray(pe, pe + 4).toString('binary') !== 'PE\0\0') throw new Error('Invalid PE header')
  if (bytes.readUInt16LE(pe + 4) !== 0x8664) throw new Error('PE executable is not x64')
  const sectionCount = bytes.readUInt16LE(pe + 6)
  const optionalSize = bytes.readUInt16LE(pe + 20)
  const optional = pe + 24
  if (optional + optionalSize > bytes.length || bytes.readUInt16LE(optional) !== 0x20b || optionalSize < 128) throw new Error('Invalid PE32+ optional header')
  const importRva = bytes.readUInt32LE(optional + 120)
  const importSize = bytes.readUInt32LE(optional + 124)
  const sectionTable = optional + optionalSize
  const sections = []
  for (let index = 0; index < sectionCount; index += 1) {
    const offset = sectionTable + index * 40
    if (offset + 40 > bytes.length) throw new Error('Truncated PE section table')
    sections.push({
      virtualSize: bytes.readUInt32LE(offset + 8),
      virtualAddress: bytes.readUInt32LE(offset + 12),
      rawSize: bytes.readUInt32LE(offset + 16),
      rawOffset: bytes.readUInt32LE(offset + 20),
    })
  }
  const rvaOffset = (rva) => {
    const section = sections.find((candidate) => rva >= candidate.virtualAddress && rva < candidate.virtualAddress + Math.max(candidate.virtualSize, candidate.rawSize))
    if (!section) throw new Error(`PE RVA is outside all sections: ${rva}`)
    const result = section.rawOffset + rva - section.virtualAddress
    if (result < 0 || result >= bytes.length) throw new Error(`PE RVA resolves outside the file: ${rva}`)
    return result
  }
  if (importRva === 0 || importSize === 0) return []
  const imports = []
  let descriptor = rvaOffset(importRva)
  const descriptorLimit = Math.min(bytes.length, descriptor + importSize)
  while (descriptor + 20 <= descriptorLimit) {
    const fields = Array.from({ length: 5 }, (_, index) => bytes.readUInt32LE(descriptor + index * 4))
    if (fields.every((value) => value === 0)) break
    const nameOffset = rvaOffset(fields[3])
    let end = nameOffset
    while (end < bytes.length && bytes[end] !== 0 && end - nameOffset <= 260) end += 1
    if (end >= bytes.length || end - nameOffset > 260) throw new Error('Invalid PE import name')
    imports.push(bytes.subarray(nameOffset, end).toString('ascii').toLowerCase())
    descriptor += 20
  }
  return [...new Set(imports)].sort()
}

export function tesseractSmokeArguments(target, fixture, tessdata) {
  const executable = ocrTargetContract(target).executable
  return {
    executable,
    version: ['--version'],
    listLanguages: ['--tessdata-dir', tessdata, '--list-langs'],
    tsv: [fixture, 'stdout', '--tessdata-dir', tessdata, '-l', 'jpn+eng', 'tsv'],
  }
}
