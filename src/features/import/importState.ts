/**
 * Framework-independent state and operations for the import review workflow.
 *
 * The functions in this module never mutate their arguments. Persistence and UI
 * concerns intentionally live elsewhere so the same rules can be used by the
 * desktop shell, tests, and a future sync service.
 */

export type ImportStatus =
  | 'detected'
  | 'parsing'
  | 'review'
  | 'ready'
  | 'committing'
  | 'posted'
  | 'failed'
  | 'rolled_back'

export type ImportIssueSeverity = 'warning' | 'error'

export interface ImportIssue {
  readonly code: string
  readonly severity: ImportIssueSeverity
  readonly message: string
}

export type CandidateDecision = 'pending' | 'approved' | 'excluded' | 'merged'

export interface ImportCandidate {
  readonly id: string
  readonly previewId: string
  readonly accountId: string | null
  readonly categoryId: string | null
  readonly decision: CandidateDecision
  readonly mergedIntoId: string | null
  readonly receiptCardMatched: boolean
  readonly selected: boolean
  readonly issues: readonly ImportIssue[]
}

export interface ImportPreview {
  readonly id: string
  readonly runId: string
  readonly filename: string
  readonly status: ImportStatus
  readonly candidateIds: readonly string[]
  readonly issues: readonly ImportIssue[]
}

export interface ImportRun {
  readonly id: string
  readonly status: ImportStatus
  readonly previewIds: readonly string[]
  readonly failureReason?: string
}

export interface ImportReviewState {
  readonly runs: readonly ImportRun[]
  readonly previews: readonly ImportPreview[]
  readonly candidates: readonly ImportCandidate[]
}

export interface IssueCounts {
  readonly errors: number
  readonly warnings: number
  readonly total: number
}

export interface InboxSummary extends IssueCounts {
  readonly runs: number
  readonly files: number
  readonly candidates: number
  readonly pending: number
  readonly approved: number
  readonly excluded: number
  readonly merged: number
  readonly selected: number
  readonly possibleDuplicates: number
  readonly receiptCardMatches: number
  readonly reviewRequired: number
  readonly readyToPost: number
  readonly failedRuns: number
  readonly postedRuns: number
}

export const EMPTY_IMPORT_STATE: ImportReviewState = Object.freeze({
  runs: Object.freeze([]),
  previews: Object.freeze([]),
  candidates: Object.freeze([]),
})

export const ALLOWED_IMPORT_TRANSITIONS: Readonly<Record<ImportStatus, readonly ImportStatus[]>> =
  Object.freeze({
    detected: Object.freeze(['parsing', 'failed']),
    parsing: Object.freeze(['review', 'ready', 'failed']),
    review: Object.freeze(['ready', 'failed', 'rolled_back']),
    ready: Object.freeze(['review', 'committing', 'failed', 'rolled_back']),
    committing: Object.freeze(['posted', 'failed']),
    // Posted data already has ledger transactions. Undoing it requires a
    // dedicated reversal workflow; deleting the staging import is not safe.
    posted: Object.freeze([]),
    failed: Object.freeze(['parsing', 'rolled_back']),
    rolled_back: Object.freeze([]),
  })

function assertNonEmptyId(id: string, label: string): void {
  if (id.trim().length === 0) throw new Error(`${label} ID must not be empty`)
}

function assertUniqueIds(items: readonly { readonly id: string }[], label: string): void {
  const ids = new Set<string>()
  for (const item of items) {
    assertNonEmptyId(item.id, label)
    if (ids.has(item.id)) throw new Error(`Duplicate ${label} ID: ${item.id}`)
    ids.add(item.id)
  }
}

/** Creates validated state from imported data without retaining mutable arrays. */
export function createImportState(input: ImportReviewState = EMPTY_IMPORT_STATE): ImportReviewState {
  assertUniqueIds(input.runs, 'run')
  assertUniqueIds(input.previews, 'preview')
  assertUniqueIds(input.candidates, 'candidate')

  const runIds = new Set(input.runs.map((run) => run.id))
  const previewIds = new Set(input.previews.map((preview) => preview.id))
  const candidateIds = new Set(input.candidates.map((candidate) => candidate.id))

  for (const run of input.runs) {
    assertUniqueReferenceIds(run.previewIds, `run ${run.id} preview`)
    for (const id of run.previewIds) {
      if (!previewIds.has(id)) throw new Error(`Run ${run.id} references unknown preview: ${id}`)
    }
  }
  for (const preview of input.previews) {
    if (!runIds.has(preview.runId)) throw new Error(`Preview ${preview.id} references unknown run: ${preview.runId}`)
    if (!input.runs.find((run) => run.id === preview.runId)?.previewIds.includes(preview.id)) {
      throw new Error(`Preview ${preview.id} is not included by run ${preview.runId}`)
    }
    assertUniqueReferenceIds(preview.candidateIds, `preview ${preview.id} candidate`)
    for (const id of preview.candidateIds) {
      if (!candidateIds.has(id)) throw new Error(`Preview ${preview.id} references unknown candidate: ${id}`)
    }
  }
  for (const candidate of input.candidates) {
    const preview = input.previews.find((item) => item.id === candidate.previewId)
    if (!preview) throw new Error(`Candidate ${candidate.id} references unknown preview: ${candidate.previewId}`)
    if (!preview.candidateIds.includes(candidate.id)) {
      throw new Error(`Candidate ${candidate.id} is not included by preview ${candidate.previewId}`)
    }
    validateCandidateResolution(candidate, input.candidates)
  }

  return {
    runs: input.runs.map((run) => ({ ...run, previewIds: [...run.previewIds] })),
    previews: input.previews.map((preview) => ({
      ...preview,
      candidateIds: [...preview.candidateIds],
      issues: preview.issues.map((issue) => ({ ...issue })),
    })),
    candidates: input.candidates.map((candidate) => ({
      ...candidate,
      issues: candidate.issues.map((issue) => ({ ...issue })),
    })),
  }
}

function assertUniqueReferenceIds(ids: readonly string[], label: string): void {
  if (new Set(ids).size !== ids.length) throw new Error(`Duplicate ${label} ID`)
}

function validateCandidateResolution(
  candidate: ImportCandidate,
  candidates: readonly ImportCandidate[],
): void {
  if (candidate.decision === 'merged') {
    if (!candidate.mergedIntoId) throw new Error(`Merged candidate ${candidate.id} must have a target`)
    if (candidate.mergedIntoId === candidate.id) throw new Error(`Candidate ${candidate.id} cannot merge into itself`)
    const target = candidates.find((item) => item.id === candidate.mergedIntoId)
    if (!target) throw new Error(`Candidate ${candidate.id} has unknown merge target: ${candidate.mergedIntoId}`)
    if (target.previewId !== candidate.previewId) throw new Error('Duplicate candidates must belong to the same preview')
    if (target.decision === 'excluded' || target.decision === 'merged') {
      throw new Error(`Candidate ${candidate.id} cannot merge into an inactive candidate`)
    }
  } else if (candidate.mergedIntoId !== null) {
    throw new Error(`Only merged candidates may have mergedIntoId`)
  }
}

function updateCandidate(
  state: ImportReviewState,
  candidateId: string,
  update: (candidate: ImportCandidate) => ImportCandidate,
): ImportReviewState {
  let found = false
  const candidates = state.candidates.map((candidate) => {
    if (candidate.id !== candidateId) return candidate
    found = true
    return update(candidate)
  })
  if (!found) throw new Error(`Unknown candidate: ${candidateId}`)
  return { ...state, candidates }
}

function requireReviewable(candidate: ImportCandidate): void {
  if (candidate.decision === 'excluded' || candidate.decision === 'merged') {
    throw new Error(`Candidate ${candidate.id} is ${candidate.decision} and cannot be edited`)
  }
}

export function canTransitionImport(from: ImportStatus, to: ImportStatus): boolean {
  return ALLOWED_IMPORT_TRANSITIONS[from].includes(to)
}

export function transitionImportRun(
  state: ImportReviewState,
  runId: string,
  status: ImportStatus,
  failureReason?: string,
): ImportReviewState {
  let found = false
  const runs = state.runs.map((run) => {
    if (run.id !== runId) return run
    found = true
    if (!canTransitionImport(run.status, status)) {
      throw new Error(`Invalid import transition: ${run.status} -> ${status}`)
    }
    if (status === 'failed' && !failureReason?.trim()) {
      throw new Error('A failed import requires a failure reason')
    }
    const next: ImportRun = status === 'failed'
      ? { ...run, status, failureReason: failureReason!.trim() }
      : { id: run.id, previewIds: run.previewIds, status }
    return next
  })
  if (!found) throw new Error(`Unknown import run: ${runId}`)

  const previewIdSet = new Set(runs.find((run) => run.id === runId)!.previewIds)
  const previews = state.previews.map((preview) =>
    previewIdSet.has(preview.id) ? { ...preview, status } : preview,
  )
  return { ...state, runs, previews }
}

export function assignCandidateAccount(
  state: ImportReviewState,
  candidateId: string,
  accountId: string | null,
): ImportReviewState {
  if (accountId !== null) assertNonEmptyId(accountId, 'account')
  return updateCandidate(state, candidateId, (candidate) => {
    requireReviewable(candidate)
    return { ...candidate, accountId }
  })
}

export function correctCandidateCategory(
  state: ImportReviewState,
  candidateId: string,
  categoryId: string | null,
): ImportReviewState {
  if (categoryId !== null) assertNonEmptyId(categoryId, 'category')
  return updateCandidate(state, candidateId, (candidate) => {
    requireReviewable(candidate)
    return { ...candidate, categoryId }
  })
}

export function excludeCandidate(state: ImportReviewState, candidateId: string): ImportReviewState {
  return updateCandidate(state, candidateId, (candidate) => {
    if (state.candidates.some((item) => item.mergedIntoId === candidateId)) {
      throw new Error(`Candidate ${candidateId} is a merge target and cannot be excluded`)
    }
    return { ...candidate, decision: 'excluded', mergedIntoId: null, selected: false }
  })
}

export function mergeDuplicateCandidate(
  state: ImportReviewState,
  duplicateId: string,
  targetId: string,
): ImportReviewState {
  if (duplicateId === targetId) throw new Error(`Candidate ${duplicateId} cannot merge into itself`)
  const duplicate = state.candidates.find((item) => item.id === duplicateId)
  const target = state.candidates.find((item) => item.id === targetId)
  if (!duplicate) throw new Error(`Unknown candidate: ${duplicateId}`)
  if (!target) throw new Error(`Unknown candidate: ${targetId}`)
  requireReviewable(duplicate)
  requireReviewable(target)
  if (duplicate.previewId !== target.previewId) throw new Error('Duplicate candidates must belong to the same preview')
  if (state.candidates.some((item) => item.mergedIntoId === duplicateId)) {
    throw new Error(`Candidate ${duplicateId} is already a merge target`)
  }
  return updateCandidate(state, duplicateId, (candidate) => ({
    ...candidate,
    decision: 'merged',
    mergedIntoId: targetId,
    selected: false,
  }))
}

export function setReceiptCardMatch(
  state: ImportReviewState,
  candidateId: string,
  matched: boolean,
): ImportReviewState {
  return updateCandidate(state, candidateId, (candidate) => {
    requireReviewable(candidate)
    return { ...candidate, receiptCardMatched: matched }
  })
}

export function setCandidateSelected(
  state: ImportReviewState,
  candidateId: string,
  selected: boolean,
): ImportReviewState {
  return updateCandidate(state, candidateId, (candidate) => {
    requireReviewable(candidate)
    return { ...candidate, selected }
  })
}

/** Selects active candidates in a preview; inactive candidates stay unselected. */
export function selectPreviewCandidates(
  state: ImportReviewState,
  previewId: string,
  selected: boolean,
): ImportReviewState {
  const preview = state.previews.find((item) => item.id === previewId)
  if (!preview) throw new Error(`Unknown preview: ${previewId}`)
  const ids = new Set(preview.candidateIds)
  return {
    ...state,
    candidates: state.candidates.map((candidate) =>
      ids.has(candidate.id) && candidate.decision !== 'excluded' && candidate.decision !== 'merged'
        ? { ...candidate, selected }
        : candidate,
    ),
  }
}

function assertApprovable(candidate: ImportCandidate): void {
  requireReviewable(candidate)
  if (!candidate.accountId) throw new Error(`Candidate ${candidate.id} requires an account before approval`)
  if (candidate.issues.some((issue) => issue.severity === 'error')) {
    throw new Error(`Candidate ${candidate.id} has unresolved errors`)
  }
}

export function approveCandidate(state: ImportReviewState, candidateId: string): ImportReviewState {
  return updateCandidate(state, candidateId, (candidate) => {
    assertApprovable(candidate)
    return { ...candidate, decision: 'approved', selected: false }
  })
}

/** Atomically approves selected candidates. No partial change occurs on error. */
export function bulkApproveSelected(state: ImportReviewState): ImportReviewState {
  const selected = state.candidates.filter((candidate) => candidate.selected)
  if (selected.length === 0) throw new Error('No candidates are selected')
  selected.forEach(assertApprovable)
  const ids = new Set(selected.map((candidate) => candidate.id))
  return {
    ...state,
    candidates: state.candidates.map((candidate) =>
      ids.has(candidate.id) ? { ...candidate, decision: 'approved', selected: false } : candidate,
    ),
  }
}

export function countImportIssues(state: ImportReviewState): IssueCounts {
  const issues = [
    ...state.previews.flatMap((preview) => preview.issues),
    ...state.candidates.flatMap((candidate) => candidate.issues),
  ]
  const errors = issues.filter((issue) => issue.severity === 'error').length
  const warnings = issues.length - errors
  return { errors, warnings, total: issues.length }
}

export function isRollbackEligible(run: ImportRun): boolean {
  return run.status === 'review' || run.status === 'ready' || run.status === 'failed'
}

export function deriveInboxSummary(state: ImportReviewState): InboxSummary {
  const issueCounts = countImportIssues(state)
  const countDecision = (decision: CandidateDecision) =>
    state.candidates.filter((candidate) => candidate.decision === decision).length
  return {
    ...issueCounts,
    runs: state.runs.length,
    files: state.previews.length,
    candidates: state.candidates.length,
    pending: countDecision('pending'),
    approved: countDecision('approved'),
    excluded: countDecision('excluded'),
    merged: countDecision('merged'),
    selected: state.candidates.filter((candidate) => candidate.selected).length,
    possibleDuplicates: state.candidates.filter((candidate) => candidate.mergedIntoId !== null).length,
    receiptCardMatches: state.candidates.filter((candidate) => candidate.receiptCardMatched).length,
    reviewRequired: state.candidates.filter((candidate) =>
      candidate.decision === 'pending' || candidate.issues.some((issue) => issue.severity === 'error'),
    ).length,
    readyToPost: state.candidates.filter((candidate) => candidate.decision === 'approved').length,
    failedRuns: state.runs.filter((run) => run.status === 'failed').length,
    postedRuns: state.runs.filter((run) => run.status === 'posted').length,
  }
}
