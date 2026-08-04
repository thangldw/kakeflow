import { readFile } from 'node:fs/promises'
import path from 'node:path'

import { describe, expect, it } from 'vitest'

import { OCR_REGRESSION_CASES } from './ocrRegressionCases'
import { parseReceiptText } from './receiptText'

describe('synthetic PP-OCRv5 receipt regression corpus', () => {
  for (const testCase of OCR_REGRESSION_CASES) {
    it(`preserves parsed fields for ${testCase.id}`, async () => {
      const fixture = await readFile(path.resolve('src/features/import/fixtures/ocr', testCase.fixtureFilename))
      expect(fixture.byteLength).toBeGreaterThan(10_000)

      const parsed = parseReceiptText(testCase.observedText)
      expect(parsed).toMatchObject({ occurredOn: testCase.expected.occurredOn, amountJpy: testCase.expected.amountJpy, issues: [] })
      expect(parsed.items.map((item) => item.amountJpy)).toEqual(expect.arrayContaining([...testCase.expected.itemAmountsJpy]))
      expect(parsed.taxes.some((tax) => tax.taxAmountJpy === testCase.expected.taxAmountJpy)).toBe(true)
    })
  }
})
