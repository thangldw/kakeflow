import { invoke as tauriInvoke } from '@tauri-apps/api/core'

export interface SourceImagePreviewDto {
  readonly sourceDocumentId: string
  readonly filename: string
  readonly mediaType: 'image/png' | 'image/jpeg' | 'image/webp'
  readonly byteSize: number
  readonly dataUrl: string
}

export type SourcePreviewInvoke = (command: string, args?: Record<string, unknown>) => Promise<unknown>

export function createSourceImagePreviewPlatform(invoke: SourcePreviewInvoke = tauriInvoke) {
  return {
    get: async (householdId: string, sourceDocumentId: string): Promise<SourceImagePreviewDto> => parsePreview(await invoke('source_image_preview_get', { householdId, sourceDocumentId })),
  }
}

function parsePreview(value: unknown): SourceImagePreviewDto {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new TypeError('source preview')
  const item = value as Record<string, unknown>
  if (typeof item.sourceDocumentId !== 'string' || typeof item.filename !== 'string' || !['image/png', 'image/jpeg', 'image/webp'].includes(String(item.mediaType)) || !Number.isSafeInteger(item.byteSize) || Number(item.byteSize) < 0 || typeof item.dataUrl !== 'string' || !item.dataUrl.startsWith(`data:${item.mediaType};base64,`)) throw new TypeError('source preview')
  return item as unknown as SourceImagePreviewDto
}
