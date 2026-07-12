import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import type { DocumentEvidenceReadModel } from './documentEvidence'
import { DocumentEvidenceViewer } from './DocumentEvidenceViewer'
import { PdfPreviewAccessError } from './sourcePdfPagePreviewPlatform'

const evidence: DocumentEvidenceReadModel = {
  sourceRecordId: 'record-1', evidenceVersion: 2, method: 'OCR', text: 'スーパー\n牛乳 238', confidenceBps: 9100, issues: ['LOW_CONTRAST'],
  pages: [{ pageNumber: 1, regions: [{ pageNumber: 1, coordinateSpace: 'PIXELS', boundingBox: { left: 20, top: 30, width: 80, height: 14 }, text: '牛乳 238', confidenceBps: 9200, provenance: 'TESSERACT_WORD' }] }],
  receipt: { merchant: 'スーパー', occurredOn: '2026-07-12', totalAmountJpy: 238, items: [{ description: '牛乳', amountJpy: 238, quantity: 1, confidenceBps: 8000, provenance: { lineNumber: 2, regionIndexes: [0], method: 'TEXT_PATTERN' } }], taxes: [{ ratePercent: 8, taxAmountJpy: 17, taxableAmountJpy: null, confidenceBps: 8500, provenance: { lineNumber: 3, regionIndexes: [1], method: 'TEXT_PATTERN' } }], couponAmountJpy: 10, pointsUsedJpy: 20 },
}

describe('DocumentEvidenceViewer', () => {
  it('shows receipt details, adjustments and located provenance', () => {
    render(<DocumentEvidenceViewer evidence={evidence} filename="receipt.jpg" />)
    expect(screen.getByRole('heading', { name: 'receipt.jpg' })).toBeInTheDocument()
    expect(screen.getByText('牛乳')).toBeInTheDocument()
    expect(screen.getByText('消費税 8%')).toBeInTheDocument()
    expect(screen.getByText('クーポン・値引')).toBeInTheDocument()
    expect(screen.getByText('ポイント利用')).toBeInTheDocument()
    expect(screen.getByText('px: x 20, y 30, w 80, h 14')).toBeInTheDocument()
    expect(screen.getByText('TESSERACT_WORD')).toBeInTheDocument()
  })

  it('routes region selection with page and provenance', () => {
    const onSelectRegion = vi.fn()
    render(<DocumentEvidenceViewer evidence={evidence} onSelectRegion={onSelectRegion} />)
    fireEvent.click(screen.getByRole('button', { name: 'Page 1 region 1を表示' }))
    expect(onSelectRegion).toHaveBeenCalledWith(1, evidence.pages[0].regions[0], 0)
  })

  it('renders PDF pages behind evidence regions and keeps failures non-blocking', async () => {
    const pdfPageLoader = vi.fn().mockResolvedValue({
      src: 'data:image/png;base64,AA==', width: 1224, height: 1584,
      pageWidthPoints: 612, pageHeightPoints: 792, alt: 'statement.pdf Page 1',
    })
    render(<DocumentEvidenceViewer evidence={evidence} pdfPageLoader={pdfPageLoader} />)

    expect(screen.getByText('原本を描画中…')).toBeInTheDocument()
    await waitFor(() => expect(screen.getByAltText('statement.pdf Page 1')).toBeInTheDocument())
    expect(pdfPageLoader).toHaveBeenCalledWith(1)
    expect(screen.getByText('原本プレビュー')).toBeInTheDocument()
  })

  it('requests an ephemeral password and retries the protected PDF page', async () => {
    const pdfPageLoader = vi.fn().mockImplementation(async (_pageNumber: number, password?: string) => {
      if (password !== 'one-time-password') throw new PdfPreviewAccessError(password ? 'PASSWORD_INVALID' : 'PASSWORD_REQUIRED')
      return { src: 'data:image/png;base64,AA==', width: 600, height: 800, pageWidthPoints: 300, pageHeightPoints: 400, alt: 'protected page' }
    })
    render(<DocumentEvidenceViewer evidence={evidence} filename="protected.pdf" pdfPageLoader={pdfPageLoader} />)

    expect(await screen.findByText('このPDFはパスワードで保護されています')).toBeInTheDocument()
    fireEvent.change(screen.getByLabelText('PDFパスワード'), { target: { value: 'one-time-password' } })
    fireEvent.click(screen.getByRole('button', { name: 'ロックを解除' }))

    await waitFor(() => expect(screen.getByAltText('protected page')).toBeInTheDocument())
    expect(pdfPageLoader).toHaveBeenLastCalledWith(1, 'one-time-password')
    expect(screen.queryByLabelText('PDFパスワード')).not.toBeInTheDocument()
  })
})
