import { describe, expect, it } from 'vitest'
import {
  approveCandidate,
  assignCandidateAccount,
  bulkApproveSelected,
  canTransitionImport,
  correctCandidateCategory,
  countImportIssues,
  createImportState,
  deriveInboxSummary,
  excludeCandidate,
  isRollbackEligible,
  mergeDuplicateCandidate,
  selectPreviewCandidates,
  setCandidateSelected,
  setReceiptCardMatch,
  transitionImportRun,
  type ImportCandidate,
  type ImportReviewState,
} from './importState'

const candidate = (id: string, overrides: Partial<ImportCandidate> = {}): ImportCandidate => ({
  id,
  previewId: 'preview-1',
  accountId: null,
  categoryId: null,
  decision: 'pending',
  mergedIntoId: null,
  receiptCardMatched: false,
  selected: false,
  issues: [],
  ...overrides,
})

function state(candidates: readonly ImportCandidate[] = [candidate('candidate-1')]): ImportReviewState {
  return createImportState({
    runs: [{ id: 'run-1', status: 'detected', previewIds: ['preview-1'] }],
    previews: [{
      id: 'preview-1', runId: 'run-1', filename: 'bank.csv', status: 'detected',
      candidateIds: candidates.map((item) => item.id), issues: [],
    }],
    candidates,
  })
}

describe('import state validation', () => {
  it('rejects duplicate entity and reference IDs', () => {
    expect(() => createImportState({
      runs: [
        { id: 'same', status: 'detected', previewIds: [] },
        { id: 'same', status: 'detected', previewIds: [] },
      ],
      previews: [], candidates: [],
    })).toThrow('Duplicate run ID: same')

    expect(() => createImportState({
      runs: [{ id: 'run', status: 'detected', previewIds: ['p', 'p'] }],
      previews: [{ id: 'p', runId: 'run', filename: 'x', status: 'detected', candidateIds: [], issues: [] }],
      candidates: [],
    })).toThrow('Duplicate run run preview ID')
  })

  it('rejects dangling and inconsistent references', () => {
    expect(() => createImportState({
      runs: [{ id: 'run', status: 'detected', previewIds: ['missing'] }],
      previews: [], candidates: [],
    })).toThrow('unknown preview')

    expect(() => createImportState({
      runs: [{ id: 'run', status: 'detected', previewIds: [] }],
      previews: [{ id: 'p', runId: 'run', filename: 'x', status: 'detected', candidateIds: [], issues: [] }],
      candidates: [],
    })).toThrow('is not included')
  })

  it('copies nested arrays so later input mutation cannot change state', () => {
    const ids = ['candidate-1']
    const input: ImportReviewState = {
      runs: [{ id: 'run-1', status: 'detected', previewIds: ['preview-1'] }],
      previews: [{ id: 'preview-1', runId: 'run-1', filename: 'x', status: 'detected', candidateIds: ids, issues: [] }],
      candidates: [candidate('candidate-1')],
    }
    const result = createImportState(input)
    ids.push('unexpected')
    expect(result.previews[0].candidateIds).toEqual(['candidate-1'])
  })
})

describe('import status machine', () => {
  it('allows the normal lifecycle and mirrors status to run previews', () => {
    let current = state()
    for (const status of ['parsing', 'review', 'ready', 'committing', 'posted'] as const) {
      current = transitionImportRun(current, 'run-1', status)
      expect(current.runs[0].status).toBe(status)
      expect(current.previews[0].status).toBe(status)
    }
    expect(() => transitionImportRun(current, 'run-1', 'rolled_back')).toThrow('Invalid import transition')
  })

  it('rejects invalid transitions, unknown runs, and failures without a reason', () => {
    expect(canTransitionImport('detected', 'posted')).toBe(false)
    expect(() => transitionImportRun(state(), 'run-1', 'posted')).toThrow('Invalid import transition')
    expect(() => transitionImportRun(state(), 'missing', 'parsing')).toThrow('Unknown import run')
    expect(() => transitionImportRun(state(), 'run-1', 'failed')).toThrow('requires a failure reason')
  })

  it('supports failed parsing retries and records a normalized reason', () => {
    const failed = transitionImportRun(state(), 'run-1', 'failed', '  invalid CSV  ')
    expect(failed.runs[0].failureReason).toBe('invalid CSV')
    const retried = transitionImportRun(failed, 'run-1', 'parsing')
    expect(retried.runs[0]).not.toHaveProperty('failureReason')
  })

  it('only allows rollback for stable unposted staging states', () => {
    expect(isRollbackEligible(state().runs[0])).toBe(false)
    const parsing = transitionImportRun(state(), 'run-1', 'parsing')
    expect(isRollbackEligible(parsing.runs[0])).toBe(false)
    const review = transitionImportRun(parsing, 'run-1', 'review')
    expect(isRollbackEligible(review.runs[0])).toBe(true)
    expect(transitionImportRun(review, 'run-1', 'rolled_back').runs[0].status).toBe('rolled_back')

    const ready = transitionImportRun(parsing, 'run-1', 'ready')
    expect(isRollbackEligible(ready.runs[0])).toBe(true)
    const committing = transitionImportRun(ready, 'run-1', 'committing')
    expect(isRollbackEligible(committing.runs[0])).toBe(false)
    const posted = transitionImportRun(committing, 'run-1', 'posted')
    expect(isRollbackEligible(posted.runs[0])).toBe(false)
    expect(() => transitionImportRun(posted, 'run-1', 'rolled_back')).toThrow('Invalid import transition')

    const failed = transitionImportRun(state(), 'run-1', 'failed', 'parse failed')
    expect(isRollbackEligible(failed.runs[0])).toBe(true)
    expect(transitionImportRun(failed, 'run-1', 'rolled_back').runs[0].status).toBe('rolled_back')
  })
})

describe('candidate review operations', () => {
  it('assigns accounts, corrects categories, and marks receipt/card matches immutably', () => {
    const initial = state()
    const withAccount = assignCandidateAccount(initial, 'candidate-1', 'bank-1')
    const categorized = correctCandidateCategory(withAccount, 'candidate-1', 'food')
    const matched = setReceiptCardMatch(categorized, 'candidate-1', true)

    expect(initial.candidates[0]).toMatchObject({ accountId: null, categoryId: null, receiptCardMatched: false })
    expect(matched.candidates[0]).toMatchObject({ accountId: 'bank-1', categoryId: 'food', receiptCardMatched: true })
  })

  it('merges a duplicate into an active target and excludes it from selection', () => {
    const initial = setCandidateSelected(state([candidate('a'), candidate('b')]), 'b', true)
    const merged = mergeDuplicateCandidate(initial, 'b', 'a')
    expect(merged.candidates[1]).toMatchObject({ decision: 'merged', mergedIntoId: 'a', selected: false })
    expect(initial.candidates[1]).toMatchObject({ decision: 'pending', mergedIntoId: null, selected: true })
  })

  it('rejects self/cross-preview/inactive merges and protects merge targets', () => {
    const initial = state([candidate('a'), candidate('b')])
    expect(() => mergeDuplicateCandidate(initial, 'a', 'a')).toThrow('itself')
    expect(() => mergeDuplicateCandidate(excludeCandidate(initial, 'b'), 'a', 'b')).toThrow('cannot be edited')

    const merged = mergeDuplicateCandidate(initial, 'b', 'a')
    expect(() => excludeCandidate(merged, 'a')).toThrow('merge target')
  })

  it('excludes candidates and prevents further editing', () => {
    const excluded = excludeCandidate(state(), 'candidate-1')
    expect(excluded.candidates[0]).toMatchObject({ decision: 'excluded', selected: false })
    expect(() => assignCandidateAccount(excluded, 'candidate-1', 'bank')).toThrow('cannot be edited')
  })

  it('selects all active candidates within one preview', () => {
    let current = state([candidate('a'), candidate('b'), candidate('c')])
    current = excludeCandidate(current, 'c')
    current = mergeDuplicateCandidate(current, 'b', 'a')
    const selected = selectPreviewCandidates(current, 'preview-1', true)
    expect(selected.candidates.map((item) => item.selected)).toEqual([true, false, false])
  })

  it('approves only candidates with an account and no error issues', () => {
    expect(() => approveCandidate(state(), 'candidate-1')).toThrow('requires an account')
    const errored = state([candidate('candidate-1', {
      accountId: 'bank', issues: [{ code: 'BAD_DATE', severity: 'error', message: 'Bad date' }],
    })])
    expect(() => approveCandidate(errored, 'candidate-1')).toThrow('unresolved errors')

    const approved = approveCandidate(
      assignCandidateAccount(state(), 'candidate-1', 'bank'),
      'candidate-1',
    )
    expect(approved.candidates[0]).toMatchObject({ decision: 'approved', selected: false })
  })

  it('bulk approval is atomic when any selected candidate is invalid', () => {
    let initial = state([
      candidate('a', { accountId: 'bank', selected: true }),
      candidate('b', { selected: true }),
    ])
    expect(() => bulkApproveSelected(initial)).toThrow('Candidate b requires an account')
    expect(initial.candidates.map((item) => item.decision)).toEqual(['pending', 'pending'])

    initial = assignCandidateAccount(initial, 'b', 'card')
    const approved = bulkApproveSelected(initial)
    expect(approved.candidates.map((item) => item.decision)).toEqual(['approved', 'approved'])
    expect(approved.candidates.every((item) => !item.selected)).toBe(true)
    expect(() => bulkApproveSelected(approved)).toThrow('No candidates are selected')
  })
})

describe('derived inbox information', () => {
  it('counts issues from previews and candidates', () => {
    const initial = createImportState({
      runs: [{ id: 'run-1', status: 'review', previewIds: ['preview-1'] }],
      previews: [{
        id: 'preview-1', runId: 'run-1', filename: 'x', status: 'review', candidateIds: ['a'],
        issues: [{ code: 'HEADER', severity: 'warning', message: 'Header inferred' }],
      }],
      candidates: [candidate('a', {
        issues: [{ code: 'DATE', severity: 'error', message: 'Date invalid' }],
      })],
    })
    expect(countImportIssues(initial)).toEqual({ errors: 1, warnings: 1, total: 2 })
  })

  it('derives a complete deterministic Inbox summary', () => {
    let current = state([
      candidate('a', { accountId: 'bank', selected: true, receiptCardMatched: true }),
      candidate('b'),
      candidate('c'),
      candidate('d', { accountId: 'card' }),
    ])
    current = approveCandidate(current, 'd')
    current = mergeDuplicateCandidate(current, 'b', 'a')
    current = excludeCandidate(current, 'c')
    const summary = deriveInboxSummary(current)

    expect(summary).toMatchObject({
      runs: 1, files: 1, candidates: 4,
      pending: 1, approved: 1, excluded: 1, merged: 1, selected: 1,
      possibleDuplicates: 1, receiptCardMatches: 1,
      reviewRequired: 1, readyToPost: 1,
      errors: 0, warnings: 0, total: 0,
      failedRuns: 0, postedRuns: 0,
    })
    expect(deriveInboxSummary(current)).toEqual(summary)
  })
})
