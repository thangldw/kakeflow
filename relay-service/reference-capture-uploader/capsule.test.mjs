import assert from 'node:assert/strict'
import { test } from 'node:test'
import { buildCaptureCapsule, normalizedEndpoint, sha256 } from './capsule.mjs'

test('builds deterministic binary capsules whose manifest covers image and audience', async () => {
  const png = new Uint8Array([137,80,78,71,13,10,26,10,0,0,0,13,73,72,68,82,0,0,0,1,0,0,0,1,8,2,0,0,0])
  const input = {
    captureId: 'capture-1', householdId: 'family', originDeviceId: 'phone-1', capturedAt: '2026-07-14T00:00:00.000Z',
    originalFilename: 'receipt.png', mediaType: 'image/png', audienceVisibility: 'PERSONAL', audienceMemberId: 'member-1', imageBytes: png,
  }
  const first = await buildCaptureCapsule(input)
  const second = await buildCaptureCapsule(input)
  assert.deepEqual(first.bytes, second.bytes)
  assert.equal(first.digest, await sha256(first.bytes))
  assert.equal(first.manifest.imageSha256, await sha256(input.imageBytes))
  assert.deepEqual(first.manifest.audience, { visibility: 'PERSONAL', memberId: 'member-1' })
})

test('rejects MIME spoofing and excessive image dimensions before upload', async () => {
  const base = { captureId: 'capture-1', householdId: 'family', originDeviceId: 'phone-1', capturedAt: '2026-07-14T00:00:00.000Z', originalFilename: 'receipt.png', audienceVisibility: 'SHARED', audienceMemberId: null }
  await assert.rejects(buildCaptureCapsule({ ...base, mediaType: 'image/png', imageBytes: new Uint8Array([1, 2, 3]) }))
  const huge = new Uint8Array([137,80,78,71,13,10,26,10,0,0,0,13,73,72,68,82,0,0,0,1,0,0,78,33,8,2,0,0,0])
  await assert.rejects(buildCaptureCapsule({ ...base, mediaType: 'image/png', imageBytes: huge }))
})

test('accepts HTTPS and loopback HTTP endpoints only', () => {
  assert.equal(normalizedEndpoint('https://relay.example/'), 'https://relay.example')
  assert.equal(normalizedEndpoint('http://127.0.0.1:8787/'), 'http://127.0.0.1:8787')
  assert.throws(() => normalizedEndpoint('http://relay.example'))
})
