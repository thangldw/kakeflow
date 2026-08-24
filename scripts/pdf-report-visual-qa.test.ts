import { describe, expect, it } from 'vitest'

import {
  parsePdfInfo,
  pdfQaExecutionPolicy,
  pngDimensions,
  validatePdfInfo,
} from './pdf-report-visual-qa.mjs'

describe('PDF report visual QA', () => {
  it('fails closed when CI requires Poppler', () => {
    expect(pdfQaExecutionPolicy(true, false)).toBe('run')
    expect(pdfQaExecutionPolicy(false, false)).toBe('skip')
    expect(pdfQaExecutionPolicy(false, true)).toBe('fail')
  })

  it('parses and bounds the structural evidence from pdfinfo', () => {
    const info = parsePdfInfo('Title: KakeFlow report\nPages: 3\nEncrypted: no\nPage size: 595.28 x 841.89 pts (A4)\nPDF version: 1.7\nCreator: KakeFlow\n    Title: ISO PDF subtype\n')
    expect(validatePdfInfo(info)).toMatchObject({
      pages: 3,
      encrypted: 'no',
      pageWidthPoints: 595.28,
      pageHeightPoints: 841.89,
      pdfVersion: '1.7',
      creator: 'KakeFlow',
      title: 'KakeFlow report',
    })
    expect(() => validatePdfInfo({ ...info, pages: 0 })).toThrow(/page count/)
    expect(() => validatePdfInfo({ ...info, encrypted: 'yes' })).toThrow(/must not be encrypted/)
    expect(() => validatePdfInfo({ ...info, pageWidthPoints: Number.NaN })).toThrow(/page width/)
  })

  it('reads PNG dimensions from the immutable header', () => {
    const bytes = Buffer.alloc(24)
    Buffer.from('89504e470d0a1a0a', 'hex').copy(bytes)
    bytes.writeUInt32BE(1200, 16)
    bytes.writeUInt32BE(1680, 20)
    expect(pngDimensions(bytes)).toEqual({ width: 1200, height: 1680 })
    expect(() => pngDimensions(Buffer.from('not a png'))).toThrow(/valid PNG/)
  })

})
