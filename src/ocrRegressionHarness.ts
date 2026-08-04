import { OCR_REGRESSION_CASES } from './features/import/ocrRegressionCases'
import { paddleOcrDocument } from './features/import/paddleOcr'
import { parseReceiptText } from './features/import/receiptText'

const output = document.querySelector<HTMLElement>('#results')!
const summary = document.querySelector<HTMLElement>('#summary')!

function sameNumbers(actual: readonly number[], expected: readonly number[]): boolean {
  return expected.every((value) => actual.includes(value))
}

let passed = 0
for (const testCase of OCR_REGRESSION_CASES) {
  const card = document.createElement('article')
  card.innerHTML = `<img alt="" src="${testCase.imageUrl}"><div><h2>${testCase.id}</h2><p>Running PP-OCRv5…</p><pre></pre></div>`
  output.append(card)
  const status = card.querySelector('p')!
  const details = card.querySelector('pre')!
  try {
    const response = await fetch(testCase.imageUrl)
    const result = await paddleOcrDocument(new Uint8Array(await response.arrayBuffer()), response.headers.get('content-type') ?? 'image/png')
    const parsed = parseReceiptText(result.text)
    const checks = {
      date: parsed.occurredOn === testCase.expected.occurredOn,
      total: parsed.amountJpy === testCase.expected.amountJpy,
      items: sameNumbers(parsed.items.map((item) => item.amountJpy), testCase.expected.itemAmountsJpy),
      tax: parsed.taxes.some((tax) => tax.taxAmountJpy === testCase.expected.taxAmountJpy),
      confidence: result.confidenceBps >= testCase.expected.minimumConfidenceBps,
    }
    const ok = Object.values(checks).every(Boolean)
    if (ok) passed += 1
    card.dataset.result = ok ? 'passed' : 'failed'
    status.textContent = ok ? `Passed · ${result.confidenceBps} bps` : 'Failed'
    details.textContent = JSON.stringify({ checks, parsed: { occurredOn: parsed.occurredOn, amountJpy: parsed.amountJpy, items: parsed.items.map((item) => item.amountJpy), taxes: parsed.taxes }, text: result.text }, null, 2)
  } catch (error) {
    card.dataset.result = 'failed'
    status.textContent = 'Failed'
    details.textContent = error instanceof Error ? error.message : String(error)
  }
}

const complete = passed === OCR_REGRESSION_CASES.length
document.body.dataset.result = complete ? 'passed' : 'failed'
summary.textContent = `${passed}/${OCR_REGRESSION_CASES.length} PP-OCRv5 regression cases passed`
