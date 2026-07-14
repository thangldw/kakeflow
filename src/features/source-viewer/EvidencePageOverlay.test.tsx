import { fireEvent, render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'

import { EvidencePageOverlay } from './EvidencePageOverlay'

const regions = [{ pageNumber: 1, text: '合計 1,480', confidenceBps: 9200, coordinateSpace: 'PIXELS' as const, boundingBox: { left: 100, top: 200, width: 300, height: 40 }, provenance: 'OCR_WORD' }]

describe('EvidencePageOverlay', () => {
  it('renders positioned accessible regions and routes selection', () => {
    const select = vi.fn()
    render(<EvidencePageOverlay pageNumber={1} regions={regions} image={{ src: 'data:image/png;base64,AA==', width: 1000, height: 1500, alt: 'receipt' }} onSelectRegion={select} />)
    const region = screen.getByRole('button', { name: /Region 1/ })
    expect(region).toHaveStyle({ left: '10%', top: `${200 / 1500 * 100}%`, width: '30%' })
    fireEvent.click(region)
    expect(select).toHaveBeenCalledWith(regions[0], 0)
  })

  it('supports zoom controls and coordinate-only fallback', () => {
    render(<EvidencePageOverlay pageNumber={1} regions={regions} />)
    expect(screen.getByText('抽出座標プレビュー')).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: '拡大' }))
    expect(screen.getByRole('status', { name: 'ズーム率' })).toHaveTextContent('125%')
  })

  it('uses persisted page dimensions when the original preview is unavailable', () => {
    render(<EvidencePageOverlay pageNumber={1} regions={regions} widthPixels={1000} heightPixels={2000} />)

    expect(screen.getByRole('button', { name: /Region 1/ })).toHaveStyle({
      left: '10%',
      top: '10%',
      width: '30%',
      height: '2%',
    })
  })

  it('maps PDF-point boxes against page points instead of rendered pixels', () => {
    const pdfRegions = [{ ...regions[0], coordinateSpace: 'PDF_POINTS' as const, boundingBox: { left: 306, top: 396, width: 61, height: 79 } }]
    render(<EvidencePageOverlay pageNumber={1} regions={pdfRegions} image={{ src: 'data:image/png;base64,AA==', width: 1224, height: 1584, pageWidthPoints: 612, pageHeightPoints: 792, alt: 'statement' }} />)

    expect(screen.getByRole('button', { name: /Region 1/ })).toHaveStyle({ left: '50%', top: '50%' })
  })
})
