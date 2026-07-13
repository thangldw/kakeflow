import { zipSync } from 'fflate'
import { describe, expect, it } from 'vitest'
import { expandZipCsv, ZipImportError } from './zipImport'

const bankCsv = new TextEncoder().encode('日付,摘要,摘要内容,支払い金額,預かり金額,差引残高,メモ,未資金化区分,入払区分\n2026/07/01,給与,,,100,100,,,入')
const code = (action: () => unknown) => {
  try { action(); return 'NO_ERROR' } catch (error) { return error instanceof ZipImportError ? error.code : 'OTHER' }
}
const centralOffsets = (bytes: Uint8Array) => {
  const offsets: number[] = []
  for (let offset = 0; offset + 46 <= bytes.length; offset += 1) if (bytes[offset] === 0x50 && bytes[offset + 1] === 0x4b && bytes[offset + 2] === 0x01 && bytes[offset + 3] === 0x02) offsets.push(offset)
  return offsets
}
const putU32 = (bytes: Uint8Array, offset: number, value: number) => {
  bytes[offset] = value & 0xff; bytes[offset + 1] = (value >>> 8) & 0xff; bytes[offset + 2] = (value >>> 16) & 0xff; bytes[offset + 3] = (value >>> 24) & 0xff
}
const u32ForTest = (bytes: Uint8Array, offset: number) => (bytes[offset] | (bytes[offset + 1] << 8) | (bytes[offset + 2] << 16) | (bytes[offset + 3] << 24)) >>> 0
const localOffsetAt = (bytes: Uint8Array, central: number) => u32ForTest(bytes, central + 42)

describe('bounded ZIP CSV expansion', () => {
  it('returns CSV entries in deterministic name order and discloses ignored non-CSV files', () => {
    const result = expandZipCsv(zipSync({ 'b.csv': new Uint8Array([...bankCsv, 10]), 'readme.txt': new TextEncoder().encode('official export'), 'a.CSV': bankCsv }))
    expect(result.entries.map((entry) => entry.name)).toEqual(['a.CSV', 'b.csv'])
    expect(result.ignoredNames).toEqual(['readme.txt'])
    expect(Array.from(result.entries[0].bytes)).toEqual(Array.from(bankCsv))
  })

  it('collapses byte-identical CSV payloads while retaining deterministic provenance', () => {
    const result = expandZipCsv(zipSync({ 'b.csv': bankCsv, 'a.csv': bankCsv }))
    expect(result.entries.map((entry) => entry.name)).toEqual(['a.csv'])
    expect(result.duplicateCsvEntries).toEqual([{ ignoredName: 'b.csv', canonicalName: 'a.csv' }])
  })

  it.each([
    ['../bank.csv', 'ZIP_PATH_UNSAFE'],
    ['folder/bank.csv', 'ZIP_PATH_UNSAFE'],
    ['folder/', 'ZIP_PATH_UNSAFE'],
  ])('rejects unsafe or directory entry %s atomically', (name, expected) => {
    expect(code(() => expandZipCsv(zipSync({ [name]: bankCsv, 'safe.csv': bankCsv })))).toBe(expected)
  })

  it('rejects duplicate normalized names before extracting anything', () => {
    expect(code(() => expandZipCsv(zipSync({ 'BANK.csv': bankCsv, 'bank.CSV': bankCsv })))).toBe('ZIP_DUPLICATE_ENTRY')
  })

  it('rejects archives with more than twenty entries', () => {
    const files = Object.fromEntries(Array.from({ length: 21 }, (_, index) => [`${index}.csv`, bankCsv]))
    expect(code(() => expandZipCsv(zipSync(files)))).toBe('ZIP_TOO_MANY_ENTRIES')
  })

  it('verifies the central CRC after decompression', () => {
    const bytes = zipSync({ 'bank.csv': bankCsv })
    for (let offset = 0; offset + 46 <= bytes.length; offset += 1) {
      if (bytes[offset] === 0x50 && bytes[offset + 1] === 0x4b && bytes[offset + 2] === 0x01 && bytes[offset + 3] === 0x02) { bytes[offset + 16] ^= 0xff; bytes[localOffsetAt(bytes, offset) + 14] ^= 0xff; break }
    }
    expect(code(() => expandZipCsv(bytes))).toBe('ZIP_EXTRACTION_FAILED')
  })

  it('decompresses and CRC-checks ignored non-CSV entries before returning CSV children', () => {
    const bytes = zipSync({ 'bank.csv': bankCsv, 'readme.txt': new TextEncoder().encode('read me') })
    const readme = centralOffsets(bytes)[1]; bytes[readme + 16] ^= 0xff; bytes[localOffsetAt(bytes, readme) + 14] ^= 0xff
    expect(code(() => expandZipCsv(bytes))).toBe('ZIP_EXTRACTION_FAILED')
  })

  it('rejects an encrypted flag before decompression', () => {
    const bytes = zipSync({ 'bank.csv': bankCsv })
    for (let offset = 0; offset + 46 <= bytes.length; offset += 1) {
      if (bytes[offset] === 0x50 && bytes[offset + 1] === 0x4b && bytes[offset + 2] === 0x01 && bytes[offset + 3] === 0x02) { bytes[offset + 8] |= 1; break }
    }
    expect(code(() => expandZipCsv(bytes))).toBe('ZIP_ENCRYPTED_ENTRY')
  })

  it('rejects an unsupported compression method before decompression', () => {
    const bytes = zipSync({ 'bank.csv': bankCsv }); const central = centralOffsets(bytes)[0]
    const local = bytes[central + 42] | (bytes[central + 43] << 8) | (bytes[central + 44] << 16) | (bytes[central + 45] << 24)
    bytes[central + 10] = 14; bytes[central + 11] = 0; bytes[local + 8] = 14; bytes[local + 9] = 0
    expect(code(() => expandZipCsv(bytes))).toBe('ZIP_COMPRESSION_UNSUPPORTED')
  })

  it('rejects declared per-entry and aggregate expansion bombs before decompression', () => {
    const perEntry = zipSync({ 'bank.csv': bankCsv }); putU32(perEntry, centralOffsets(perEntry)[0] + 24, 10 * 1024 * 1024 + 1)
    expect(code(() => expandZipCsv(perEntry))).toBe('ZIP_ENTRY_TOO_LARGE')
    const aggregate = zipSync(Object.fromEntries(Array.from({ length: 6 }, (_, index) => [`${index}.csv`, bankCsv])))
    centralOffsets(aggregate).forEach((offset) => { putU32(aggregate, offset + 24, 9 * 1024 * 1024); putU32(aggregate, localOffsetAt(aggregate, offset) + 22, 9 * 1024 * 1024) })
    expect(code(() => expandZipCsv(aggregate))).toBe('ZIP_EXPANDED_TOO_LARGE')
  })

  it('rejects an entry ZIP64 size sentinel and overlong decoded names', () => {
    const zip64 = zipSync({ 'bank.csv': bankCsv }); putU32(zip64, centralOffsets(zip64)[0] + 24, 0xffffffff)
    expect(code(() => expandZipCsv(zip64))).toBe('ZIP64_UNSUPPORTED')
    expect(code(() => expandZipCsv(zipSync({ [`${'a'.repeat(256)}.csv`]: bankCsv })))).toBe('ZIP_INVALID_NAME')
  })

  it('rejects archives without CSV and archives with trailing data', () => {
    expect(code(() => expandZipCsv(zipSync({ 'readme.txt': bankCsv })))).toBe('ZIP_NO_CSV_ENTRIES')
    const valid = zipSync({ 'bank.csv': bankCsv }); const trailing = new Uint8Array(valid.length + 1); trailing.set(valid)
    expect(code(() => expandZipCsv(trailing))).toBe('ZIP_INVALID_ARCHIVE')
  })

  it('conservatively rejects legacy non-ASCII names without the UTF-8 flag', () => {
    const bytes = zipSync({ 'a.csv': bankCsv }); const central = centralOffsets(bytes)[0]
    const local = bytes[central + 42] | (bytes[central + 43] << 8) | (bytes[central + 44] << 16) | (bytes[central + 45] << 24)
    bytes[central + 46] = 0x80; bytes[local + 30] = 0x80
    expect(code(() => expandZipCsv(bytes))).toBe('ZIP_INVALID_NAME')
  })

  it('rejects inconsistent local flags and declared metadata', () => {
    const flagMismatch = zipSync({ 'bank.csv': bankCsv }); const central = centralOffsets(flagMismatch)[0]
    const local = flagMismatch[central + 42] | (flagMismatch[central + 43] << 8) | (flagMismatch[central + 44] << 16) | (flagMismatch[central + 45] << 24)
    flagMismatch[local + 6] ^= 0x08
    expect(code(() => expandZipCsv(flagMismatch))).toBe('ZIP_INVALID_ARCHIVE')
    const crcMismatch = zipSync({ 'bank.csv': bankCsv }); const crcCentral = centralOffsets(crcMismatch)[0]
    const crcLocal = crcMismatch[crcCentral + 42] | (crcMismatch[crcCentral + 43] << 8) | (crcMismatch[crcCentral + 44] << 16) | (crcMismatch[crcCentral + 45] << 24)
    crcMismatch[crcLocal + 14] ^= 0xff
    expect(code(() => expandZipCsv(crcMismatch))).toBe('ZIP_INVALID_ARCHIVE')
  })
})
