import { useMemo, useState } from 'react'

import type { ExtractedRegionDto } from '../../platform'
import './evidencePageOverlay.css'
import { localize } from '../../i18n'

export interface EvidencePageImage {
  readonly src: string
  readonly width: number
  readonly height: number
  readonly pageWidthPoints?: number
  readonly pageHeightPoints?: number
  readonly alt: string
}

export interface EvidencePageOverlayProps {
  readonly pageNumber: number
  readonly regions: readonly ExtractedRegionDto[]
  readonly image?: EvidencePageImage
  readonly widthPixels?: number | null
  readonly heightPixels?: number | null
  readonly selectedRegionIndexes?: readonly number[]
  readonly onSelectRegion?: (region: ExtractedRegionDto, index: number) => void
}

export function EvidencePageOverlay({ pageNumber, regions, image, widthPixels, heightPixels, selectedRegionIndexes = [], onSelectRegion }: EvidencePageOverlayProps) {
  const [zoom, setZoom] = useState(1)
  const located = regions.map((region, index) => ({ region, index })).filter(({ region }) => region.boundingBox && region.coordinateSpace !== 'UNLOCATED')
  const inferred = useMemo(() => ({
    width: Math.max(1, ...located.map(({ region }) => (region.boundingBox?.left ?? 0) + (region.boundingBox?.width ?? 0))),
    height: Math.max(1, ...located.map(({ region }) => (region.boundingBox?.top ?? 0) + (region.boundingBox?.height ?? 0))),
  }), [located])
  const storedDimensions = widthPixels != null && heightPixels != null ? { width: widthPixels, height: heightPixels } : null
  const width = image?.width ?? storedDimensions?.width ?? inferred.width
  const height = image?.height ?? storedDimensions?.height ?? inferred.height
  if (located.length === 0 && !image) return <p className="evidence-overlay-empty">{localize("ページ")} {pageNumber} {localize("には表示できる座標がありません。")}</p>

  return <section className="evidence-overlay" aria-label={localize(`ページ ${pageNumber} の証跡領域`)}>
    <header><span>{image ? localize("原本プレビュー") : localize("抽出座標プレビュー")}</span><div><button type="button" aria-label={localize("縮小")} disabled={zoom <= .75} onClick={() => setZoom((value) => Math.max(.75, value - .25))}>−</button><output aria-label={localize("ズーム率")}>{Math.round(zoom * 100)}%</output><button type="button" aria-label={localize("拡大")} disabled={zoom >= 2.25} onClick={() => setZoom((value) => Math.min(2.25, value + .25))}>＋</button><button type="button" onClick={() => setZoom(1)}>{localize("全体表示")}</button></div></header>
    <div className="evidence-overlay-scroll"><div className={`evidence-overlay-canvas${image ? '' : ' evidence-overlay-canvas--synthetic'}`} style={{ aspectRatio: `${width} / ${height}`, width: `${zoom * 100}%` }}>
      {image && <img src={image.src} alt={image.alt} width={image.width} height={image.height} />}
      {located.map(({ region, index }) => {
        const box = region.boundingBox!
        const selected = selectedRegionIndexes.includes(index)
        const coordinateWidth = region.coordinateSpace === 'PDF_POINTS' ? image?.pageWidthPoints ?? width : width
        const coordinateHeight = region.coordinateSpace === 'PDF_POINTS' ? image?.pageHeightPoints ?? height : height
        return <button type="button" key={`${region.provenance}-${index}`} className={selected ? 'selected' : ''} style={{ left: `${box.left / coordinateWidth * 100}%`, top: `${box.top / coordinateHeight * 100}%`, width: `${Math.max(box.width / coordinateWidth * 100, 1)}%`, height: `${Math.max(box.height / coordinateHeight * 100, 1)}%` }} aria-label={localize(`領域 ${index + 1}: ${region.text || localize("空")}`)} aria-pressed={selected} title={region.text} onClick={() => onSelectRegion?.(region, index)}><span>{index + 1}</span></button>
      })}
    </div></div>
    {located.length === 0 && <p className="evidence-overlay-empty">{localize("原本ページに重ねて表示できるOCR領域はありません。")}</p>}
  </section>
}
