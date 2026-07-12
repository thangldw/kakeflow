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
  const id = `${file.name}:${file.size}:${file.lastModified}`
  try {
    const { text, encoding } = decodeCsvBytes(await readFileBytes(file))
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
  return Promise.all(Array.from(files).map(previewImportFile))
}
