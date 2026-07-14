import assert from 'node:assert/strict'
import { test } from 'node:test'
import {
  MAX_AUTOMATIC_ATTEMPTS,
  beginCaptureUpload,
  copyCapsuleBytes,
  createQueuedCapture,
  isCaptureDue,
  markCaptureDelivered,
  markCaptureUploadFailed,
  recoverCapture,
  retryCaptureManually,
} from './capture-queue.mjs'

const queueInput = () => ({
  captureId: 'capture-1', digest: 'a'.repeat(64), capsuleBytes: new Uint8Array([1, 2, 3]),
  relayEndpoint: 'https://relay.example', householdId: 'family', originDeviceId: 'phone-1',
  audienceVisibility: 'SHARED', audienceMemberId: null, originalFilename: 'receipt.png', mediaType: 'image/png',
})

test('persists exact capsule identity and bytes before the first upload', () => {
  const input = queueInput()
  const queued = createQueuedCapture(input, 100)
  input.capsuleBytes[0] = 9
  assert.equal(queued.state, 'QUEUED')
  assert.equal(queued.attemptCount, 0)
  assert.deepEqual(copyCapsuleBytes(queued), new Uint8Array([1, 2, 3]))
  assert.equal(queued.captureId, 'capture-1')
  assert.equal(queued.digest, 'a'.repeat(64))
})

test('recovers an interrupted upload without changing its immutable capsule', () => {
  const uploading = beginCaptureUpload(createQueuedCapture(queueInput(), 100), 100)
  const recovered = recoverCapture(uploading, 200)
  assert.equal(recovered.state, 'QUEUED')
  assert.equal(recovered.attemptCount, 1)
  assert.equal(recovered.lastErrorCode, 'INTERRUPTED')
  assert.deepEqual(copyCapsuleBytes(recovered), copyCapsuleBytes(uploading))
})

test('uses bounded automatic retries and requires attention after the limit', () => {
  let record = createQueuedCapture(queueInput(), 0)
  for (let attempt = 1; attempt <= MAX_AUTOMATIC_ATTEMPTS; attempt += 1) {
    record = beginCaptureUpload(record, record.nextAttemptAt)
    record = markCaptureUploadFailed(record, 'NETWORK_ERROR', true, record.updatedAt)
    assert.equal(record.attemptCount, attempt)
    assert.equal(record.state, attempt === MAX_AUTOMATIC_ATTEMPTS ? 'NEEDS_ATTENTION' : 'RETRY_WAIT')
  }
  const retried = retryCaptureManually(record, 999)
  assert.equal(retried.state, 'QUEUED')
  assert.equal(retried.attemptCount, 0)
  assert.equal(isCaptureDue(retried, 999), true)
})

test('accepts only a matching relay receipt and does not retry permanent errors automatically', () => {
  const input = queueInput()
  const uploading = beginCaptureUpload(createQueuedCapture(input, 10), 10)
  const mismatch = markCaptureDelivered(uploading, { captureId: 'other', digest: input.digest }, 20)
  assert.equal(mismatch.state, 'NEEDS_ATTENTION')
  assert.equal(mismatch.lastErrorCode, 'ACCEPTANCE_MISMATCH')

  const rejected = markCaptureUploadFailed(uploading, 'RELAY_REJECTED', false, 20)
  assert.equal(rejected.state, 'NEEDS_ATTENTION')

  const delivered = markCaptureDelivered(uploading, { captureId: input.captureId, digest: input.digest }, 20)
  assert.equal(delivered.state, 'DELIVERED')
  assert.equal(delivered.lastErrorCode, null)
})
