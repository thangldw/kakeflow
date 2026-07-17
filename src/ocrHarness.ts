import { paddleOcrDocument } from './features/import/paddleOcr'
import { parseReceiptText } from './features/import/receiptText'

const status = document.querySelector<HTMLElement>('#status')!
const output = document.querySelector<HTMLElement>('#result')!
const source = new URLSearchParams(globalThis.location.search).get('source')

if (!source) {
  status.textContent = 'Missing ?source= image URL.'
} else {
  try {
    const startedAt = performance.now()
    status.textContent = 'Running PP-OCRv5 locally…'
    const response = await fetch(source)
    if (!response.ok) throw new Error(`Image request failed: HTTP ${response.status}`)
    const contentType = response.headers.get('content-type') ?? 'image/jpeg'
    const document = await paddleOcrDocument(new Uint8Array(await response.arrayBuffer()), contentType)
    const parsed = parseReceiptText(document.text)
    output.textContent = JSON.stringify({
      elapsedMs: Math.round(performance.now() - startedAt),
      confidenceBps: document.confidenceBps,
      parsed,
      text: document.text,
    }, null, 2)
    status.textContent = 'Completed'
  } catch (error) {
    status.textContent = 'Failed'
    output.textContent = error instanceof Error ? `${error.name}: ${error.message}\n${error.stack ?? ''}` : String(error)
  }
}
