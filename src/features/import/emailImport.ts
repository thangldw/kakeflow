import type { ParsedImport } from '../../ingestion'

const MAX_ATTACHMENTS = 20
const MAX_ATTACHMENT_BYTES = 10 * 1024 * 1024
const MAX_TOTAL_ATTACHMENT_BYTES = 25 * 1024 * 1024
const MAX_FILENAME_LENGTH = 255
const SUPPORTED_TABULAR_ATTACHMENT = /\.(?:csv|tsv|xlsx)$/i

export class EmailImportError extends Error {
  constructor(readonly code: string, message: string) { super(message); this.name = 'EmailImportError' }
}

export interface EmailTabularAttachment {
  readonly name: string
  readonly mediaType: string
  readonly bytes: Uint8Array
}

function fail(code: string, message: string): never {
  throw new EmailImportError(code, message)
}

function attachmentBytes(content: ArrayBuffer | Uint8Array | string): Uint8Array {
  if (typeof content === 'string') return new TextEncoder().encode(content)
  return content instanceof Uint8Array ? content : new Uint8Array(content)
}

function safeFilename(value: string | null): string | null {
  if (!value) return null
  const name = value.normalize('NFKC').trim()
  if (!name || name.length > MAX_FILENAME_LENGTH || Array.from(name).some((character) => character.codePointAt(0)! <= 31 || character.codePointAt(0) === 127)) return null
  return name
}

/**
 * Parse one immutable RFC 5322 message and return exactly one importable
 * tabular attachment. Multiple candidates are intentionally not auto-selected.
 */
export async function extractSingleEmailTabularAttachment(bytes: Uint8Array): Promise<EmailTabularAttachment> {
  let parsed
  try {
    const { default: PostalMime } = await import('postal-mime')
    // Copy across WebView/test realms so the parser always receives an
    // ArrayBuffer owned by the current JavaScript realm.
    const normalizedBytes = new Uint8Array(bytes.byteLength)
    normalizedBytes.set(bytes)
    parsed = await PostalMime.parse(normalizedBytes.buffer, {
      attachmentEncoding: 'arraybuffer',
      maxHeadersSize: 128 * 1024,
      maxNestingDepth: 3,
      rfc822Attachments: false,
    })
  } catch {
    return fail('EMAIL_PARSE_FAILED', 'RFC 5322 / MIMEメールを安全に解析できませんでした。')
  }
  if (parsed.attachments.length > MAX_ATTACHMENTS) fail('EMAIL_TOO_MANY_ATTACHMENTS', `メールの添付ファイルは${MAX_ATTACHMENTS}件以下にしてください。`)

  const names = new Set<string>()
  let totalBytes = 0
  const candidates: EmailTabularAttachment[] = []
  for (const attachment of parsed.attachments) {
    const content = attachmentBytes(attachment.content)
    if (content.byteLength > MAX_ATTACHMENT_BYTES) fail('EMAIL_ATTACHMENT_TOO_LARGE', '添付ファイルは1件10MB以下にしてください。')
    totalBytes += content.byteLength
    if (totalBytes > MAX_TOTAL_ATTACHMENT_BYTES) fail('EMAIL_ATTACHMENTS_TOO_LARGE', '展開後の添付ファイル合計は25MB以下にしてください。')
    if (attachment.disposition === 'inline') continue
    const name = safeFilename(attachment.filename)
    if (!name) fail('EMAIL_ATTACHMENT_NAME_INVALID', '添付ファイル名がないか、安全に表示できません。')
    const normalizedName = name.toLocaleLowerCase('en-US')
    if (names.has(normalizedName)) fail('EMAIL_ATTACHMENT_NAME_DUPLICATE', `正規化後に重複する添付ファイル名があります: ${name}`)
    names.add(normalizedName)
    if (SUPPORTED_TABULAR_ATTACHMENT.test(name)) {
      candidates.push({ name, mediaType: attachment.mimeType || 'application/octet-stream', bytes: content })
    }
  }
  if (candidates.length === 0) fail('EMAIL_NO_SUPPORTED_ATTACHMENT', '取込可能なCSV / TSV / XLSX添付ファイルがありません。')
  if (candidates.length > 1) fail('EMAIL_MULTIPLE_SUPPORTED_ATTACHMENTS', '取込可能な添付ファイルが複数あります。誤った口座への自動選択を避けるため、個別に保存して取り込んでください。')
  return candidates[0]
}

function qualifyValue(value: unknown, sourcePart: string): unknown {
  if (Array.isArray(value)) return value.map((item) => qualifyValue(item, sourcePart))
  if (typeof value !== 'object' || value === null) return value
  const record = value as Record<string, unknown>
  const qualified = Object.fromEntries(Object.entries(record).map(([key, item]) => [key, qualifyValue(item, sourcePart)]))
  if (Number.isSafeInteger(record.sourceRow) && Number.isSafeInteger(record.sourceRowEnd) && Array.isArray(record.rawFields)) {
    qualified.sourcePart = sourcePart
  }
  return qualified
}

export function qualifyEmailParsedImport(parsed: ParsedImport<unknown>, sourcePart: string): ParsedImport<unknown> {
  return {
    ...parsed,
    records: qualifyValue(parsed.records, sourcePart) as readonly unknown[],
    metadata: { ...parsed.metadata, container: 'RFC5322_EMAIL', attachmentName: sourcePart },
  }
}
