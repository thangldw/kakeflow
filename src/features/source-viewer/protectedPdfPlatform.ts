import { invoke as tauriInvoke } from '@tauri-apps/api/core'
import type { ExtractedDocumentDto } from '../../platform'

export type PdfPasswordStatus = 'SUCCESS' | 'PASSWORD_REQUIRED' | 'PASSWORD_INVALID' | 'PASSWORD_UNSUPPORTED'
export type PdfOcrStatus = PdfPasswordStatus | 'OCR_ENGINE_UNAVAILABLE' | 'OCR_MODELS_UNAVAILABLE' | 'LIMIT_EXCEEDED' | 'TIMED_OUT' | 'NO_TEXT' | 'FAILED'

export type ProtectedPdfExtractionAttempt =
  | { readonly status: 'SUCCESS'; readonly document: ExtractedDocumentDto }
  | { readonly status: Exclude<PdfPasswordStatus, 'SUCCESS'>; readonly document: null }
export type ProtectedPdfOcrAttempt =
  | { readonly status: 'SUCCESS'; readonly document: ExtractedDocumentDto }
  | { readonly status: Exclude<PdfOcrStatus, 'SUCCESS'>; readonly document: null }
export interface PdfRenderedPageDto {
  readonly pageNumber: number
  readonly pageCount: number
  readonly pageWidthPoints: number
  readonly pageHeightPoints: number
  readonly widthPixels: number
  readonly heightPixels: number
  readonly mediaType: 'image/png'
  readonly dataUrl: string
}
export type ProtectedPdfRenderAttempt =
  | { readonly status: 'SUCCESS'; readonly pages: readonly PdfRenderedPageDto[] }
  | { readonly status: 'PASSWORD_REQUIRED' | 'PASSWORD_INVALID' | 'PASSWORD_UNSUPPORTED' | 'LIMIT_EXCEEDED' | 'FAILED'; readonly pages: null }

export type ProtectedPdfInvoke = (command: string, args?: Record<string, unknown>) => Promise<unknown>

export function createProtectedPdfPlatform(invoke: ProtectedPdfInvoke = tauriInvoke) {
  return {
    extract: async (fileBytes: Uint8Array, password?: string): Promise<ProtectedPdfExtractionAttempt> => parseAttempt(await invoke('document_extract_attempt', {
      fileBytes: Array.from(fileBytes), mediaType: 'application/pdf', password: password ?? null,
    })),
    ocr: async (fileBytes: Uint8Array, password?: string): Promise<ProtectedPdfOcrAttempt> => parseOcrAttempt(await invoke('document_pdf_ocr_attempt', {
      fileBytes: Array.from(fileBytes), mediaType: 'application/pdf', password: password ?? null,
    })),
    renderForOcr: async (fileBytes: Uint8Array, password?: string): Promise<ProtectedPdfRenderAttempt> => parseRenderAttempt(await invoke('document_pdf_render_attempt', {
      fileBytes: Array.from(fileBytes), mediaType: 'application/pdf', password: password ?? null,
    })),
  }
}

function parseRenderAttempt(value: unknown): ProtectedPdfRenderAttempt {
  const item = requiredObject(value, 'protected PDF render attempt')
  const failureStatuses = ['PASSWORD_REQUIRED', 'PASSWORD_INVALID', 'PASSWORD_UNSUPPORTED', 'LIMIT_EXCEEDED', 'FAILED'] as const
  if (failureStatuses.includes(item.status as typeof failureStatuses[number])) {
    if (item.pages !== null) throw new TypeError('protected PDF render attempt')
    return { status: item.status as typeof failureStatuses[number], pages: null }
  }
  if (item.status !== 'SUCCESS' || !Array.isArray(item.pages) || item.pages.length === 0 || item.pages.length > 32) throw new TypeError('protected PDF render attempt')
  const rawPages = item.pages
  let encodedBytes = 0
  const pages = rawPages.map((value, index): PdfRenderedPageDto => {
    const page = requiredObject(value, 'rendered PDF page')
    const pageNumber = boundedInteger(page.pageNumber, 32, 'page number')
    const pageCount = boundedInteger(page.pageCount, 32, 'page count')
    const widthPixels = boundedInteger(page.widthPixels, 1_600, 'page width')
    const heightPixels = boundedInteger(page.heightPixels, 1_600, 'page height')
    if (pageNumber !== index + 1 || pageCount !== rawPages.length || widthPixels === 0 || heightPixels === 0) throw new TypeError('rendered PDF page')
    if (typeof page.pageWidthPoints !== 'number' || !Number.isFinite(page.pageWidthPoints) || page.pageWidthPoints <= 0
      || typeof page.pageHeightPoints !== 'number' || !Number.isFinite(page.pageHeightPoints) || page.pageHeightPoints <= 0
      || page.mediaType !== 'image/png' || typeof page.dataUrl !== 'string' || !page.dataUrl.startsWith('data:image/png;base64,')) throw new TypeError('rendered PDF page')
    encodedBytes += page.dataUrl.length
    if (page.dataUrl.length > 20_000_000 || encodedBytes > 150_000_000) throw new TypeError('rendered PDF pages')
    return { pageNumber, pageCount, pageWidthPoints: page.pageWidthPoints, pageHeightPoints: page.pageHeightPoints, widthPixels, heightPixels, mediaType: 'image/png', dataUrl: page.dataUrl }
  })
  return { status: 'SUCCESS', pages }
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

function parseOcrAttempt(value: unknown): ProtectedPdfOcrAttempt {
  const item = object(value)
  const statuses: readonly PdfOcrStatus[] = ['SUCCESS', 'PASSWORD_REQUIRED', 'PASSWORD_INVALID', 'PASSWORD_UNSUPPORTED', 'OCR_ENGINE_UNAVAILABLE', 'OCR_MODELS_UNAVAILABLE', 'LIMIT_EXCEEDED', 'TIMED_OUT', 'NO_TEXT', 'FAILED']
  if (!item || !statuses.includes(item.status as PdfOcrStatus)) throw new TypeError('protected PDF OCR attempt')
  if (item.status === 'SUCCESS') {
    const document = parseDocument(item.document)
    if (!document || document.method !== 'OCR') throw new TypeError('protected PDF OCR attempt')
    return { status: 'SUCCESS', document }
  }
  if (item.document !== null) throw new TypeError('protected PDF OCR attempt')
  return { status: item.status as Exclude<PdfOcrStatus, 'SUCCESS'>, document: null }
}

function parseDocument(value: unknown): ExtractedDocumentDto | null {
  try {
    const item = requiredObject(value, 'extracted document')
    if ((item.method !== 'EMBEDDED_TEXT' && item.method !== 'OCR') || typeof item.text !== 'string' || !Array.isArray(item.issues) || !item.issues.every((issue) => typeof issue === 'string')) throw new TypeError('extracted document')
    const confidenceBps = boundedInteger(item.confidenceBps, 10_000, 'confidence')
    const pages = typeof item.pages === 'undefined' ? undefined : parsePages(item.pages, item.pageCount)
    const pageCount = pages ? pages.length : typeof item.pageCount === 'undefined' ? undefined : boundedInteger(item.pageCount, 10_000, 'page count')
    if (pageCount === 0) throw new TypeError('page count')
    const regions = typeof item.regions === 'undefined' ? undefined : parseRegions(item.regions, pages)
    return { method: item.method, text: item.text, confidenceBps, issues: item.issues, regions, pageCount, pages }
  } catch {
    return null
  }
}

function parsePages(value: unknown, declaredPageCount: unknown): NonNullable<ExtractedDocumentDto['pages']> {
  if (!Array.isArray(value) || value.length === 0 || value.length > 10_000) throw new TypeError('extracted pages')
  if (boundedInteger(declaredPageCount, 10_000, 'page count') !== value.length) throw new TypeError('page count')
  return value.map((value, index) => {
    const item = requiredObject(value, 'page')
    const pageNumber = boundedInteger(item.pageNumber, 10_000, 'page number')
    if (pageNumber !== index + 1) throw new TypeError('page order')
    const widthPixels = item.widthPixels === null ? null : boundedInteger(item.widthPixels, 20_000, 'page width')
    const heightPixels = item.heightPixels === null ? null : boundedInteger(item.heightPixels, 20_000, 'page height')
    if ((widthPixels === null) !== (heightPixels === null) || widthPixels === 0 || heightPixels === 0) throw new TypeError('page dimensions')
    const confidenceBps = boundedInteger(item.confidenceBps, 10_000, 'page confidence')
    if (!Array.isArray(item.issues) || !item.issues.every((issue) => typeof issue === 'string')) throw new TypeError('page issues')
    return { pageNumber, widthPixels, heightPixels, confidenceBps, issues: item.issues }
  })
}

function parseRegions(value: unknown, pages?: NonNullable<ExtractedDocumentDto['pages']>): NonNullable<ExtractedDocumentDto['regions']> {
  if (!Array.isArray(value) || value.length > 10_000) throw new TypeError('extracted regions')
  return value.map((value) => {
    const item = requiredObject(value, 'region')
    const pageNumber = boundedInteger(item.pageNumber, 10_000, 'region page')
    if (pageNumber === 0 || (pages && pageNumber > pages.length)) throw new TypeError('region page')
    if (item.coordinateSpace !== 'PIXELS' && item.coordinateSpace !== 'PDF_POINTS' && item.coordinateSpace !== 'UNLOCATED') throw new TypeError('coordinate space')
    const confidenceBps = boundedInteger(item.confidenceBps, 10_000, 'region confidence')
    if (typeof item.text !== 'string' || typeof item.provenance !== 'string' || !item.provenance) throw new TypeError('region')
    let boundingBox = null
    if (item.boundingBox !== null) {
      const box = requiredObject(item.boundingBox, 'region box')
      boundingBox = {
        left: boundedInteger(box.left, 100_000, 'region left'),
        top: boundedInteger(box.top, 100_000, 'region top'),
        width: boundedInteger(box.width, 100_000, 'region width'),
        height: boundedInteger(box.height, 100_000, 'region height'),
      }
      if (boundingBox.width === 0 || boundingBox.height === 0 || item.coordinateSpace === 'UNLOCATED') throw new TypeError('region box')
      const page = pages?.[pageNumber - 1]
      if (item.coordinateSpace === 'PIXELS' && page?.widthPixels != null && page.heightPixels != null
        && (boundingBox.left + boundingBox.width > page.widthPixels || boundingBox.top + boundingBox.height > page.heightPixels)) throw new TypeError('region bounds')
    } else if (item.coordinateSpace !== 'UNLOCATED') throw new TypeError('region box')
    return { pageNumber, coordinateSpace: item.coordinateSpace, boundingBox, text: item.text, confidenceBps, provenance: item.provenance }
  })
}

const object = (value: unknown): Record<string, unknown> | null => value !== null && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : null
const requiredObject = (value: unknown, label: string) => {
  const item = object(value)
  if (!item) throw new TypeError(label)
  return item
}
const boundedInteger = (value: unknown, maximum: number, label: string) => {
  if (!Number.isSafeInteger(value) || Number(value) < 0 || Number(value) > maximum) throw new TypeError(label)
  return Number(value)
}
