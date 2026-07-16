import { fireEvent, render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { DuplicateReviewGate } from '../../App'
import type { ImportPreviewDto } from '../../platform'

const preview: ImportPreviewDto = {
  summary: { runId: 'overlap', documentId: 'document', status: 'REVIEW_REQUIRED', recordCount: 1, candidateCount: 1, reusedExisting: false },
  source: { sourceType: 'MANUAL_UPLOAD', originalFilename: 'july-new.csv', mediaType: 'text/csv', byteSize: 42, sha256: 'a'.repeat(64), audienceVisibility: 'SHARED', audienceMemberId: null },
  duplicateSummary: { confirmedReplays: 0, likelyDuplicates: 1, possibleDuplicates: 0, unresolved: 1, overlapStart: '2026-07-01', overlapEnd: '2026-07-31' },
  candidates: [{
    id: 'candidate', accountId: 'bank', occurredOn: '2026-07-12', postedOn: null, amountJpy: 1000, direction: 'OUT', descriptionRaw: 'Store', merchantRaw: 'Store', externalTransactionId: null, externalSource: null, externalFactHash: null, calculationTarget: true, suggestedTransactionType: null, institutionRaw: null, categoryMajorRaw: null, categoryMinorRaw: null, memoRaw: null, extractionConfidenceBps: 9900, normalizationConfidenceBps: 9900, attributionKind: 'HOUSEHOLD', attributedMemberId: null, audienceVisibility: 'SHARED', audienceMemberId: null, reviewStatus: 'READY', evidenceCount: 1, evidenceRoles: ['PRIMARY'], issues: [], receiptReview: null,
    duplicateMatch: { confidence: 'LIKELY', matchedTransactionId: 'transaction', matchedCandidateId: null, occurredOn: '2026-07-12', amountJpy: 1000, payee: 'Store', description: null, sourceFilename: 'july-old.csv', reasons: ['SAME_ACCOUNT', 'SAME_AMOUNT', 'SAME_EFFECTIVE_DATE', 'SAME_NORMALIZED_TEXT'], decision: 'UNRESOLVED' },
  }],
}

describe('DuplicateReviewGate', () => {
  it('explains an overlap and requires one explicit row-level resolution', () => {
    const onResolution = vi.fn()
    render(<DuplicateReviewGate preview={preview} onResolution={onResolution} />)
    expect(screen.getByText('既存データとの重複期間: 2026-07-01 → 2026-07-31')).toBeInTheDocument()
    expect(screen.getByText(/同じ口座 \+ 同じ金額 \+ 同じ取引日 \+ 支払先・摘要が一致/)).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: '追加証憑として紐付け' }))
    expect(onResolution).toHaveBeenCalledWith('candidate', 'LINK')
  })
})
