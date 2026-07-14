export const CAPTURE_QUEUE_SCHEMA = 1
export const MAX_AUTOMATIC_ATTEMPTS = 5
export const CAPTURE_QUEUE_STATES = Object.freeze(['QUEUED', 'UPLOADING', 'RETRY_WAIT', 'DELIVERED', 'NEEDS_ATTENTION'])

const RETRY_DELAYS_MS = Object.freeze([5_000, 15_000, 60_000, 5 * 60_000])

function assertRecord(record) {
  if (!record || record.schemaVersion !== CAPTURE_QUEUE_SCHEMA) throw new Error('Unsupported capture queue record.')
  if (!CAPTURE_QUEUE_STATES.includes(record.state)) throw new Error('Invalid capture queue state.')
  if (!(record.capsuleBytes instanceof Uint8Array) || record.capsuleBytes.byteLength < 1) throw new Error('Capture capsule bytes are missing.')
  if (typeof record.captureId !== 'string' || typeof record.digest !== 'string') throw new Error('Capture identity is missing.')
  return record
}

export function createQueuedCapture(input, now = Date.now()) {
  if (!(input.capsuleBytes instanceof Uint8Array)) throw new Error('Capture capsule bytes are missing.')
  return assertRecord({
    schemaVersion: CAPTURE_QUEUE_SCHEMA,
    captureId: input.captureId,
    digest: input.digest,
    capsuleBytes: new Uint8Array(input.capsuleBytes),
    relayEndpoint: input.relayEndpoint,
    householdId: input.householdId,
    originDeviceId: input.originDeviceId,
    audienceVisibility: input.audienceVisibility,
    audienceMemberId: input.audienceMemberId ?? null,
    originalFilename: input.originalFilename,
    mediaType: input.mediaType,
    createdAt: now,
    updatedAt: now,
    state: 'QUEUED',
    attemptCount: 0,
    nextAttemptAt: now,
    lastErrorCode: null,
  })
}

export function recoverCapture(record, now = Date.now()) {
  const current = assertRecord(record)
  if (current.state !== 'UPLOADING') return current
  return { ...current, state: 'QUEUED', nextAttemptAt: now, updatedAt: now, lastErrorCode: 'INTERRUPTED' }
}

export function isCaptureDue(record, now = Date.now()) {
  const current = assertRecord(record)
  return (current.state === 'QUEUED' || current.state === 'RETRY_WAIT') && current.nextAttemptAt <= now
}

export function beginCaptureUpload(record, now = Date.now()) {
  const current = assertRecord(record)
  if (!isCaptureDue(current, now)) throw new Error('Capture is not ready for upload.')
  return { ...current, state: 'UPLOADING', attemptCount: current.attemptCount + 1, updatedAt: now, lastErrorCode: null }
}

export function markCaptureDelivered(record, accepted, now = Date.now()) {
  const current = assertRecord(record)
  if (current.state !== 'UPLOADING') throw new Error('Capture is not uploading.')
  if (accepted?.captureId !== current.captureId || accepted?.digest !== current.digest) {
    return { ...current, state: 'NEEDS_ATTENTION', updatedAt: now, nextAttemptAt: now, lastErrorCode: 'ACCEPTANCE_MISMATCH' }
  }
  return { ...current, state: 'DELIVERED', updatedAt: now, nextAttemptAt: now, lastErrorCode: null }
}

export function markCaptureUploadFailed(record, errorCode, retryable, now = Date.now()) {
  const current = assertRecord(record)
  if (current.state !== 'UPLOADING') throw new Error('Capture is not uploading.')
  const canRetry = retryable && current.attemptCount < MAX_AUTOMATIC_ATTEMPTS
  const delay = RETRY_DELAYS_MS[Math.min(Math.max(current.attemptCount - 1, 0), RETRY_DELAYS_MS.length - 1)]
  return {
    ...current,
    state: canRetry ? 'RETRY_WAIT' : 'NEEDS_ATTENTION',
    nextAttemptAt: canRetry ? now + delay : now,
    updatedAt: now,
    lastErrorCode: errorCode,
  }
}

export function retryCaptureManually(record, now = Date.now()) {
  const current = assertRecord(record)
  if (current.state !== 'NEEDS_ATTENTION' && current.state !== 'RETRY_WAIT') throw new Error('Capture does not need a retry.')
  return { ...current, state: 'QUEUED', attemptCount: 0, nextAttemptAt: now, updatedAt: now, lastErrorCode: null }
}

export function copyCapsuleBytes(record) {
  return new Uint8Array(assertRecord(record).capsuleBytes)
}
