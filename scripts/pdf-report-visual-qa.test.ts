import { execFileSync } from 'node:child_process'
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'

import { describe, expect, it } from 'vitest'

import {
  parsePdfInfo,
  pngDimensions,
  runPdfReportVisualQa,
  validatePdfInfo,
} from './pdf-report-visual-qa.mjs'

function hasPoppler() {
  try {
    execFileSync('pdfinfo', ['-v'], { stdio: 'ignore' })
    execFileSync('pdftoppm', ['-v'], { stdio: 'ignore' })
    return true
  } catch {
    return false
  }
}

function minimalPdf() {
  const objects = [
    '<< /Type /Catalog /Pages 2 0 R >>',
    '<< /Type /Pages /Kids [3 0 R] /Count 1 >>',
    '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 595 842] /Resources << /Font << /F1 5 0 R >> >> /Contents 4 0 R >>',
    '<< /Length 51 >>\nstream\nBT /F1 18 Tf 72 770 Td (KakeFlow PDF QA) Tj ET\nendstream',
    '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>',
  ]
  let output = '%PDF-1.4\n'
  const offsets = [0]
  objects.forEach((object, index) => {
    offsets.push(Buffer.byteLength(output, 'ascii'))
    output += `${index + 1} 0 obj\n${object}\nendobj\n`
  })
  const xref = Buffer.byteLength(output, 'ascii')
  output += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`
  output += offsets.slice(1).map((offset) => `${String(offset).padStart(10, '0')} 00000 n \n`).join('')
  output += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`
  return Buffer.from(output, 'ascii')
}

describe('PDF report visual QA', () => {
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

  it.skipIf(!hasPoppler())('renders a deterministic fixture and writes machine plus human review evidence', async () => {
    const temporaryRoot = await mkdtemp(path.join(os.tmpdir(), 'kakeflow-pdf-qa-test-'))
    const fixture = path.join(temporaryRoot, 'fixture.pdf')
    const output = path.join(temporaryRoot, 'qa')
    try {
      await writeFile(fixture, minimalPdf())
      const result = await runPdfReportVisualQa({
        reports: { monthly: fixture, annual: fixture, 'investment-performance': fixture },
        outputDirectory: output,
      })
      expect(result).toMatchObject({ status: 'automated-pass', visualReview: 'required' })
      expect(result.reportTypes).toEqual(['monthly', 'annual', 'investment-performance'])
      expect(result.reports).toEqual([
        expect.objectContaining({ pages: 1, type: 'monthly' }),
        expect.objectContaining({ pages: 1, type: 'annual' }),
        expect.objectContaining({ pages: 1, type: 'investment-performance' }),
      ])
      const manifest = JSON.parse(await readFile(path.join(output, 'manifest.json'), 'utf8'))
      expect(manifest.reports[0].render.pages[0]).toMatchObject({ page: 1, width: 1190, height: 1684 })
      const checklist = await readFile(path.join(output, 'VISUAL_REVIEW.md'), 'utf8')
      expect(checklist).toContain('- [ ] `monthly/page-0001.png`')
      expect(checklist).toContain('- [ ] `annual/page-0001.png`')
      expect(checklist).toContain('- [ ] `investment-performance/page-0001.png`')
      expect(checklist).toContain('annual chart keeps January-December order')
      expect(checklist).toContain('Partial-coverage months are distinguishable')
      expect(checklist).toContain('separated and visibly labeled by native currency')
      expect(checklist).toContain('No consolidated return, ROI, TWR, IRR')
      expect(checklist).toContain('remain visible as exceptions')
      expect(checklist).toContain('unavailable lineage stays explicitly unavailable')
      await expect(runPdfReportVisualQa({
        reports: { monthly: fixture, annual: fixture },
        outputDirectory: path.join(temporaryRoot, 'wrong-release-scope'),
      })).rejects.toThrow(/Expected PDF report types annual, investment-performance, monthly/)
    } finally {
      await rm(temporaryRoot, { recursive: true, force: true })
    }
  }, 20_000)
})
