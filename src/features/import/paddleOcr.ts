import type { OcrResult, PaddleOCR as PaddleOCREngine } from '@paddleocr/paddleocr-js'
import type { ExtractedDocumentDto, ExtractedRegionDto } from '../../platform'
import type { PdfRenderedPageDto } from '../source-viewer/protectedPdfPlatform'

const DETECTION_MODEL = 'PP-OCRv5_mobile_det'
const RECOGNITION_MODEL = 'PP-OCRv5_mobile_rec'

type Engine = Pick<PaddleOCREngine, 'predict'>

let enginePromise: Promise<Engine> | null = null

function bundledAssetUrl(path: string): string {
  if (typeof globalThis.location === 'undefined') return path
  const relativePath = path.startsWith('/') ? path.slice(1) : path
  return new URL(`${import.meta.env.BASE_URL}${relativePath}`, globalThis.location.origin).href
}

async function createEngine(): Promise<Engine> {
  const { PaddleOCR } = await import('@paddleocr/paddleocr-js')
  return PaddleOCR.create({
    worker: false,
    textDetectionModelName: DETECTION_MODEL,
    textDetectionModelAsset: {
      url: bundledAssetUrl(`/ocr/paddleocr/models/${DETECTION_MODEL}.tar`),
    },
    textRecognitionModelName: RECOGNITION_MODEL,
    textRecognitionModelAsset: {
      url: bundledAssetUrl(`/ocr/paddleocr/models/${RECOGNITION_MODEL}.tar`),
    },
    textDetLimitSideLen: 1280,
    textDetLimitType: 'max',
    textRecScoreThresh: 0.2,
    ortOptions: {
      backend: 'wasm',
      wasmPaths: bundledAssetUrl('/ocr/paddleocr/ort/'),
      numThreads: 1,
      simd: true,
      proxy: false,
    },
  })
}

async function getEngine(): Promise<Engine> {
  enginePromise ??= createEngine()
  try {
    return await enginePromise
  } catch (error) {
    // Allow a later retry after a transient asset/runtime initialization error.
    enginePromise = null
    throw error
  }
}

function confidenceBps(score: number): number {
  if (!Number.isFinite(score)) return 0
  return Math.max(0, Math.min(10_000, Math.round(score * 10_000)))
}

function regionFromItem(item: OcrResult['items'][number]): ExtractedRegionDto | null {
  const text = item.text.trim()
  if (!text) return null
  const xs = item.poly.map(([x]) => x).filter(Number.isFinite)
  const ys = item.poly.map(([, y]) => y).filter(Number.isFinite)
  const boundingBox = xs.length > 0 && ys.length > 0
    ? {
        left: Math.min(...xs),
        top: Math.min(...ys),
        width: Math.max(0, Math.max(...xs) - Math.min(...xs)),
        height: Math.max(0, Math.max(...ys) - Math.min(...ys)),
      }
    : null
  return {
    pageNumber: 1,
    coordinateSpace: boundingBox ? 'PIXELS' : 'UNLOCATED',
    boundingBox,
    text,
    confidenceBps: confidenceBps(item.score),
    provenance: 'PADDLEOCR_V5_LINE',
  }
}

function mapPaddleOcrResult(result: OcrResult, allowEmpty: boolean): ExtractedDocumentDto {
  const regions = result.items.map(regionFromItem).filter((region): region is ExtractedRegionDto => region !== null)
  const text = regions.map((region) => region.text).join('\n')
  if (!text && !allowEmpty) throw new Error('PP-OCRv5 did not recognize any text in the image.')

  const totalWeight = regions.reduce((sum, region) => sum + Math.max(1, [...region.text].length), 0)
  const documentConfidence = totalWeight === 0 ? 0 : Math.round(regions.reduce(
    (sum, region) => sum + region.confidenceBps * Math.max(1, [...region.text].length),
    0,
  ) / totalWeight)

  return {
    method: 'OCR',
    text,
    confidenceBps: documentConfidence,
    issues: text ? [] : ['NO_TEXT'],
    regions,
    pageCount: 1,
    pages: [{
      pageNumber: 1,
      widthPixels: result.image.width,
      heightPixels: result.image.height,
      confidenceBps: documentConfidence,
      issues: text ? [] : ['NO_TEXT'],
    }],
  }
}

export function paddleOcrResultToDocument(result: OcrResult): ExtractedDocumentDto {
  return mapPaddleOcrResult(result, false)
}

async function recognizeBlob(blob: Blob, allowEmpty = false): Promise<ExtractedDocumentDto> {
  const engine = await getEngine()
  const [result] = await engine.predict(blob)
  if (!result) throw new Error('PP-OCRv5 returned no image result.')
  return mapPaddleOcrResult(result, allowEmpty)
}

export async function paddleOcrDocument(fileBytes: Uint8Array, mediaType: string): Promise<ExtractedDocumentDto> {
  if (!mediaType.startsWith('image/')) throw new Error(`PP-OCRv5 only accepts image input, received ${mediaType}.`)
  const blob = new Blob([Uint8Array.from(fileBytes).buffer], { type: mediaType })
  return recognizeBlob(blob)
}

export function combinePaddleOcrPdfDocuments(
  renderedPages: readonly PdfRenderedPageDto[],
  documents: readonly ExtractedDocumentDto[],
): ExtractedDocumentDto {
  if (renderedPages.length === 0 || renderedPages.length !== documents.length) throw new Error('PP-OCRv5 PDF page results are incomplete.')
  const regions = documents.flatMap((document, index) => (document.regions ?? []).map((region) => ({ ...region, pageNumber: index + 1 })))
  const pages = documents.map((document, index) => ({
    pageNumber: index + 1,
    widthPixels: renderedPages[index].widthPixels,
    heightPixels: renderedPages[index].heightPixels,
    confidenceBps: document.confidenceBps,
    issues: document.text ? [] : ['NO_TEXT'],
  }))
  const recognized = documents.filter((document) => document.text)
  if (recognized.length === 0) throw new Error('PP-OCRv5 did not recognize any text in the PDF.')
  const weight = recognized.reduce((sum, document) => sum + Math.max(1, [...document.text].length), 0)
  const confidence = Math.round(recognized.reduce((sum, document) => sum + document.confidenceBps * Math.max(1, [...document.text].length), 0) / weight)
  return {
    method: 'OCR',
    text: documents.map((document) => document.text).join('\n\f\n'),
    confidenceBps: confidence,
    issues: pages.some((page) => page.issues.includes('NO_TEXT')) ? ['PARTIAL_NO_TEXT'] : [],
    regions,
    pageCount: pages.length,
    pages,
  }
}

export async function paddleOcrRenderedPdfPages(renderedPages: readonly PdfRenderedPageDto[]): Promise<ExtractedDocumentDto> {
  const documents: ExtractedDocumentDto[] = []
  for (const page of renderedPages) {
    const response = await fetch(page.dataUrl)
    if (!response.ok) throw new Error(`Could not decode rendered PDF page ${page.pageNumber}.`)
    documents.push(await recognizeBlob(await response.blob(), true))
  }
  return combinePaddleOcrPdfDocuments(renderedPages, documents)
}

export function resetPaddleOcrForTesting(): void {
  enginePromise = null
}
