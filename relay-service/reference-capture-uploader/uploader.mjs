import { buildCaptureCapsule, CAPSULE_SCHEMA, MAX_IMAGE_BYTES, normalizedEndpoint } from './capsule.mjs'

const form = document.querySelector('form')
const endpointInput = document.querySelector('#endpoint')
const tokenInput = document.querySelector('#token')
const householdSelect = document.querySelector('#household')
const audienceFieldset = document.querySelector('#audience')
const fileInput = document.querySelector('#receipt')
const connectButton = document.querySelector('#connect')
const sendButton = document.querySelector('#send')
const status = document.querySelector('#status')
const deviceId = `browser-${crypto.randomUUID()}`
let memberships = []
let pending = null

function announce(message, state = 'info') {
  status.textContent = message
  status.dataset.state = state
}

async function relayRequest(path, init = {}) {
  const endpoint = normalizedEndpoint(endpointInput.value.trim())
  const token = tokenInput.value.trim()
  if (!token) throw new Error('Bearer token を入力してください。')
  const response = await fetch(`${endpoint}${path}`, {
    ...init,
    headers: { Authorization: `Bearer ${token}`, ...init.headers },
    signal: AbortSignal.timeout(15_000),
  })
  if (!response.ok) {
    const body = await response.json().catch(() => ({}))
    throw new Error(typeof body.error === 'string' ? body.error : `Relay error ${response.status}`)
  }
  return response
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
    sendButton.disabled = memberships.length === 0
    announce(memberships.length > 0 ? '接続しました。送信先とレシートを確認してください。' : '有効な家族メンバー登録がありません。', memberships.length > 0 ? 'success' : 'error')
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
  if (!membership || !file || !['SHARED', 'PERSONAL'].includes(String(visibility))) return announce('送信先とレシート画像を確認してください。', 'error')
  if (!['image/jpeg', 'image/png'].includes(file.type) || file.size < 1 || file.size > MAX_IMAGE_BYTES) return announce('JPEG/PNG（20 MiB 以下）を選択してください。', 'error')
  sendButton.disabled = true
  announce('レシート capsule を作成しています…')
  try {
    const memberId = visibility === 'PERSONAL' ? membership.domainMemberId : null
    const retryKey = JSON.stringify([membership.householdId, visibility, memberId, file.name, file.type, file.size, file.lastModified])
    if (pending?.retryKey !== retryKey) {
      const captureId = `capture-${crypto.randomUUID()}`
      const capsule = await buildCaptureCapsule({
        captureId, householdId: membership.householdId, originDeviceId: deviceId,
        capturedAt: new Date().toISOString(), originalFilename: file.name,
        mediaType: file.type, audienceVisibility: visibility, audienceMemberId: memberId,
        imageBytes: new Uint8Array(await file.arrayBuffer()),
      })
      pending = { retryKey, captureId, capsule }
    }
    const { captureId, capsule } = pending
    const headers = {
      'Content-Type': 'application/octet-stream',
      'X-KakeFlow-Capture-Id': captureId, 'X-KakeFlow-Digest': capsule.digest,
      'X-KakeFlow-Origin-Device-Id': deviceId,
      'X-KakeFlow-Audience-Visibility': visibility,
      'X-KakeFlow-Capsule-Schema': CAPSULE_SCHEMA,
    }
    if (memberId) headers['X-KakeFlow-Audience-Member-Id'] = memberId
    const response = await relayRequest(`/v2/households/${encodeURIComponent(membership.householdId)}/captures`, { method: 'POST', headers, body: capsule.bytes })
    const accepted = await response.json()
    if (accepted.capture?.captureId !== captureId || accepted.capture?.digest !== capsule.digest) throw new Error('Relay acceptance did not match this capture.')
    pending = null
    form.reset()
    householdSelect.value = membership.householdId
    announce('受け付けました。KakeFlow desktop の「Capture Inbox」で確認してください。', 'success')
  } catch (error) {
    announce(`${error instanceof Error ? error.message : '送信できませんでした。'} 入力を変えずに再送すると同じ capture ID で再試行します。`, 'error')
  } finally { sendButton.disabled = memberships.length === 0 }
})
