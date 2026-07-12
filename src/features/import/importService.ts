import { decodeCsvBytes, detectImportAdapter } from '../../ingestion'
import type { ParseIssue } from '../../ingestion'

export interface ImportPreview {
  id: string
  filename: string
  adapterId: string | null
  encoding: string
  recordCount: number
  issues: readonly ParseIssue[]
  status: 'ready' | 'unsupported' | 'error'
  parsedAt: string
}

const MAX_FILE_BYTES = 25 * 1024 * 1024
const MAX_BATCH_FILES = 20

async function sha256Hex(bytes: Uint8Array): Promise<string> {
  if (!globalThis.crypto?.subtle) throw new Error('Secure file hashing is unavailable')
  const digest = await globalThis.crypto.subtle.digest('SHA-256', bytes.slice().buffer)
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, '0')).join('')
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

export async function previewImportFile(file: File): Promise<ImportPreview> {
  let id = `pending:${file.name}:${file.size}`
  try {
    if (file.size > MAX_FILE_BYTES) {
      return {
        id, filename: file.name, adapterId: null, encoding: 'not-read', recordCount: 0,
        issues: [{ code: 'FILE_TOO_LARGE', message: 'ファイルサイズは25MB以下にしてください。', severity: 'error' }],
        status: 'error', parsedAt: new Date().toISOString(),
      }
    }
    const bytes = await readFileBytes(file)
    id = await sha256Hex(bytes)
    const { text, encoding } = decodeCsvBytes(bytes)
    const detected = detectImportAdapter({ text, filename: file.name })
    if (!detected) {
      return {
        id, filename: file.name, adapterId: null, encoding, recordCount: 0,
        issues: [{ code: 'ADAPTER_NOT_FOUND', message: '対応するCSV形式を検出できませんでした。', severity: 'error' }],
        status: 'unsupported', parsedAt: new Date().toISOString(),
      }
    }

    const parsed = detected.adapter.parse({ text, filename: file.name })
    return {
      id, filename: file.name, adapterId: detected.adapter.id, encoding,
      recordCount: parsed.records.length, issues: parsed.issues,
      status: parsed.issues.some((issue) => issue.severity === 'error') ? 'error' : 'ready',
      parsedAt: new Date().toISOString(),
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
  const accepted = selected.slice(0, MAX_BATCH_FILES)
  const previews: ImportPreview[] = []
  for (let index = 0; index < accepted.length; index += 2) {
    previews.push(...await Promise.all(accepted.slice(index, index + 2).map(previewImportFile)))
  }
  if (selected.length > MAX_BATCH_FILES) {
    previews.push({
      id: `batch-limit:${selected.length}`, filename: `${selected.length - MAX_BATCH_FILES}件のファイル`,
      adapterId: null, encoding: 'not-read', recordCount: 0, status: 'error', parsedAt: new Date().toISOString(),
      issues: [{ code: 'BATCH_TOO_LARGE', message: '一度に選択できるファイルは20件までです。', severity: 'error' }],
    })
  }
  return previews
}
