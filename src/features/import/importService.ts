import { decodeCsvBytes, detectImportAdapter } from '../../ingestion'
import type { AdapterId, ParsedImport, ParseIssue } from '../../ingestion'
import readXlsxFile from 'read-excel-file/browser'
import { expandZipCsv, ZipImportError } from './zipImport'

export interface ImportPreview {
  id: string
  filename: string
  adapterId: string | null
  encoding: string
  recordCount: number
  issues: readonly ParseIssue[]
  status: 'ready' | 'extractable' | 'unsupported' | 'error'
  parsedAt: string
  fileBytes?: Uint8Array
  parsed?: ParsedImport<unknown>
  detectedAdapterId?: AdapterId
  mediaType?: string
  sourceModifiedAt?: string
  sourceType?: 'MANUAL_UPLOAD' | 'LOCAL_FOLDER'
  folderInboxItemId?: string
  watchedFolderId?: string
  relativePath?: string
  archiveFilename?: string
  archiveEntryName?: string
}

const MAX_FILE_BYTES = 25 * 1024 * 1024
const MAX_IMAGE_BYTES = 20 * 1024 * 1024
const MAX_BATCH_FILES = 20

async function sha256Hex(bytes: Uint8Array): Promise<string> {
  if (!globalThis.crypto?.subtle) throw new Error('Secure file hashing is unavailable')
  const digest = await globalThis.crypto.subtle.digest('SHA-256', bytes.slice().buffer)
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, '0')).join('')
}

export function sha256Text(value: string): Promise<string> {
  return sha256Hex(new TextEncoder().encode(value))
}

async function readFileBytes(file: File): Promise<Uint8Array> {
  if (typeof file.arrayBuffer === 'function') return new Uint8Array(await file.arrayBuffer())
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onerror = () => reject(reader.error ?? new Error('File read failed'))
    reader.onload = () => {
      if (!(reader.result instanceof ArrayBuffer)) reject(new Error('Expected file bytes'))
      else resolve(new Uint8Array(reader.result))
    }
    reader.readAsArrayBuffer(file)
  })
}

function csvCell(value: unknown): string {
  if (value === null || typeof value === 'undefined') return ''
  const text = value instanceof Date
    ? `${value.getFullYear()}/${String(value.getMonth() + 1).padStart(2, '0')}/${String(value.getDate()).padStart(2, '0')}`
    : String(value)
  return /[",\r\n]/.test(text) ? `"${text.replaceAll('"', '""')}"` : text
}

export function excelRowsToCsv(rows: readonly (readonly unknown[])[]): string {
  return rows.map((row) => row.map(csvCell).join(',')).join('\n')
}

export async function previewImportFile(file: File): Promise<ImportPreview> {
  let id = `pending:${file.name}:${file.size}`
  try {
    const isImage = /image\/(?:png|jpeg)/i.test(file.type) || /\.(?:png|jpe?g)$/i.test(file.name)
    const sizeLimit = isImage ? MAX_IMAGE_BYTES : MAX_FILE_BYTES
    if (file.size > sizeLimit) {
      return {
        id, filename: file.name, adapterId: null, encoding: 'not-read', recordCount: 0,
        issues: [{ code: 'FILE_TOO_LARGE', message: isImage ? 'レシート画像は20MB以下にしてください。' : 'ファイルサイズは25MB以下にしてください。', severity: 'error' }],
        status: 'error', parsedAt: new Date().toISOString(),
      }
    }
    const bytes = await readFileBytes(file)
    id = await sha256Hex(bytes)
    const isPdf = file.type === 'application/pdf' || /\.pdf$/i.test(file.name)
    if (isPdf) {
      return {
        id, filename: file.name, adapterId: 'pdf-local-extraction-v2', encoding: 'binary', recordCount: 0,
        issues: [{ code: 'DOCUMENT_EXTRACTION_REQUIRED', message: 'PDFをローカルで解析し、画像PDFの場合は明示操作後にOCRします。', severity: 'warning' }],
        status: 'extractable', parsedAt: new Date().toISOString(), fileBytes: bytes,
        mediaType: 'application/pdf', sourceModifiedAt: new Date(file.lastModified).toISOString(),
      }
    }
    if (isImage) {
      const mediaType = file.type.toLowerCase() === 'image/png' || /\.png$/i.test(file.name) ? 'image/png' : 'image/jpeg'
      return {
        id, filename: file.name, adapterId: 'receipt-image-ocr-v1', encoding: 'binary', recordCount: 0,
        issues: [{ code: 'DOCUMENT_EXTRACTION_REQUIRED', message: 'レシート画像を端末内OCRで読み取ります。', severity: 'warning' }],
        status: 'extractable', parsedAt: new Date().toISOString(), fileBytes: bytes,
        mediaType, sourceModifiedAt: new Date(file.lastModified).toISOString(),
      }
    }
    const isXlsx = /\.xlsx$/i.test(file.name) || file.type === 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
    let text: string
    let encoding: string
    let detected = null
    if (isXlsx) {
      const sheets = await readXlsxFile(file)
      const rankedSheets = sheets.map((sheet) => {
        const sheetText = excelRowsToCsv(sheet.data)
        return { text: sheetText, detected: detectImportAdapter({ text: sheetText, filename: file.name }) }
      }).sort((left, right) => (right.detected?.score ?? 0) - (left.detected?.score ?? 0))
      text = rankedSheets[0]?.text ?? ''
      detected = rankedSheets[0]?.detected ?? null
      encoding = 'xlsx'
    } else {
      const decoded = decodeCsvBytes(bytes)
      text = decoded.text
      encoding = decoded.encoding
      detected = detectImportAdapter({ text, filename: file.name })
    }
    if (!detected) {
      return {
        id, filename: file.name, adapterId: null, encoding, recordCount: 0,
        issues: [{ code: 'ADAPTER_NOT_FOUND', message: '対応するCSV / Excel形式を検出できませんでした。', severity: 'error' }],
        status: 'unsupported', parsedAt: new Date().toISOString(), fileBytes: bytes,
        mediaType: file.type || (isXlsx ? 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' : 'text/csv'),
        sourceModifiedAt: new Date(file.lastModified).toISOString(),
      }
    }

    const parsed = detected.adapter.parse({ text, filename: file.name })
    return {
      id, filename: file.name, adapterId: detected.adapter.id, encoding,
      recordCount: parsed.records.length, issues: parsed.issues,
      status: parsed.issues.some((issue) => issue.severity === 'error') ? 'error' : 'ready',
      parsedAt: new Date().toISOString(), fileBytes: bytes, parsed,
      detectedAdapterId: detected.adapter.id, mediaType: file.type || 'text/csv',
      sourceModifiedAt: new Date(file.lastModified).toISOString(),
    }
  } catch (error) {
    return {
      id, filename: file.name, adapterId: null, encoding: 'unknown', recordCount: 0,
      issues: [{ code: 'IMPORT_READ_FAILED', message: error instanceof Error ? error.message : 'ファイルを読み取れませんでした。', severity: 'error' }],
      status: 'error', parsedAt: new Date().toISOString(),
    }
  }
}

export async function previewImportFiles(files: FileList | readonly File[]): Promise<ImportPreview[]> {
  const selected = Array.from(files)
  const previews: ImportPreview[] = []
  for (const file of selected.slice(0, MAX_BATCH_FILES)) {
    const isZip = /\.zip$/i.test(file.name) || /^(?:application\/zip|application\/x-zip-compressed)$/i.test(file.type)
    let expanded: ImportPreview[]
    if (isZip) {
      try {
        if (file.size > MAX_FILE_BYTES) throw new ZipImportError('ZIP_FILE_TOO_LARGE', 'ZIPファイルは25MB以下にしてください。')
        const archive = expandZipCsv(await readFileBytes(file))
        expanded = []
        for (const [entryIndex, entry] of archive.entries.entries()) {
          const displayName = `${file.name} › ${entry.name}`
          const child = await previewImportFile(new File([new Uint8Array(entry.bytes)], displayName, { type: 'text/csv', lastModified: file.lastModified }))
          expanded.push({
            ...child, archiveFilename: file.name, archiveEntryName: entry.name,
            issues: entryIndex !== 0 ? child.issues : [
              ...child.issues,
              ...(archive.ignoredNames.length === 0 ? [] : [{ code: 'ZIP_NON_CSV_IGNORED', severity: 'warning' as const, message: `CSV以外の${archive.ignoredNames.length}件を取り込み対象外にしました: ${archive.ignoredNames.join(', ')}` }]),
              ...(archive.duplicateCsvEntries.length === 0 ? [] : [{ code: 'ZIP_DUPLICATE_CSV_IGNORED', severity: 'warning' as const, message: `内容が同一のCSV ${archive.duplicateCsvEntries.length}件を重複として除外しました: ${archive.duplicateCsvEntries.map((duplicate) => `${duplicate.ignoredName} → ${duplicate.canonicalName}`).join(', ')}` }]),
            ],
          })
        }
      } catch (error) {
        const issue = error instanceof ZipImportError ? error : new ZipImportError('ZIP_READ_FAILED', 'ZIPファイルを読み取れませんでした。')
        expanded = [{ id: `zip-error:${file.name}:${file.size}`, filename: file.name, adapterId: null, encoding: 'not-read', recordCount: 0, status: 'error', parsedAt: new Date().toISOString(), issues: [{ code: issue.code, message: issue.message, severity: 'error' }] }]
      }
    } else expanded = [await previewImportFile(file)]
    if (previews.length + expanded.length > MAX_BATCH_FILES) {
      previews.push({ id: `batch-limit:${selected.length}:${previews.length + expanded.length}`, filename: '取込上限超過', adapterId: null, encoding: 'not-read', recordCount: 0, status: 'error', parsedAt: new Date().toISOString(), issues: [{ code: 'BATCH_TOO_LARGE', message: 'ZIP内のCSVを含め、一度にプレビューできるファイルは20件までです。', severity: 'error' }] })
      break
    }
    previews.push(...expanded)
  }
  if (selected.length > MAX_BATCH_FILES && !previews.some((preview) => preview.issues.some((issue) => issue.code === 'BATCH_TOO_LARGE'))) {
    previews.push({
      id: `batch-limit:${selected.length}`, filename: `${selected.length - MAX_BATCH_FILES}件のファイル`,
      adapterId: null, encoding: 'not-read', recordCount: 0, status: 'error', parsedAt: new Date().toISOString(),
      issues: [{ code: 'BATCH_TOO_LARGE', message: '一度に選択できるファイルは20件までです。', severity: 'error' }],
    })
  }
  return previews
}
