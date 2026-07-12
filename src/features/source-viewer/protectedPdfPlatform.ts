import { invoke as tauriInvoke } from '@tauri-apps/api/core'
import type { ExtractedDocumentDto, ExtractedRegionDto } from '../../platform'

export type PdfPasswordStatus = 'SUCCESS' | 'PASSWORD_REQUIRED' | 'PASSWORD_INVALID' | 'PASSWORD_UNSUPPORTED'

export type ProtectedPdfExtractionAttempt =
  | { readonly status: 'SUCCESS'; readonly document: ExtractedDocumentDto }
  | { readonly status: Exclude<PdfPasswordStatus, 'SUCCESS'>; readonly document: null }

export type ProtectedPdfInvoke = (command: string, args?: Record<string, unknown>) => Promise<unknown>

export function createProtectedPdfPlatform(invoke: ProtectedPdfInvoke = tauriInvoke) {
  return {
    extract: async (fileBytes: Uint8Array, password?: string): Promise<ProtectedPdfExtractionAttempt> => parseAttempt(await invoke('document_extract_attempt', {
      fileBytes: Array.from(fileBytes), mediaType: 'application/pdf', password: password ?? null,
    })),
  }
}

function parseAttempt(value: unknown): ProtectedPdfExtractionAttempt {
  const item = object(value)
  if (!item || !['SUCCESS', 'PASSWORD_REQUIRED', 'PASSWORD_INVALID', 'PASSWORD_UNSUPPORTED'].includes(String(item.status))) throw new TypeError('protected PDF extraction attempt')
  if (item.status === 'SUCCESS') {
    const document = parseDocument(item.document)
    if (!document) throw new TypeError('protected PDF extraction attempt')
    return { status: 'SUCCESS', document }
  }
  if (item.document !== null) throw new TypeError('protected PDF extraction attempt')
  return { status: item.status as Exclude<PdfPasswordStatus, 'SUCCESS'>, document: null }
}

function parseDocument(value: unknown): ExtractedDocumentDto | null {
  const item = object(value)
  if (!item || !['EMBEDDED_TEXT', 'OCR'].includes(String(item.method)) || typeof item.text !== 'string' || !bps(item.confidenceBps) || !Array.isArray(item.issues) || !item.issues.every((issue) => typeof issue === 'string') || !Array.isArray(item.regions)) return null
  const regions = item.regions.map(parseRegion)
  if (regions.some((region) => region === null)) return null
  return { method: item.method as ExtractedDocumentDto['method'], text: item.text, confidenceBps: Number(item.confidenceBps), issues: item.issues as string[], regions: regions as ExtractedRegionDto[] }
}

function parseRegion(value: unknown): ExtractedRegionDto | null {
  const item = object(value)
  if (!item || !positiveInteger(item.pageNumber, 10_000) || !['PIXELS', 'PDF_POINTS', 'UNLOCATED'].includes(String(item.coordinateSpace)) || typeof item.text !== 'string' || !bps(item.confidenceBps) || typeof item.provenance !== 'string') return null
  const box = item.boundingBox === null ? null : object(item.boundingBox)
  if (box && ![box.left, box.top, box.width, box.height].every((value) => Number.isSafeInteger(value) && Number(value) >= 0)) return null
  return {
    pageNumber: Number(item.pageNumber), coordinateSpace: item.coordinateSpace as ExtractedRegionDto['coordinateSpace'],
    boundingBox: box ? { left: Number(box.left), top: Number(box.top), width: Number(box.width), height: Number(box.height) } : null,
    text: item.text, confidenceBps: Number(item.confidenceBps), provenance: item.provenance,
  }
}

const object = (value: unknown): Record<string, unknown> | null => value !== null && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : null
const positiveInteger = (value: unknown, maximum: number) => Number.isSafeInteger(value) && Number(value) > 0 && Number(value) <= maximum
const bps = (value: unknown) => Number.isSafeInteger(value) && Number(value) >= 0 && Number(value) <= 10_000
