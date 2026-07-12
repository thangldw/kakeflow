import { invoke as tauriInvoke } from '@tauri-apps/api/core'
import type { EvidencePageImage } from './EvidencePageOverlay'

export interface SourcePdfPagePreviewDto {
  readonly sourceDocumentId: string
  readonly filename: string
  readonly pageNumber: number
  readonly pageCount: number
  readonly pageWidthPoints: number
  readonly pageHeightPoints: number
  readonly widthPixels: number
  readonly heightPixels: number
  readonly mediaType: 'image/png'
  readonly dataUrl: string
}

export type SourcePdfPreviewInvoke = (command: string, args?: Record<string, unknown>) => Promise<unknown>
export type SourcePdfPagePreviewStatus = 'SUCCESS' | 'PASSWORD_REQUIRED' | 'PASSWORD_INVALID' | 'PASSWORD_UNSUPPORTED'

export class PdfPreviewAccessError extends Error {
  constructor(readonly status: Exclude<SourcePdfPagePreviewStatus, 'SUCCESS'>) {
    super(status)
    this.name = 'PdfPreviewAccessError'
  }
}

export function createSourcePdfPagePreviewPlatform(invoke: SourcePdfPreviewInvoke = tauriInvoke) {
  return {
    get: async (householdId: string, sourceDocumentId: string, pageNumber: number): Promise<SourcePdfPagePreviewDto> => parsePreview(await invoke('source_pdf_page_preview_get', { householdId, sourceDocumentId, pageNumber })),
    getWithPassword: async (householdId: string, sourceDocumentId: string, pageNumber: number, password?: string): Promise<SourcePdfPagePreviewDto> => {
      const attempt = parseAttempt(await invoke('source_pdf_page_preview_attempt', { householdId, sourceDocumentId, pageNumber, password: password ?? null }))
      if (attempt.status !== 'SUCCESS') throw new PdfPreviewAccessError(attempt.status)
      return attempt.preview
    },
  }
}

function parseAttempt(value: unknown): { readonly status: 'SUCCESS'; readonly preview: SourcePdfPagePreviewDto } | { readonly status: Exclude<SourcePdfPagePreviewStatus, 'SUCCESS'>; readonly preview: null } {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new TypeError('source PDF preview attempt')
  const item = value as Record<string, unknown>
  if (item.status === 'SUCCESS') return { status: 'SUCCESS', preview: parsePreview(item.preview) }
  if (['PASSWORD_REQUIRED', 'PASSWORD_INVALID', 'PASSWORD_UNSUPPORTED'].includes(String(item.status)) && item.preview === null) return { status: item.status as Exclude<SourcePdfPagePreviewStatus, 'SUCCESS'>, preview: null }
  throw new TypeError('source PDF preview attempt')
}

export function pdfPreviewToEvidenceImage(preview: SourcePdfPagePreviewDto): EvidencePageImage {
  return {
    src: preview.dataUrl,
    width: preview.widthPixels,
    height: preview.heightPixels,
    pageWidthPoints: preview.pageWidthPoints,
    pageHeightPoints: preview.pageHeightPoints,
    alt: `${preview.filename} Page ${preview.pageNumber}`,
  }
}

function parsePreview(value: unknown): SourcePdfPagePreviewDto {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new TypeError('source PDF preview')
  const item = value as Record<string, unknown>
  if (
    typeof item.sourceDocumentId !== 'string'
    || typeof item.filename !== 'string'
    || !positiveInteger(item.pageNumber, 10_000)
    || !positiveInteger(item.pageCount, 10_000)
    || Number(item.pageNumber) > Number(item.pageCount)
    || !positiveNumber(item.pageWidthPoints, 100_000)
    || !positiveNumber(item.pageHeightPoints, 100_000)
    || !positiveInteger(item.widthPixels, 1_600)
    || !positiveInteger(item.heightPixels, 1_600)
    || item.mediaType !== 'image/png'
    || typeof item.dataUrl !== 'string'
    || !item.dataUrl.startsWith('data:image/png;base64,')
  ) throw new TypeError('source PDF preview')
  return item as unknown as SourcePdfPagePreviewDto
}

const positiveInteger = (value: unknown, maximum: number) => Number.isSafeInteger(value) && Number(value) > 0 && Number(value) <= maximum
const positiveNumber = (value: unknown, maximum: number) => typeof value === 'number' && Number.isFinite(value) && value > 0 && value <= maximum
