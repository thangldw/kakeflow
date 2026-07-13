import { unzipSync } from 'fflate'

const MAX_ARCHIVE_BYTES = 25 * 1024 * 1024
const MAX_ENTRY_BYTES = 10 * 1024 * 1024
const MAX_TOTAL_BYTES = 50 * 1024 * 1024
const MAX_ENTRIES = 20

export interface ZipCsvEntry { readonly name: string; readonly bytes: Uint8Array }
export interface ZipDuplicateCsv { readonly ignoredName: string; readonly canonicalName: string }
export interface ZipCsvExpansion { readonly entries: readonly ZipCsvEntry[]; readonly ignoredNames: readonly string[]; readonly duplicateCsvEntries: readonly ZipDuplicateCsv[] }
export class ZipImportError extends Error {
  constructor(readonly code: string, message: string) { super(message); this.name = 'ZipImportError' }
}
interface CentralEntry { name: string; uncompressedSize: number; crc32: number }
const u16 = (data: Uint8Array, offset: number) => data[offset] | (data[offset + 1] << 8)
const u32 = (data: Uint8Array, offset: number) => (u16(data, offset) + u16(data, offset + 2) * 0x10000) >>> 0
function fail(code: string, message: string): never { throw new ZipImportError(code, message) }
function decodeName(bytes: Uint8Array, utf8: boolean): string {
  if (!utf8 && bytes.some((byte) => byte > 0x7f)) return fail('ZIP_INVALID_NAME', 'UTF-8指定のないZIP項目名はASCII文字だけを使用してください。')
  try { return new TextDecoder(utf8 ? 'utf-8' : 'windows-1252', { fatal: true }).decode(bytes) }
  catch { return fail('ZIP_INVALID_NAME', 'ZIP内のファイル名を安全に読み取れません。') }
}
function findEocd(bytes: Uint8Array): number {
  const lower = Math.max(0, bytes.length - 65_557)
  for (let offset = bytes.length - 22; offset >= lower; offset -= 1) if (u32(bytes, offset) === 0x06054b50 && offset + 22 + u16(bytes, offset + 20) === bytes.length) return offset
  return fail('ZIP_INVALID_ARCHIVE', '有効なZIPの終端情報がありません。')
}
const normalizedName = (name: string) => name.normalize('NFKC').toLocaleLowerCase('en-US')
const CRC32_TABLE = Uint32Array.from({ length: 256 }, (_, index) => {
  let value = index
  for (let bit = 0; bit < 8; bit += 1) value = (value >>> 1) ^ (0xedb88320 & -(value & 1))
  return value >>> 0
})
function crc32(data: Uint8Array): number {
  let value = 0xffffffff
  for (const byte of data) value = (value >>> 8) ^ CRC32_TABLE[(value ^ byte) & 0xff]
  return (value ^ 0xffffffff) >>> 0
}

function inspectCentralDirectory(bytes: Uint8Array): CentralEntry[] {
  const eocd = findEocd(bytes); const commentLength = u16(bytes, eocd + 20)
  if (eocd + 22 + commentLength !== bytes.length) fail('ZIP_INVALID_ARCHIVE', 'ZIP終端以降に予期しないデータがあります。')
  const disk = u16(bytes, eocd + 4); const centralDisk = u16(bytes, eocd + 6); const diskEntries = u16(bytes, eocd + 8); const entryCount = u16(bytes, eocd + 10)
  const centralSize = u32(bytes, eocd + 12); const centralOffset = u32(bytes, eocd + 16)
  if (disk !== 0 || centralDisk !== 0 || diskEntries !== entryCount) fail('ZIP_MULTIDISK_UNSUPPORTED', '分割ZIPには対応していません。')
  if (entryCount === 0xffff || centralSize === 0xffffffff || centralOffset === 0xffffffff) fail('ZIP64_UNSUPPORTED', 'ZIP64には対応していません。')
  if (entryCount === 0) fail('ZIP_NO_CSV_ENTRIES', 'ZIPにCSVファイルがありません。')
  if (entryCount > MAX_ENTRIES) fail('ZIP_TOO_MANY_ENTRIES', `ZIP内の項目は${MAX_ENTRIES}件以下にしてください。`)
  if (centralOffset + centralSize !== eocd || centralOffset + centralSize > bytes.length) fail('ZIP_INVALID_ARCHIVE', 'ZIP中央ディレクトリが不正です。')
  const entries: CentralEntry[] = []; const names = new Set<string>(); let total = 0; let offset = centralOffset
  for (let index = 0; index < entryCount; index += 1) {
    if (offset + 46 > eocd || u32(bytes, offset) !== 0x02014b50) fail('ZIP_INVALID_ARCHIVE', 'ZIP項目情報が不正です。')
    const flags = u16(bytes, offset + 8); const compression = u16(bytes, offset + 10); const expectedCrc32 = u32(bytes, offset + 16); const compressedSize = u32(bytes, offset + 20); const uncompressedSize = u32(bytes, offset + 24)
    const nameLength = u16(bytes, offset + 28); const extraLength = u16(bytes, offset + 30); const itemCommentLength = u16(bytes, offset + 32); const externalAttributes = u32(bytes, offset + 38); const localOffset = u32(bytes, offset + 42)
    const next = offset + 46 + nameLength + extraLength + itemCommentLength
    if (next > eocd || nameLength === 0) fail('ZIP_INVALID_ARCHIVE', 'ZIP項目の境界が不正です。')
    if (nameLength > 1024) fail('ZIP_INVALID_NAME', 'ZIP項目名が長すぎます。')
    const name = decodeName(bytes.subarray(offset + 46, offset + 46 + nameLength), Boolean(flags & 0x800))
    if (name.length > 255) fail('ZIP_INVALID_NAME', 'ZIP項目名は255文字以下にしてください。')
    if (flags & 0x41) fail('ZIP_ENCRYPTED_ENTRY', '暗号化されたZIP項目には対応していません。')
    if (compression !== 0 && compression !== 8) fail('ZIP_COMPRESSION_UNSUPPORTED', `ZIP項目「${name}」の圧縮方式には対応していません。`)
    if (compressedSize === 0xffffffff || uncompressedSize === 0xffffffff || localOffset === 0xffffffff) fail('ZIP64_UNSUPPORTED', 'ZIP64項目には対応していません。')
    if (Array.from(name).some((character) => character.codePointAt(0)! <= 31 || character.codePointAt(0) === 127)) fail('ZIP_INVALID_NAME', 'ZIP項目名に使用できない文字があります。')
    const path = name.replaceAll('\\', '/')
    if (path.endsWith('/') || path.includes('/') || /^(?:\.{1,2}|[a-z]:)/i.test(path) || (externalAttributes & 0x10) !== 0) fail('ZIP_PATH_UNSAFE', `ZIP項目「${name}」はディレクトリまたは安全でないパスです。`)
    const key = normalizedName(path); if (names.has(key)) fail('ZIP_DUPLICATE_ENTRY', `正規化後に重複するZIP項目名があります: ${name}`); names.add(key)
    if (uncompressedSize > MAX_ENTRY_BYTES) fail('ZIP_ENTRY_TOO_LARGE', `ZIP内の各ファイルは10MB以下にしてください: ${name}`)
    total += uncompressedSize; if (total > MAX_TOTAL_BYTES) fail('ZIP_EXPANDED_TOO_LARGE', 'ZIP展開後の合計サイズは50MB以下にしてください。')
    if (localOffset + 30 > centralOffset || u32(bytes, localOffset) !== 0x04034b50) fail('ZIP_INVALID_ARCHIVE', `ZIP項目「${name}」のローカル情報が不正です。`)
    const localFlags = u16(bytes, localOffset + 6); const localNameLength = u16(bytes, localOffset + 26); const localExtraLength = u16(bytes, localOffset + 28)
    const localNameStart = localOffset + 30; const dataStart = localNameStart + localNameLength + localExtraLength
    if ((localFlags & 0x41) !== 0 || (localFlags & 0x849) !== (flags & 0x849) || u16(bytes, localOffset + 8) !== compression || dataStart > centralOffset) fail('ZIP_INVALID_ARCHIVE', `ZIP項目「${name}」のローカル情報が一致しません。`)
    if (decodeName(bytes.subarray(localNameStart, localNameStart + localNameLength), Boolean(localFlags & 0x800)) !== name) fail('ZIP_INVALID_ARCHIVE', `ZIP項目「${name}」の名前情報が一致しません。`)
    if ((flags & 0x8) === 0 && (u32(bytes, localOffset + 14) !== expectedCrc32 || u32(bytes, localOffset + 18) !== compressedSize || u32(bytes, localOffset + 22) !== uncompressedSize)) fail('ZIP_INVALID_ARCHIVE', `ZIP項目「${name}」のCRCまたはサイズ情報が一致しません。`)
    if (dataStart + compressedSize > centralOffset) fail('ZIP_INVALID_ARCHIVE', `ZIP項目「${name}」のデータ境界が不正です。`)
    entries.push({ name, uncompressedSize, crc32: expectedCrc32 }); offset = next
  }
  if (offset !== eocd) fail('ZIP_INVALID_ARCHIVE', 'ZIP中央ディレクトリの件数が一致しません。')
  return entries.sort((a, b) => a.name < b.name ? -1 : a.name > b.name ? 1 : 0)
}

export function expandZipCsv(bytes: Uint8Array): ZipCsvExpansion {
  if (bytes.byteLength > MAX_ARCHIVE_BYTES) fail('ZIP_FILE_TOO_LARGE', 'ZIPファイルは25MB以下にしてください。')
  const metadata = inspectCentralDirectory(bytes); const csv = metadata.filter((entry) => /\.csv$/i.test(entry.name)); const ignoredNames = metadata.filter((entry) => !/\.csv$/i.test(entry.name)).map((entry) => entry.name)
  if (csv.length === 0) fail('ZIP_NO_CSV_ENTRIES', 'ZIPに取り込み可能なCSVファイルがありません。')
  let extracted: Record<string, Uint8Array>
  try { extracted = unzipSync(bytes) }
  catch { return fail('ZIP_EXTRACTION_FAILED', 'ZIPの展開または整合性確認に失敗しました。') }
  const verified = new Map(metadata.map((entry) => {
    const value = extracted[entry.name]
    if (!value || value.byteLength !== entry.uncompressedSize || crc32(value) !== entry.crc32) fail('ZIP_EXTRACTION_FAILED', `ZIP項目「${entry.name}」のサイズまたはCRCが一致しません。`)
    return [entry.name, value] as const
  }))
  const entries: ZipCsvEntry[] = []; const duplicateCsvEntries: ZipDuplicateCsv[] = []
  for (const entry of csv) {
    const value = verified.get(entry.name)!
    const canonical = entries.find((candidate) => candidate.bytes.byteLength === value.byteLength && candidate.bytes.every((byte, index) => byte === value[index]))
    if (canonical) duplicateCsvEntries.push({ ignoredName: entry.name, canonicalName: canonical.name })
    else entries.push({ name: entry.name, bytes: value })
  }
  return { entries, ignoredNames, duplicateCsvEntries }
}
