import { buildCaptureCapsule, CAPSULE_SCHEMA, MAX_IMAGE_BYTES, normalizedEndpoint } from './capsule.mjs'
import {
  beginCaptureUpload,
  createQueuedCapture,
  isCaptureDue,
  markCaptureDelivered,
  markCaptureUploadFailed,
  recoverCapture,
  retryCaptureManually,
} from './capture-queue.mjs'
import { openCaptureQueueStore } from './capture-queue-store.mjs'

const form = document.querySelector('form')
const endpointInput = document.querySelector('#endpoint')
const tokenInput = document.querySelector('#token')
const householdSelect = document.querySelector('#household')
const audienceFieldset = document.querySelector('#audience')
const fileInput = document.querySelector('#receipt')
const connectButton = document.querySelector('#connect')
const sendButton = document.querySelector('#send')
const status = document.querySelector('#status')
const queueList = document.querySelector('#queue-list')
const queueCount = document.querySelector('#queue-count')
const deviceId = `browser-${crypto.randomUUID()}`
let memberships = []
let queueStore = null
let queueRecords = []
let queueRunning = false
let retryTimer = null

class RelayError extends Error {
  constructor(message, retryable) {
    super(message)
    this.retryable = retryable
  }
}

function announce(message, state = 'info') {
  status.textContent = message
  status.dataset.state = state
}

async function relayRequest(path, init = {}, endpointOverride = null) {
  const endpoint = endpointOverride ?? normalizedEndpoint(endpointInput.value.trim())
  const token = tokenInput.value.trim()
  if (!token) throw new RelayError('Bearer token を入力してください。', false)
  let response
  try {
    response = await fetch(`${endpoint}${path}`, {
      ...init,
      headers: { Authorization: `Bearer ${token}`, ...init.headers },
      signal: AbortSignal.timeout(15_000),
    })
  } catch {
    throw new RelayError('Relay に接続できませんでした。', true)
  }
  if (!response.ok) {
    const body = await response.json().catch(() => ({}))
    throw new RelayError(typeof body.error === 'string' ? body.error : `Relay error ${response.status}`, response.status >= 500 || response.status === 408 || response.status === 429)
  }
  return response
}

function stateLabel(record) {
  return {
    QUEUED: '送信待ち', UPLOADING: '送信中', RETRY_WAIT: '自動再試行待ち', DELIVERED: 'Relay 受付済み', NEEDS_ATTENTION: '確認が必要',
  }[record.state]
}

function renderQueue() {
  queueCount.textContent = `${queueRecords.filter((record) => record.state !== 'DELIVERED').length} 件待ち`
  queueList.replaceChildren(...queueRecords.map((record) => {
    const item = document.createElement('li')
    item.dataset.state = record.state
    const content = document.createElement('span')
    const title = document.createElement('strong')
    title.textContent = record.originalFilename
    const detail = document.createElement('small')
    detail.textContent = `${stateLabel(record)} ・ 試行 ${record.attemptCount}${record.lastErrorCode ? ` ・ ${record.lastErrorCode}` : ''}`
    content.append(title, detail)
    const actions = document.createElement('span')
    actions.className = 'queue-actions'
    if (record.state === 'NEEDS_ATTENTION' || record.state === 'RETRY_WAIT') {
      const retry = document.createElement('button')
      retry.type = 'button'; retry.dataset.action = 'retry'; retry.dataset.captureId = record.captureId; retry.textContent = '再試行'
      actions.append(retry)
    }
    if (record.state === 'DELIVERED') {
      const remove = document.createElement('button')
      remove.type = 'button'; remove.dataset.action = 'remove'; remove.dataset.captureId = record.captureId; remove.textContent = '履歴から削除'
      actions.append(remove)
    }
    item.append(content, actions)
    return item
  }))
  if (queueRecords.length === 0) {
    const empty = document.createElement('li')
    empty.className = 'queue-empty'; empty.textContent = '保存済みの送信はありません。'
    queueList.append(empty)
  }
}

async function persist(record) {
  await queueStore.put(record)
  queueRecords = queueRecords.map((item) => item.captureId === record.captureId ? record : item)
  renderQueue()
}

function scheduleQueue() {
  clearTimeout(retryTimer)
  const next = queueRecords
    .filter((record) => record.state === 'QUEUED' || record.state === 'RETRY_WAIT')
    .reduce((value, record) => Math.min(value, record.nextAttemptAt), Number.POSITIVE_INFINITY)
  if (Number.isFinite(next)) retryTimer = setTimeout(() => void processQueue(), Math.min(Math.max(next - Date.now(), 250), 60_000))
}

async function uploadCapture(record) {
  const headers = {
    'Content-Type': 'application/octet-stream',
    'X-KakeFlow-Capture-Id': record.captureId,
    'X-KakeFlow-Digest': record.digest,
    'X-KakeFlow-Origin-Device-Id': record.originDeviceId,
    'X-KakeFlow-Audience-Visibility': record.audienceVisibility,
    'X-KakeFlow-Capsule-Schema': CAPSULE_SCHEMA,
  }
  if (record.audienceMemberId) headers['X-KakeFlow-Audience-Member-Id'] = record.audienceMemberId
  const response = await relayRequest(`/v2/households/${encodeURIComponent(record.householdId)}/captures`, { method: 'POST', headers, body: record.capsuleBytes }, record.relayEndpoint)
  return (await response.json()).capture
}

async function processQueue() {
  if (queueRunning || !queueStore || !tokenInput.value.trim() || !navigator.onLine) return scheduleQueue()
  let currentEndpoint
  try { currentEndpoint = normalizedEndpoint(endpointInput.value.trim()) } catch { return }
  queueRunning = true
  try {
    while (navigator.onLine) {
      const record = queueRecords.find((item) => item.relayEndpoint === currentEndpoint && isCaptureDue(item))
      if (!record) break
      const uploading = beginCaptureUpload(record)
      await persist(uploading)
      announce(`${uploading.originalFilename} を Relay へ送信しています…`)
      try {
        const accepted = await uploadCapture(uploading)
        const delivered = markCaptureDelivered(uploading, accepted)
        await persist(delivered)
        announce(delivered.state === 'DELIVERED'
          ? '受け付けました。KakeFlow desktop の「Capture Inbox」で確認してください。'
          : 'Relay の受付結果が一致しません。キューを確認してください。', delivered.state === 'DELIVERED' ? 'success' : 'error')
      } catch (error) {
        const relayError = error instanceof RelayError ? error : new RelayError('送信できませんでした。', true)
        const failed = markCaptureUploadFailed(uploading, relayError.retryable ? 'NETWORK_ERROR' : 'RELAY_REJECTED', relayError.retryable)
        await persist(failed)
        announce(`${relayError.message} レシートは端末内のキューに保存されています。`, 'error')
      }
    }
  } finally {
    queueRunning = false
    scheduleQueue()
  }
}

connectButton.addEventListener('click', async () => {
  connectButton.disabled = true
  announce('Relay のメンバー情報を確認しています…')
  try {
    const value = await (await relayRequest('/v2/whoami')).json()
    memberships = Array.isArray(value.memberships) ? value.memberships.filter((item) => item.state === 'ACTIVE') : []
    householdSelect.replaceChildren(...memberships.map((item) => new Option(`${item.householdId} · ${item.domainMemberId}`, item.householdId)))
    householdSelect.disabled = memberships.length === 0
    audienceFieldset.disabled = memberships.length === 0
    sendButton.disabled = memberships.length === 0 || !queueStore
    announce(memberships.length > 0 ? '接続しました。保存済みキューを確認して送信します。' : '有効な家族メンバー登録がありません。', memberships.length > 0 ? 'success' : 'error')
    await processQueue()
  } catch (error) {
    memberships = []
    householdSelect.replaceChildren()
    sendButton.disabled = true
    announce(error instanceof Error ? error.message : '接続できませんでした。', 'error')
  } finally { connectButton.disabled = false }
})

form.addEventListener('submit', async (event) => {
  event.preventDefault()
  const file = fileInput.files?.[0]
  const membership = memberships.find((item) => item.householdId === householdSelect.value)
  const visibility = new FormData(form).get('visibility')
  if (!queueStore) return announce('永続キューを利用できません。', 'error')
  if (!membership || !file || !['SHARED', 'PERSONAL'].includes(String(visibility))) return announce('送信先とレシート画像を確認してください。', 'error')
  if (!['image/jpeg', 'image/png'].includes(file.type) || file.size < 1 || file.size > MAX_IMAGE_BYTES) return announce('JPEG/PNG（20 MiB 以下）を選択してください。', 'error')
  sendButton.disabled = true
  announce('レシートを端末内のキューへ保存しています…')
  try {
    const relayEndpoint = normalizedEndpoint(endpointInput.value.trim())
    const audienceMemberId = visibility === 'PERSONAL' ? membership.domainMemberId : null
    const captureId = `capture-${crypto.randomUUID()}`
    const capsule = await buildCaptureCapsule({
      captureId, householdId: membership.householdId, originDeviceId: deviceId,
      capturedAt: new Date().toISOString(), originalFilename: file.name,
      mediaType: file.type, audienceVisibility: visibility, audienceMemberId,
      imageBytes: new Uint8Array(await file.arrayBuffer()),
    })
    const queued = createQueuedCapture({
      captureId, digest: capsule.digest, capsuleBytes: capsule.bytes, relayEndpoint,
      householdId: membership.householdId, originDeviceId: deviceId,
      audienceVisibility: visibility, audienceMemberId, originalFilename: file.name, mediaType: file.type,
    })
    await queueStore.put(queued)
    queueRecords.push(queued)
    renderQueue()
    form.reset()
    householdSelect.value = membership.householdId
    announce('端末内の永続キューへ保存しました。接続でき次第、同じ capture ID と bytes で送信します。', 'success')
    await processQueue()
  } catch (error) {
    announce(error instanceof Error ? error.message : 'キューへ保存できませんでした。', 'error')
  } finally { sendButton.disabled = memberships.length === 0 || !queueStore }
})

queueList.addEventListener('click', async (event) => {
  const button = event.target.closest('button[data-action]')
  if (!button || !queueStore) return
  const record = queueRecords.find((item) => item.captureId === button.dataset.captureId)
  if (!record) return
  if (button.dataset.action === 'retry') {
    await persist(retryCaptureManually(record))
    announce('再試行を予約しました。Relay に接続してください。')
    await processQueue()
  } else if (button.dataset.action === 'remove' && record.state === 'DELIVERED') {
    await queueStore.delete(record.captureId)
    queueRecords = queueRecords.filter((item) => item.captureId !== record.captureId)
    renderQueue()
  }
})

window.addEventListener('online', () => void processQueue())

async function initializeQueue() {
  try {
    queueStore = await openCaptureQueueStore()
    queueRecords = await queueStore.list()
    for (const record of queueRecords) {
      const recovered = recoverCapture(record)
      if (recovered !== record) await queueStore.put(recovered)
    }
    queueRecords = await queueStore.list()
    renderQueue()
  } catch (error) {
    queueStore = null
    sendButton.disabled = true
    announce(error instanceof Error ? error.message : '永続キューを開始できませんでした。', 'error')
  }
}

renderQueue()
void initializeQueue()
